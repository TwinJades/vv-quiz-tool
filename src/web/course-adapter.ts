import type {CourseCatalog,CoursePlatform,CourseVerification,LearningTask,QuizBoundary,VideoSnapshot} from '../core/course';
import type {VisualGeometry} from '../core/visual';
import type {CourseSurfaceReading,CourseSurfaceSnapshot,CourseFrameContext,CourseEmbeddedFrame} from './course-surface';
import {LiveCoursePage} from './live-course-page';
import {SemanticCoursePage} from './semantic-course-page';
import {isObservedCourseInteraction} from './course-interaction';

export type CoursePageRequest=
  | {operation:'bind';catalog:CourseCatalog}
  | {operation:'catalog';known?:CourseCatalog}
  | {operation:'children'|'enter'|'video'|'speed'|'speed_target'|'mute'|'play'|'pause'|'verify'|'quiz'|'rewatch'|'retry'|'record';course_id:string;task:LearningTask;tab_muted?:boolean}
  | {operation:'directory';course_id:string};
export type CourseSpeedTarget={point:{x:number;y:number};captured_at:number;geometry:VisualGeometry};
export type CoursePageResult=CourseCatalog|LearningTask[]|VideoSnapshot|CourseVerification|QuizBoundary|CourseSpeedTarget|boolean|null;

export function coursePlatform(value:string):CoursePlatform|null {
  if(!URL.canParse(value))return null;
  const url=new URL(value);if(url.protocol!=='https:')return null;
  if(url.hostname==='zhihuishu.com'||url.hostname.endsWith('.zhihuishu.com'))return 'zhidao';
  if(url.hostname==='chaoxing.com'||url.hostname.endsWith('.chaoxing.com'))return 'chaoxing';
  return null;
}

export class CoursePageAdapter {
  readonly #semantic:SemanticCoursePage;
  readonly #live:LiveCoursePage;
  constructor(private document:Document,readonly platform:CoursePlatform){this.#semantic=new SemanticCoursePage(document,platform);this.#live=new LiveCoursePage(document);}
  close():void{this.#semantic.close();this.#live.close();}
  captureSemantic(context?:CourseFrameContext,intent?:CourseSurfaceSnapshot['intent']):CourseSurfaceSnapshot{return this.#semantic.capture(context,intent);}
  embeddedFrames():CourseEmbeddedFrame[]{return this.#semantic.ready()?this.#semantic.embeddedFrames():[];}
  pauseCurrent(courseId:string,contextId:string|null,context?:CourseFrameContext):boolean{return this.#semantic.pauseCurrent(courseId,contextId,context);}
  applySemantic(reading:CourseSurfaceReading):void{this.#semantic.apply(reading);}
  expandSemantic(signal:AbortSignal,direction:'next'|'previous'='next'):boolean{return this.#semantic.loadNext(signal,direction);}
  semanticInteractionTarget(target:EventTarget|null):boolean{return this.#semantic.ready()&&isObservedCourseInteraction(this.document,target);}
  assertBoundary(courseId:string,task:LearningTask,boundary:QuizBoundary):HTMLElement{
    if(boundary.course_id!==courseId||boundary.task_id!==task.id||(boundary.kind==='video_popup'?task.kind!=='video':boundary.kind!==task.kind))throw new Error('测验课程、资源或类型身份已经改变。');
    if(this.#semantic.ready())return this.#semantic.quizRoot(task,boundary);
    if(!this.#live.handles())throw new Error('当前课程页面结构尚未识别。');
    if(boundary.kind==='video_popup')return this.#live.assertPopup(task,boundary);
    if(boundary.id!==task.id)throw new Error('测验边界身份已经改变。');
    return this.#live.quizRoot(task);
  }
  execute(request:CoursePageRequest,signal:AbortSignal=new AbortController().signal):Promise<CoursePageResult>{
    signal.throwIfAborted();
    if(coursePlatform(this.document.location.href)!==this.platform)throw new Error('课程平台或网站身份已经改变。');
    if(this.#semantic.ready())return this.#semantic.execute(request,signal);
    if(this.#live.handles())return this.#live.execute(request,signal);
    throw new Error('当前课程页面尚未识别，请通过加载课程入口读取实际目录。');
  }
}

export class CoursePageLease {
  #session:string|null=null;
  #adapter:CoursePageAdapter|null=null;
  constructor(private document:Document){}
  close():void{this.#adapter?.close();this.#adapter=null;this.#session=null;}
  forSession(platform:CoursePlatform,session:string):CoursePageAdapter{
    if(!session)throw new Error('课程执行缺少父会话身份。');
    if(this.#session!==session||this.#adapter?.platform!==platform){this.close();this.#session=session;this.#adapter=new CoursePageAdapter(this.document,platform);}
    return this.#adapter!;
  }
}
