import type { CourseCatalog, CoursePlatform, CourseVerification, LearningTask, QuizBoundary, QuizRules, VideoSnapshot } from '../core/course';
import { isExplicitlyHidden } from './dom-utils';
import { readZhidaoDirectory } from './zhidao-directory';
import { readChaoxingDirectory } from './chaoxing-directory';
import { readChaoxingLearningPage } from './chaoxing-learning-page';
import { readZhidaoNavigation } from './zhidao-navigation';
import { readZhidaoPlayer } from './zhidao-player';
import { ZhidaoLearningPage } from './zhidao-learning-page';
import type { VisualGeometry } from '../core/visual';

export type CoursePageRequest =
  | { operation: 'catalog' }
  | { operation: 'enter' | 'video' | 'speed' | 'speed_target' | 'mute' | 'play' | 'pause' | 'verify' | 'quiz' | 'rewatch'; course_id: string; task: LearningTask }
  | { operation: 'directory'; course_id: string };
export type CourseSpeedTarget={point:{x:number;y:number};captured_at:number;geometry:VisualGeometry};
export type CoursePageResult = CourseCatalog | VideoSnapshot | CourseVerification | QuizBoundary | CourseSpeedTarget | boolean | null;

export function coursePlatform(url: string): CoursePlatform | null {
  try {
    const {hostname,protocol}=new URL(url);
    if(protocol!=='https:')return null;
    if(hostname==='zhihuishu.com'||hostname.endsWith('.zhihuishu.com'))return 'zhidao';
    if(hostname==='chaoxing.com'||hostname.endsWith('.chaoxing.com'))return 'chaoxing';
  } catch { /* Invalid URLs do not identify a platform. */ }
  return null;
}
const bool = (value:string|undefined):boolean|null => value==='true'?true:value==='false'?false:null;
const num = (value:string|undefined):number|null => value!==undefined&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
const text = (element:Element) => (element.getAttribute('aria-label')||element.textContent||'').replace(/\s+/g,' ').trim();
const visible = (element:HTMLElement) => element.isConnected&&!isExplicitlyHidden(element);
const enabled = (element:HTMLElement) => visible(element)&&!element.hasAttribute('disabled')&&element.getAttribute('aria-disabled')!=='true';

/** Strict semantic reader. No undocumented selectors or private progress APIs.
 * The normalized DOM contract is covered by fixtures; live platform mappings
 * require separately retained page evidence before they can be advertised.
 */
