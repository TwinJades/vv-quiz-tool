import { CourseOrchestrator, QuizOrchestrator, validateCourseScope } from '../core';
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
import type { CoursePageRequest, CourseSpeedTarget } from '../web/course-adapter';
import type { VisualGeometry } from '../core/visual';
import { VisualTransport } from './visual-transport';
import {VisualWebAdapter} from '../web/visual-adapter';
import {KnowledgeTabPlatform} from './knowledge-practice-platform';
import type {KnowledgeCatalog} from '../core/knowledge-practice';
import type {PracticeChild} from '../core/knowledge-practice';
import type {ChaoxingPracticeReviewReading} from '../web/chaoxing-practice';
import type {InitialSemanticSnapshot} from '../web/initial-snapshot';
import {expectedCourseLocation} from '../web/course-location';
import {courseSurfaceFingerprint,courseSnapshotHasIdentity,courseResourceTasks} from '../web/course-surface';
import type {CourseSurfaceReading,CourseSurfaceSnapshot,CourseFrameContext,CourseEmbeddedFrame} from '../web/course-surface';
import {projectCourseFrame} from '../web/frame-projection';
import type {CourseFrameRect} from '../web/frame-projection';

async function send<T>(tab:number,frame:number,request:ContentRequest,signal?:AbortSignal):Promise<T> {
  signal?.throwIfAborted();
  const response=await chrome.tabs.sendMessage(tab,request,{frameId:frame}) as ContentResponse;
  signal?.throwIfAborted();if(!response?.ok)throw new Error(response?.error??'课程页面连接中断。');return response.result as T;
}

