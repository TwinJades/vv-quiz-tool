import { ModelCallBudget } from './call-budget';
import type { RunStrategy } from './schema';
import type { SessionRuntimeSnapshot, SessionSummary } from './orchestrator';

export type CoursePlatform = 'zhidao' | 'chaoxing';
export type LearningTaskKind = 'lesson' | 'video' | 'lesson_quiz' | 'chapter_quiz' | 'excluded';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'locked' | 'unknown';
export interface CourseRules {
  visibility_required: boolean | null;
  speed_allowed: boolean | null;
}
export interface QuizRules {
  scored: boolean | null;
  retry_allowed: boolean | null;
  remaining_attempts: number | null;
  requires_pass: boolean | null;
  requires_rewatch: boolean | null;
}
export interface LearningTask {
  resource_id?:string;
  resource_fingerprint?:string;
  id: string;
  lesson_id: string;
  chapter_id: string;
  title: string;
  kind: LearningTaskKind;
  order: number;
  status: TaskStatus;
  prerequisites: string[];
}
export interface CourseCatalog {
  resource_discovery?:Array<{lesson_id:string;state:'pending'|'complete'|'failed';count:number|null;reason?:string}>;
  page_type?: 'chaoxing' | 'zhidao_ai' | 'zhidao_shared' | 'semantic';
  coverage?: { loaded: number; total: number | null; exhausted: boolean };
  context_id?:string;
  course_id: string;
  platform: CoursePlatform;
  title: string;
  revision: string;
  complete: boolean;
  tasks: LearningTask[];
  rules: CourseRules;
  diagnostics: string[];
}
export interface VideoSnapshot {
  resource_fingerprint?:string;
  course_id: string;
  task_id: string;
  video_id: string;
  observed_at: number;
  duration: number | null;
  position: number | null;
  rate: number | null;
  paused: boolean;
  buffering: boolean;
  seeking: boolean;
  ended: boolean;
  visible: boolean;
  popup: QuizBoundary | null;
  background_input_confirmed?:boolean;
}
export interface QuizBoundary {
  id: string;
  course_id: string;
  task_id: string;
  kind: 'video_popup' | 'lesson_quiz' | 'chapter_quiz';
  rules: QuizRules;
}
export interface CourseVerification {
  record_source?:'submitted'|'existing_record'|'no_practice';
  task_id: string;
  media_ended: boolean;
  progress_recorded: boolean;
  submission_confirmed: boolean;
  completed: boolean;
  passed: boolean | null;
  pending_grading: boolean;
  visible_score: string | null;
}
export interface CourseAdapter {
  reconcileRecords?():void;
  pauseCurrent?(signal:AbortSignal):Promise<boolean>;
  children?(task:LearningTask,signal:AbortSignal):Promise<LearningTask[]>;
  catalog(signal: AbortSignal): Promise<CourseCatalog>;
  enter(task: LearningTask, signal: AbortSignal): Promise<void>;
  video(task: LearningTask, signal: AbortSignal): Promise<VideoSnapshot>;
  highestAllowedSpeed(task: LearningTask, signal: AbortSignal): Promise<void>;
  mute(task: LearningTask, signal: AbortSignal): Promise<void>;
  play(task: LearningTask, signal: AbortSignal): Promise<void>;
  pauseVideo(task: LearningTask, signal: AbortSignal): Promise<boolean>;
  verify(task: LearningTask, signal: AbortSignal): Promise<CourseVerification>;
  returnToCatalog(signal: AbortSignal): Promise<void>;
  quiz(task: LearningTask, signal: AbortSignal): Promise<QuizBoundary>;
}
export interface CourseQuizResult {
  guessed?:number;
  record_source?:'submitted'|'existing_record'|'no_practice';
  status: 'completed' | 'paused' | 'rewatching';
  reason: string | null;
  submission_confirmed: boolean;
  passed: boolean | null;
  visible_score: string | null;
  retried: number;
}
export interface CourseQuizRunner {
  popupRetryCheckpoint?():Array<[string,number]>;
  retryPendingCheckpoint?():string|null;
  retryCheckpoint?():Array<[string,number]>;
  childCheckpoint?():CourseQuizCheckpoint|null;
  run(boundary: QuizBoundary, strategy: RunStrategy, signal: AbortSignal): Promise<CourseQuizResult>;
  pause(): void;
}
export interface CourseQuizCheckpoint {boundary_id:string;task_id:string;snapshot:SessionRuntimeSnapshot;retries?:number;retry_pending?:boolean}
export interface CourseRuntime {
  checkpoint?:{catalog:CourseCatalog;completed:string[];children:LearningTask[];pending_quiz:QuizBoundary|null;quiz_child?:CourseQuizCheckpoint|null;issues?:CourseTaskIssue[];excluded_tasks?:string[];quiz_retries?:Array<[string,number]>;quiz_retry_pending?:string|null;popup_retries?:Array<[string,number]>};
  phase: string;
  course_id: string;
  title: string;
  scope: string[];
  current_task_id: string | null;
  estimate_seconds: number | null;
  estimate_frozen: boolean;
  video: { ended: boolean; progress_recorded: boolean; rate?: number | null };
  issues?: CourseTaskIssue[];
  results: Array<{ id: string; kind: QuizBoundary['kind']; result: CourseQuizResult }>;
  tasks: LearningTask[];
  excluded: string[];
}