export class CoursePageAdapter {
  #buffering = new WeakMap<HTMLVideoElement,boolean>();
  #bound = new WeakSet<HTMLVideoElement>();
  #popupPosition = new WeakMap<HTMLElement,number>();
  #allowedRates = new WeakMap<HTMLVideoElement,Set<number>>();
  readonly #zhidao:ZhidaoLearningPage;
  constructor(private document:Document, readonly platform:CoursePlatform) {this.#zhidao=new ZhidaoLearningPage(document);}
  close():void {this.#zhidao.close();}
  root():HTMLElement {
    if(coursePlatform(this.document.location.href)!==this.platform)throw new Error('课程平台或网站身份改变。');
    const pageText=this.document.body?.innerText||this.document.body?.textContent||'';
    if(/本课程已结课|课程已结束|任务点[、，\s\S]{0,40}将无法完成/.test(pageText))throw new Error('当前课程已结课或任务点被平台关闭，不能用于自动学习或新增进度验收。');
    const roots=Array.from(this.document.querySelectorAll<HTMLElement>('[data-course-id][data-course-catalog]')).filter(visible);
    if(roots.length!==1)throw new Error('课程结构尚未验证。需要目录、视频、弹题、进度与测验页面材料；未执行动作。');
    if(!roots[0]!.dataset.courseId?.trim())throw new Error('缺少稳定课程身份。');
    return roots[0]!;
  }
  private course(id:string):HTMLElement {const root=this.root();if(root.dataset.courseId!==id)throw new Error('课程身份失配。');return root;}
  catalog():CourseCatalog {
    if (coursePlatform(this.document.location.href) !== this.platform) throw new Error('课程平台或网站身份改变。');
    if(this.platform==='zhidao'&&!this.document.querySelector('[data-course-id][data-course-catalog]')&&this.#zhidao.handles())return this.#zhidao.catalog();
    // Real directory evidence is useful for preview, but knowledge cards and
    // lesson rows are not yet executable video/quiz tasks. Never promote their
    // percentages or icons into completed tasks or mark the catalog complete.
    if (!this.document.querySelector('[data-course-id][data-course-catalog]')) {
      const learning=this.platform==='chaoxing' ? readChaoxingLearningPage(this.document) : null;
      if(learning)return {course_id:learning.course_id,platform:this.platform,title:learning.lesson_title??this.document.title,
        revision:JSON.stringify(learning),complete:false,tasks:[],rules:{visibility_required:learning.visibility_required,speed_allowed:null},
        diagnostics:[`当前课时有${learning.videos.length}个视频、${learning.quizzes.length}个关联测验；尚未完成真实执行映射。`,
          ...learning.diagnostics,...(learning.quizzes.some(q=>q.visual_text_required)?['题干使用显示字体，需视觉识别后核对控件，不能直接求解原始乱码文字。']:[])]};
      const zhidao = this.platform === 'zhidao' ? readZhidaoDirectory(this.document) : null;
      if (zhidao) return { course_id: zhidao.course_id, platform: this.platform, title: this.document.title,
        revision: JSON.stringify(zhidao), complete: false, tasks: [],
        rules: {visibility_required:null,speed_allowed:null}, diagnostics: [
          `已读取${zhidao.modules.length}个知识模块、${zhidao.points.length}个知识点；视频与关联练习的范围和规则确认前不能启动。`,
          ...zhidao.diagnostics,
        ] };
      const navigation = this.platform === 'zhidao' ? readZhidaoNavigation(this.document) : null;
      if (navigation?.ready) {
        const player = navigation.stage === 'learner' ? readZhidaoPlayer(this.document) : null;
        return { course_id:navigation.course_id, platform:this.platform, title:this.document.title,
          revision:JSON.stringify({navigation,player}), complete:false, tasks:[],
          rules:{visibility_required:null,speed_allowed:null}, diagnostics:[
            navigation.stage === 'learner'
              ? '已识别知到学习页；知识点内的视频与文档要分别确认身份和完成规则，请返回课程目录选择范围。'
              : '已识别知到练习或历史解析页；既有作答记录不代表本次提交或课程任务完成，请返回课程目录选择范围。',
            ...(player ? [player.paused ? '当前视频已暂停。' : '当前视频正在播放，平台返回学习页可能自动播放，请核对暂停状态。',
              player.muted || player.volume === 0 ? '播放器静音已确认。' : '播放器自身静音未确认。', ...player.diagnostics] : []),
            ...navigation.diagnostics,
          ] };
      }
      const chaoxing = this.platform === 'chaoxing' ? readChaoxingDirectory(this.document) : null;
      if (chaoxing) {
        if (!chaoxing.course_id) throw new Error(`已读取${chaoxing.lessons.length}个课时；${chaoxing.diagnostics.join('；')}`);
        return { course_id: chaoxing.course_id, platform: this.platform, title: this.document.title,
          revision: JSON.stringify(chaoxing), complete: false, tasks: [],
          rules: {visibility_required:null,speed_allowed:null}, diagnostics: [
            `已读取${chaoxing.lessons.length}个课时；视频、弹题和关联测验仍需逐项确认。`,
            ...chaoxing.diagnostics,
          ] };
      }
    }
    const root=this.root();
    const rows=Array.from(root.querySelectorAll<HTMLElement>('[data-learning-task-id]')).filter(visible);
    const diagnostics:string[]=[];
    const tasks=rows.map((row,index):LearningTask=>{
      const declared=row.dataset.taskKind;
      const kind=['video','lesson_quiz','chapter_quiz'].includes(declared??'')?declared as LearningTask['kind']:'excluded';
      const status=['not_started','in_progress','completed','locked'].includes(row.dataset.taskStatus??'')?row.dataset.taskStatus as LearningTask['status']:'unknown';
      const lesson=row.dataset.lessonId;const chapter=row.dataset.chapterId;
      if(!lesson||!chapter||!row.dataset.learningTaskId||status==='unknown')diagnostics.push('任务身份、归属或状态未知：'+text(row).slice(0,80));
      return {id:row.dataset.learningTaskId??'',lesson_id:lesson??'',chapter_id:chapter??'',title:row.dataset.taskTitle||text(row),kind,status,order:index,
        prerequisites:(row.dataset.prerequisites??'').split(/\s+/).filter(Boolean)};
    });
    const rules={visibility_required:bool(root.dataset.visibilityRequired),speed_allowed:bool(root.dataset.speedAllowed)};
    if(rules.visibility_required===null||rules.speed_allowed===null)diagnostics.push('课程倍速或页面可见性规则尚未确认');
    if(!tasks.length)diagnostics.push('没有完整任务清单');
    const complete=root.dataset.catalogComplete==='true';if(!complete)diagnostics.push('目录完整性未确认，可能仍有未展开或未加载课时');
    return {course_id:root.dataset.courseId!,platform:this.platform,title:root.dataset.courseTitle||this.document.title,
      revision:JSON.stringify(tasks.map(t=>[t.id,t.status,t.kind,t.prerequisites])),complete,tasks,rules,diagnostics};
  }
  private taskRoot(courseId:string,task:LearningTask):HTMLElement {
    const root=this.course(courseId);
    this.taskIdentity(this.catalog(),task);
    const roots=Array.from(root.querySelectorAll<HTMLElement>('[data-active-task-id]')).filter(e=>visible(e)&&e.dataset.activeTaskId===task.id);
    if(roots.length!==1)throw new Error('当前课时/视频身份无法唯一确认。');
    return roots[0]!;
  }
  private taskIdentity(catalog:CourseCatalog,task:LearningTask):LearningTask {
    const matches=catalog.tasks.filter(t=>t.id===task.id);
    const current=matches[0];
    if(matches.length!==1||!current||current.kind!==task.kind||current.lesson_id!==task.lesson_id||
      current.chapter_id!==task.chapter_id||current.prerequisites.join('|')!==task.prerequisites.join('|'))throw new Error('课时身份、归属或前置条件改变。');
    return current;
  }
  private button(scope:HTMLElement,action:string):HTMLElement {
    const buttons=Array.from(scope.querySelectorAll<HTMLElement>('button,[role="button"],a[href],input[type="button"]'))
      .filter(e=>enabled(e)&&e.dataset.courseAction===action);
    if(buttons.length!==1)throw new Error('缺少唯一可用正常控件：'+action);
    return buttons[0]!;
  }
  private click(element:HTMLElement):void {
    if(!enabled(element))throw new Error('控件不可用。');
    if(element instanceof this.document.defaultView!.HTMLAnchorElement){
      const link=new URL(element.href,this.document.location.href);
      if(coursePlatform(link.href)!==this.platform||element.target&&element.target!=='_self')throw new Error('导航目标未知、跨平台或新标签尚未验证。');
    }
    element.click();
  }
  enter(courseId:string,task:LearningTask):void {
    const root=this.course(courseId);const fresh=this.taskIdentity(this.catalog(),task);
    if(fresh.status==='locked'||fresh.status==='unknown')throw new Error('任务不可进入。');
    const active=Array.from(root.querySelectorAll<HTMLElement>('[data-active-task-id]')).filter(e=>visible(e)&&e.dataset.activeTaskId===task.id);
    if(active.length===1)return;
    const rows=Array.from(root.querySelectorAll<HTMLElement>('[data-learning-task-id]')).filter(e=>visible(e)&&e.dataset.learningTaskId===task.id);
    if(rows.length!==1)throw new Error('目录任务不唯一。');
    this.click(this.button(rows[0]!,'enter'));
  }
  private media(scope:HTMLElement):HTMLVideoElement {
    const videos=Array.from(scope.querySelectorAll<HTMLVideoElement>('video')).filter(visible);
    if(videos.length!==1||!videos[0]!.dataset.videoId)throw new Error('需要可读取且有稳定身份的唯一视频及其iframe资料。');
    const video=videos[0]!;
    if(!this.#bound.has(video)){
      this.#bound.add(video);
      for(const event of ['waiting','stalled'])video.addEventListener(event,()=>this.#buffering.set(video,true));
      for(const event of ['playing','canplay','ended'])video.addEventListener(event,()=>this.#buffering.set(video,false));
    }
    return video;
  }
  private quizRules(root:HTMLElement):QuizRules {
    const attempts=num(root.dataset.remainingAttempts);
    return {scored:bool(root.dataset.scored),retry_allowed:bool(root.dataset.retryAllowed),remaining_attempts:attempts!==null&&Number.isInteger(attempts)&&attempts>=0?attempts:null,
      requires_pass:bool(root.dataset.requiresPass),requires_rewatch:bool(root.dataset.requiresRewatch)};
  }
  quizRoot(courseId:string,task:LearningTask,kind?:QuizBoundary['kind']):HTMLElement {
    const scope=this.taskRoot(courseId,task);
    const roots=Array.from(scope.querySelectorAll<HTMLElement>('[data-quiz-id][data-quiz-kind]')).filter(e=>visible(e)&&(!kind||e.dataset.quizKind===kind));
    if(roots.length!==1)throw new Error('测验/弹题边界无法唯一确认。');
    return roots[0]!;
  }
  assertBoundary(courseId:string,task:LearningTask,expected:QuizBoundary):HTMLElement {
    const root=this.quizRoot(courseId,task,expected.kind);
    if(expected.course_id!==courseId||expected.task_id!==task.id||root.dataset.quizId!==expected.id||
      (expected.kind==='video_popup'?task.kind!=='video':expected.kind!==task.kind))throw new Error('弹题/测验身份改变。');
    const rules=this.quizRules(root);
    for(const key of ['scored','retry_allowed','requires_pass','requires_rewatch'] as const){
      if(rules[key]===null||rules[key]!==expected.rules[key])throw new Error('测验规则已改变或未知，请重新核对。');
    }
    return root;
  }
  boundary(courseId:string,task:LearningTask):QuizBoundary {
    const root=this.quizRoot(courseId,task);
    const kind=root.dataset.quizKind;
    if(kind==='video_popup'?task.kind!=='video':kind!==task.kind)throw new Error('测验类型不匹配，禁止进入考试。');
    if(!root.dataset.quizId)throw new Error('缺少测验身份。');
    return {id:root.dataset.quizId,course_id:courseId,task_id:task.id,kind:kind as QuizBoundary['kind'],rules:this.quizRules(root)};
  }
  video(courseId:string,task:LearningTask):VideoSnapshot {
    const scope=this.taskRoot(courseId,task);const video=this.media(scope);
    this.assertPlaybackSpeed(video);
    if(!video.paused&&!video.ended&&!video.muted&&video.volume!==0)throw new Error('播放中的静音状态已失效，暂停课程后请核对播放器。');
    const popups=Array.from(scope.querySelectorAll<HTMLElement>('[data-quiz-id][data-quiz-kind="video_popup"]')).filter(visible);
    if(popups.length>1)throw new Error('多个视频弹题，无法可靠分离。');
    if(popups[0]&&!this.#popupPosition.has(popups[0]))this.#popupPosition.set(popups[0],video.currentTime);
    return {course_id:courseId,task_id:task.id,video_id:video.dataset.videoId!,observed_at:Date.now(),duration:Number.isFinite(video.duration)?video.duration:null,
      position:Number.isFinite(video.currentTime)?video.currentTime:null,rate:Number.isFinite(video.playbackRate)?video.playbackRate:null,
      paused:video.paused,buffering:this.#buffering.get(video)===true||video.readyState<3,seeking:video.seeking,ended:video.ended,
      visible:this.document.visibilityState==='visible',popup:popups.length?this.boundary(courseId,task):null};
  }
  async speed(courseId:string,task:LearningTask):Promise<void> {
    const rules=this.catalog().rules;if(rules.speed_allowed===null)throw new Error('倍速规则未知。');
    const scope=this.taskRoot(courseId,task);const video=this.media(scope);
    if(!rules.speed_allowed){if(video.playbackRate!==1)throw new Error('课程不允许倍速，但当前实际速度不是1x，请关闭外部加速后继续。');this.#allowedRates.set(video,new Set([1]));return;}
    const menu=Array.from(scope.querySelectorAll<HTMLElement>('[data-course-action="speed-menu"]')).filter(enabled);
    if(menu.length>1)throw new Error('倍速菜单不唯一。');if(menu[0])this.click(menu[0]);
    const choices=Array.from(scope.querySelectorAll<HTMLElement>('[data-playback-rate]')).filter(enabled)
      .map(element=>({element,rate:num(element.dataset.playbackRate)})).filter((x):x is {element:HTMLElement;rate:number}=>x.rate!==null&&x.rate>0).sort((a,b)=>b.rate-a.rate);
    if(!choices.length){if(video.playbackRate!==1)throw new Error('实际倍速没有可验证的播放器允许选项，请关闭外部加速后继续。');this.#allowedRates.set(video,new Set([1]));return;}
    const best=choices[0]!;if(video.playbackRate!==best.rate)this.click(best.element);
    if(video.playbackRate!==best.rate)throw new Error('倍速选择后实际速度未确认。');
    this.#allowedRates.set(video,new Set(choices.map(choice=>choice.rate)));
  }
  private assertPlaybackSpeed(video:HTMLVideoElement):void {
    const allowed=this.catalog().rules.speed_allowed;
    if(allowed===null)throw new Error('倍速规则未知。');
    if(!Number.isFinite(video.playbackRate)||video.playbackRate<=0||
      (!allowed?video.playbackRate!==1:!(this.#allowedRates.get(video)??new Set([1])).has(video.playbackRate)))
      throw new Error('实际播放速度不在已确认的播放器允许选项内，请关闭外部加速后继续。');
  }
  playback(courseId:string,task:LearningTask,pause:boolean):boolean {
    const scope=this.taskRoot(courseId,task);const video=this.media(scope);
    if(!pause){this.mute(courseId,task);this.assertPlaybackSpeed(video);}
    if(video.paused===pause)return true;
    this.click(this.button(scope,pause?'pause':'play'));
    return video.paused===pause;
  }
  mute(courseId:string,task:LearningTask):void {
    const scope=this.taskRoot(courseId,task);const video=this.media(scope);
    if(video.muted||video.volume===0)return;
    this.click(this.button(scope,'mute'));
    if(!video.muted&&video.volume!==0)throw new Error('静音未确认，请先使用播放器静音控件。');
  }
  verify(courseId:string,task:LearningTask):CourseVerification {
    const catalog=this.catalog();if(catalog.course_id!==courseId)throw new Error('进度不属于当前课程。');
    const row=this.taskIdentity(catalog,task);
    const active=Array.from(this.course(courseId).querySelectorAll<HTMLElement>('[data-active-task-id]')).find(e=>visible(e)&&e.dataset.activeTaskId===task.id);
    const quiz=active&&Array.from(active.querySelectorAll<HTMLElement>('[data-quiz-id]')).find(visible);
    const submission=quiz?.dataset.submissionConfirmed==='true';
    return {task_id:task.id,media_ended:task.kind==='video'&&active!==undefined?this.media(active).ended:false,progress_recorded:row.status==='completed',
      submission_confirmed:submission,completed:row.status==='completed',passed:bool(quiz?.dataset.passed),
      pending_grading:quiz?.dataset.pendingGrading==='true',visible_score:quiz?.querySelector<HTMLElement>('[data-visible-score]')?.textContent?.trim()??null};
  }
  rewatch(courseId:string,task:LearningTask):boolean {
    const scope=this.taskRoot(courseId,task);const popup=this.quizRoot(courseId,task,'video_popup');
    const before=this.#popupPosition.get(popup);
    if(popup.dataset.feedback!=='incorrect'||this.quizRules(popup).requires_rewatch!==true||before===undefined)throw new Error('回看要求或回退基准未确认。');
    this.click(this.button(popup,'rewatch'));
    if(visible(popup)||!(this.media(scope).currentTime<before))throw new Error('正常回看后弹题未解除或实际回退未确认。');
    return true;
  }
  execute(request:CoursePageRequest,signal:AbortSignal=new AbortController().signal):CoursePageResult|Promise<CoursePageResult> {
    signal.throwIfAborted();
    if(this.platform==='zhidao'&&!this.document.querySelector('[data-course-id][data-course-catalog]')&&this.#zhidao.handles())return this.#zhidao.execute(request,signal);
    if(request.operation==='catalog')return this.catalog();
    if(request.operation==='directory'){this.click(this.button(this.course(request.course_id),'directory'));return true;}
    const {course_id,task}=request;
    switch(request.operation){
      case 'enter':this.enter(course_id,task);return true;
      case 'video':return this.video(course_id,task);
      case 'speed':return this.speed(course_id,task).then(()=>true);
      case 'speed_target':return null;
      case 'mute':this.mute(course_id,task);return true;
      case 'play':if(!this.playback(course_id,task,false))throw new Error('视频恢复播放未确认。');return true;
      case 'pause':return this.playback(course_id,task,true);
      case 'verify':return this.verify(course_id,task);
      case 'quiz':return this.boundary(course_id,task);
      case 'rewatch':return this.rewatch(course_id,task);
    }
  }
}

export class ZhidaoCourseAdapter extends CoursePageAdapter {constructor(document:Document){super(document,'zhidao');}}
export class ChaoxingCourseAdapter extends CoursePageAdapter {constructor(document:Document){super(document,'chaoxing');}}

/** Previewing another point must not replace an active course lease. A new
 * parent session gets a fresh point scope; a resumed parent retains its scope. */
export class CoursePageLease {
  #session:string|null=null;#adapter:CoursePageAdapter|null=null;
  constructor(private document:Document){}
  preview(platform:CoursePlatform):CoursePageAdapter {return new CoursePageAdapter(this.document,platform);}
  forSession(platform:CoursePlatform,session:string):CoursePageAdapter {
    if(!session)throw new Error('课程执行缺少父会话身份。');
    if(this.#session!==session||this.#adapter?.platform!==platform){this.#adapter?.close();this.#adapter=new CoursePageAdapter(this.document,platform);this.#session=session;}
    return this.#adapter!;
  }
}
