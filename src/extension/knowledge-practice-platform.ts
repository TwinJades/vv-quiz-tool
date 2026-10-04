import {KnowledgePracticeOrchestrator,validateKnowledgeScope} from '../core/knowledge-practice';
import type {KnowledgeAdapter,KnowledgeCatalog,KnowledgePoint,PracticeChild} from '../core/knowledge-practice';
import {courseModels} from '../core/course';
import {QuizOrchestrator} from '../core/orchestrator';
import type {RuntimePlatform,SessionRuntimeSnapshot} from '../core/orchestrator';
import type {ModelCallBudget} from '../core/call-budget';
import type {ProviderProfile,RunStrategy} from '../core/schema';
import {VercelAiSolverProvider} from '../provider/solver-provider';
import {WebVerifier} from '../web/verifier';
import {ensureContentInjected,TabPlatformProxy} from './tab-platform';
import {requireCurrentWebsite,websiteIsAuthorized} from './website-access';
import type {ContentResponse} from './messages';
import type {KnowledgePageRequest,KnowledgePageState} from '../web/knowledge-practice-page';

export class KnowledgeTabPlatform implements KnowledgeAdapter {
  #epoch=crypto.randomUUID();#enabled=false;#document:string|null=null;#child:TabPlatformProxy|null=null;
  #modelId:string|null;
  constructor(readonly tabId:number,readonly sessionId:string,readonly initial:KnowledgeCatalog,modelId:string|null=null){this.#modelId=modelId;}
  interactionMatches(id:string,epoch:string):boolean{return this.#child?.interactionMatches(id,epoch)===true||this.#enabled&&id===this.sessionId&&epoch===this.#epoch;}
  async #permission(signal:AbortSignal):Promise<chrome.webNavigation.GetFrameResultDetails>{
    signal.throwIfAborted();await requireCurrentWebsite(this.tabId);signal.throwIfAborted();
    const frame=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:0});
    if(!frame||!await websiteIsAuthorized(frame.url))throw new Error('当前知到课程页面没有授权。');signal.throwIfAborted();return frame;
  }
  async enableInteraction(_session=this.sessionId):Promise<void>{
    this.#enabled=false;this.#epoch=crypto.randomUUID();const frames=await ensureContentInjected(this.tabId);
    try{for(const frameId of frames){const response=await chrome.tabs.sendMessage(this.tabId,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:true}},{frameId});if(!response?.ok)throw new Error(response?.error??'人工操作保护安装失败。');}
      this.#document=(await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:0}))?.documentId??null;this.#enabled=true;
    }catch(e){await this.disableInteraction();throw e;}
  }
  async disableInteraction():Promise<void>{this.#enabled=false;await this.#child?.disableInteraction();await chrome.tabs.sendMessage(this.tabId,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:false}},{frameId:0}).catch(()=>{});}
  async #page<T>(request:KnowledgePageRequest,signal:AbortSignal):Promise<T>{
    const frame=await this.#permission(signal);
    if(!this.#enabled||frame.documentId!==this.#document){await this.enableInteraction();signal.throwIfAborted();}
    const response=await chrome.tabs.sendMessage(this.tabId,{type:'VV_KNOWLEDGE_PAGE',request,session_id:this.sessionId,interaction_epoch:this.#epoch},{frameId:0}) as ContentResponse;
    signal.throwIfAborted();if(!response?.ok)throw new Error(response?.error??'知识点页面连接中断。');return response.result as T;
  }
  async catalog(signal:AbortSignal):Promise<KnowledgeCatalog>{
    const frame=await this.#permission(signal);
    if(new URL(frame.url).pathname===`/singleCourse/knowledgeStudy/${this.initial.course_id}/${this.initial.context_id}`)return this.#page({operation:'catalog'},signal);
    // An interrupted two-step entry resumes on the same selected point. This
    // cached list does not assert that the whole directory is complete.
    return structuredClone(this.initial);
  }
  #request(operation:Exclude<KnowledgePageRequest,{operation:'catalog'}>['operation'],point:KnowledgePoint):KnowledgePageRequest{return {operation,course_id:this.initial.course_id,context_id:this.initial.context_id,point};}
  async #state(point:KnowledgePoint,signal:AbortSignal):Promise<KnowledgePageState>{return this.#page(this.#request('state',point),signal);}
  async #wait(point:KnowledgePoint,signal:AbortSignal,ready:(s:KnowledgePageState)=>boolean):Promise<KnowledgePageState>{
    for(let i=0;i<100;i++){
      signal.throwIfAborted();const state=await this.#state(point,signal);
      if(state.navigation.stage==='learner'&&state.has_video&&!state.paused)await this.#page(this.#request('pause',point),signal);
      else if(ready(state))return state;
      await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},200);signal.addEventListener('abort',abort,{once:true});});
    }
    throw new Error('知识点页面或正常导航20秒内未确认，已停止。');
  }
  async prepare(point:KnowledgePoint,signal:AbortSignal):Promise<'practice'|'existing_record'|'no_practice'>{
    const muted=await chrome.tabs.update(this.tabId,{muted:true});signal.throwIfAborted();if(!muted?.mutedInfo?.muted)throw new Error('进入知识点前标签静音未确认。');
    let state=await this.#state(point,signal);
    if(state.navigation.stage==='directory')await this.#page(this.#request('enter',point),signal);
    state=await this.#wait(point,signal,s=>s.no_practice||s.navigation.ready&&['learner','mastery_history','practice'].includes(s.navigation.stage));
    if(state.no_practice)return 'no_practice';
    if(state.navigation.stage==='learner')await this.#page(this.#request('improve',point),signal);
    state=await this.#wait(point,signal,s=>s.navigation.stage==='practice'&&s.navigation.ready||s.navigation.stage==='mastery_history'&&s.navigation.ready&&(s.history_empty||s.history_count>0));
    if(state.navigation.stage==='mastery_history'){
      if(state.history_count>0)return 'existing_record';
      // Re-read rendered empty history rather than inferring absence from mastery.
      await new Promise(r=>setTimeout(r,1000));signal.throwIfAborted();state=await this.#state(point,signal);
      if(state.history_count>0)return 'existing_record';if(!state.history_empty)throw new Error('历史记录状态尚未确认。');
      await this.#page(this.#request('improve',point),signal);
      state=await this.#wait(point,signal,s=>s.navigation.stage==='practice'&&s.navigation.ready);
    }
    if(state.navigation.stage!=='practice'||!state.navigation.exercise_id)throw new Error('未确认关联知识点练习，禁止答题。');return 'practice';
  }
  async returnToDirectory(point:KnowledgePoint,signal:AbortSignal):Promise<void>{
    this.#enabled=false; // Rebind the parent after the child's final submission.
    let state=await this.#state(point,signal);if(state.navigation.stage==='directory')return;
    const muted=await chrome.tabs.update(this.tabId,{muted:true});signal.throwIfAborted();if(!muted?.mutedInfo?.muted)throw new Error('返回学习页前静音未确认。');
    if(state.navigation.stage==='result'||state.navigation.stage==='mastery_history')await this.#page(this.#request('back',point),signal);
    state=await this.#wait(point,signal,s=>s.navigation.stage==='learner'&&s.navigation.ready&&(!s.has_video||s.paused===true));
    await this.#page(this.#request('directory',point),signal);await this.#wait(point,signal,s=>s.navigation.stage==='directory'&&s.navigation.ready);
    this.#child=null;
  }
  async pausePlayback(point:KnowledgePoint):Promise<void>{
    const signal=new AbortController().signal;await this.#permission(signal);await ensureContentInjected(this.tabId);
    // A disabled matching binding permits only the restricted normal pause.
    await chrome.tabs.sendMessage(this.tabId,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:false}},{frameId:0});
    const response=await chrome.tabs.sendMessage(this.tabId,{type:'VV_KNOWLEDGE_PAGE',request:this.#request('pause',point),session_id:this.sessionId,interaction_epoch:this.#epoch},{frameId:0});
    if(!response?.ok||response.result!==true)throw new Error('视频暂停未确认。');
  }
  async makeChild(point:KnowledgePoint,profile:ProviderProfile,key:string|undefined,budget:ModelCallBudget,strategy:()=>RunStrategy,onUpdate:()=>void,signal:AbortSignal,modelChanged:(id:string,reason:string)=>void=()=>{}):Promise<PracticeChild>{
    const state=await this.#state(point,signal);
    if(state.navigation.stage!=='practice'||!state.navigation.ready)throw new Error('知识点练习边界不明确。');
    const exercise=state.navigation.exercise_id!,proxy=new TabPlatformProxy(this.tabId,'structured');this.#child=proxy;
    const childId=crypto.randomUUID();await proxy.enableInteraction(childId);signal.throwIfAborted();this.#enabled=false;
    // The proxy owns its cancellation epoch and final-submit receipt. Checking
    // public route identities here confines all generic quiz writes to this child.
    const bound=async(s:AbortSignal,writing=false)=>{const frame=await this.#permission(s),url=new URL(frame.url);const resultPath=`/point/${this.initial.course_id}/`;
      const practice=url.origin==='https://studentexamcomh5.zhihuishu.com'&&url.pathname.startsWith(`/studentReviewTestOrExam/${exercise}/1/1/${this.initial.course_id}/`)&&
        url.searchParams.getAll('pointId').length===1&&url.searchParams.get('pointId')===point.id&&url.searchParams.getAll('classId').length===1&&url.searchParams.get('classId')===this.initial.context_id;
      const result=url.origin==='https://ai-smart-course-student-pro.zhihuishu.com'&&url.pathname.startsWith(resultPath)&&url.pathname.endsWith(`/${exercise}/${point.id}/${this.initial.context_id}`);
      if(!practice&&(!result||writing))throw new Error('当前页面不属于本知识点练习或提交结果。');};
    const platform:RuntimePlatform={capabilities:()=>proxy.capabilities(),hasPendingSubmission:()=>proxy.hasPendingSubmission(),
      waitUntilReady:async s=>{await bound(s);return proxy.waitUntilReady(s);},observeSession:async(id,s)=>{await bound(s,true);return proxy.observeSession(id,s);},
      readState:async s=>{await bound(s);return proxy.readState(s);},readTimer:async s=>{await bound(s);return proxy.readTimer(s);},
      resolveMedia:async(h,s)=>{await bound(s);return proxy.resolveMedia(h,s);},execute:async(p,m,s)=>{await bound(s,true);return proxy.execute(p,m,s);}};
    const models=courseModels(profile.model_catalog.models);if(!models.length)throw new Error('没有已配置的授权Gemini模型。');let modelIndex=this.#modelId===null?0:models.indexOf(this.#modelId);
    if(modelIndex<0)throw new Error('恢复模型已不在配置的授权Gemini列表中。');this.#modelId=models[modelIndex]!;
    const child=new QuizOrchestrator(platform,new VercelAiSolverProvider(profile,this.#modelId,key,budget,undefined,120000,true),new WebVerifier(),
      {session_id:childId,strategy:strategy(),observation_input_mode:'structured',provider_profile_id:profile.provider_profile_id,model_id:this.#modelId,model_call_budget:budget,
        image_upload_authorized:profile.image_upload_authorized,max_answer_retries:0,require_retry_control:true,on_update:onUpdate});
    const run=async(resume:boolean,parentSignal:AbortSignal)=>{
      const abort=()=>child.pause('知识点父任务已暂停。');parentSignal.addEventListener('abort',abort,{once:true});
      try{parentSignal.throwIfAborted();await proxy.enableInteraction(childId);parentSignal.throwIfAborted();
      for(;;){if(resume)await child.resume();else await child.run();parentSignal.throwIfAborted();const result=child.snapshot(),notice=result.notice??'';
      const unavailable=!/429|quota|额度|credential|permission|401|403/i.test(notice)&&/Provider is temporarily unavailable|configured model is unavailable|request timed out|service unavailable|HTTP 5\d\d/i.test(notice);
      if(result.state!=='PAUSED'||!unavailable||modelIndex+1>=models.length||budget.remaining<=0)return;
      modelIndex++;this.#modelId=models[modelIndex]!;child.replaceSolver(new VercelAiSolverProvider(profile,this.#modelId,key,budget,undefined,120000,true),this.#modelId);
      modelChanged(this.#modelId,'模型服务持续不可用，按授权切换至 '+this.#modelId+'；总调用预算保留。');resume=true;
      }}finally{parentSignal.removeEventListener('abort',abort);await proxy.disableInteraction();}
    };
    return {run:s=>run(false,s),resume:s=>run(true,s),pause:r=>child.pause(r),switchStrategy:s=>child.switchStrategy(s),snapshot:()=>child.snapshot()};
  }
}

export async function previewKnowledge(tabId:number):Promise<KnowledgeCatalog>{
  await requireCurrentWebsite(tabId);await ensureContentInjected(tabId);
  const response=await chrome.tabs.sendMessage(tabId,{type:'VV_KNOWLEDGE_PAGE',request:{operation:'catalog'}},{frameId:0}) as ContentResponse;
  if(!response?.ok)throw new Error(response?.error??'知识点目录读取失败。');return response.result as KnowledgeCatalog;
}
export function createKnowledgeRun(tabId:number,profile:ProviderProfile,key:string|undefined,budget:ModelCallBudget,
  options:{session_id:string;catalog:KnowledgeCatalog;scope:string[];strategy:RunStrategy;on_update:(s:SessionRuntimeSnapshot)=>void;restore?:SessionRuntimeSnapshot}):{platform:KnowledgeTabPlatform;orchestrator:KnowledgePracticeOrchestrator}{
  validateKnowledgeScope(options.catalog,options.scope);const models=courseModels(profile.model_catalog.models);if(!models.length)throw new Error('没有已配置的授权Gemini模型。');
  const model=options.restore?.model_id??models[0]!;if(!models.includes(model))throw new Error('恢复模型已不在配置的授权Gemini列表中。');
  const platform=new KnowledgeTabPlatform(tabId,options.session_id,options.catalog,model);let orchestrator:KnowledgePracticeOrchestrator;
  orchestrator=new KnowledgePracticeOrchestrator(platform,(point,update,signal)=>platform.makeChild(point,profile,key,budget,()=>orchestrator.snapshot().strategy,update,signal,(id,reason)=>orchestrator.modelChanged(id,reason)),
    {...options,provider_profile_id:profile.provider_profile_id,model_id:model,budget});return {platform,orchestrator};
}
