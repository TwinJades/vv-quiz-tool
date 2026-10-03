import { CourseOrchestrator, QuizOrchestrator, courseModels } from '../core';
import type { CourseAdapter, CourseCatalog, CourseOptions, CourseQuizResult, CourseQuizRunner, CourseVerification, LearningTask, QuizBoundary, VideoSnapshot } from '../core/course';
import type { RuntimeMediaPayload, RuntimePlatform, SessionRuntimeSnapshot } from '../core/orchestrator';
import type { PlatformObservation, PlatformState } from '../core/platform';
import type { ActionResult, ExecutionPlan, LocatorMap, ProviderProfile, RunStrategy } from '../core/schema';
import { ModelCallBudget } from '../core/call-budget';
import { VercelAiSolverProvider } from '../provider/solver-provider';
import { WebVerifier } from '../web/verifier';
import { ensureContentInjected } from './tab-platform';
import { requireCurrentWebsite, websiteIsAuthorized } from './website-access';
import type { ContentRequest, ContentResponse } from './messages';
import type { CoursePageRequest } from '../web/course-adapter';

async function send<T>(tab:number,frame:number,request:ContentRequest,signal?:AbortSignal):Promise<T> {
  signal?.throwIfAborted();
  const response=await chrome.tabs.sendMessage(tab,request,{frameId:frame}) as ContentResponse;
  signal?.throwIfAborted();if(!response?.ok)throw new Error(response?.error??'课程页面连接中断。');return response.result as T;
}

