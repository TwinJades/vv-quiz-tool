import { ModelCallBudget } from './call-budget';
import type { RunStrategy } from './schema';
import type { SessionRuntimeSnapshot, SessionSummary } from './orchestrator';

export type CoursePlatform = 'zhidao' | 'chaoxing';
export type LearningTaskKind = 'video' | 'lesson_quiz' | 'chapter_quiz' | 'excluded';
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
}
export interface QuizBoundary {
  id: string;
  course_id: string;
  task_id: string;
  kind: 'video_popup' | 'lesson_quiz' | 'chapter_quiz';
  rules: QuizRules;
}
export interface CourseVerification {
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
  status: 'completed' | 'paused' | 'rewatching';
  reason: string | null;
  submission_confirmed: boolean;
  passed: boolean | null;
  visible_score: string | null;
  retried: number;
}
export interface CourseQuizRunner {
  run(boundary: QuizBoundary, strategy: RunStrategy, signal: AbortSignal): Promise<CourseQuizResult>;
  pause(): void;
  switchStrategy(strategy: RunStrategy): void;
}
export interface CourseRuntime {
  phase: string;
  course_id: string;
  title: string;
  scope: string[];
  current_task_id: string | null;
  estimate_seconds: number | null;
  estimate_frozen: boolean;
  video: { ended: boolean; progress_recorded: boolean };
  results: Array<{ id: string; kind: QuizBoundary['kind']; result: CourseQuizResult }>;
  tasks: LearningTask[];
  excluded: string[];
}

/** Never extrapolate a playback estimate from elapsed wall time. */
export class VideoEstimate {
  seconds: number | null = null;
  frozen = true;
  observe(video: VideoSnapshot, now: number): void {
    const valid = now - video.observed_at >= 0 && now - video.observed_at <= 5000 &&
      video.duration !== null && Number.isFinite(video.duration) && video.duration > 0 &&
      video.position !== null && Number.isFinite(video.position) && video.position >= 0 && video.position <= video.duration &&
      video.rate !== null && Number.isFinite(video.rate) && video.rate > 0;
    this.frozen = !valid || video.paused || video.buffering || video.seeking || video.popup !== null;
    if (!valid) { this.seconds = null; return; }
    if (!this.frozen || this.seconds === null || video.ended) {
      this.seconds = Math.ceil(Math.max(0, video.duration! - video.position!) / video.rate!);
    }
  }
  freeze(): void { this.frozen = true; }
}

export function validateCourseScope(catalog: CourseCatalog, ids: string[]): void {
  if (!catalog.complete || catalog.diagnostics.length) throw new Error('课程目录或规则不完整：' + catalog.diagnostics.join('；'));
  if(!catalog.course_id.trim()||catalog.rules.visibility_required===null||catalog.rules.speed_allowed===null)throw new Error('课程身份、倍速或页面可见性规则未知。');
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('请先明确选择不重复的课时/章节范围。');
  if (new Set(catalog.tasks.map(t => t.id)).size !== catalog.tasks.length) throw new Error('课程任务身份重复。');
  for (const id of ids) {
    const task = catalog.tasks.find(t => t.id === id);
    if (!task || task.kind === 'excluded' || task.status === 'unknown') throw new Error('范围含未知、考试或不支持任务：' + id);
  }
}