export interface CourseTaskIssue { task_id:string; parent_id?:string; title:string; reason:string; checked:boolean }

export function courseRecordConfirms(task:LearningTask,record:CourseVerification,rules?:QuizRules):boolean {
  if(record.task_id!==task.id)throw new Error('平台记录不属于当前任务。');
  if(!record.completed||!record.progress_recorded||record.pending_grading)return false;
  if(task.kind==='video')return true;
  return (task.kind==='lesson_quiz'||task.kind==='chapter_quiz')&&record.submission_confirmed&&(!rules?.requires_pass||record.passed===true);
}

export function validateCourseResources(parent:LearningTask,children:LearningTask[]):void {
  const ids=new Set(children.map(child=>child.id));
  if(!children.length||ids.size!==children.length||children.some(child=>child.lesson_id!==parent.lesson_id||child.chapter_id!==parent.chapter_id||child.kind==='lesson'||child.kind!=='excluded'&&child.status==='unknown'))throw new Error('课时资源身份、状态或归属不完整。');
  for(const child of children)if(child.prerequisites.some(id=>id===child.id||!ids.has(id)))throw new Error('课时资源前置条件引用了范围外任务。');
  const visited=new Set<string>(),active=new Set<string>();
  const visit=(id:string):void=>{
    if(active.has(id))throw new Error('课时资源前置条件循环。');
    if(visited.has(id))return;
    active.add(id);for(const dependency of children.find(child=>child.id===id)!.prerequisites)visit(dependency);
    active.delete(id);visited.add(id);
  };
  for(const child of children)visit(child.id);
}

export function nextCourseResource(children:LearningTask[],completed:Set<string>,failed:Set<string>):LearningTask|null {
  return [...children].sort((a,b)=>a.order-b.order).find(child=>child.kind!=='excluded'&&!completed.has(child.id)&&!failed.has(child.id)&&child.status!=='locked'&&child.prerequisites.every(id=>completed.has(id)))??null;
}

export function courseScopeForSelection(catalog:CourseCatalog,selection:string):string[]{
  if(!selection)return [];
  if(selection!=='all'&&!selection.startsWith('chapter:')&&!selection.startsWith('lesson:'))throw new Error('课程范围选择无效。');
  return catalog.tasks.filter(task=>task.kind!=='excluded'&&(selection==='all'?task.status!=='completed':selection==='chapter:'+task.chapter_id||selection==='lesson:'+task.lesson_id)).map(task=>task.id);
}

export function courseScopeConfirmed(catalog:CourseCatalog,scope:string[],excluded:Set<string>,issues:CourseTaskIssue[]):boolean {
  const selected=catalog.tasks.filter(task=>scope.includes(task.id)&&!excluded.has(task.id));
  return selected.length>0&&issues.length===0&&selected.every(task=>task.status==='completed');
}

export function courseFailureIsLocal(message:string):boolean {
  return !/登录|验证码|滑块|监考|权限|未授权|预算|调用上限|model call|Provider|模型服务|识别服务|MODEL_NOT_FOUND|AUTHENTICATION|INVALID_OUTPUT|429|quota|credential|permission|401|403|身份.*改变|不属于|保存失败|断点/i.test(message);
}

/** Never extrapolate a playback estimate from elapsed wall time. */
export class VideoEstimate {
  seconds: number | null = null;
  frozen = true;
  #last: Pick<VideoSnapshot, 'course_id' | 'task_id' | 'video_id' | 'duration' | 'position' | 'rate'> | null = null;
  observe(video: VideoSnapshot, now: number): void {
    const valid = now - video.observed_at >= 0 && now - video.observed_at <= 5000 &&
      video.duration !== null && Number.isFinite(video.duration) && video.duration > 0 &&
      video.position !== null && Number.isFinite(video.position) && video.position >= 0 && video.position <= video.duration &&
      video.rate !== null && Number.isFinite(video.rate) && video.rate > 0;
    this.frozen = !valid || video.paused || video.buffering || video.seeking || video.popup !== null;
    if (!valid) { this.seconds = null; this.#last = null; return; }
    const previous = this.#last;
    const sameVideo = previous?.course_id === video.course_id && previous.task_id === video.task_id && previous.video_id === video.video_id;
    // A settled normal rewind or a speed/duration change invalidates the old
    // estimate even while paused. Seeking positions are intermediate; forward
    // drift during buffering, pause or a popup must not decrement the estimate.
    const changedBasis = sameVideo && !video.seeking && video.popup === null &&
      (video.position! < previous!.position! || video.rate !== previous!.rate || video.duration !== previous!.duration);
    if (!this.frozen || this.seconds === null || video.ended || !sameVideo || changedBasis) {
      this.seconds = Math.ceil(Math.max(0, video.duration! - video.position!) / video.rate!);
    }
    if (!video.seeking && video.popup === null) this.#last = { course_id:video.course_id, task_id:video.task_id, video_id:video.video_id,
      duration:video.duration, position:video.position, rate:video.rate };
  }
  freeze(): void { this.frozen = true; }
}