export class CourseTabPlatform implements CourseAdapter {
  #frame=0;
  #epoch=crypto.randomUUID();
  #frames:number[]=[];
  interactionMatches(sessionId:string,epoch:string):boolean{return this.sessionId===sessionId&&this.#epoch===epoch;}
  constructor(readonly tabId:number,readonly sessionId:string,readonly courseId:string){}
  async preview(signal:AbortSignal):Promise<CourseCatalog> {
    await requireCurrentWebsite(this.tabId);signal.throwIfAborted();
    const frames=await ensureContentInjected(this.tabId);signal.throwIfAborted();
    const results=await Promise.allSettled(frames.map(async frame=>({frame,catalog:await send<CourseCatalog>(this.tabId,frame,{type:'VV_COURSE',request:{operation:'catalog'}},signal)})));
    const good=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
    if(good.length!==1)throw new Error(good.length?'存在多个课程目录，不能自动选择。':results.map(r=>r.status==='rejected'?String(r.reason):'').filter(Boolean).join('；'));
    this.#frame=good[0]!.frame;return good[0]!.catalog;
  }
  async #authorize(signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();await requireCurrentWebsite(this.tabId);const frame=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});
    signal.throwIfAborted();if(!frame?.url||!await websiteIsAuthorized(frame.url))throw new Error('课程所在frame未授权。');signal.throwIfAborted();
  }
  async enableInteraction(_sessionId=this.sessionId):Promise<void>{
    this.#epoch=crypto.randomUUID();this.#frames=await ensureContentInjected(this.tabId);
    await Promise.all(this.#frames.map(frame=>send(this.tabId,frame,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:true}})));
  }
  async disableInteraction():Promise<void>{
    await Promise.allSettled(this.#frames.map(frame=>send(this.tabId,frame,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:false}})));
  }
  async #page<T>(request:CoursePageRequest,signal:AbortSignal):Promise<T>{
    await this.#authorize(signal);
    return send<T>(this.tabId,this.#frame,{type:'VV_COURSE',request,session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
  }
  catalog(signal:AbortSignal):Promise<CourseCatalog>{return this.#page({operation:'catalog'},signal);}
  async enter(task:LearningTask,signal:AbortSignal):Promise<void>{await this.#page({operation:'enter',course_id:this.courseId,task},signal);}
  video(task:LearningTask,signal:AbortSignal):Promise<VideoSnapshot>{return this.#page({operation:'video',course_id:this.courseId,task},signal);}
  async highestAllowedSpeed(task:LearningTask,signal:AbortSignal):Promise<void>{await this.#page({operation:'speed',course_id:this.courseId,task},signal);}
  async mute(task:LearningTask,signal:AbortSignal):Promise<void>{await this.#page({operation:'mute',course_id:this.courseId,task},signal);}
  async play(task:LearningTask,signal:AbortSignal):Promise<void>{await this.#page({operation:'play',course_id:this.courseId,task},signal);}
  pauseVideo(task:LearningTask,signal:AbortSignal):Promise<boolean>{return this.#page({operation:'pause',course_id:this.courseId,task},signal);}
  verify(task:LearningTask,signal:AbortSignal):Promise<CourseVerification>{return this.#page({operation:'verify',course_id:this.courseId,task},signal);}
  async returnToCatalog(signal:AbortSignal):Promise<void>{await this.#page({operation:'directory',course_id:this.courseId},signal);}
  quiz(task:LearningTask,signal:AbortSignal):Promise<QuizBoundary>{return this.#page({operation:'quiz',course_id:this.courseId,task},signal);}
  rewatch(task:LearningTask,signal:AbortSignal):Promise<boolean>{return this.#page({operation:'rewatch',course_id:this.courseId,task},signal);}
  async quizRequest<T>(boundary:QuizBoundary,task:LearningTask,request:ContentRequest,signal:AbortSignal):Promise<T>{
    await this.#authorize(signal);
    return send<T>(this.tabId,this.#frame,{type:'VV_COURSE_QUIZ',course_id:this.courseId,task,boundary,parent_session_id:this.sessionId,interaction_epoch:this.#epoch,request},signal);
  }
}

class ScopedQuizPlatform implements RuntimePlatform {
  constructor(private parent:CourseTabPlatform,private boundary:QuizBoundary,private task:LearningTask){}
  capabilities(){return {question_types:['single_choice','multiple_choice','fill_blank'] as Array<'single_choice'|'multiple_choice'|'fill_blank'>,multi_question_page:true,text_input:true,image_input:true,semantic_targeting:true,coordinate_targeting:false,submit:true,advance:true,grading_feedback:true,timer_observation:this.boundary.kind!=='video_popup'};}
  waitUntilReady(signal:AbortSignal){return this.parent.quizRequest<{ready:boolean;reason?:string}>(this.boundary,this.task,{type:'VV_WAIT_READY'},signal);}
  observeSession(session_id:string,signal:AbortSignal){return this.parent.quizRequest<PlatformObservation>(this.boundary,this.task,{type:'VV_OBSERVE',session_id,mode:'structured'},signal);}
  readState(signal:AbortSignal){return this.parent.quizRequest<PlatformState>(this.boundary,this.task,{type:'VV_READ_STATE'},signal);}
  readTimer(signal:AbortSignal){return this.parent.quizRequest<number|null>(this.boundary,this.task,{type:'VV_READ_TIMER'},signal);}
  execute(plan:ExecutionPlan,locator_map:LocatorMap,signal:AbortSignal){return this.parent.quizRequest<ActionResult[]>(this.boundary,this.task,{type:'VV_EXECUTE',plan,locator_map},signal);}
  async resolveMedia(handles:string[],signal:AbortSignal):Promise<RuntimeMediaPayload[]>{
    if(!handles.length)return [];
    const sources=await this.parent.quizRequest<Array<{temporary_handle:string;source_url:string;mime_type:string}>>(this.boundary,this.task,{type:'VV_RESOLVE_MEDIA',temporary_handles:handles},signal);
    const media:RuntimeMediaPayload[]=[];
    for(const source of sources){signal.throwIfAborted();const response=await fetch(source.source_url,{signal});if(!response.ok)throw new Error('题目图片读取失败。');
      const mime=response.headers.get('content-type')?.split(';')[0]??source.mime_type;if(!mime.startsWith('image/'))throw new Error('媒体不是图片。');
      media.push({temporary_handle:source.temporary_handle,mime_type:mime,data:new Uint8Array(await response.arrayBuffer())});}
    signal.throwIfAborted();return media;
  }
}

export class CourseQuizService implements CourseQuizRunner {
  #active:QuizOrchestrator|null=null;
  #modelIndex=0;
  #models:string[];
  #children=new Map<string,{platform:ScopedQuizPlatform;orchestrator:QuizOrchestrator;attempts:number}>();
  #rewatches=new Map<string,number>();
  #modelNotice:(id:string,reason:string)=>void=()=>{};
  constructor(private parent:CourseTabPlatform,private profile:ProviderProfile,private apiKey:string|undefined,private budget:ModelCallBudget,private tasks:LearningTask[]){
    this.#models=courseModels(profile.model_catalog.models);if(!this.#models.length)throw new Error('当前Provider没有已授权的Gemini课程模型。');
  }
  get model():string{return this.#models[this.#modelIndex]!;}
  onModelChange(notice:(id:string,reason:string)=>void):void{this.#modelNotice=notice;}
  pause():void{this.#active?.pause('课程已暂停。');}
  switchStrategy(strategy:RunStrategy):void{this.#active?.switchStrategy(strategy);}
  async run(boundary:QuizBoundary,strategy:RunStrategy,signal:AbortSignal):Promise<CourseQuizResult>{
    signal.throwIfAborted();const task=this.tasks.find(t=>t.id===boundary.task_id);if(!task)throw new Error('子会话课时身份未知。');
    const key=`${boundary.task_id}:${boundary.kind}:${boundary.id}`;
    let child=this.#children.get(key);
    const platform=child?.platform??new ScopedQuizPlatform(this.parent,boundary,task);
    // A possibly completed submission is reconciled before any new model or action.
    const state=await platform.readState(signal);signal.throwIfAborted();
    if(state.completed)return {status:'completed',reason:null,submission_confirmed:true,passed:boundary.rules.requires_pass?state.feedback==='correct':null,visible_score:state.visible_score??null,retried:child?.orchestrator.snapshot().progress.retried??0};
    if(boundary.rules.remaining_attempts===0)throw new Error('平台已无剩余作答次数。');
    const rewatch=async():Promise<CourseQuizResult>=>{
      const count=this.#rewatches.get(key)??0;
      if(count>=2||boundary.rules.retry_allowed!==true||boundary.rules.remaining_attempts===0)throw new Error('回看重答次数已耗尽或网站不允许重答。');
      await this.parent.rewatch(task,signal);signal.throwIfAborted();this.#rewatches.set(key,count+1);
      return {status:'rewatching',reason:'网站要求回看，实际回退及弹题解除已确认。',submission_confirmed:true,passed:false,visible_score:null,retried:count+1};
    };
    if(boundary.rules.requires_rewatch&&state.feedback==='incorrect')return rewatch();
    const abort=()=>this.#active?.pause('课程已暂停。');signal.addEventListener('abort',abort,{once:true});
    try{
      for(;;){
        signal.throwIfAborted();
        if(!child){
          const solver=new VercelAiSolverProvider(this.profile,this.model,this.apiKey,this.budget,undefined,120_000,true);
          const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),{session_id:crypto.randomUUID(),strategy,observation_input_mode:'structured',
            provider_profile_id:this.profile.provider_profile_id,model_id:this.model,model_call_budget:this.budget,image_upload_authorized:this.profile.image_upload_authorized,
            max_answer_retries:boundary.rules.retry_allowed===true?Math.min(2,Math.max(0,(boundary.rules.remaining_attempts??3)-1)):0,require_retry_control:true,answer_retry_counts:new Map()});
          child={platform,orchestrator,attempts:0};this.#children.set(key,child);
        }
        this.#active=child.orchestrator;child.orchestrator.switchStrategy(strategy);
        if(child.orchestrator.snapshot().state==='PAUSED')await child.orchestrator.resume();else await child.orchestrator.run();
        signal.throwIfAborted();const result=child.orchestrator.snapshot();
        if(boundary.rules.requires_rewatch&&(await platform.readState(signal)).feedback==='incorrect')return rewatch();
        if(result.state==='COMPLETE')return {status:'completed',reason:null,submission_confirmed:true,passed:boundary.rules.requires_pass? (await platform.readState(signal)).feedback==='correct':null,visible_score:result.summary?.visible_score??null,retried:result.progress.retried};
        // The generic provider classifies HTTP 429 as transient; course mode
        // conservatively pauses on it because account quota cannot be excluded.
        const unavailable=!/429|quota|额度|credential|permission|401|403/i.test(result.notice??'')&&/Provider is temporarily unavailable|configured model is unavailable|request timed out|service unavailable|HTTP 5\d\d/i.test(result.notice??'');
        if(unavailable&&this.#modelIndex+1<this.#models.length&&this.budget.remaining>0){
          this.#modelIndex++;this.#modelNotice(this.model,'首选模型持续不可用，课程按授权切换至 '+this.model+'；调用预算保持。');
          // Retain the paused child for reconciliation; replace its solver without resetting attempts.
          child.orchestrator.replaceSolver(new VercelAiSolverProvider(this.profile,this.model,this.apiKey,this.budget,undefined,120_000,true),this.model);
          continue;
        }
        return {status:'paused',reason:result.notice??'子会话未完成。',submission_confirmed:false,passed:null,visible_score:result.summary?.visible_score??null,retried:result.progress.retried};
      }
    }finally{signal.removeEventListener('abort',abort);this.#active=null;}
  }
}

export async function createCourseRun(tabId:number,profile:ProviderProfile,apiKey:string|undefined,budget:ModelCallBudget,options:Omit<CourseOptions,'budget'|'model_id'>):Promise<{orchestrator:CourseOrchestrator;platform:CourseTabPlatform}>{
  const platform=new CourseTabPlatform(tabId,options.session_id,options.catalog.course_id);
  const fresh=await platform.preview(new AbortController().signal);
  if(fresh.course_id!==options.catalog.course_id||fresh.revision!==options.catalog.revision)throw new Error('目录预览后已改变，请重新选择范围。');
  const quizzes=new CourseQuizService(platform,profile,apiKey,budget,fresh.tasks);
  const orchestrator=new CourseOrchestrator(platform,quizzes,{...options,budget,model_id:quizzes.model});
  quizzes.onModelChange((id,reason)=>orchestrator.modelChanged(id,reason));
  return {orchestrator,platform};
}