export class CourseTabPlatform implements CourseAdapter {
  #frame=0;
  #epoch=crypto.randomUUID();
  #frames:number[]=[];
  #interactionEnabled=false;
  #hover:VisualTransport|null=null;
  #documentId:string|null=null;
  #catalog:CourseCatalog|null=null;
  #inputAt=0;
  #surfaceCache=new Map<number,{fingerprint:string;reading:CourseSurfaceReading;native:boolean;intent:CourseSurfaceSnapshot['intent']}>();
  #hoverTask:LearningTask|null=null;
  #activeTask:LearningTask|null=null;
  #hoverSignal:AbortSignal|null=null;
  #hoverFrame=0;
  #resourceBindings=new Map<number,{task_id:string;lesson_id:string;document_id:string}>();
  #childBindings=new Set<{interactionMatches(id:string,epoch:string):boolean;disableInteraction():Promise<void>}>();
  private frameCandidates(results:PromiseSettledResult<{frame:number;snapshot:CourseSurfaceSnapshot}>[]):Array<{frame:number;snapshot:CourseSurfaceSnapshot}>{
    return results.flatMap(result=>result.status==='fulfilled'&&result.value.snapshot.elements.length>3?[result.value]:[])
      .filter(candidate=>this.#catalog?courseSnapshotHasIdentity(candidate.snapshot,this.#catalog.course_id,this.#catalog.context_id??null):/课程|章节|知识点|课时|视频|course|chapter|lesson|video/i.test(candidate.snapshot.visible_text))
      .sort((a,b)=>Number(b.snapshot.native)-Number(a.snapshot.native)||Number(b.frame===0)-Number(a.frame===0)||b.snapshot.elements.length-a.snapshot.elements.length);
  }
  registerChild(platform:{interactionMatches(id:string,epoch:string):boolean;disableInteraction():Promise<void>}):void{this.#childBindings.add(platform);}
  readonly quizResults=new Map<string,CourseVerification>();
  reconcileRecords():void{this.quizResults.clear();}
  nativePage():boolean{return this.#surfaceCache.get(this.#frame)?.native===true;}
  activeTask():LearningTask|null{return this.#activeTask?structuredClone(this.#activeTask):null;}
  interactionBinding(){return {session_id:this.sessionId,epoch:this.#epoch,enabled:this.#interactionEnabled};}
  interactionMatches(sessionId:string,epoch:string):boolean{return [...this.#childBindings].some(child=>child.interactionMatches(sessionId,epoch))||this.#interactionEnabled&&this.sessionId===sessionId&&this.#epoch===epoch;}
  constructor(readonly tabId:number,readonly sessionId:string,public courseId:string,known?:CourseCatalog,private recognize?:(snapshot:CourseSurfaceSnapshot,signal:AbortSignal)=>Promise<CourseSurfaceReading>){this.#catalog=known??null;}
  async #surface(frame:number,signal:AbortSignal,context?:CourseFrameContext,intent:CourseSurfaceSnapshot['intent']='task'):Promise<CourseSurfaceReading>{
    if(!this.recognize)throw new Error('课程页面识别服务未配置。');
    const deadline=Date.now()+30000;let snapshot:CourseSurfaceSnapshot;
    for(;;){
      signal.throwIfAborted();snapshot=await send<CourseSurfaceSnapshot>(this.tabId,frame,{type:'VV_CAPTURE_COURSE_SURFACE',session_id:this.sessionId,...(context?{context}:{})},signal);
      if(snapshot.elements.length>3&&(snapshot.visible_text.trim()||snapshot.elements.some(element=>element.tag==='video')))break;
      if(Date.now()>=deadline)throw new Error('课程导航后实际页面未就绪。');await new Promise<void>(resolve=>setTimeout(resolve,200));
    }
    if(this.#activeTask)snapshot.active_task={id:this.#activeTask.id,lesson_id:this.#activeTask.lesson_id,kind:this.#activeTask.kind,title:this.#activeTask.title};
    snapshot.intent=intent;
    const fingerprint=courseSurfaceFingerprint(snapshot),old=this.#surfaceCache.get(frame);
    const reusable=old?.fingerprint===fingerprint&&(old.intent===intent||!old.reading.more_id&&!old.reading.previous_id&&!old.reading.scroll_root_id&&!old.reading.expand_ids.length&&!old.reading.busy);
    const reading=reusable?{...old!.reading,capture_id:snapshot.capture_id}:await this.recognize(snapshot,signal);
    if(this.#catalog&&(reading.course_id!==this.#catalog.course_id||reading.context_id!==(this.#catalog.context_id??null)))throw new Error('当前页面课程或班级身份已改变。');
    await send(this.tabId,frame,{type:'VV_APPLY_COURSE_SURFACE',session_id:this.sessionId,reading},signal);
    this.#surfaceCache.set(frame,{fingerprint,reading,native:snapshot.native,intent});return reading;
  }
  async prepare(signal:AbortSignal,progress?:(value:{loaded:number;title:string})=>Promise<void>):Promise<CourseCatalog>{
    await requireCurrentWebsite(this.tabId);const frames=await ensureContentInjected(this.tabId);signal.throwIfAborted();
    const results=await Promise.allSettled(frames.map(async frame=>({frame,snapshot:await send<CourseSurfaceSnapshot>(this.tabId,frame,{type:'VV_CAPTURE_COURSE_SURFACE',session_id:this.sessionId},signal)})));
    const candidates=this.frameCandidates(results);
    if(!candidates.length)throw new Error('没有可加载的课程目录，请登录并打开课程。');
    this.#frame=candidates[0]!.frame;await this.enableInteraction();
    const loaded=new Map<string,LearningTask>(),deadline=Date.now()+120000;let catalog:CourseCatalog|null=null,lastSignature:string|null=null,stable=0,changedAt=Date.now();
    while(Date.now()<deadline){
      signal.throwIfAborted();const reading=await this.#surface(this.#frame,signal,undefined,'directory');
      if(!reading.lessons.length){
        if(reading.controls.some(control=>control.role==='directory'||control.role==='back')){
          const before=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});
          try{await send(this.tabId,this.#frame,{type:'VV_COURSE',request:{operation:'directory',course_id:reading.course_id},session_id:this.sessionId,interaction_epoch:this.#epoch},signal);}
          catch(error){await this.reconcileNavigation(before,null,error,signal);}
        }
        else if(!reading.busy)throw new Error('请打开当前课程的课时目录后加载。');
        await new Promise<void>(resolve=>setTimeout(resolve,300));continue;
      }
      if(!loaded.size&&reading.previous_id){await this.expandDirectory('previous',signal);await new Promise<void>(resolve=>setTimeout(resolve,300));continue;}
      catalog=await send<CourseCatalog>(this.tabId,this.#frame,{type:'VV_COURSE',request:{operation:'catalog'},session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
      for(const task of catalog.tasks){const previous=loaded.get(task.id);if(previous){if(previous.title!==task.title||previous.chapter_id!==task.chapter_id)throw new Error('分页目录中的课时公开身份重复或改变。');previous.status=task.status;}else loaded.set(task.id,{...task,order:loaded.size});}
      await progress?.({loaded:loaded.size,title:catalog.title});signal.throwIfAborted();
      const signature=JSON.stringify(reading.lessons.map(row=>[row.id,row.title,row.status]));stable=signature===lastSignature?stable+1:0;if(signature!==lastSignature)changedAt=Date.now();lastSignature=signature;
      const expanded=!reading.busy?await this.expandDirectory('next',signal):true;
      if(expanded)changedAt=Date.now();
      if(!reading.busy&&!reading.expand_ids.length&&!reading.more_id&&!expanded&&stable>=2&&Date.now()-changedAt>=3000){
        if(reading.total!==null&&reading.total!==loaded.size)throw new Error('课程公开总数与已加载课时数量不一致。');
        if(!loaded.size)throw new Error('课程没有可识别的课时。');
        const tasks=[...loaded.values()];catalog={...catalog,tasks,complete:true,diagnostics:[],resource_discovery:tasks.map(task=>({lesson_id:task.lesson_id,state:'pending',count:null})),coverage:{loaded:tasks.length,total:reading.total,exhausted:true},revision:JSON.stringify(tasks.map(task=>[task.id,task.chapter_id,task.title]))};
        this.#catalog=catalog;this.courseId=catalog.course_id;
        if(tasks.some(task=>task.prerequisites.some(id=>!loaded.has(id))))throw new Error('课程目录前置条件引用了未发现课时。');
        return catalog;
      }
      await new Promise<void>(resolve=>setTimeout(resolve,300));
    }
    throw new Error('课程目录加载超时，请检查页面加载状态。');
  }
  private async expandDirectory(direction:'next'|'previous',signal:AbortSignal):Promise<boolean>{
    const before=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});
    try{return await send(this.tabId,this.#frame,{type:'VV_EXPAND_COURSE_SURFACE',session_id:this.sessionId,interaction_epoch:this.#epoch,direction},signal);}
    catch(error){await this.reconcileNavigation(before,null,error,signal);return true;}
  }
  private async locateLesson(task:LearningTask,signal:AbortSignal):Promise<void>{
    if(!this.recognize)return;
    const deadline=Date.now()+120000;let direction:'previous'|'next'='previous',last:string|null=null,unchanged=0;
    while(Date.now()<deadline){
      const reading=await this.#surface(this.#frame,signal,undefined,'directory');signal.throwIfAborted();
      if(reading.current_lesson_id===task.lesson_id||reading.lessons.some(row=>row.id===task.lesson_id))return;
      if(!reading.lessons.length)throw new Error('当前课程目录尚未显示选定课时。');
      if(direction==='previous'&&!reading.previous_id)direction='next';
      const signature=JSON.stringify(reading.lessons.map(row=>row.id));unchanged=signature===last?unchanged+1:0;last=signature;
      if(unchanged>10)throw new Error('课程分页没有继续加载。');
      if(!await this.expandDirectory(direction,signal)&&!reading.busy)throw new Error('完整课程目录中无法重新定位选定课时。');
      await new Promise<void>(resolve=>setTimeout(resolve,300));
    }
    throw new Error('重新定位课程课时超时。');
  }
  async preview(signal:AbortSignal):Promise<CourseCatalog> {
    if(this.recognize){if(!this.#catalog)return this.prepare(signal);await this.selectFrame(signal);await this.enableInteraction();await this.#surface(this.#frame,signal);return this.#catalog;}
    await requireCurrentWebsite(this.tabId);signal.throwIfAborted();
    const frames=await ensureContentInjected(this.tabId);signal.throwIfAborted();
    const results=await Promise.allSettled(frames.map(async frame=>({frame,catalog:await send<CourseCatalog>(this.tabId,frame,{type:'VV_COURSE',request:{operation:'catalog',...(this.#catalog?{known:this.#catalog}:{})}},signal)})));
    const good=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
    if(good.length!==1)throw new Error(good.length?'存在多个课程目录，不能自动选择。':results.map(r=>r.status==='rejected'?String(r.reason):'').filter(Boolean).join('；'));
    this.#frame=good[0]!.frame;this.#catalog=good[0]!.catalog;return good[0]!.catalog;
  }
  private async selectFrame(signal:AbortSignal):Promise<void>{
    const frames=await ensureContentInjected(this.tabId);
    const captured=await Promise.allSettled(frames.map(async frame=>({frame,snapshot:await send<CourseSurfaceSnapshot>(this.tabId,frame,{type:'VV_CAPTURE_COURSE_SURFACE',session_id:this.sessionId},signal)})));
    const candidates=this.frameCandidates(captured);
    signal.throwIfAborted();if(!candidates.length)throw new Error('课程页面尚未加载，或登录已失效。');this.#frame=candidates[0]!.frame;
  }
  async #authorize(signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();await requireCurrentWebsite(this.tabId);const frame=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});
    signal.throwIfAborted();if(!frame?.url||!await websiteIsAuthorized(frame.url))throw new Error('课程所在frame未授权。');signal.throwIfAborted();
  }
  private async resourceFrame(kind:'video'|'quiz',task:LearningTask,signal:AbortSignal):Promise<number>{
    if(!this.recognize)return this.#frame;
    const embedded=await send<CourseEmbeddedFrame[]>(this.tabId,this.#frame,{type:'VV_COURSE_EMBEDDED_FRAMES',session_id:this.sessionId},signal);
    let selected=embedded.filter(frame=>frame.kind===kind);
    if(!selected.length&&kind==='quiz'&&task.kind==='video')selected=embedded.filter(frame=>frame.kind==='video');
    if(!selected.length)return this.#frame;
    if(selected.length!==1)throw new Error('当前资源的跨源框架不唯一。');
    const target=selected[0]!,frames=await chrome.webNavigation.getAllFrames({tabId:this.tabId});
    const descendants=(id:number):boolean=>{let current=frames?.find(frame=>frame.frameId===id);while(current&&current.parentFrameId>=0){if(current.parentFrameId===this.#frame)return true;current=frames?.find(frame=>frame.frameId===current!.parentFrameId);}return false;};
    const candidates=frames?.filter(frame=>frame.url===target.url&&descendants(frame.frameId))??[];
    if(candidates.length!==1)throw new Error('资源跨源框架所属课程无法唯一核验。');
    const frame=candidates[0]!;if(!frame.documentId||!await websiteIsAuthorized(frame.url))throw new Error('资源跨源框架未授权。');
    await ensureContentInjected(this.tabId);signal.throwIfAborted();
    await send(this.tabId,frame.frameId,{type:'VV_SET_INTERACTION',binding:this.interactionBinding()},signal);
    if(!this.#frames.includes(frame.frameId))this.#frames.push(frame.frameId);
    await this.#surface(frame.frameId,signal,target.context);
    await send(this.tabId,frame.frameId,{type:'VV_COURSE',request:{operation:'bind',catalog:this.#catalog!},session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
    const old=this.#resourceBindings.get(frame.frameId);
    if(old?.task_id!==task.id||old.document_id!==frame.documentId){
      await send(this.tabId,frame.frameId,{type:'VV_COURSE',request:{operation:'enter',course_id:this.courseId,task},session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
      this.#resourceBindings.set(frame.frameId,{task_id:task.id,lesson_id:task.lesson_id,document_id:frame.documentId});
    }
    return frame.frameId;
  }
  async enableInteraction(_sessionId=this.sessionId):Promise<void>{
    this.#interactionEnabled=false;
    await Promise.all([...this.#childBindings].map(child=>child.disableInteraction()));
    this.#epoch=crypto.randomUUID();this.#frames=await ensureContentInjected(this.tabId);
    this.#documentId=(await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame}))?.documentId??null;
    try {
      const results=await Promise.allSettled(this.#frames.map(frame=>send(this.tabId,frame,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:true}})));
      const failed=results.find(result=>result.status==='rejected');
      if(failed?.status==='rejected')throw failed.reason;
      this.#interactionEnabled=true;
    } catch(error) {
      await this.disableInteraction();
      throw error;
    }
  }
  async disableInteraction():Promise<void>{
    this.#interactionEnabled=false;
    await Promise.all([...this.#childBindings].map(child=>child.disableInteraction()));
    await Promise.allSettled(this.#frames.map(frame=>send(this.tabId,frame,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:false}})));
    await this.#hover?.close();this.#hover=null;
  }
  async #page<T>(request:CoursePageRequest,signal:AbortSignal):Promise<T>{
    if(request.operation==='pause'){
      signal.throwIfAborted();const resource=[...this.#resourceBindings.entries()].find(([,binding])=>binding.task_id===request.task.id),frameId=resource?.[0]??this.#frame;
      const frame=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId});signal.throwIfAborted();
      if(!frame||resource&&frame.documentId!==resource[1].document_id)throw new Error('视频暂停时资源框架身份已改变。');
      if(!this.#catalog)throw new Error('视频暂停缺少课程身份。');
      return send<T>(this.tabId,frameId,{type:'VV_PAUSE_COURSE_MEDIA',course_id:this.courseId,context_id:this.#catalog.context_id??null,session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
    }
    if(!await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame})){await this.selectFrame(signal);await this.enableInteraction();}
    await this.#authorize(signal);
    const frame=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});signal.throwIfAborted();
    if(frame?.documentId!==this.#documentId){await this.enableInteraction();signal.throwIfAborted();}
    if(this.recognize)await this.#surface(this.#frame,signal);
    if(this.#catalog)await send(this.tabId,this.#frame,{type:'VV_COURSE',request:{operation:'bind',catalog:this.#catalog},session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
    const mediaOperation=['video','speed','speed_target','mute','play','rewatch'].includes(request.operation);
    const target=mediaOperation&&'task' in request?await this.resourceFrame('video',request.task,signal):this.#frame;
    if(request.operation==='speed_target')this.#hoverFrame=target;
    return send<T>(this.tabId,target,{type:'VV_COURSE',request,session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
  }
  catalog(signal:AbortSignal):Promise<CourseCatalog>{return this.#page({operation:'catalog'},signal);}
  private async reconcileNavigation(before:chrome.webNavigation.GetFrameResultDetails|null,task:LearningTask|null,error:unknown,signal:AbortSignal):Promise<void>{
    if(!before?.documentId)throw error;
    const observed=this.#surfaceCache.get(this.#frame)?.reading;
    if(!this.#catalog&&!observed)throw error;
    if(!/Receiving end does not exist|Could not establish connection|message port closed|连接中断|尚未就绪|未就绪/i.test(error instanceof Error?error.message:String(error)))throw error;
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      signal.throwIfAborted();let frame=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});signal.throwIfAborted();
      if(!frame){await this.selectFrame(signal);frame=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});}
      if(frame?.documentId&&frame.documentId!==before.documentId){
        if(!this.recognize&&this.#catalog&&!expectedCourseLocation(frame.url,this.#catalog,task))throw new Error('正常课程导航进入了范围外页面。');
        if((await chrome.tabs.get(this.tabId)).status!=='complete'){await new Promise<void>(resolve=>setTimeout(resolve,200));continue;}
        await this.enableInteraction();
        if(this.recognize){const reading=await this.#surface(this.#frame,signal);if(observed&&(reading.course_id!==observed.course_id||reading.context_id!==observed.context_id))throw new Error('正常导航后课程或班级身份已改变。');}
        else await this.#page({operation:'catalog'},signal);
        return;
      }
      await new Promise<void>(resolve=>setTimeout(resolve,200));
    }
    throw error;
  }
  async children(task:LearningTask,signal:AbortSignal):Promise<LearningTask[]>{
    if(this.recognize)await this.#surface(this.#frame,signal,undefined,'resources');
    if(!this.recognize)return this.#page({operation:'children',course_id:this.courseId,task},signal);
    if(this.nativePage()){
      const deadline=Date.now()+120000;let signature:string|null=null,changedAt=Date.now();
      while(Date.now()<deadline){
        const reading=await this.#surface(this.#frame,signal,undefined,'resources');
        if(reading.current_lesson_id!==task.lesson_id)throw new Error('课时资源发现时身份已改变。');
        if(!reading.busy&&reading.resources_complete){
          const children=await this.#page<LearningTask[]>({operation:'children',course_id:this.courseId,task},signal);
          const fresh=JSON.stringify(children.map(child=>[child.id,child.kind,child.title,child.resource_fingerprint,child.prerequisites]));
          if(fresh!==signature){signature=fresh;changedAt=Date.now();}
          else if(Date.now()-changedAt>=3000)return children;
        }else changedAt=Date.now();
        await new Promise<void>(resolve=>setTimeout(resolve,300));
      }
      throw new Error('课时资源发现超时。');
    }
    const loaded=new Map<string,CourseSurfaceReading['resources'][number]>(),deadline=Date.now()+120000;let last:string|null=null,stable=0,changedAt=Date.now();
    while(Date.now()<deadline){
      const reading=await this.#surface(this.#frame,signal,undefined,'resources');if(reading.current_lesson_id!==task.lesson_id)throw new Error('课时资源发现时身份已改变。');
      if(!loaded.size&&reading.previous_id){await this.expandDirectory('previous',signal);await new Promise<void>(resolve=>setTimeout(resolve,300));continue;}
      for(const resource of reading.resources){const previous=loaded.get(resource.id);if(previous&&(previous.kind!==resource.kind||previous.title!==resource.title))throw new Error('分页资源身份已改变。');loaded.set(resource.id,resource);}
      const signature=JSON.stringify([...loaded].map(([id,row])=>[id,row.status]));stable=signature===last?stable+1:0;if(signature!==last)changedAt=Date.now();last=signature;
      const expanded=!reading.busy?await this.expandDirectory('next',signal):true;
      if(expanded)changedAt=Date.now();
      if(reading.resources_complete&&!reading.busy&&!expanded&&stable>=2&&Date.now()-changedAt>=3000){
        if(!loaded.size||reading.resources_total!==null&&reading.resources_total!==loaded.size)throw new Error('课时资源总数或发现范围尚未确认。');
        return courseResourceTasks(task,[...loaded.values()]);
      }
      await new Promise<void>(resolve=>setTimeout(resolve,300));
    }
    throw new Error('课时资源发现超时。');
  }
  private async locateResource(task:LearningTask,signal:AbortSignal):Promise<void>{
    if(!this.recognize||this.nativePage()||task.kind==='lesson')return;
    const deadline=Date.now()+120000;let direction:'previous'|'next'='previous';
    while(Date.now()<deadline){
      const reading=await this.#surface(this.#frame,signal,undefined,'resources'),id=task.resource_id??task.id.split(':').at(-1);
      if(reading.current_lesson_id!==task.lesson_id)throw new Error('资源定位时课时身份已改变。');
      if(reading.resources.some(row=>row.id===id)||reading.current_resource_id===id)return;
      if(direction==='previous'&&!reading.previous_id)direction='next';
      if(!reading.busy&&!await this.expandDirectory(direction,signal))throw new Error('完整课时资源中没有选定资源的入口。');
      await new Promise<void>(resolve=>setTimeout(resolve,300));
    }
    throw new Error('课时资源定位超时。');
  }
  async enter(task:LearningTask,signal:AbortSignal):Promise<void>{
    this.#activeTask=task;
    if(this.recognize&&(task.kind==='lesson_quiz'||task.kind==='chapter_quiz')){
      const reading=await this.#surface(this.#frame,signal);
      if(reading.current_lesson_id===task.lesson_id&&['quiz','result'].includes(reading.stage)){await this.#page({operation:'enter',course_id:this.courseId,task},signal);return;}
    }
    if(this.recognize&&task.kind!=='lesson'){
      const reading=await this.#surface(this.#frame,signal);
      if(reading.current_lesson_id!==task.lesson_id){const parent=this.#catalog?.tasks.find(parent=>parent.lesson_id===task.lesson_id&&parent.kind==='lesson');if(!parent)throw new Error('资源缺少所属课时。');await this.enter(parent,signal);this.#activeTask=task;}
    }
    await this.locateLesson(task,signal);
    await this.locateResource(task,signal);
    // A normal platform navigation may autoplay before its player mute control
    // can be resolved. Mute the chosen tab first; retain normal player checks.
    const catalog=await this.catalog(signal);signal.throwIfAborted();
    if(catalog.course_id!==this.courseId)throw new Error('静音前课程身份已改变。');
    const current=catalog.tasks.find(item=>item.id===task.id)??catalog.tasks.find(item=>item.kind==='lesson'&&item.lesson_id===task.lesson_id);
    if(!current||current.kind!=='lesson'&&(current.kind!==task.kind||current.lesson_id!==task.lesson_id||current.chapter_id!==task.chapter_id||
      current.prerequisites.join('|')!==task.prerequisites.join('|')))throw new Error('静音前课时身份或归属已改变。');
    signal.throwIfAborted();
    const tab=await chrome.tabs.update(this.tabId,{muted:true});signal.throwIfAborted();
    if(!tab?.mutedInfo?.muted)throw new Error('课程标签静音未确认，停止进入课时。');
    const before=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});
    try {
      await this.#page({operation:'enter',course_id:this.courseId,task},signal);
      if(this.recognize){
        const deadline=Date.now()+30000;
        while(Date.now()<deadline){signal.throwIfAborted();const reading=await this.#surface(this.#frame,signal);if(reading.current_lesson_id===task.lesson_id&&(task.kind==='lesson'||this.#catalog?.page_type!=='zhidao_shared'||reading.current_resource_id===(task.resource_id??task.id.split(':').at(-1))))return;await new Promise<void>(resolve=>setTimeout(resolve,200));}
        throw new Error('课程导航后课时身份尚未就绪。');
      }
    }
    catch(error){await this.reconcileNavigation(before,task,error,signal);}
  }
  async video(task:LearningTask,signal:AbortSignal):Promise<VideoSnapshot>{
    await this.hover(task,signal);
    const video=await this.#page<VideoSnapshot>({operation:'video',course_id:this.courseId,task,hover_at:this.#inputAt},signal);
    return {...video,background_input_confirmed:this.#inputAt>0&&Date.now()-this.#inputAt<5000};
  }
  private async projectedTarget(task:LearningTask,signal:AbortSignal):Promise<CourseSpeedTarget|null>{
    const target=await this.#page<CourseSpeedTarget|null>({operation:'speed_target',course_id:this.courseId,task},signal);if(!target)return target;
    return this.projectTarget(target,this.#hoverFrame,signal);
  }
  private async projectTarget(target:CourseSpeedTarget,frameId:number,signal:AbortSignal):Promise<CourseSpeedTarget>{
    if(frameId===0)return target;
    const frames=await chrome.webNavigation.getAllFrames({tabId:this.tabId});signal.throwIfAborted();
    let current=frameId,point=target.point,region=target.geometry.region;
    while(current!==0){
      const child=frames?.find(frame=>frame.frameId===current);if(!child||child.parentFrameId<0)throw new Error('课程播放器框架链已改变。');
      const rect=await send<CourseFrameRect>(this.tabId,child.parentFrameId,{type:'VV_COURSE_FRAME_RECT',child_url:child.url},signal);
      ({point,region}=projectCourseFrame(point,region,rect));current=child.parentFrameId;
    }
    const geometry=await send<VisualGeometry>(this.tabId,0,{type:'VV_VISUAL_GEOMETRY',full_viewport:true},signal);
    return {...target,point,geometry:{...geometry,region},captured_at:Date.now()};
  }
  private async hoverGeometry():Promise<VisualGeometry>{
    if(!this.#hoverTask||!this.#hoverSignal)throw new Error('课程悬停缺少活动视频。');
    this.#hoverSignal.throwIfAborted();
    const target=await this.projectedTarget(this.#hoverTask,this.#hoverSignal);if(!target)throw new Error('课程播放器悬停范围已改变。');return target.geometry;
  }
  private async hover(task:LearningTask,signal:AbortSignal):Promise<void>{
    const target=await this.projectedTarget(task,signal);
    if(!target)return;
    this.#hoverTask=task;this.#hoverSignal=signal;
    this.#hover??=new VisualTransport(this.tabId,()=>this.hoverGeometry(),()=>this.#interactionEnabled?{session_id:this.sessionId,epoch:this.#epoch,enabled:true}:null,async()=>{},false);
    await this.#hover.hoverNormalControl({...target,session_id:this.sessionId,interaction_epoch:this.#epoch},signal);this.#inputAt=Date.now();
  }
  async highestAllowedSpeed(task:LearningTask,signal:AbortSignal):Promise<void>{
    const target=await this.projectedTarget(task,signal);
    if(target){
      this.#hoverTask=task;this.#hoverSignal=signal;
      this.#hover??=new VisualTransport(this.tabId,()=>this.hoverGeometry(),
        ()=>this.#interactionEnabled?{session_id:this.sessionId,epoch:this.#epoch,enabled:true}:null,async()=>{},false);
      await this.#hover.hoverNormalControl({...target,session_id:this.sessionId,interaction_epoch:this.#epoch},signal);signal.throwIfAborted();
    }
    await this.#page({operation:'speed',course_id:this.courseId,task},signal);
  }
  async mute(task:LearningTask,signal:AbortSignal):Promise<void>{const tab=await chrome.tabs.update(this.tabId,{muted:true});signal.throwIfAborted();if(!tab?.mutedInfo?.muted)throw new Error('课程标签静音未确认。');await this.#page({operation:'mute',course_id:this.courseId,task,tab_muted:true},signal);}
  async play(task:LearningTask,signal:AbortSignal):Promise<void>{await this.hover(task,signal);const tab=await chrome.tabs.get(this.tabId);signal.throwIfAborted();await this.#page({operation:'play',course_id:this.courseId,task,hover_at:this.#inputAt,tab_muted:tab.mutedInfo?.muted===true},signal);}
  pauseVideo(task:LearningTask,signal:AbortSignal):Promise<boolean>{return this.#page({operation:'pause',course_id:this.courseId,task},signal);}
  async pauseCurrent(signal:AbortSignal):Promise<boolean>{
    if(!this.#catalog)throw new Error('课程暂停缺少目录身份。');
    const frames=await chrome.webNavigation.getAllFrames({tabId:this.tabId});signal.throwIfAborted();
    const embedded=await send<CourseEmbeddedFrame[]>(this.tabId,this.#frame,{type:'VV_COURSE_EMBEDDED_FRAMES',session_id:this.sessionId},signal);
    for(const resource of embedded.filter(resource=>resource.kind==='video')){
      const candidates=frames?.filter(frame=>frame.url===resource.url)??[];
      if(candidates.length!==1)throw new Error('课程暂停时播放器框架不唯一。');
      const frame=candidates[0]!;if(!await websiteIsAuthorized(frame.url))throw new Error('课程暂停播放器框架未授权。');
      await send(this.tabId,frame.frameId,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:true}},signal);
      if(!this.#frames.includes(frame.frameId))this.#frames.push(frame.frameId);
      if(!await send<boolean>(this.tabId,frame.frameId,{type:'VV_PAUSE_COURSE_MEDIA',course_id:this.courseId,context_id:this.#catalog.context_id??null,session_id:this.sessionId,interaction_epoch:this.#epoch,context:resource.context},signal))return false;
      await send(this.tabId,frame.frameId,{type:'VV_SET_INTERACTION',binding:{session_id:this.sessionId,epoch:this.#epoch,enabled:false}},signal);
    }
    const selected=[...this.#resourceBindings.entries()].filter(([,binding])=>binding.task_id===this.#activeTask?.id||this.#activeTask?.kind==='lesson'&&binding.lesson_id===this.#activeTask.lesson_id).map(([id])=>id);
    selected.push(this.#frame);
    for(const id of new Set(selected)){
      const frame=frames?.find(frame=>frame.frameId===id),binding=this.#resourceBindings.get(id);
      if(!frame){if(id===this.#frame)throw new Error('课程暂停页面已关闭。');continue;}
      if(binding&&frame.documentId!==binding.document_id)throw new Error('课程暂停时资源框架身份已改变。');
      if(!await send<boolean>(this.tabId,id,{type:'VV_PAUSE_COURSE_MEDIA',course_id:this.courseId,context_id:this.#catalog.context_id??null,session_id:this.sessionId,interaction_epoch:this.#epoch},signal))return false;
    }
    this.#surfaceCache.clear();return true;
  }
  async verify(task:LearningTask,signal:AbortSignal):Promise<CourseVerification>{await this.#authorize(signal);return this.quizResults.get(task.id)??this.#page({operation:'verify',course_id:this.courseId,task},signal);}
  async returnToCatalog(signal:AbortSignal):Promise<void>{
    const before=await chrome.webNavigation.getFrame({tabId:this.tabId,frameId:this.#frame});
    try {await this.#page({operation:'directory',course_id:this.courseId},signal);}
    catch(error){await this.reconcileNavigation(before,null,error,signal);await this.#page({operation:'directory',course_id:this.courseId},signal);}
    if(this.recognize){
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){
        signal.throwIfAborted();const reading=await this.#surface(this.#frame,signal);
        if(reading.lessons.length)return;
        if(reading.controls.some(control=>control.role==='directory'||control.role==='back'))await this.#page({operation:'directory',course_id:this.courseId},signal);
        await new Promise<void>(resolve=>setTimeout(resolve,200));
      }
      throw new Error('正常返回后课程目录尚未加载。');
    }
  }
  quiz(task:LearningTask,signal:AbortSignal):Promise<QuizBoundary>{return this.#page({operation:'quiz',course_id:this.courseId,task},signal);}
  rewatch(task:LearningTask,signal:AbortSignal):Promise<boolean>{return this.#page({operation:'rewatch',course_id:this.courseId,task},signal);}
  async retryQuiz(task:LearningTask,signal:AbortSignal):Promise<void>{
    await this.#page({operation:'retry',course_id:this.courseId,task},signal);
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){signal.throwIfAborted();const reading=await this.#surface(this.#frame,signal);if(reading.stage==='quiz'&&reading.quiz_root_id&&!reading.submission_ids.length)return;await new Promise<void>(resolve=>setTimeout(resolve,200));}
    throw new Error('测验重答操作后的新页面未确认，保留断点。');
  }
  async openQuizRecord(task:LearningTask,signal:AbortSignal):Promise<void>{
    await this.#page({operation:'record',course_id:this.courseId,task},signal);
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){const reading=await this.#surface(this.#frame,signal);if(reading.stage==='result'&&reading.current_lesson_id===task.lesson_id&&reading.submission_ids.length)return;await new Promise<void>(resolve=>setTimeout(resolve,200));}
    throw new Error('关联测验记录页面未确认。');
  }
  async quizRequest<T>(boundary:QuizBoundary,task:LearningTask,request:ContentRequest,signal:AbortSignal):Promise<T>{
    await this.#authorize(signal);
    if(this.recognize)await this.#surface(this.#frame,signal);
    const frame=await this.resourceFrame('quiz',task,signal);
    const result=await send<T>(this.tabId,frame,{type:'VV_COURSE_QUIZ',course_id:this.courseId,task,boundary,parent_session_id:this.sessionId,interaction_epoch:this.#epoch,request},signal);
    if(request.type==='VV_VISUAL_GEOMETRY'||request.type==='VV_CHAOXING_QUESTION_GEOMETRY'){
      const geometry=result as VisualGeometry,target=await this.projectTarget({point:{x:geometry.region.x,y:geometry.region.y},captured_at:Date.now(),geometry},frame,signal);
      return target.geometry as T;
    }
    return result;
  }
  async quizTransport(boundary:QuizBoundary,task:LearningTask,signal:AbortSignal,questionId?:string):Promise<VisualTransport>{
    await this.#hover?.close();this.#hover=null;
    return new VisualTransport(this.tabId,()=>this.quizRequest<VisualGeometry>(boundary,task,questionId?{type:'VV_CHAOXING_QUESTION_GEOMETRY',question_id:questionId}:{type:'VV_VISUAL_GEOMETRY'},signal),
      ()=>this.#interactionEnabled?this.interactionBinding():null,
      async ticket=>{await Promise.all(this.#frames.map(frame=>send(this.tabId,frame,{type:'VV_ARM_NATIVE_INPUT',ticket})));},false);
  }
  async submitChaoxing(task:LearningTask,signal:AbortSignal):Promise<ChaoxingPracticeReviewReading>{
    await this.enableInteraction();
    return send(this.tabId,this.#frame,{type:'VV_SUBMIT_CHAOXING',course_id:this.courseId,lesson_id:task.lesson_id,task_id:task.id,quiz_index:Number(task.id.split(':').at(-1)),session_id:this.sessionId,interaction_epoch:this.#epoch},signal);
  }
}

class ChaoxingQuizPlatform implements RuntimePlatform {
  #receipt:ChaoxingPracticeReviewReading|null=null;
  #initialized=false;
  constructor(private readonly parent:CourseTabPlatform,private readonly task:LearningTask,private readonly proxy:ScopedQuizPlatform){}
  private async authorize(signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();await requireCurrentWebsite(this.parent.tabId);
    const frame=await chrome.webNavigation.getFrame({tabId:this.parent.tabId,frameId:0});
    const url=frame&&new URL(frame.url);
    if(url?.hostname!=='mooc1.chaoxing.com'||url.searchParams.get('courseId')!==this.parent.courseId||url.searchParams.get('chapterId')!==this.task.lesson_id)throw new Error('学习通测验所属课时改变。');
    signal.throwIfAborted();
  }
  capabilities(){return this.proxy.capabilities();}
  async waitUntilReady(signal:AbortSignal){await this.authorize(signal);return this.proxy.waitUntilReady(signal);}
  async observeSession(id:string,signal:AbortSignal){await this.authorize(signal);await this.proxy.enableInteraction(id);const reading=await this.proxy.observeSession(id,signal);
    return reading;
  }
  async readState(signal:AbortSignal):Promise<PlatformState>{
    await this.authorize(signal);
    if(!this.#initialized){
      const result=await this.parent.verify(this.task,signal);
      if(result.submission_confirmed)return {observation_id:'cx-review',fingerprint:'cx-review',selected_target_ids:[],field_values:{},feedback:null,can_retry:false,has_next:false,has_session_submit:false,completed:true,session_passed:result.passed,...(result.visible_score?{visible_score:result.visible_score}:{})};
      await this.proxy.enableInteraction(crypto.randomUUID());await this.proxy.waitUntilReady(signal);this.#initialized=true;
    }
    if(this.#receipt)return {observation_id:'cx-review',fingerprint:'cx-review',selected_target_ids:[],field_values:{},feedback:null,can_retry:false,has_next:false,has_session_submit:false,completed:true,session_passed:(await this.parent.verify(this.task,signal)).passed,visible_score:`${this.#receipt.score}/${this.#receipt.maximum}`};
    return this.proxy.readState(signal);
  }
  readTimer(signal:AbortSignal){return this.proxy.readTimer(signal);}
  resolveMedia(handles:string[],signal:AbortSignal){return this.proxy.resolveMedia(handles,signal);}
  async execute(plan:ExecutionPlan,map:LocatorMap,signal:AbortSignal):Promise<ActionResult[]>{
    await this.authorize(signal);if(this.#receipt)throw new Error('学习通测验已经提交。');
    if(plan.actions.length===1&&['submit_session','submit_question'].includes(plan.actions[0]!.kind)){
      await this.proxy.disableInteraction();this.#receipt=await this.parent.submitChaoxing(this.task,signal);
      return [{action_id:plan.actions[0]!.action_id,status:'succeeded'}];
    }
    return this.proxy.execute(plan,map,signal);
  }
}

class ScopedQuizPlatform implements RuntimePlatform {
  #mapped=false;
  #visual:VisualWebAdapter|null=null;
  #media=new Map<string,RuntimeMediaPayload>();
  constructor(private parent:CourseTabPlatform,private boundary:QuizBoundary,private task:LearningTask,private solver?:VercelAiSolverProvider,private imagesAuthorized=false,private nativeChaoxing=false){}
  interactionMatches(id:string,epoch:string){return this.parent.interactionBinding().session_id===id&&this.parent.interactionBinding().epoch===epoch&&this.parent.interactionBinding().enabled;}
  async enableInteraction(_id?:string){await this.parent.enableInteraction();}
  async disableInteraction(){await this.#visual?.close();this.#visual=null;this.#mapped=false;this.#media.clear();}
  capabilities(){return {question_types:['single_choice','multiple_choice','fill_blank'] as Array<'single_choice'|'multiple_choice'|'fill_blank'>,multi_question_page:true,text_input:true,image_input:true,semantic_targeting:true,coordinate_targeting:this.imagesAuthorized,submit:true,advance:true,grading_feedback:true,timer_observation:this.boundary.kind!=='video_popup'};}
  async waitUntilReady(signal:AbortSignal){const ready=await this.parent.quizRequest<{ready:boolean;reason?:string}>(this.boundary,this.task,{type:'VV_WAIT_READY'},signal);if(ready.reason==='semantic_structure_changed'){this.#mapped=false;return {ready:true};}return ready;}
  async observeSession(session_id:string,signal:AbortSignal){
    if(this.#visual)return this.#visual.observeSession(session_id,signal);
    let questionIds:string[]|undefined;
    if(!this.#mapped&&this.solver){
      const binding=this.parent.interactionBinding();
      const snapshot=await this.parent.quizRequest<InitialSemanticSnapshot>(this.boundary,this.task,{type:'VV_CAPTURE_INITIAL_SEMANTIC',binding},signal);
      if(this.nativeChaoxing&&snapshot.chaoxing_question_ids?.length){if(snapshot.rendered_text_required)questionIds=snapshot.chaoxing_question_ids;else this.#mapped=true;}
      else {
        const reading=snapshot.rendered_text_required?{region_ids:[],use_visual:true}:await this.solver.recognizeInitialSemantic(snapshot,signal);
        if(reading.use_visual){
          if(!this.imagesAuthorized)throw new Error('实际题干需要截图，当前Provider没有图片授权。');
          const transport=await this.parent.quizTransport(this.boundary,this.task,signal);
          this.#visual=new VisualWebAdapter(transport,(capture,s,context)=>this.solver!.recognizeVisual(capture,s,context));
          return this.#visual.observeSession(session_id,signal);
        }
        if(!await this.parent.quizRequest<boolean>(this.boundary,this.task,{type:'VV_APPLY_INITIAL_SEMANTIC',binding,reading},signal))throw new Error('弹题结构未通过实际控件验证。');
        this.#mapped=true;
      }
    }
    const observation=await this.parent.quizRequest<PlatformObservation>(this.boundary,this.task,{type:'VV_OBSERVE',session_id,mode:'structured'},signal);
    if(questionIds){
      if(!this.imagesAuthorized)throw new Error('学习通实际题目截图需要Provider图片授权。');
      if(questionIds.length!==observation.questions.length)throw new Error('学习通题目清单与实际作答结构不一致。');
      this.#media.clear();
      for(const [index,parsed] of observation.questions.entries()){
        const question=parsed.question;
        const transport=await this.parent.quizTransport(this.boundary,this.task,signal,questionIds[index]);
        try{
          const capture=await transport.capture(session_id,observation.observation_id,signal),handle=capture.frame.temporary_handle;
          this.#media.set(handle,{temporary_handle:handle,mime_type:'image/png',data:capture.data});
          question.stem={text:`第${index+1}题，题干和选项以实际题目截图为准。`,format:'plain_text',media:[{id:handle,kind:'image',purpose:'实际题干与全部选项',temporary_handle:handle,mime_type:'image/png',source:'region_capture',width:capture.frame.width,height:capture.frame.height} ]};
          question.options=question.options.map((option,position)=>({...option,text:`${String.fromCharCode(65+position)} 选项，内容见实际截图。`,media:[]}));
          question.provenance.text_source='visual';
        }finally{await transport.close();}
      }
    }
    return observation;
  }
  async readState(signal:AbortSignal){const state=await this.parent.quizRequest<PlatformState>(this.boundary,this.task,{type:'VV_READ_STATE'},signal);if(state.completed||!this.#visual)return state;return {...await this.#visual.readState(signal),completed:false};}
  readTimer(signal:AbortSignal){return this.parent.quizRequest<number|null>(this.boundary,this.task,{type:'VV_READ_TIMER'},signal);}
  async execute(plan:ExecutionPlan,locator_map:LocatorMap,signal:AbortSignal){
    const submitting=plan.actions.some(action=>action.kind==='submit_session'||action.kind==='submit_question'||this.boundary.kind==='video_popup'&&action.kind==='set_selected'&&action.value);
    if(submitting)await this.parent.quizRequest(this.boundary,this.task,{type:'VV_COURSE_SUBMISSION',phase:'arm'},signal);
    const result=this.#visual?await this.#visual.execute(plan,locator_map,signal):await this.parent.quizRequest<ActionResult[]>(this.boundary,this.task,{type:'VV_EXECUTE',plan,locator_map},signal);
    if(submitting)await this.parent.quizRequest(this.boundary,this.task,{type:'VV_COURSE_SUBMISSION',phase:result.every(action=>action.status==='succeeded')?'confirm':'cancel'},signal);
    return result;
  }
  async resolveMedia(handles:string[],signal:AbortSignal):Promise<RuntimeMediaPayload[]>{
    if(!handles.length)return [];
    if(this.#visual)return this.#visual.resolveMedia(handles,signal);
    const captures=handles.flatMap(handle=>this.#media.has(handle)?[this.#media.get(handle)!]:[]);
    handles=handles.filter(handle=>!this.#media.has(handle));if(!handles.length)return captures;
    const sources=await this.parent.quizRequest<Array<{temporary_handle:string;source_url:string;mime_type:string}>>(this.boundary,this.task,{type:'VV_RESOLVE_MEDIA',temporary_handles:handles},signal);
    const media:RuntimeMediaPayload[]=[];
    for(const source of sources){signal.throwIfAborted();const response=await fetch(source.source_url,{signal});if(!response.ok)throw new Error('题目图片读取失败。');
      const mime=response.headers.get('content-type')?.split(';')[0]??source.mime_type;if(!mime.startsWith('image/'))throw new Error('媒体不是图片。');
      media.push({temporary_handle:source.temporary_handle,mime_type:mime,data:new Uint8Array(await response.arrayBuffer())});}
    signal.throwIfAborted();return [...captures,...media];
  }
}

export class CourseQuizService implements CourseQuizRunner {
  #active:QuizOrchestrator|null=null;
  #practice:PracticeChild|null=null;
  #practiceRuns=new Map<string,{adapter:KnowledgeTabPlatform;child:PracticeChild|null;prepared:'practice'|'existing_record'|'no_practice'}>();
  #boundary:QuizBoundary|null=null;
  #restored:NonNullable<NonNullable<SessionRuntimeSnapshot['course']>['checkpoint']>['quiz_child'];
  #modelId:string;
  #children=new Map<string,{platform:RuntimePlatform;scope:ScopedQuizPlatform;orchestrator:QuizOrchestrator;attempts:number}>();
  #rewatches=new Map<string,number>();
  #quizRetries=new Map<string,number>();
  #retryPending=false;
  #retryTaskId:string|null=null;
  #lastRetrySnapshot:SessionRuntimeSnapshot|null=null;
  #modelNotice:(id:string,reason:string)=>void=()=>{};
  #persist:()=>Promise<void>=async()=>{};
  #updated:()=>void=()=>{};
  persistWith(persist:()=>Promise<void>,updated:()=>void):void{this.#persist=persist;this.#updated=updated;}
  constructor(private parent:CourseTabPlatform,private profile:ProviderProfile,private apiKey:string|undefined,private budget:ModelCallBudget,private tasks:LearningTask[],modelId:string,restore?:SessionRuntimeSnapshot){
    this.#modelId=restore?.model_id??modelId;
    if(!profile.model_catalog.models.includes(this.#modelId))throw new Error('课程所选模型已不在Provider配置中。');
    if(!profile.capabilities.structured_output)throw new Error('课程模型需要支持结构化输出。');
    this.#restored=restore?.course?.checkpoint?.quiz_child;
    this.#quizRetries=new Map(restore?.course?.checkpoint?.quiz_retries??[]);
    this.#rewatches=new Map(restore?.course?.checkpoint?.popup_retries??[]);
    this.#retryPending=this.#restored?.retry_pending===true||Boolean(restore?.course?.checkpoint?.quiz_retry_pending);
    this.#retryTaskId=restore?.course?.checkpoint?.quiz_retry_pending??null;
  }
  retryCheckpoint(){return [...this.#quizRetries.entries()];}
  popupRetryCheckpoint(){return [...this.#rewatches.entries()];}
  retryPendingCheckpoint(){return this.#retryPending?this.#boundary?.task_id??this.#restored?.task_id??this.#retryTaskId:null;}
  childCheckpoint(){const snapshot=this.#active?.snapshot()??this.#practice?.snapshot()??this.#restored?.snapshot??(this.#retryPending?this.#lastRetrySnapshot:null);if(!snapshot)return null;return this.#boundary?{boundary_id:this.#boundary.id,task_id:this.#boundary.task_id,snapshot,retries:this.#quizRetries.get(this.#boundary.task_id)??0,retry_pending:this.#retryPending}:this.#restored??null;}
  get model():string{return this.#modelId;}
  onModelChange(notice:(id:string,reason:string)=>void):void{this.#modelNotice=notice;}
  pause():void{this.#active?.pause('课程已暂停。');this.#practice?.pause('课程已暂停。');}
  async run(boundary:QuizBoundary,strategy:RunStrategy,signal:AbortSignal):Promise<CourseQuizResult>{
    this.#boundary=boundary;
    signal.throwIfAborted();let task=this.tasks.find(t=>t.id===boundary.task_id);
    const catalog=await this.parent.catalog(signal);
    if(!task){const active=this.parent.activeTask();if(active?.id===boundary.task_id&&catalog.tasks.some(parent=>parent.lesson_id===active.lesson_id))task=active;}
    if(!task)throw new Error('子会话课时身份未知。');
    if(!this.tasks.some(known=>known.id===task!.id))this.tasks.push(task);
    if(catalog.context_id&&catalog.platform==='zhidao'&&catalog.page_type==='zhidao_ai'&&this.parent.nativePage()&&task.kind==='lesson_quiz'){
      const parent=catalog.tasks.find(parent=>parent.lesson_id===task!.lesson_id&&parent.kind==='lesson')!;
      const point={id:task.lesson_id,title:parent.title,order:parent.order};
      const knowledge:KnowledgeCatalog={course_id:catalog.course_id,context_id:catalog.context_id,title:catalog.title,revision:catalog.revision,points:[point]};
      let run=this.#practiceRuns.get(task.id);
      if(!run){
        const adapter=new KnowledgeTabPlatform(this.parent.tabId,this.parent.sessionId,knowledge,this.model);this.parent.registerChild(adapter);
        await adapter.enableInteraction();const prepared=await adapter.prepare(point,signal);
        if(this.#retryPending&&prepared!=='practice')throw new Error('知识点重答操作结果尚未确认，保留断点。');
        if(this.#retryPending){this.#retryPending=false;this.#restored=null;await this.#persist();}
        const restored=this.#restored?.task_id===task.id?this.#restored.snapshot:undefined;
        const child=prepared==='practice'?await adapter.makeChild(point,this.profile,this.apiKey,this.budget,()=>strategy,()=>this.#updated(),signal,()=>{},restored,()=>this.#persist()):null;
        run={adapter,prepared,child};this.#practiceRuns.set(task.id,run);this.#restored=null;
      }
      for(;;){
        signal.throwIfAborted();const adapter:KnowledgeTabPlatform=run.adapter,prepared:'practice'|'existing_record'|'no_practice'=run.prepared,child:PracticeChild|null=run.child;
        let score:string|null=null,guessed=0;
        if(prepared==='practice'){
          if(!child)throw new Error('知识点关联练习缺少子会话。');
          this.#practice=child;
          if(child.snapshot().state==='PAUSED')await child.resume(signal);else await child.run(signal);
          const result=child.snapshot();if(result.state!=='COMPLETE')return {status:'paused',reason:result.notice??'知识点关联练习未完成。',submission_confirmed:false,passed:null,visible_score:result.summary?.visible_score??null,retried:this.#quizRetries.get(task.id)??0};
          score=result.summary?.visible_score??null;guessed=result.progress.guessed;
        }
        await adapter.disableInteraction();await this.parent.enableInteraction();
        const rules=(await this.parent.quiz(task,signal)).rules;
        rules.requires_pass=boundary.rules.requires_pass===true||rules.requires_pass===true;boundary.rules=rules;
        if(prepared==='existing_record'&&rules.requires_pass&&rules.scored!==false)await this.parent.openQuizRecord(task,signal);
        const record=prepared==='no_practice'?{task_id:task.id,media_ended:false,progress_recorded:true,submission_confirmed:true,completed:true,passed:null,pending_grading:false,visible_score:null}:await this.parent.verify(task,signal);
        signal.throwIfAborted();score??=record.visible_score;
        if(!record.submission_confirmed)return {status:'paused',reason:'知识点已有记录或提交结果尚未确认。',submission_confirmed:false,passed:record.passed,visible_score:score,retried:this.#quizRetries.get(task.id)??0};
        if(prepared==='no_practice')boundary.rules.requires_pass=false;
        if(boundary.rules.requires_pass&&record.passed!==true){
          const fresh=(await this.parent.quiz(task,signal)).rules,count=this.#quizRetries.get(task.id)??0;
          if(record.passed===null)return {status:'paused',reason:'知识点测验及格条件尚未确认。',submission_confirmed:true,passed:null,visible_score:score,retried:count};
          if(fresh.retry_allowed!==true||fresh.remaining_attempts===0||count>=2)return {status:'paused',reason:'知识点测验未及格，允许的重答次数已耗尽或入口不可用。',submission_confirmed:true,passed:false,visible_score:score,retried:count};
          this.#quizRetries.set(task.id,count+1);this.#lastRetrySnapshot=this.#practice?.snapshot()??this.#restored?.snapshot??null;this.#retryPending=true;await this.#persist();
          await this.parent.retryQuiz(task,signal);signal.throwIfAborted();
          await adapter.enableInteraction();if(await adapter.prepare(point,signal)!=='practice')throw new Error('知识点重答页面未确认。');
          this.#retryPending=false;this.#practice=null;this.#restored=null;
          const next=await adapter.makeChild(point,this.profile,this.apiKey,this.budget,()=>strategy,()=>this.#updated(),signal,()=>{},undefined,()=>this.#persist());
          run={adapter,prepared:'practice',child:next};this.#practiceRuns.set(task.id,run);await this.#persist();continue;
        }
        const recordSource=prepared==='practice'?'submitted':prepared;
        this.parent.quizResults.set(task.id,{...record,record_source:recordSource,visible_score:score});
        await adapter.returnToDirectory(point,signal);await adapter.disableInteraction();await this.parent.enableInteraction();
        this.#practice=null;this.#practiceRuns.delete(task.id);
        return {record_source:recordSource,status:'completed',reason:null,submission_confirmed:true,passed:record.passed,visible_score:score,retried:this.#quizRetries.get(task.id)??0,guessed};
      }
    }
    const key=`${boundary.task_id}:${boundary.kind}:${boundary.id}`;
    let child=this.#children.get(key);
    const realChaoxing=catalog.platform==='chaoxing'&&catalog.context_id&&this.parent.nativePage()&&task.kind==='chapter_quiz';
    const realSolver=new VercelAiSolverProvider(this.profile,this.model,this.apiKey,this.budget,undefined,25000,true);
    let scoped=child?.scope??new ScopedQuizPlatform(this.parent,boundary,task,realSolver,this.profile.image_upload_authorized&&this.profile.capabilities.image_input,Boolean(realChaoxing));
    if(!child)this.parent.registerChild(scoped);
    let platform=child?.platform??(realChaoxing?new ChaoxingQuizPlatform(this.parent,task,scoped):scoped);
    // A possibly completed submission is reconciled before any new model or action.
    const state=await platform.readState(signal);signal.throwIfAborted();
    if(this.#retryPending){
      if(state.completed)throw new Error('测验重答操作结果尚未确认，请检查页面后继续。');
      const ready=await platform.waitUntilReady(signal);if(!ready.ready)throw new Error('测验重答页面尚未确认。');
      this.#retryPending=false;this.#restored=null;await this.#persist();
    }
    const retry=async():Promise<boolean>=>{
      const fresh=await this.parent.quiz(task!,signal),count=this.#quizRetries.get(task!.id)??0;
      if(boundary.kind==='video_popup'||fresh.rules.retry_allowed!==true||fresh.rules.remaining_attempts===0||count>=2)return false;
      this.#quizRetries.set(task!.id,count+1);this.#lastRetrySnapshot=this.#active?.snapshot()??this.#restored?.snapshot??null;this.#retryPending=true;await this.#persist();
      await scoped.disableInteraction();await this.parent.retryQuiz(task!,signal);signal.throwIfAborted();
      this.#retryPending=false;this.#restored=null;this.#active=null;child=undefined;this.#children.delete(key);
      scoped=new ScopedQuizPlatform(this.parent,fresh,task!,realSolver,this.profile.image_upload_authorized&&this.profile.capabilities.image_input,Boolean(realChaoxing));this.parent.registerChild(scoped);
      platform=realChaoxing?new ChaoxingQuizPlatform(this.parent,task!,scoped):scoped;
      await this.#persist();return true;
    };
    if(state.completed){
      if(boundary.rules.requires_pass&&state.session_passed===false){if(!await retry())return {status:'paused',reason:'测验未及格，允许的重答次数已耗尽或重答入口不可用。',submission_confirmed:true,passed:false,visible_score:state.visible_score??null,retried:this.#quizRetries.get(task.id)??0};}
      else return {status:'completed',reason:null,submission_confirmed:true,passed:state.session_passed??null,visible_score:state.visible_score??null,retried:child?.orchestrator.snapshot().progress.retried??0};
    }
    if(boundary.rules.remaining_attempts===0)throw new Error('平台已无剩余作答次数。');
    const rewatch=async():Promise<CourseQuizResult>=>{
      const count=this.#rewatches.get(key)??0;
      if(count>=2||boundary.rules.retry_allowed!==true||boundary.rules.remaining_attempts===0)throw new Error('回看重答次数已耗尽或网站不允许重答。');
      this.#rewatches.set(key,count+1);await this.#persist();signal.throwIfAborted();
      const confirmed=await this.parent.rewatch(task,signal);signal.throwIfAborted();
      if(!confirmed)throw new Error('网站要求回看，但实际回退及弹题解除尚未确认。');
      await scoped.disableInteraction();this.#active=null;this.#restored=null;this.#children.delete(key);
      return {status:'rewatching',reason:'网站要求回看，实际回退及弹题解除已确认。',submission_confirmed:true,passed:false,visible_score:null,retried:count+1};
    };
    if(boundary.rules.requires_rewatch&&state.feedback==='incorrect')return rewatch();
    const abort=()=>this.#active?.pause('课程已暂停。');signal.addEventListener('abort',abort,{once:true});
    try{
      for(;;){
        signal.throwIfAborted();
        if(!child){
          const solver=new VercelAiSolverProvider(this.profile,this.model,this.apiKey,this.budget,undefined,120_000,true);
          const restored=this.#restored?.boundary_id===boundary.id&&this.#restored.task_id===boundary.task_id?this.#restored.snapshot:undefined;
          const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),{session_id:restored?.session_id??crypto.randomUUID(),strategy,observation_input_mode:'structured',...(restored?{restore:restored}:{}),
            persist:()=>this.#persist(),on_update:()=>this.#updated(),
            provider_profile_id:this.profile.provider_profile_id,model_id:this.model,model_call_budget:this.budget,image_upload_authorized:this.profile.image_upload_authorized,
            max_answer_retries:boundary.kind==='video_popup'&&boundary.rules.retry_allowed===true?Math.min(2,Math.max(0,(boundary.rules.remaining_attempts??3)-1)):0,require_retry_control:true,answer_retry_counts:new Map()});
          child={platform,scope:scoped,orchestrator,attempts:0};this.#children.set(key,child);
          this.#restored=null;
        }
        this.#active=child.orchestrator;
        if(child.orchestrator.snapshot().state==='PAUSED')await child.orchestrator.resume();else await child.orchestrator.run();
        signal.throwIfAborted();const result=child.orchestrator.snapshot();
        if(boundary.rules.requires_rewatch&&(await platform.readState(signal)).feedback==='incorrect')return rewatch();
        if(result.state==='COMPLETE'){
          const after=await platform.readState(signal);signal.throwIfAborted();
          if(!after.completed)return {status:'paused',reason:'测验结束后的提交状态已变化，需要重新核对。',submission_confirmed:false,passed:after.session_passed??null,visible_score:after.visible_score??null,retried:result.progress.retried};
          if(boundary.rules.requires_pass&&after.session_passed===false){if(await retry())continue;return {status:'paused',reason:'测验未及格，允许的重答次数已耗尽或重答入口不可用。',submission_confirmed:true,passed:false,visible_score:after.visible_score??null,retried:result.progress.retried+(this.#quizRetries.get(task.id)??0),guessed:result.progress.guessed};}
          return {status:'completed',reason:null,submission_confirmed:true,passed:after.session_passed??null,visible_score:after.visible_score??null,retried:result.progress.retried+(this.#quizRetries.get(task.id)??0),guessed:result.progress.guessed};
        }
        // The generic provider classifies HTTP 429 as transient; course mode
        // conservatively pauses on it because account quota cannot be excluded.
        return {status:'paused',reason:result.notice??'子会话未完成。',submission_confirmed:false,passed:null,visible_score:result.summary?.visible_score??null,retried:result.progress.retried};
      }
    }finally{signal.removeEventListener('abort',abort);if(this.#active?.snapshot().state==='COMPLETE'){await scoped.disableInteraction();this.#active=null;this.#restored=null;}}
  }
}

export async function createCourseRun(tabId:number,profile:ProviderProfile,apiKey:string|undefined,budget:ModelCallBudget,options:Omit<CourseOptions,'budget'>,preparedPlatform?:CourseTabPlatform,signal:AbortSignal=new AbortController().signal):Promise<{orchestrator:CourseOrchestrator;platform:CourseTabPlatform}>{
  const reader=new VercelAiSolverProvider(profile,options.model_id,apiKey,budget,undefined,25000,true);
  const platform=preparedPlatform??new CourseTabPlatform(tabId,options.session_id,options.catalog.course_id,options.catalog,(snapshot,signal)=>reader.recognizeCourse(snapshot,signal));
  let fresh:CourseCatalog;
  try{fresh=await platform.preview(signal);signal.throwIfAborted();}
  catch(error){await platform.disableInteraction();throw error;}
  if(fresh.course_id!==options.catalog.course_id||fresh.revision!==options.catalog.revision)throw new Error('目录预览后已改变，请重新选择范围。');
  const quizzes=new CourseQuizService(platform,profile,apiKey,budget,[...fresh.tasks,...(options.restore?.course?.checkpoint?.children??[])],options.model_id,options.restore);
  const orchestrator=new CourseOrchestrator(platform,quizzes,{...options,budget,model_id:quizzes.model});
  quizzes.persistWith(()=>options.persist?.(orchestrator.snapshot())??Promise.resolve(),()=>orchestrator.checkpointUpdated());
  quizzes.onModelChange((id,reason)=>orchestrator.modelChanged(id,reason));
  return {orchestrator,platform};
}