export function nextCourseTask(catalog: CourseCatalog, scope: string[]): LearningTask | null {
  const remaining = catalog.tasks.filter(t => scope.includes(t.id) && t.status !== 'completed').sort((a,b) => a.order-b.order);
  if (!remaining.length) return null;
  const startedLessons = new Set(catalog.tasks.filter(t => scope.includes(t.id) && (t.status === 'in_progress' || t.status === 'completed')).map(t => t.lesson_id));
  const ready = remaining.filter(t => t.status !== 'locked' && t.prerequisites.every(id => catalog.tasks.find(p => p.id === id)?.status === 'completed'));
  const task = ready.find(t => t.status === 'in_progress') ?? ready.find(t => startedLessons.has(t.lesson_id)) ?? ready[0];
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
  constructor(private adapter: CourseAdapter, private quizzes: CourseQuizRunner, private options: CourseOptions) {
    validateCourseScope(options.catalog,options.scope);
    this.#now = options.now ?? Date.now;
    this.#wait = options.wait ?? delay;
    this.#runtime = {phase:'READY',course_id:options.catalog.course_id,title:options.catalog.title,scope:[...options.scope],current_task_id:null,
      estimate_seconds:null,estimate_frozen:true,video:{ended:false,progress_recorded:false},results:[],tasks:options.catalog.tasks,
      excluded:options.catalog.tasks.filter(t => !options.scope.includes(t.id)).map(t=>t.id)};
  }
  snapshot(): SessionRuntimeSnapshot {
    const selected = this.#runtime.tasks.filter(t=>this.options.scope.includes(t.id));
    return {session_id:this.options.session_id,state:this.#state,strategy:this.options.strategy,observation_input_mode:'structured',
      provider_profile_id:this.options.provider_profile_id,model_id:this.options.model_id,model_calls:{used:this.options.budget.used,limit:this.options.budget.limit},
      progress:{total:selected.length,answered:selected.filter(t=>t.status==='completed').length,guessed:0,retried:this.#runtime.results.reduce((n,r)=>n+r.result.retried,0),skipped:0,failed:0},
      notice:this.#notice,summary:this.#summary,course:structuredClone({...this.#runtime,estimate_seconds:this.#estimate.seconds,estimate_frozen:this.#estimate.frozen})};
  }
  modelChanged(id: string, reason: string): void { this.options.model_id=id; this.#notice=reason; this.#emit(); }
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
      if (current?.kind==='video') {
        try { if (!await this.adapter.pauseVideo(current,new AbortController().signal)) this.#notice=reason+' 视频暂停未确认，请检查播放器。'; }
        catch { this.#notice=reason+' 视频可能仍在播放，请手动检查。'; }
      }
      this.#emit();
    })();
  }
  async resume(): Promise<void> { await this.#running;await this.#pausePromise;if(this.#state==='PAUSED'){this.#summary=null;this.#notice=null;await this.run();} }
  switchStrategy(strategy:RunStrategy):void {this.options.strategy=strategy;this.quizzes.switchStrategy(strategy);this.#emit();}
  stop(reason='用户停止课程。'):void {this.pause(reason);this.#state='CANCELLED';this.#finish('cancelled',reason);}
  #finish(status:SessionSummary['status'],reason:string|null):void {
    const snapshot=this.snapshot();this.#summary={session_id:this.options.session_id,status,...snapshot.progress,model_calls:this.options.budget.used,visible_score:null,stop_reason:reason};this.#emit();
  }
  #identity(catalog:CourseCatalog):void {
    if(catalog.course_id!==this.options.catalog.course_id||catalog.platform!==this.options.catalog.platform)throw new Error('当前页面已改变课程，停止自动动作。');
    validateCourseScope(catalog,this.options.scope);
    for(const id of this.options.scope){
      const old=this.options.catalog.tasks.find(t=>t.id===id)!;const fresh=catalog.tasks.find(t=>t.id===id)!;
      if(old.kind!==fresh.kind||old.lesson_id!==fresh.lesson_id||old.chapter_id!==fresh.chapter_id||old.prerequisites.join('|')!==fresh.prerequisites.join('|'))throw new Error('课程任务归属或前置条件改变，请重新选择范围。');
    }
    this.#runtime.tasks=catalog.tasks;
  }
  async #quiz(boundary:QuizBoundary,signal:AbortSignal):Promise<void> {
    if(boundary.course_id!==this.options.catalog.course_id||boundary.task_id!==this.#current?.id)throw new Error('测验不属于当前课时。');
    if(boundary.rules.retry_allowed===null||boundary.rules.requires_rewatch===null||boundary.rules.requires_pass===null)throw new Error('测验重试、回看或及格规则未知，请先确认页面材料。');
    this.#pendingQuiz=boundary;this.#phase(boundary.kind==='video_popup'?'POPUP':'QUIZ','SOLVE');
    const result=await this.quizzes.run(boundary,this.options.strategy,signal);signal.throwIfAborted();
    const resultId=`${boundary.task_id}:${boundary.kind}:${boundary.id}`;
    const prior=this.#runtime.results.findIndex(r=>r.id===resultId);
    const entry={id:resultId,kind:boundary.kind,result};if(prior<0)this.#runtime.results.push(entry);else this.#runtime.results[prior]=entry;
    this.#emit();
    if(result.status==='rewatching'&&boundary.kind==='video_popup'&&boundary.rules.requires_rewatch){this.#pendingQuiz=null;return;}
    if(result.status!=='completed'||!result.submission_confirmed)throw new Error(result.reason??'测验提交或弹题处理尚未确认。');
    if(boundary.rules.requires_pass&&result.passed!==true)throw new Error('已提交，但及格条件尚未确认。');
    this.#pendingQuiz=null;
  }
  async #watch(task:LearningTask,catalog:CourseCatalog,signal:AbortSignal):Promise<void> {
    await this.adapter.mute(task,signal);signal.throwIfAborted();
    await this.adapter.highestAllowedSpeed(task,signal);signal.throwIfAborted();
    let lastPosition:number|null=null;let lastProgress=this.#now();let lastPopup:string|null=null;let shouldPlay=true;let videoId:string|null=null;
    while(!signal.aborted){
      const video=await this.adapter.video(task,signal);signal.throwIfAborted();
      if(video.course_id!==catalog.course_id||video.task_id!==task.id||!video.video_id||videoId!==null&&videoId!==video.video_id||this.#now()-video.observed_at>5000||this.#now()<video.observed_at)throw new Error('视频身份或观察失效，暂停。');
      videoId=video.video_id;
      if(catalog.rules.visibility_required===null)throw new Error('课程页面可见性规则未知。');
      if(catalog.rules.visibility_required&&!video.visible)throw new Error('本课程要求页面可见，请返回视频页面后继续。');
      this.#estimate.observe(video,this.#now());this.#emit();
      if(video.popup){
        if(video.popup.id===lastPopup)throw new Error('弹题仍未解除或要求回看，停止重复提交。');
        await this.#quiz(video.popup,signal);lastPopup=video.popup.id;shouldPlay=true;lastProgress=this.#now();continue;
      }
      lastPopup=null;
      if(video.ended){this.#runtime.video.ended=true;this.#phase('VERIFY_PROGRESS','VERIFY');return;}
      if(video.position!==null&&video.position!==lastPosition){lastPosition=video.position;lastProgress=this.#now();}
      if(shouldPlay&&video.paused&&!video.buffering&&!video.seeking){await this.adapter.play(task,signal);signal.throwIfAborted();shouldPlay=false;}
      if(this.#now()-lastProgress>=120000)throw new Error('视频连续两分钟没有有效播放进展，请检查网络或播放器。');
      this.#phase(video.buffering?'BUFFERING':video.seeking?'REWATCHING':'PLAYING');await this.#wait(1000,signal);
    }
  }
  async #progress(task:LearningTask,signal:AbortSignal):Promise<void> {
    const start=this.#now();let returned=false;
    while(this.#now()-start<120000){
      const result=await this.adapter.verify(task,signal);signal.throwIfAborted();
      if(result.task_id!==task.id)throw new Error('平台进度不属于当前任务。');
      this.#runtime.video.progress_recorded=result.progress_recorded;this.#emit();
      if(result.progress_recorded&&result.completed)return;
      if(!returned&&this.#now()-start>=60000){await this.adapter.returnToCatalog(signal);signal.throwIfAborted();returned=true;}
      await this.#wait(2000,signal);
    }
    throw new Error('视频已结束，平台任务完成记录仍未确认；不会进入下一课时。');
  }
  async #loop(signal:AbortSignal):Promise<void> {
    this.#phase('OBSERVE_COURSE');
    // Reconcile any possibly submitted child before navigating or requesting another answer.
    if(this.#pendingQuiz){await this.#quiz(this.#pendingQuiz,signal);}
    for(;;){
      signal.throwIfAborted();const catalog=await this.adapter.catalog(signal);signal.throwIfAborted();this.#identity(catalog);
      const task=nextCourseTask(catalog,this.options.scope);
      if(!task){this.#state='COMPLETE';this.#runtime.phase='RANGE_COMPLETE';this.#notice='本次选定的视频与关联测验范围已完成；讨论、作业、见面课、签到和期末考试未纳入。';this.#finish('completed',null);return;}
      this.#current=task;this.#runtime.current_task_id=task.id;this.#runtime.video={ended:false,progress_recorded:false};this.#estimate=new VideoEstimate();this.#phase('ENTER_TASK');
      await this.adapter.enter(task,signal);signal.throwIfAborted();
      if(task.kind==='video'){await this.#watch(task,catalog,signal);await this.#progress(task,signal);}
      else{
        const result=await this.adapter.verify(task,signal);signal.throwIfAborted();
        if(!result.submission_confirmed){await this.#quiz(await this.adapter.quiz(task,signal),signal);}
        const after=await this.adapter.verify(task,signal);signal.throwIfAborted();
        if(!after.submission_confirmed||!after.completed)throw new Error('测验已提交或待批阅，但任务完成尚未确认。');
      }
      this.#phase('RECONCILE','VERIFY');await this.adapter.returnToCatalog(signal);signal.throwIfAborted();
      const fresh=await this.adapter.catalog(signal);signal.throwIfAborted();this.#identity(fresh);
      if(fresh.tasks.find(t=>t.id===task.id)?.status!=='completed')throw new Error('目录尚未确认任务完成，停止重复执行。');
    }
  }
}