export function validateCourseScope(catalog: CourseCatalog, ids: string[]): void {
  if (!catalog.complete || catalog.diagnostics.length) throw new Error('课程目录或规则不完整：' + catalog.diagnostics.join('；'));
  if(catalog.coverage&&(!catalog.coverage.exhausted||catalog.coverage.loaded!==catalog.tasks.length||catalog.coverage.total!==null&&catalog.coverage.total!==catalog.tasks.length))throw new Error('课程目录加载范围尚未确认。');
  if(!catalog.course_id.trim())throw new Error('课程身份未知。');
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('请先明确选择不重复的课时/章节范围。');
  if (new Set(catalog.tasks.map(t => t.id)).size !== catalog.tasks.length) throw new Error('课程任务身份重复。');
  for (const id of ids) {
    const task = catalog.tasks.find(t => t.id === id);
    if (!task || task.kind === 'excluded' || task.status === 'unknown'&&task.kind!=='lesson') throw new Error('范围含未知、考试或不支持任务：' + id);
  }
}

export function nextCourseTask(catalog: CourseCatalog, scope: string[]): LearningTask | null {
  const remaining = catalog.tasks.filter(t => scope.includes(t.id) && t.status !== 'completed').sort((a,b) => a.order-b.order);
  if (!remaining.length) return null;
  const startedLessons = new Set(catalog.tasks.filter(t => scope.includes(t.id) && (t.status === 'in_progress' || t.status === 'completed')).map(t => t.lesson_id));
  const ready = remaining.filter(t => t.status !== 'locked' && t.prerequisites.every(id => catalog.tasks.find(p => p.id === id)?.status === 'completed'));
  const task = ready.find(t => startedLessons.has(t.lesson_id)) ?? ready[0];
  if (!task) throw new Error('范围内任务锁定或前置任务未完成；不会扩张范围。');
  return task;
}

export function courseModels(ids: string[]): string[] {
  const tier = (id: string) => /^gemini-3\.8-flash(?:-|$)/.test(id) ? 0 : /^gemini-3\.7-flash(?:-|$)/.test(id) ? 1 : /^gemini-3\.1-pro(?:-|$)/.test(id) ? 2 : 3;
  return [...new Set(ids)].filter(id => tier(id)<3).sort((a,b) => tier(a)-tier(b) || a.localeCompare(b));
}

export interface CourseOptions {
  session_id: string;
  catalog: CourseCatalog;
  scope: string[];
  strategy: RunStrategy;
  provider_profile_id: string;
  model_id: string;
  budget: ModelCallBudget;
  on_update?: (snapshot: SessionRuntimeSnapshot) => void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  restore?:SessionRuntimeSnapshot;
  persist?:(snapshot:SessionRuntimeSnapshot)=>Promise<void>;
}
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve,reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort',abort); reject(new DOMException('Cancelled','AbortError')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve(); },ms);
  signal.addEventListener('abort',abort,{once:true});
});

