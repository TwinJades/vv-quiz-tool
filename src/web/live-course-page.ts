import type {CourseCatalog,LearningTask,QuizBoundary,VideoSnapshot,CourseVerification} from '../core/course';
import type {CoursePageRequest,CoursePageResult,CourseSpeedTarget} from './course-adapter';
import {ChaoxingVideoPage} from './chaoxing-video-page';
import {readChaoxingLearningPage} from './chaoxing-learning-page';
import {readChaoxingPractice,readChaoxingPracticeReview} from './chaoxing-practice';
import {readZhidaoDirectory} from './zhidao-directory';
import {readZhidaoNavigation} from './zhidao-navigation';
import {ZhidaoLearningPage} from './zhidao-learning-page';
import {KnowledgePracticePage} from './knowledge-practice-page';
import {captureVisualGeometry} from './visual-geometry';
import {isExplicitlyHidden,normalizedText} from './dom-utils';
import {chaoxingLessonTasks,chaoxingResourceTasks} from './chaoxing-course-tasks';
import {coursePopupIdentity} from './course-popup-identity';

export class LiveCoursePage {
  #initial:CourseCatalog|null=null;
  #video:ChaoxingVideoPage|null=null;
  #zhidao:ZhidaoLearningPage|null=null;
  #lesson:string|null=null;
  #inputAt=0;
  #activePopup:{task_id:string;root:HTMLElement;id:string}|null=null;
  #mediaBindings=new Map<string,string>();
  constructor(private readonly document:Document){}
  close():void {this.#zhidao?.close();}
  handles():boolean{return readChaoxingLearningPage(this.document)!==null||readZhidaoNavigation(this.document)!==null;}
  bind(catalog:CourseCatalog):void {
    const url=new URL(this.document.location.href),nav=readZhidaoNavigation(this.document),cx=readChaoxingLearningPage(this.document);
    if(cx?.course_id!==catalog.course_id&&nav?.course_id!==catalog.course_id)throw new Error('课程绑定与当前公开页面身份不一致。');
    const context=cx?.class_id??nav?.context_id;
    if(catalog.context_id&&context&&catalog.context_id!==context)throw new Error('课程班级身份不一致。');
    if(url.protocol!=='https:')throw new Error('课程页面必须使用HTTPS。');
    this.#initial=structuredClone(catalog);
  }
  catalog():CourseCatalog {
    const cx=readChaoxingLearningPage(this.document);
    if(cx){
      this.#video??=new ChaoxingVideoPage(this.document,cx.course_id,cx.class_id);
      const tasks=chaoxingLessonTasks(cx.course_id,cx.class_id,this.#video.lessons());
      if(!tasks.length)throw new Error('学习通课时目录没有加载。');
      if(this.#initial?.course_id===cx.course_id&&this.#initial.context_id===cx.class_id)return structuredClone(this.#initial);
      const catalog:CourseCatalog={course_id:cx.course_id,context_id:cx.class_id,platform:'chaoxing',title:this.document.title,
        page_type:'chaoxing',revision:JSON.stringify(tasks.map(task=>[task.id,task.title,task.kind])),complete:false,tasks,rules:{visibility_required:cx.visibility_required,speed_allowed:null},diagnostics:['请通过加载课程入口确认完整目录。']};
      this.#initial=catalog;return structuredClone(catalog);
    }
    const directory=readZhidaoDirectory(this.document);
    if(directory){
      if(!directory.points.length||directory.diagnostics.length>2)throw new Error('知到已加载知识点身份不完整。');
      if(this.#initial?.course_id===directory.course_id&&this.#initial.context_id===directory.context_id)return structuredClone(this.#initial);
      const tasks=directory.points.map((point):LearningTask=>({id:`zd:${directory.course_id}:${directory.context_id}:${point.id}`,lesson_id:point.id,chapter_id:point.module_id,title:point.title,
        kind:'lesson',status:'not_started',order:point.order,prerequisites:[]}));
      const catalog:CourseCatalog={course_id:directory.course_id,context_id:directory.context_id,platform:'zhidao',title:this.document.title,
        page_type:'zhidao_ai',revision:JSON.stringify(tasks.map(task=>[task.id,task.title,task.chapter_id])),complete:false,tasks,rules:{visibility_required:null,speed_allowed:null},diagnostics:['请通过加载课程入口确认完整目录。']};
      this.#initial=catalog;return structuredClone(catalog);
    }
    const nav=readZhidaoNavigation(this.document);
    if(!this.#initial||nav?.course_id!==this.#initial.course_id||nav.context_id!==this.#initial.context_id)throw new Error('请在知到目录读取并选择课程范围。');
    return structuredClone(this.#initial);
  }
  private current(task:LearningTask):void {
    const catalog=this.catalog();
    if(!catalog.tasks.some(parent=>parent.lesson_id===task.lesson_id)||task.id.split(':')[1]!==catalog.course_id)throw new Error('任务不属于本次公开课程目录。');
  }
  private async waitForLesson(task:LearningTask,signal:AbortSignal):Promise<void>{
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      signal.throwIfAborted();
      const cx=readChaoxingLearningPage(this.document),nav=readZhidaoNavigation(this.document);
      if(cx?.lesson_id===task.lesson_id&&cx.lesson_title&&cx.resources_ready)return;
      if(nav?.stage==='learner'&&nav.point_id===task.lesson_id&&nav.ready){
        const sections=Array.from(this.document.querySelectorAll<HTMLElement>('.resources-section')).filter(section=>!isExplicitlyHidden(section)&&normalizedText(section.querySelector(':scope >.resources-detail-title')?.textContent)==='必学资源');
        if(sections.length===1&&Array.from(sections[0]!.querySelectorAll('.resources-list >.basic-info-video-card-container')).some(card=>!isExplicitlyHidden(card)))return;
      }
      await new Promise<void>(resolve=>setTimeout(resolve,200));
    }
    throw new Error('正常课时导航后资源尚未就绪。');
  }
  async children(task:LearningTask,signal:AbortSignal):Promise<LearningTask[]>{
    await this.waitForLesson(task,signal);this.current(task);
    const cx=readChaoxingLearningPage(this.document);
    if(cx){
      return chaoxingResourceTasks(task,cx);
    }
    if(this.#lesson!==task.lesson_id){this.#zhidao?.close();this.#zhidao=new ZhidaoLearningPage(this.document);this.#lesson=task.lesson_id;}
    const section=Array.from(this.document.querySelectorAll<HTMLElement>('.resources-section')).find(section=>!isExplicitlyHidden(section)&&normalizedText(section.querySelector(':scope >.resources-detail-title')?.textContent)==='必学资源')!;
    const cards=Array.from(section.querySelectorAll<HTMLElement>('.resources-list >.basic-info-video-card-container')).filter(card=>!isExplicitlyHidden(card));
    const requiredVideos=cards.filter(card=>card.querySelector(':scope >.video-wrap >.icon-box.video'));
    if(requiredVideos.length&&!this.document.querySelector('video.vjs-tech')){
      requiredVideos[0]!.click();const deadline=Date.now()+15000;
      while(!this.document.querySelector('video.vjs-tech')&&Date.now()<deadline){signal.throwIfAborted();await new Promise<void>(resolve=>setTimeout(resolve,100));}
      if(!this.document.querySelector('video.vjs-tech'))throw new Error('必学视频正常入口后播放器尚未加载。');
    }
    const videos=requiredVideos.length?this.#zhidao!.catalog().tasks.filter(resource=>resource.kind==='video').map(resource=>({...resource,chapter_id:task.chapter_id})):[];
    const excluded=cards.filter(card=>!requiredVideos.includes(card)).map((card):LearningTask=>{
      const title=normalizedText(card.querySelector(':scope >.video-info')?.textContent);
      if(!title)throw new Error('范围外资源标题尚未确认。');
      return {...task,id:`${task.id}:excluded:${cards.indexOf(card)}`,kind:'excluded',title,order:cards.indexOf(card),status:'not_started',prerequisites:[]};
    });
    const nav=readZhidaoNavigation(this.document)!;
    const noPractice=/免考知识点[，,\s]*无练习题/.test(normalizedText(this.document.body?.innerText))&&!nav.improve_available;
    return [...videos,...excluded,...(noPractice?[]:[{...task,id:`${task.id}:practice`,kind:'lesson_quiz' as const,title:`${task.title} · 关联首次练习`,order:cards.length,status:'not_started' as const,prerequisites:videos.map(video=>video.id)}])];
  }
  quizRoot(task:LearningTask):HTMLElement {
    this.current(task);const cx=readChaoxingLearningPage(this.document);
    if(task.kind==='video'){
      const popup=this.popup(task);if(!popup)throw new Error('视频弹题已经解除。');return popup.root;
    }
    if(!cx||cx.lesson_id!==task.lesson_id)throw new Error('关联测验课时身份改变。');
    const cards=this.document.querySelector<HTMLIFrameElement>('iframe#iframe')?.contentDocument;
    const modules=Array.from(cards?.querySelectorAll<HTMLIFrameElement>('iframe')??[]).filter(frame=>!isExplicitlyHidden(frame)&&new URL(frame.src,cards!.location.href).pathname==='/ananas/modules/work/index.html');
    const index=Number(task.id.split(':').at(-1)),work=modules[index]?.contentDocument?.querySelector<HTMLIFrameElement>('iframe#frame_content')?.contentDocument;
    const reading=work&&(readChaoxingPractice(work)||readChaoxingPracticeReview(work));
    if(!reading||reading.course_id!==cx.course_id||reading.lesson_id!==task.lesson_id||!work?.body)throw new Error('关联测验公开身份未确认。');
    return work.body;
  }
  private popup(task:LearningTask):{root:HTMLElement;boundary:QuizBoundary}|null {
    let scope:HTMLElement|null=this.document.querySelector('.videoNameBox');
    const cx=readChaoxingLearningPage(this.document);
    if(cx){
      const cards=this.document.querySelector<HTMLIFrameElement>('iframe#iframe')?.contentDocument;
      const frames=Array.from(cards?.querySelectorAll<HTMLIFrameElement>('iframe')??[]).filter(frame=>new URL(frame.src,cards!.location.href).pathname==='/ananas/modules/video/index.html');
      scope=frames[Number(task.id.split(':').at(-1))]?.contentDocument?.body??null;
    }
    const roots=[...new Set(Array.from(scope?.querySelectorAll<HTMLElement>('.radio-view,[role=dialog],.vjs-modal-dialog')??[]).map(root=>root.matches('.radio-view')?root.closest<HTMLElement>('[role=dialog],.vjs-modal-dialog')??root.parentElement:root))]
      .filter((root):root is HTMLElement=>Boolean(root)&&!isExplicitlyHidden(root!)&&Boolean(root!.querySelector('input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],.radio-view >li')));
    const leaf=roots.filter(root=>!roots.some(other=>other!==root&&root.contains(other)));
    if(!leaf.length){if(this.#activePopup?.task_id===task.id)this.#activePopup=null;return null;}if(leaf.length!==1)throw new Error('视频弹题边界不唯一。');
    const root=leaf[0]!;
    if(this.#activePopup?.root!==root||this.#activePopup.task_id!==task.id)this.#activePopup={task_id:task.id,root,id:coursePopupIdentity(task.id,root)};
    const id=this.#activePopup.id;
    const text=normalizedText(root.innerText);
    const rewatch=/需要回看|必须回看|回看后重答/.test(text);
    const attempts=/剩余(?:作答)?\s*(\d+)\s*次/.exec(text);
    return {root,boundary:{id,task_id:task.id,course_id:this.catalog().course_id,kind:'video_popup',rules:{scored:null,retry_allowed:rewatch,remaining_attempts:attempts?Number(attempts[1]):rewatch?null:1,requires_pass:false,requires_rewatch:rewatch}}};
  }
  assertPopup(task:LearningTask,boundary:QuizBoundary):HTMLElement {const popup=this.popup(task);if(!popup||popup.boundary.id!==boundary.id||popup.boundary.task_id!==boundary.task_id)throw new Error('弹题身份已经改变。');return popup.root;}
  async execute(request:CoursePageRequest,signal:AbortSignal):Promise<CoursePageResult>{
    signal.throwIfAborted();
    if(request.operation==='bind'){this.bind(request.catalog);return true;}
    if(request.operation==='catalog'){if(request.known)this.bind(request.known);return this.catalog();}
    if(request.operation==='directory'){
      if(readChaoxingLearningPage(this.document))return true;
      const nav=readZhidaoNavigation(this.document);
      if(nav?.stage==='directory'){
        const deadline=Date.now()+30000;
        while(Date.now()<deadline){signal.throwIfAborted();const directory=readZhidaoDirectory(this.document);if(directory?.course_id===request.course_id&&directory.context_id===this.#initial?.context_id&&directory.points.length)return true;await new Promise<void>(resolve=>setTimeout(resolve,200));}
        throw new Error('知到目录的实际知识点清单尚未加载。');
      }
      if(!nav?.point_id||!this.#initial)throw new Error('知识点返回身份未确认。');
      const point=this.#initial.tasks.find(task=>task.lesson_id===nav.point_id)!;
      const page=new KnowledgePracticePage(this.document);
      const base={course_id:this.#initial.course_id,context_id:this.#initial.context_id!,point:{id:point.lesson_id,title:point.title,order:point.order}};
      page.execute({operation:'pause',...base},signal);page.execute({operation:'directory',...base},signal);
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){signal.throwIfAborted();const directory=readZhidaoDirectory(this.document);if(directory?.course_id===base.course_id&&directory.context_id===base.context_id&&directory.points.length)return true;await new Promise<void>(resolve=>setTimeout(resolve,200));}
      throw new Error('返回目录后知识点清单尚未加载。');
    }
    const {task}=request;this.current(task);
    const currentCx=readChaoxingLearningPage(this.document);
    if(task.kind==='video'&&currentCx?.lesson_id===task.lesson_id){
      const media=currentCx.videos[Number(task.id.split(':').at(-1))]?.media;if(!media)throw new Error('实际视频资源尚未加载。');
      const expected=this.#mediaBindings.get(task.id)??task.resource_fingerprint;
      if(media.source_fingerprint){if(expected&&expected!==media.source_fingerprint)throw new Error('实际视频资源身份与选定任务不一致。');this.#mediaBindings.set(task.id,media.source_fingerprint);}
    }
    if(request.operation==='rewatch'){
      const popup=this.popup(task);
      if(!popup?.boundary.rules.requires_rewatch)throw new Error('当前弹题没有明确回看要求。');
      const controls=Array.from(popup.root.querySelectorAll<HTMLElement>('button,[role=button],a,input[type=button]')).filter(element=>!isExplicitlyHidden(element)&&!element.hasAttribute('disabled')&&element.getAttribute('aria-disabled')!=='true'&&/^(?:回看|重新观看|返回观看|回看后重答)$/.test(normalizedText(element.innerText||element.getAttribute('value'))));
      if(controls.length!==1)throw new Error('网站正常回看控件不唯一。');
      const before=currentCx?currentCx.videos[Number(task.id.split(':').at(-1))]?.media?.position:this.document.querySelector<HTMLVideoElement>('.videoNameBox video')?.currentTime;
      if(before===undefined||!Number.isFinite(before)||before<=0)throw new Error('回看前实际播放位置未知。');
      controls[0]!.click();const deadline=Date.now()+10000;
      while(Date.now()<deadline){signal.throwIfAborted();const cx=readChaoxingLearningPage(this.document),position=cx?cx.videos[Number(task.id.split(':').at(-1))]?.media?.position:this.document.querySelector<HTMLVideoElement>('.videoNameBox video')?.currentTime;
        if(position!==undefined&&position<before&&!this.popup(task))return true;await new Promise<void>(resolve=>setTimeout(resolve,100));}
      return false;
    }
    if(task.kind==='video'&&request.operation==='quiz'){
      const popup=this.popup(task);if(!popup)throw new Error('当前视频没有弹题。');return popup.boundary;
    }
    if(request.operation==='enter'){
      const cx=readChaoxingLearningPage(this.document);
      if(cx){this.#video!.selectLesson(task.lesson_id,this.catalog().tasks.find(parent=>parent.lesson_id===task.lesson_id)!.title,signal);await this.waitForLesson(task,signal);
        if(task.kind==='video')this.#video!.selectVideo(Number(task.id.split(':').at(-1)),signal);return true;}
      const nav=readZhidaoNavigation(this.document)!;
      if(nav.stage==='directory')new KnowledgePracticePage(this.document).execute({operation:'enter',course_id:request.course_id,context_id:this.#initial!.context_id!,point:{id:task.lesson_id,title:task.title,order:task.order}},signal);
      await this.waitForLesson(task,signal);
      if(task.kind==='video'){
        if(this.#lesson!==task.lesson_id){this.#zhidao?.close();this.#zhidao=new ZhidaoLearningPage(this.document);this.#lesson=task.lesson_id;}
        await this.#zhidao!.execute({...request,task:{...task,chapter_id:task.lesson_id}},signal);
      }
      return true;
    }
    if(request.operation==='children')return this.children(task,signal);
    const cx=readChaoxingLearningPage(this.document);
    if(!cx){
      if(task.kind==='lesson_quiz'&&request.operation==='quiz')return {id:task.id,task_id:task.id,course_id:request.course_id,kind:'lesson_quiz',rules:{scored:true,retry_allowed:false,remaining_attempts:1,requires_pass:false,requires_rewatch:false}} satisfies QuizBoundary;
      if(!this.#zhidao){this.#zhidao=new ZhidaoLearningPage(this.document);this.#lesson=task.lesson_id;}
      const result=await this.#zhidao.execute({...request,task:{...task,chapter_id:task.lesson_id}},signal);
      if(request.operation==='video')return {...result as VideoSnapshot,popup:this.popup(task)?.boundary??null};
      return result;
    }
    if(task.kind==='chapter_quiz'){
      const root=this.quizRoot(task),review=readChaoxingPracticeReview(root.ownerDocument),quiz=cx.quizzes[Number(task.id.split(':').at(-1))]!;
      if(request.operation==='quiz')return {id:task.id,course_id:cx.course_id,task_id:task.id,kind:'chapter_quiz',rules:{scored:true,retry_allowed:false,remaining_attempts:review?0:1,requires_pass:false,requires_rewatch:false}} satisfies QuizBoundary;
      if(request.operation==='verify')return {task_id:task.id,media_ended:false,progress_recorded:quiz.task_recorded===true,submission_confirmed:Boolean(review),completed:Boolean(review)&&quiz.task_recorded===true,passed:null,pending_grading:false,visible_score:review?`${review.score}/${review.maximum}`:null} satisfies CourseVerification;
      throw new Error('章节测验不支持播放器操作。');
    }
    this.#video??=new ChaoxingVideoPage(this.document,cx.course_id,cx.class_id);this.#video.selectVideo(Number(task.id.split(':').at(-1)),signal);
    if(request.operation==='speed_target'){
      const point=this.#video.hoverPoint(signal),geometry=captureVisualGeometry(this.document,null);
      geometry.region={x:0,y:0,width:geometry.viewport.width,height:geometry.viewport.height};
      return {point:{x:point.x,y:point.y},captured_at:point.captured_at,geometry} satisfies CourseSpeedTarget;
    }
    if(request.operation==='mute'){this.#video.mute(signal,request.tab_muted===true);return true;}
    if(request.operation==='speed')return true;
    if(request.operation==='play'){await this.#video.play(signal,request.hover_at??this.#inputAt,request.tab_muted===true);return true;}
    if(request.operation==='pause'){this.#video.selectVideo(Number(task.id.split(':').at(-1)),signal);return this.#video.pause(signal);}
    const snapshot=this.#video.snapshot(),media=snapshot.media;if(!media)throw new Error('视频媒体尚未就绪。');
    if(request.operation==='video'){
      this.#inputAt=request.hover_at??0;
      const popup=this.popup(task);
      if(snapshot.blocked&&!popup)throw new Error('播放器存在无法识别的对话框。');
      return {course_id:cx.course_id,task_id:task.id,video_id:task.id,...(media.source_fingerprint?{resource_fingerprint:media.source_fingerprint}:{}),observed_at:snapshot.observed_at,duration:media.duration,position:media.position,rate:media.rate,
        paused:media.paused,buffering:media.ready_state<3,seeking:media.seeking,ended:media.ended,visible:!snapshot.hidden,background_input_confirmed:Date.now()-this.#inputAt<5000,popup:popup?.boundary??null} satisfies VideoSnapshot;
    }
    if(request.operation==='verify')return {task_id:task.id,media_ended:media.ended,progress_recorded:snapshot.task_recorded===true,submission_confirmed:false,completed:snapshot.task_recorded===true,passed:null,pending_grading:false,visible_score:null} satisfies CourseVerification;
    throw new Error('当前实际资源没有对应的操作。');
  }
}