export class CourseOrchestrator {
  #state: SessionRuntimeSnapshot['state'] = 'CREATED';
  #controller: AbortController | null = null;
  #running: Promise<void> | null = null;
  #pausePromise: Promise<void> = Promise.resolve();
  #notice: string | null = null;
  #summary: SessionSummary | null = null;
  #current: LearningTask | null = null;
  #pendingQuiz: QuizBoundary | null = null;
  #estimate = new VideoEstimate();
  #runtime: CourseRuntime;
  #now: () => number;
  #wait: (ms:number,signal:AbortSignal) => Promise<void>;
  #completed=new Set<string>();
  #children:LearningTask[]=[];
  #issues=new Map<string,CourseTaskIssue>();
  #excludedTasks=new Set<string>();
  #auditCompleted=false;
  #discovery=new Map<string,NonNullable<CourseCatalog['resource_discovery']>[number]>();
  constructor(private adapter: CourseAdapter, private quizzes: CourseQuizRunner, private options: CourseOptions) {
    validateCourseScope(options.catalog,options.scope);
    this.#now = options.now ?? Date.now;
    this.#wait = options.wait ?? delay;
    for(const task of options.catalog.tasks.filter(task=>task.kind==='lesson'))this.#discovery.set(task.lesson_id,options.catalog.resource_discovery?.find(entry=>entry.lesson_id===task.lesson_id)??{lesson_id:task.lesson_id,state:'pending',count:null});
    this.#runtime = {phase:'READY',course_id:options.catalog.course_id,title:options.catalog.title,scope:[...options.scope],current_task_id:null,
      estimate_seconds:null,estimate_frozen:true,video:{ended:false,progress_recorded:false},results:[],tasks:options.catalog.tasks,
      excluded:options.catalog.tasks.filter(t => !options.scope.includes(t.id)).map(t=>t.id)};
    if(options.restore){
      this.#auditCompleted=true;
      const checkpoint=options.restore.course?.checkpoint;
      if(!checkpoint||options.restore.session_id!==options.session_id||options.restore.provider_profile_id!==options.provider_profile_id||JSON.stringify(checkpoint.catalog)!==JSON.stringify(options.catalog))throw new Error('课程恢复断点身份不一致。');
      this.#completed=new Set(checkpoint.completed);this.#children=checkpoint.children;this.#pendingQuiz=checkpoint.pending_quiz;
      this.#current=this.#children.find(child=>child.id===this.#pendingQuiz?.task_id)??null;
      this.#runtime.current_task_id=this.#current?.id??null;
      this.#runtime.results=options.restore.course!.results;
      for(const issue of checkpoint.issues??[])this.#issues.set(issue.task_id,issue);
      for(const id of checkpoint.excluded_tasks??[])this.#excludedTasks.add(id);
    }
  }
  snapshot(): SessionRuntimeSnapshot {
    const selected = this.#runtime.tasks.filter(t=>this.options.scope.includes(t.id));
    return {session_id:this.options.session_id,state:this.#state,strategy:this.options.strategy,observation_input_mode:'structured',
      provider_profile_id:this.options.provider_profile_id,model_id:this.options.model_id,model_calls:{used:this.options.budget.used,limit:this.options.budget.limit},
      progress:{total:selected.length,answered:selected.filter(t=>t.status==='completed').length,guessed:this.#runtime.results.reduce((n,r)=>n+(r.result.guessed??0),0),retried:this.#runtime.results.reduce((n,r)=>n+r.result.retried,0),skipped:this.#excludedTasks.size,failed:this.#issues.size},
      notice:this.#notice,summary:this.#summary,course:structuredClone({...this.#runtime,estimate_seconds:this.#estimate.seconds,estimate_frozen:this.#estimate.frozen,
        excluded:[...new Set([...this.#runtime.excluded,...this.#excludedTasks])],issues:[...this.#issues.values()],checkpoint:{catalog:{...this.options.catalog,resource_discovery:[...this.#discovery.values()]},completed:[...this.#completed],children:this.#children,pending_quiz:this.#pendingQuiz,quiz_child:this.quizzes.childCheckpoint?.()??null,issues:[...this.#issues.values()],excluded_tasks:[...this.#excludedTasks],quiz_retries:this.quizzes.retryCheckpoint?.()??[],quiz_retry_pending:this.quizzes.retryPendingCheckpoint?.()??null,popup_retries:this.quizzes.popupRetryCheckpoint?.()??[]}})};
  }
  modelChanged(id: string, reason: string): void { this.options.model_id=id; this.#notice=reason; this.#emit(); }
  checkpointUpdated():void{this.#emit();}
  #emit(): void { this.options.on_update?.(this.snapshot()); }
  #phase(phase:string,state:SessionRuntimeSnapshot['state']='WAIT_READY'): void { this.#runtime.phase=phase;this.#state=state;this.#emit(); }
  run(): Promise<void> {
    if (this.#running) return this.#running;
    if (['COMPLETE','CANCELLED','FAILED'].includes(this.#state)) return Promise.resolve();
    this.#controller=new AbortController();
    const signal=this.#controller.signal;
    this.#running=this.#loop(signal).catch(async error=>{
      if (!signal.aborted) { this.pause(error instanceof Error?error.message:String(error)); await this.#pausePromise; }
    }).finally(()=>{this.#running=null;});
    return this.#running;
  }
  pause(reason='用户暂停课程。'): void {
    if (['COMPLETE','CANCELLED','FAILED'].includes(this.#state)) return;
    this.#controller?.abort(); this.quizzes.pause();this.#state='PAUSED';this.#notice=reason;this.#estimate.freeze();this.#emit();
    const current=this.#current;
    this.#pausePromise=(async()=>{
      if (this.adapter.pauseCurrent||current?.kind==='video') {
        try { if (!(this.adapter.pauseCurrent?await this.adapter.pauseCurrent(new AbortController().signal):await this.adapter.pauseVideo(current!,new AbortController().signal))) this.#notice=reason+' 视频暂停未确认，请检查播放器。'; }
        catch { this.#notice=reason+' 视频可能仍在播放，请手动检查。'; }
      }
      this.#emit();
    })();
  }
  async resume(): Promise<void> { await this.#running;await this.#pausePromise;if(this.#state==='PAUSED'){this.#summary=null;this.#notice=null;this.#issues.clear();this.#auditCompleted=true;await this.run();} }
  stop(reason='用户停止课程。'):void {this.pause(reason);this.#state='CANCELLED';this.#finish('cancelled',reason);}
  #finish(status:SessionSummary['status'],reason:string|null):void {
    const snapshot=this.snapshot();this.#summary={session_id:this.options.session_id,status,...snapshot.progress,model_calls:this.options.budget.used,visible_score:null,stop_reason:reason};this.#emit();
  }
  #identity(catalog:CourseCatalog):void {
    if(catalog.course_id!==this.options.catalog.course_id||catalog.platform!==this.options.catalog.platform||catalog.context_id!==this.options.catalog.context_id)throw new Error('当前页面已改变课程或班级，停止自动动作。');
    validateCourseScope(catalog,this.options.scope);
    for(const id of this.options.scope){
      const old=this.options.catalog.tasks.find(t=>t.id===id)!;const fresh=catalog.tasks.find(t=>t.id===id)!;
      if(old.kind!==fresh.kind||old.lesson_id!==fresh.lesson_id||old.chapter_id!==fresh.chapter_id||old.prerequisites.join('|')!==fresh.prerequisites.join('|'))throw new Error('课程任务归属或前置条件改变，请重新选择范围。');
    }
    for(const task of catalog.tasks)if(this.#completed.has(task.id))task.status='completed';
    this.#runtime.tasks=catalog.tasks;
  }
  #validateQuizBoundary(boundary:QuizBoundary):void {
    if(boundary.course_id!==this.options.catalog.course_id||boundary.task_id!==this.#current?.id)throw new Error('测验不属于当前课时。');
    if(boundary.kind==='video_popup' ? this.#current.kind!=='video' : boundary.kind!==this.#current.kind&&this.#current.kind!=='lesson')throw new Error('弹题与课时/章节测验类型不匹配。');
    if(boundary.rules.remaining_attempts!==null&&(!Number.isInteger(boundary.rules.remaining_attempts)||boundary.rules.remaining_attempts<0))throw new Error('测验剩余次数无效。');
  }
  async #quiz(boundary:QuizBoundary,signal:AbortSignal):Promise<void> {
    this.#validateQuizBoundary(boundary);
    this.#pendingQuiz=boundary;this.#phase(boundary.kind==='video_popup'?'POPUP':'QUIZ','SOLVE');
    await this.options.persist?.(this.snapshot());signal.throwIfAborted();
    let result:CourseQuizResult;
    try{result=await this.quizzes.run(boundary,this.options.strategy,signal);signal.throwIfAborted();}
    catch(error){
      signal.throwIfAborted();
      const reason=error instanceof Error?error.message:String(error),child=this.quizzes.childCheckpoint?.();
      if(courseFailureIsLocal(reason)&&!child?.snapshot.checkpoint?.submission_pending&&!child?.retry_pending&&!this.quizzes.retryPendingCheckpoint?.())this.#pendingQuiz=null;
      throw error;
    }
    const resultId=`${boundary.task_id}:${boundary.kind}:${boundary.id}`;
    const prior=this.#runtime.results.findIndex(r=>r.id===resultId);
    const entry={id:resultId,kind:boundary.kind,result};if(prior<0)this.#runtime.results.push(entry);else this.#runtime.results[prior]=entry;
    this.#emit();
    if(result.status==='rewatching'&&boundary.kind==='video_popup'&&boundary.rules.requires_rewatch){this.#pendingQuiz=null;return;}
    if(result.submission_confirmed&&result.passed===false)this.#pendingQuiz=null;
    if(result.status!=='completed'||!result.submission_confirmed){
      const reason=result.reason??'测验提交或弹题处理尚未确认。',child=this.quizzes.childCheckpoint?.();
      if(!result.submission_confirmed&&courseFailureIsLocal(reason)&&!child?.snapshot.checkpoint?.submission_pending&&!child?.retry_pending&&!this.quizzes.retryPendingCheckpoint?.())this.#pendingQuiz=null;
      throw new Error(reason);
    }
    if(boundary.rules.requires_pass&&result.passed!==true)throw new Error('已提交，但及格条件尚未确认。');
    this.#pendingQuiz=null;
  }
  async #watch(task:LearningTask,catalog:CourseCatalog,signal:AbortSignal):Promise<void> {
    await this.adapter.mute(task,signal);signal.throwIfAborted();
    await this.adapter.highestAllowedSpeed(task,signal);signal.throwIfAborted();
    let lastPosition:number|null=null;let lastProgress=this.#now();let lastPopup:string|null=null;let videoId:string|null=null;
    while(!signal.aborted){
      const video=await this.adapter.video(task,signal);signal.throwIfAborted();
      if(video.course_id!==catalog.course_id||video.task_id!==task.id||!video.video_id||videoId!==null&&videoId!==video.video_id||this.#now()-video.observed_at>5000||this.#now()<video.observed_at)throw new Error('视频身份或观察失效，暂停。');
      videoId=video.video_id;
      if(video.resource_fingerprint){if(task.resource_fingerprint&&task.resource_fingerprint!==video.resource_fingerprint)throw new Error('当前视频媒体身份已经改变。');task.resource_fingerprint=video.resource_fingerprint;}
      if(!video.visible&&!video.background_input_confirmed&&video.paused)throw new Error('后台播放器输入未确认。');
      this.#runtime.video.rate=video.rate;
      this.#estimate.observe(video,this.#now());this.#emit();
      if(video.popup){
        if(video.popup.id===lastPopup)throw new Error('弹题仍未解除或要求回看，停止重复提交。');
        await this.#quiz(video.popup,signal);lastPopup=video.popup.id;lastProgress=this.#now();continue;
      }
      lastPopup=null;
      if(video.ended){this.#runtime.video.ended=true;this.#phase('VERIFY_PROGRESS','VERIFY');return;}
      if(video.position!==null){if(lastPosition!==null&&video.position>lastPosition&&!video.seeking)lastProgress=this.#now();lastPosition=video.position;}
      if(video.paused&&!video.seeking){await this.adapter.play(task,signal);signal.throwIfAborted();}
      if(this.#now()-lastProgress>=120000)throw new Error('视频连续两分钟没有有效播放进展，请检查网络或播放器。');
      this.#phase(video.buffering?'BUFFERING':video.seeking?'REWATCHING':video.paused?'PLAYBACK_PAUSED':'PLAYING');await this.#wait(1000,signal);
    }
  }
  async #progress(task:LearningTask,signal:AbortSignal):Promise<void> {
    const start=this.#now();let returned=false;
    while(this.#now()-start<120000){
      const result=await this.adapter.verify(task,signal);signal.throwIfAborted();
      if(result.task_id!==task.id)throw new Error('平台进度不属于当前任务。');
      this.#runtime.video.progress_recorded=result.progress_recorded;this.#emit();
      if(result.progress_recorded&&result.completed)return;
      if(!returned&&this.#now()-start>=60000){
        await this.adapter.returnToCatalog(signal);signal.throwIfAborted();returned=true;
        // A knowledge directory can show an aggregate including documents;
        // re-enter the exact video to read its own fresh record. Normal site
        // navigation can autoplay, so immediately verify normal pause again.
        await this.adapter.enter(task,signal);signal.throwIfAborted();
        if(!await this.adapter.pauseVideo(task,signal))throw new Error('重新核对平台记录时视频暂停未确认。');
        signal.throwIfAborted();
      }
      await this.#wait(2000,signal);
    }
    throw new Error('视频已结束，平台任务完成记录仍未确认。');
  }
  async #audit(signal:AbortSignal):Promise<void>{
    if(!this.#auditCompleted)return;
    this.adapter.reconcileRecords?.();
    this.#excludedTasks.clear();
    this.#phase('RECONCILE','VERIFY');
    const fresh=await this.adapter.catalog(signal);this.#identity(fresh);
    for(const parent of fresh.tasks.filter(task=>this.options.scope.includes(task.id)&&this.#completed.has(task.id))){
      this.#current=parent;this.#runtime.current_task_id=parent.id;
      try{
      await this.adapter.enter(parent,signal);
      const children=parent.kind==='lesson'&&this.adapter.children?await this.adapter.children(parent,signal):[parent];
      if(parent.kind==='lesson')validateCourseResources(parent,children);
      let confirmed=children.some(child=>child.kind!=='excluded');
      for(const child of children.filter(task=>task.kind!=='excluded')){
        this.#current=child;this.#runtime.current_task_id=child.id;
        await this.adapter.enter(child,signal);
        if(child.kind==='video'&&!await this.adapter.pauseVideo(child,signal))throw new Error('恢复核验时视频暂停未确认。');
        const rules=child.kind==='video'?undefined:(await this.adapter.quiz(child,signal)).rules;
        if(!courseRecordConfirms(child,await this.adapter.verify(child,signal),rules)){confirmed=false;this.#completed.delete(child.id);}
        else this.#completed.add(child.id);
      }
      if(!confirmed){this.#completed.delete(parent.id);parent.status='in_progress';}
      }catch(error){
        signal.throwIfAborted();const reason=error instanceof Error?error.message:String(error);if(!courseFailureIsLocal(reason))throw error;
        this.#completed.delete(parent.id);parent.status='in_progress';this.#issues.set(parent.id,{task_id:parent.id,title:parent.title,reason,checked:false});
        if(this.adapter.pauseCurrent&&!await this.adapter.pauseCurrent(signal))throw new Error('恢复异常任务的视频暂停未确认。');
      }
      await this.adapter.returnToCatalog(signal);signal.throwIfAborted();
    }
    this.#auditCompleted=false;await this.options.persist?.(this.snapshot());
  }
  async #loop(signal:AbortSignal):Promise<void> {
    this.#phase('OBSERVE_COURSE');
    if(!this.#pendingQuiz)await this.#audit(signal);
    for(;;){
      signal.throwIfAborted();const catalog=await this.adapter.catalog(signal);signal.throwIfAborted();this.#identity(catalog);
      // Resume must validate the live course before reconciling a possibly
      // submitted child. Re-read the catalog after it updates any task status.
      if(this.#pendingQuiz){
        const boundary=this.#pendingQuiz,parent=catalog.tasks.find(task=>task.lesson_id===this.#current?.lesson_id);
        if(!parent||!this.#current)throw new Error('恢复测验缺少所属课时。');
        try{
        await this.adapter.enter(this.#current,signal);
        if(this.#current.kind==='video'&&!await this.adapter.pauseVideo(this.#current,signal))throw new Error('恢复弹题前视频暂停未确认。');
        await this.#quiz(boundary,signal);
        if(boundary.kind!=='video_popup'){
          const record=await this.adapter.verify(this.#current,signal);
          if(courseRecordConfirms(this.#current,record,boundary.rules))this.#completed.add(this.#current.id);
          else throw new Error('恢复测验的平台任务记录尚未确认。');
          await this.adapter.returnToCatalog(signal);
        }
        }catch(error){
          signal.throwIfAborted();const reason=error instanceof Error?error.message:String(error);
          if(this.#pendingQuiz||!courseFailureIsLocal(reason))throw error;
          this.#issues.set(parent.id,{task_id:parent.id,title:parent.title,reason,checked:false});
          if(this.#current.id!==parent.id)this.#issues.set(this.#current.id,{task_id:this.#current.id,parent_id:parent.id,title:this.#current.title,reason,checked:false});
          if(this.adapter.pauseCurrent&&!await this.adapter.pauseCurrent(signal))throw new Error('恢复测验异常时视频暂停未确认。');
          await this.adapter.returnToCatalog(signal);
        }
        await this.#audit(signal);continue;
      }
      const available=this.options.scope.filter(id=>!this.#issues.has(id)&&!this.#excludedTasks.has(id));
      const ready=catalog.tasks.filter(task=>available.includes(task.id)&&task.status!=='completed'&&task.status!=='locked'&&task.prerequisites.every(id=>catalog.tasks.find(parent=>parent.id===id)?.status==='completed'));
      const task=ready.length?nextCourseTask(catalog,ready.map(task=>task.id)):null;
      if(!task){
        for(const pending of catalog.tasks.filter(task=>available.includes(task.id)&&task.status!=='completed'))this.#issues.set(pending.id,{task_id:pending.id,title:pending.title,reason:'课时尚未解锁或前置任务尚未完成。',checked:false});
        for(const issue of this.#issues.values()){
          if(issue.checked)continue;issue.checked=true;
          const parent=catalog.tasks.find(candidate=>candidate.id===(issue.parent_id??issue.task_id));
          if(!parent)throw new Error('未完成记录缺少所属课时。');
          for(const related of this.#issues.values())if(related.task_id===parent.id||related.parent_id===parent.id)related.checked=true;
          if(parent.status==='locked')continue;
          try{
            this.#current=parent;this.#runtime.current_task_id=parent.id;
            await this.adapter.enter(parent,signal);
            const children=parent.kind==='lesson'&&this.adapter.children?await this.adapter.children(parent,signal):[parent];
            if(parent.kind==='lesson'){
              validateCourseResources(parent,children);
              this.#discovery.set(parent.lesson_id,{lesson_id:parent.lesson_id,state:'complete',count:children.length});
            }
            let confirmed=children.filter(child=>child.kind!=='excluded').length>0;
            for(const child of children.filter(child=>child.kind!=='excluded')){
              this.#current=child;this.#runtime.current_task_id=child.id;
              await this.adapter.enter(child,signal);
              if(child.kind==='video'&&!await this.adapter.pauseVideo(child,signal))throw new Error('最终核验时视频暂停未确认。');
              const rules=child.kind==='video'?undefined:(await this.adapter.quiz(child,signal)).rules;
              const valid=courseRecordConfirms(child,await this.adapter.verify(child,signal),rules);confirmed&&=valid;
              if(valid){this.#completed.add(child.id);this.#issues.delete(child.id);}
            }
            if(confirmed){this.#completed.add(parent.id);parent.status='completed';for(const [id,value] of this.#issues)if(id===parent.id||value.parent_id===parent.id)this.#issues.delete(id);}
          }catch(error){
            signal.throwIfAborted();const reason=error instanceof Error?error.message:String(error);if(!courseFailureIsLocal(reason))throw error;issue.reason=reason;
            if(this.adapter.pauseCurrent&&!await this.adapter.pauseCurrent(signal))throw new Error('最终核验异常时视频暂停未确认。');
          }
          await this.adapter.returnToCatalog(signal);this.#emit();
        }
        if(this.#issues.size){this.#runtime.phase='NEEDS_ATTENTION';this.pause('部分课时需要处理，请查看未完成任务后继续。');return;}
        if(!courseScopeConfirmed(catalog,this.options.scope,this.#excludedTasks,[...this.#issues.values()])){this.#runtime.phase='NEEDS_ATTENTION';this.pause('选定范围没有确认完成的视频或关联测验，请检查课时范围。');return;}
        this.#state='COMPLETE';this.#runtime.phase='RANGE_COMPLETE';this.#notice='本次选定的视频与关联测验已完成。';this.#finish('completed',null);return;
      }
      try {await this.#executeTask(task,catalog,signal);}
      catch(error){
        signal.throwIfAborted();const reason=error instanceof Error?error.message:String(error);
        if(this.#pendingQuiz||!courseFailureIsLocal(reason))throw error;
        const current=this.#current;
        if(current?.kind==='video'&&!await this.adapter.pauseVideo(current,signal))throw new Error('异常任务的视频暂停未确认。');
        this.#issues.set(task.id,{task_id:task.id,title:task.title,reason,checked:false});
        if(task.kind==='lesson'&&this.#discovery.get(task.lesson_id)?.state!=='complete')this.#discovery.set(task.lesson_id,{lesson_id:task.lesson_id,state:'failed',count:null,reason});
        await this.adapter.returnToCatalog(signal);this.#children=[];this.#emit();
      }
    }
  }
  async #executeTask(task:LearningTask,catalog:CourseCatalog,signal:AbortSignal):Promise<void>{
      this.#current=task;this.#runtime.current_task_id=task.id;this.#runtime.video={ended:false,progress_recorded:false};this.#estimate=new VideoEstimate();this.#phase('ENTER_TASK');
      await this.adapter.enter(task,signal);signal.throwIfAborted();
      if(task.kind==='lesson'){
        if(!this.adapter.children)throw new Error('课程适配器没有提供实际课时资源。');
        const children=await this.adapter.children(task,signal);signal.throwIfAborted();
        validateCourseResources(task,children);
        this.#discovery.set(task.lesson_id,{lesson_id:task.lesson_id,state:'complete',count:children.length});
        if(this.#children.length&&this.#children[0]!.lesson_id===task.lesson_id&&(JSON.stringify(this.#children.map(child=>[child.id,child.kind]))!==JSON.stringify(children.map(child=>[child.id,child.kind]))||this.#children.some(child=>child.resource_fingerprint&&children.find(fresh=>fresh.id===child.id)?.resource_fingerprint&&child.resource_fingerprint!==children.find(fresh=>fresh.id===child.id)?.resource_fingerprint)))throw new Error('恢复时课时资源清单改变。');
        for(const child of children){const previous=this.#children.find(item=>item.id===child.id);if(previous?.resource_fingerprint&&!child.resource_fingerprint)child.resource_fingerprint=previous.resource_fingerprint;}
        this.#children=children;this.#emit();
        if(!children.some(child=>child.kind!=='excluded')){this.#excludedTasks.add(task.id);this.#children=[];await this.adapter.returnToCatalog(signal);this.#emit();return;}
        const completed=new Set<string>(),failed=new Set<string>();
        for(const child of children.filter(child=>child.kind!=='excluded'&&(child.status==='completed'||this.#completed.has(child.id)))){
          this.#current=child;this.#runtime.current_task_id=child.id;
          try{
          await this.adapter.enter(child,signal);
          if(child.kind==='video'&&!await this.adapter.pauseVideo(child,signal))throw new Error('已有记录核验时视频暂停未确认。');
          const rules=child.kind==='video'?undefined:(await this.adapter.quiz(child,signal)).rules;
          if(courseRecordConfirms(child,await this.adapter.verify(child,signal),rules))completed.add(child.id);
          else{this.#completed.delete(child.id);child.status='in_progress';}
          }catch(error){
            signal.throwIfAborted();const reason=error instanceof Error?error.message:String(error);if(!courseFailureIsLocal(reason))throw error;
            failed.add(child.id);this.#completed.delete(child.id);this.#issues.set(child.id,{task_id:child.id,parent_id:task.id,title:child.title,reason,checked:false});
            if(this.adapter.pauseCurrent&&!await this.adapter.pauseCurrent(signal))throw new Error('已有记录核验异常时视频暂停未确认。');
          }
        }
        for(;;){
          const child=nextCourseResource(children,completed,failed);if(!child)break;
          signal.throwIfAborted();this.#current=child;this.#runtime.current_task_id=child.id;
          this.#runtime.video={ended:false,progress_recorded:false};this.#estimate=new VideoEstimate();
          try{
          await this.adapter.enter(child,signal);
          if(child.kind==='video'){await this.#watch(child,catalog,signal);await this.#progress(child,signal);}
          else{
            const boundary=await this.adapter.quiz(child,signal);this.#pendingQuiz=boundary;this.#emit();await this.#quiz(boundary,signal);
            const deadline=this.#now()+120000;let verified=await this.adapter.verify(child,signal);
            while(!courseRecordConfirms(child,verified,boundary.rules)&&!verified.pending_grading&&this.#now()<deadline){await this.#wait(1000,signal);verified=await this.adapter.verify(child,signal);}
            if(!courseRecordConfirms(child,verified,boundary.rules))throw new Error('课时测验提交、及格条件或平台记录尚未确认。');
            this.#pendingQuiz=null;
          }
          this.#completed.add(child.id);completed.add(child.id);this.#emit();
          }catch(error){
            signal.throwIfAborted();const reason=error instanceof Error?error.message:String(error);
            if(this.#pendingQuiz||!courseFailureIsLocal(reason))throw error;
            if(child.kind==='video'&&!await this.adapter.pauseVideo(child,signal))throw new Error('异常资源的视频暂停未确认。');
            failed.add(child.id);this.#issues.set(child.id,{task_id:child.id,parent_id:task.id,title:child.title,reason,checked:false});this.#emit();
          }
        }
        for(const child of children.filter(child=>child.kind!=='excluded'&&!completed.has(child.id)))if(!this.#issues.has(child.id))this.#issues.set(child.id,{task_id:child.id,parent_id:task.id,title:child.title,reason:'资源尚未解锁或前置任务尚未完成。',checked:false});
        if(completed.size!==children.filter(child=>child.kind!=='excluded').length){this.#issues.set(task.id,{task_id:task.id,title:task.title,reason:'课时仍有未完成的资源。',checked:false});await this.adapter.returnToCatalog(signal);this.#emit();return;}
        this.#completed.add(task.id);this.#children=[];this.#current=task;
        await this.adapter.returnToCatalog(signal);this.#emit();return;
      }
      if(task.kind==='video'){await this.#watch(task,catalog,signal);await this.#progress(task,signal);}
      else{
        const boundary=await this.adapter.quiz(task,signal);signal.throwIfAborted();this.#validateQuizBoundary(boundary);
        const result=await this.adapter.verify(task,signal);signal.throwIfAborted();
        if(result.task_id!==task.id)throw new Error('测验提交记录不属于当前任务。');
        if(!result.submission_confirmed){await this.#quiz(boundary,signal);}
        let after=await this.adapter.verify(task,signal);signal.throwIfAborted();
        const recordDeadline=this.#now()+120000;
        while((!after.submission_confirmed||!after.completed)&&!after.pending_grading&&this.#now()<recordDeadline){
          if(after.task_id!==task.id)throw new Error('测验结果不属于当前任务。');
          await this.#wait(1000,signal);after=await this.adapter.verify(task,signal);signal.throwIfAborted();
        }
        if(after.task_id!==task.id)throw new Error('测验结果不属于当前任务。');
        if(!after.submission_confirmed||!after.completed)throw new Error('测验已提交或待批阅，但任务完成尚未确认。');
        if(boundary.rules.requires_pass&&after.passed!==true)throw new Error('测验提交已确认，但平台及格条件尚未确认。');
        this.#pendingQuiz=null;
      }
      this.#phase('RECONCILE','VERIFY');await this.adapter.returnToCatalog(signal);signal.throwIfAborted();
      const fresh=await this.adapter.catalog(signal);signal.throwIfAborted();this.#identity(fresh);
      if(fresh.tasks.find(t=>t.id===task.id)?.status!=='completed')throw new Error('目录尚未确认任务完成，停止重复执行。');
  }
}
