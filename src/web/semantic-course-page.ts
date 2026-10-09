import type {CourseCatalog,CoursePlatform,LearningTask,QuizBoundary,CourseVerification,VideoSnapshot} from '../core/course';
import type {CoursePageRequest,CoursePageResult} from './course-adapter';
import type {CourseSurfaceSnapshot,CourseSurfaceReading,CourseFrameContext,CourseEmbeddedFrame} from './course-surface';
import {courseSurfaceSchema,courseSnapshotHasIdentity,courseResourceTasks} from './course-surface';
import {SemanticDomMapping} from './semantic-dom-mapping';
import {isExplicitlyHidden,normalizedText,requireClickable,fnv1a} from './dom-utils';
import {cleanedVisibleText} from './separation-trial';
import {readChaoxingLearningPage} from './chaoxing-learning-page';
import {readZhidaoNavigation} from './zhidao-navigation';
import {LiveCoursePage} from './live-course-page';
import {courseQuizGeometry} from './course-quiz-geometry';
import {coursePopupIdentity} from './course-popup-identity';
import {publicMediaIdentity} from './public-course-url';

export class SemanticCoursePage {
  readonly #mapping:SemanticDomMapping;
  readonly #native:LiveCoursePage;
  #snapshot:CourseSurfaceSnapshot|null=null;
  #reading:CourseSurfaceReading|null=null;
  #catalog:CourseCatalog|null=null;
  #rows=new Map<string,{root:HTMLElement;enter:HTMLElement;title:string}>();
  #active:LearningTask|null=null;
  #popup:{root:HTMLElement;id:string}|null=null;
  #attributes=new Map<string,Record<string,string>>();
  constructor(private document:Document,private platform:CoursePlatform){this.#mapping=new SemanticDomMapping(document);this.#native=new LiveCoursePage(document);}
  close():void{this.#mapping.clear();this.#native.close();}
  ready():boolean{return this.#reading!==null;}
  pauseCurrent(courseId:string,contextId:string|null,verifiedContext?:CourseFrameContext):boolean{
    const context=verifiedContext??this.#snapshot?.parent_course;
    if(context&&context.frame_url!==this.document.location.href)throw new Error('课程暂停框架身份已改变。');
    const snapshot:CourseSurfaceSnapshot={...(context?{parent_course:context}:{}),capture_id:crypto.randomUUID(),url:this.document.location.href,title:this.document.title,native:false,visible_text:'',elements:[...this.document.querySelectorAll<HTMLElement>('[courseid],[data-course-id],[clazzid]')].map((element,index)=>({element_id:String(index),parent_id:null,tag:element.tagName.toLowerCase(),text:'',classes:[],role:null,input_type:null,clickable:false,disabled:false,selected:false,attributes:Object.fromEntries([...element.attributes].filter(attribute=>['courseid','data-course-id','clazzid'].includes(attribute.name)).map(attribute=>[attribute.name,attribute.value]))}))};
    if(!courseSnapshotHasIdentity(snapshot,courseId,contextId))throw new Error('暂停视频时课程或班级身份已改变。');
    const documents=new Set<Document>();
    const pause=(document:Document):void=>{
      if(documents.has(document))return;documents.add(document);
      for(const media of document.querySelectorAll('video')){media.pause();if(!media.paused)throw new Error('浏览器视频暂停状态未确认。');}
      for(const frame of document.querySelectorAll('iframe'))if(frame.contentDocument)pause(frame.contentDocument);
    };
    pause(this.document);this.#reading=null;return true;
  }
  capture(context?:CourseFrameContext):CourseSurfaceSnapshot{
    if(context&&(context.frame_url!==this.document.location.href||!context.current_lesson_id||!context.current_resource_id))throw new Error('课程框架身份已改变。');
    this.#attributes.clear();
    const elements=this.#mapping.capture(this.document.body,true).map(element=>{
      const node=this.#mapping.element(element.element_id),attributes:Record<string,string>={};
      this.#attributes.set(element.element_id,Object.fromEntries([...node.attributes].filter(attribute=>/^(?:id|href|src|data-(?:id|course-id|video-id|chapter-id|lesson-id)|courseid|clazzid|chapterid|lessonid|resourceid|videoid|knowledgeid)$/.test(attribute.name)).map(attribute=>[attribute.name,attribute.value])));
      for(const name of ['id','href','src','aria-label','aria-expanded','aria-busy','data-id','data-course-id','data-video-id','data-chapter-id','data-lesson-id','courseid','clazzid','chapterid','lessonid','resourceid','videoid','knowledgeid']){
        const value=node.getAttribute(name);if(value===null)continue;
        if(name==='href'||name==='src'){
          const url=new URL(value,node.ownerDocument.location.href);if(url.protocol!=='https:')continue;
          for(const key of [...url.searchParams.keys()])if(/token|secret|password|auth|sign/i.test(key))url.searchParams.delete(key);
          attributes[name]=url.href;
        }else attributes[name]=value.slice(0,250);
      }
      return {...element,attributes};
    });
    const chaoxing=readChaoxingLearningPage(this.document);
    this.#snapshot={...(context?{parent_course:context}:{}),capture_id:crypto.randomUUID(),url:this.document.location.href,title:this.document.title,native:Boolean(chaoxing&&!chaoxing.cross_origin_resources)||readZhidaoNavigation(this.document)!==null,
      visible_text:cleanedVisibleText(this.document,this.document.body,20000),elements};
    return this.#snapshot;
  }
  apply(value:CourseSurfaceReading):void{
    const reading=courseSurfaceSchema.parse(value),snapshot=this.#snapshot;
    if(!snapshot||reading.capture_id!==snapshot.capture_id||snapshot.url!==this.document.location.href)throw new Error('PAGE_CHANGED: 课程识别资料已失效。');
    if(reading.stage==='unknown')throw new Error('当前页面没有可识别的课程目录或学习资源。');
    const parent=snapshot.parent_course;
    if(parent){if(reading.course_id!==parent.course_id||reading.context_id!==parent.context_id||reading.current_lesson_id!==parent.current_lesson_id||reading.current_resource_id!==parent.current_resource_id)throw new Error('课程框架资源归属已改变。');}
    else if(!courseSnapshotHasIdentity(snapshot,reading.course_id,reading.context_id))throw new Error('课程公开身份无法从当前页面核验。');
    if(this.#catalog&&(this.#catalog.course_id!==reading.course_id||this.#catalog.context_id!==(reading.context_id??undefined)))throw new Error('课程或班级身份已改变。');
    const ids=[reading.directory_root_id,reading.video_root_id,reading.quiz_root_id,reading.scroll_root_id,reading.previous_id,...reading.expand_ids,reading.more_id,...reading.record_ids,...reading.submission_ids,...reading.controls.map(control=>control.id)].filter((id):id is string=>id!==null);
    for(const id of ids)this.element(id);
    this.#rows.clear();
    for(const [kind,rows] of [['lesson',reading.lessons],['resource',reading.resources]] as const)for(const row of rows){
      const key=kind+':'+row.id;
      if(this.#rows.has(key))throw new Error('课程任务公开身份重复。');
      const root=this.element(row.root_id),enter=this.element(row.enter_id);
      if(!root.contains(enter)||!normalizedText(root.innerText).includes(row.title))throw new Error('课程任务标题或入口归属无法核验。');
      const observed=[root,enter,...root.querySelectorAll<HTMLElement>('[id],[href],[src],[data-id],[data-video-id],[data-chapter-id],[data-lesson-id],[chapterid],[lessonid],[resourceid],[videoid],[knowledgeid]')];
      const publicIdentity=observed.some(element=>[...element.attributes].some(attribute=>{
        if(attribute.name==='href'||attribute.name==='src'){const url=new URL(attribute.value,element.ownerDocument.location.href);return [...url.searchParams.values()].includes(row.id)||url.pathname.split('/').includes(row.id);}
        if(attribute.name==='id')return attribute.value===row.id||attribute.value===`cur${row.id}`||attribute.value===`knowledgeId-${row.id}`;
        return /^(?:data-id|data-video-id|data-chapter-id|data-lesson-id|chapterid|lessonid|resourceid|videoid|knowledgeid)$/.test(attribute.name)&&attribute.value===row.id;
      }));
      if(!publicIdentity)throw new Error('课程任务身份没有所属行的公开依据。');
      for(const [existingKey,existing] of this.#rows)if(existingKey.startsWith(kind+':')&&(existing.root.contains(root)||root.contains(existing.root)))throw new Error('课程任务行发生重复或范围重叠。');
      if(row.status==='completed'){
        const status=row.status_id?this.element(row.status_id):null;
        const value=status?normalizedText(status.innerText+' '+(status.getAttribute('aria-label')??'')):'';
        const explicit=/已完成|已学完|已提交|已通过|completed|finished|submitted/i.test(value);
        const resourceProgress=kind==='resource'&&/^100\s*%$/.test(value)&&!/掌握|正确率|mastery|accuracy/i.test(normalizedText(status?.parentElement?.innerText));
        if(!status||!root.contains(status)||!(explicit||resourceProgress))throw new Error('课程完成状态缺少所属任务的公开记录。');
      }
      this.#rows.set(key,{root,enter,title:row.title});
    }
    this.#reading=reading;
  }
  bind(catalog:CourseCatalog):void{
    if(this.#reading&&(this.#reading.course_id!==catalog.course_id||this.#reading.context_id!==(catalog.context_id??null)))throw new Error('课程绑定身份不一致。');
    this.#catalog=structuredClone(catalog);
  }
  catalog():CourseCatalog{
    const reading=this.reading();
    if(!reading.lessons.length){if(this.#catalog)return structuredClone(this.#catalog);throw new Error('请打开课程目录后加载课程。');}
    const complete=!reading.busy&&!reading.expand_ids.length&&!reading.more_id&&(reading.total===null||reading.total===reading.lessons.length);
    const prefix=this.platform==='chaoxing'?'cx':'zd';
    const taskId=(id:string)=>`${prefix}:${reading.course_id}:${reading.context_id??'course'}:${id}`;
    const tasks=reading.lessons.map((row,order):LearningTask=>({id:taskId(row.id),lesson_id:row.id,chapter_id:row.chapter_id,title:row.title,kind:'lesson',status:row.status,order,prerequisites:row.prerequisites.map(taskId)}));
    const catalog:CourseCatalog={course_id:reading.course_id,...(reading.context_id?{context_id:reading.context_id}:{}),platform:this.platform,page_type:this.platform==='chaoxing'?'chaoxing':this.document.location.hostname.startsWith('ai-smart-course')?'zhidao_ai':'zhidao_shared',title:reading.title,
      revision:JSON.stringify(tasks.map(task=>[task.id,task.chapter_id,task.title])),complete,tasks,rules:{speed_allowed:reading.speed_allowed,visibility_required:reading.visibility_required},
      coverage:{loaded:tasks.length,total:reading.total,exhausted:complete},diagnostics:complete?[]:['课程目录仍在加载，请继续加载目录。']};
    if(this.#catalog){
      const merged=structuredClone(this.#catalog);
      for(const task of tasks){const known=merged.tasks.find(candidate=>candidate.id===task.id);if(!known||known.chapter_id!==task.chapter_id||known.title!==task.title||known.prerequisites.join('|')!==task.prerequisites.join('|'))throw new Error('课程目录身份或前置条件已改变。');known.status=task.status;}
      return merged;
    }
    return catalog;
  }
  private element(id:string):HTMLElement{
    if(!this.#snapshot||this.#snapshot.url!==this.document.location.href)throw new Error('PAGE_CHANGED: 课程页面版本已改变。');
    const element=this.#mapping.element(id),attributes=this.#attributes.get(id);
    if(!attributes||Object.entries(attributes).some(([key,value])=>element.getAttribute(key)!==value))throw new Error('PAGE_CHANGED: 课程控件身份已改变。');
    return element;
  }
  reading():CourseSurfaceReading{if(!this.#reading)throw new Error('课程页面需要重新识别。');return this.#reading;}
  embeddedFrames():CourseEmbeddedFrame[]{
    const reading=this.reading(),result:CourseEmbeddedFrame[]=[];
    if(!reading.current_lesson_id||!reading.current_resource_id)return result;
    for(const [kind,id] of [['video',reading.video_root_id],['quiz',reading.quiz_root_id]] as const){
      if(!id)continue;const root=this.element(id);
      const frames=[...(root.tagName==='IFRAME'?[root as HTMLIFrameElement]:[]),...root.querySelectorAll<HTMLIFrameElement>('iframe')];
      for(const frame of frames){
        if(isExplicitlyHidden(frame)||frame.contentDocument||!frame.src)continue;
        const url=new URL(frame.src,frame.ownerDocument.location.href);if(url.protocol!=='https:')throw new Error('课程资源框架没有HTTPS地址。');
        result.push({kind,url:url.href,context:{course_id:reading.course_id,context_id:reading.context_id,title:reading.title,current_lesson_id:reading.current_lesson_id,current_resource_id:reading.current_resource_id,source_url:this.document.location.href,frame_url:url.href,kind}});
      }
    }
    return result;
  }
  private click(element:HTMLElement,signal:AbortSignal):void{
    signal.throwIfAborted();if(element.hasAttribute('disabled')||element.getAttribute('aria-disabled')==='true')throw new Error('课程控件不可用。');
    requireClickable(element);
    if(element.matches('a[href]')){
      const url=new URL(element.getAttribute('href')!,this.document.location.href);
      if(url.protocol!=='https:'||this.platform==='chaoxing'&&!url.hostname.endsWith('.chaoxing.com')||this.platform==='zhidao'&&!url.hostname.endsWith('.zhihuishu.com'))throw new Error('课程导航目标未授权。');
      if(element.getAttribute('target')==='_blank'){
        const target=element.getAttribute('target');element.setAttribute('target','_self');
        element.click();if(target!==null)element.setAttribute('target',target);signal.throwIfAborted();return;
      }
    }
    element.click();signal.throwIfAborted();
  }
  loadNext(signal:AbortSignal,direction:'next'|'previous'='next'):boolean{
    const reading=this.reading();
    const id=direction==='previous'?reading.previous_id:reading.expand_ids[0]??reading.more_id;
    if(id){this.click(this.element(id),signal);return true;}
    if(direction==='previous'||!reading.scroll_root_id)return false;
    const root=this.element(reading.scroll_root_id),view=root.ownerDocument.defaultView!;
    if(root===root.ownerDocument.body||root===root.ownerDocument.documentElement){
      const scrolling=root.ownerDocument.scrollingElement;if(!scrolling)throw new Error('课程目录滚动元素不可用。');
      if(scrolling.scrollTop+view.innerHeight>=scrolling.scrollHeight-2)return false;
      view.scrollBy({top:Math.max(100,view.innerHeight*.8),behavior:'instant'});return true;
    }
    if(root.scrollTop+root.clientHeight>=root.scrollHeight-2)return false;
    root.scrollBy({top:Math.max(100,root.clientHeight*.8),behavior:'instant'});return true;
  }
  private control(role:CourseSurfaceReading['controls'][number]['role']):HTMLElement{
    const controls=this.reading().controls.filter(control=>control.role===role);
    if(controls.length!==1)throw new Error('课程正常控件不可用或不唯一：'+role);
    return this.element(controls[0]!.id);
  }
  private media():HTMLVideoElement{
    const root=this.reading().video_root_id;if(!root)throw new Error('课程视频播放器尚未加载。');
    const scope=this.element(root),videos=[...(scope.matches('video')?[scope as HTMLVideoElement]:[]),...scope.querySelectorAll<HTMLVideoElement>('video')].filter(video=>!isExplicitlyHidden(video));
    if(videos.length!==1)throw new Error('课程活动视频无法唯一确认。');return videos[0]!;
  }
  private async confirmPlayback(paused:boolean,signal:AbortSignal):Promise<boolean>{
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){signal.throwIfAborted();if(this.media().paused===paused)return true;await new Promise<void>(resolve=>setTimeout(resolve,100));}
    throw new Error('课程播放器操作后的状态未确认。');
  }
  private popup(task:LearningTask):QuizBoundary|null{
    const rootId=this.reading().quiz_root_id;if(!rootId){this.#popup=null;return null;}
    const root=this.element(rootId);
    if(!root.querySelector('input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],.radio-view'))return null;
    if(this.#popup?.root!==root)this.#popup={root,id:coursePopupIdentity(task.id,root)};
    return {id:this.#popup.id,course_id:this.#catalog!.course_id,task_id:task.id,kind:'video_popup',rules:this.reading().quiz_rules};
  }
  quizRoot(task:LearningTask,boundary:QuizBoundary):HTMLElement{
    if(this.#snapshot?.native&&readChaoxingLearningPage(this.document)){this.#native.bind(this.#catalog!);return boundary.kind==='video_popup'?this.#native.assertPopup(task,boundary):this.#native.quizRoot(task);}
    const id=this.reading().quiz_root_id;if(!id)throw new Error('课程测验页面尚未加载。');
    if(boundary.course_id!==this.#catalog?.course_id||boundary.task_id!==task.id)throw new Error('测验不属于当前课程任务。');
    return this.element(id);
  }
  async execute(request:CoursePageRequest,signal:AbortSignal):Promise<CoursePageResult>{
    signal.throwIfAborted();
    if(request.operation==='bind'){this.bind(request.catalog);return true;}
    if(request.operation==='catalog'){if(request.known)this.bind(request.known);return this.catalog();}
    if(request.operation==='directory'){
      if(this.reading().lessons.length)return true;
      this.click(this.control(this.reading().controls.some(control=>control.role==='directory')?'directory':'back'),signal);return true;
    }
    const {task}=request,catalog=this.#catalog;if(!catalog||catalog.course_id!==request.course_id||!catalog.tasks.some(parent=>parent.lesson_id===task.lesson_id))throw new Error('任务不属于已选择的课程目录。');
    if(request.operation==='record'){
      if(this.reading().current_lesson_id!==task.lesson_id)throw new Error('测验记录不属于当前课时。');
      this.click(this.control('record'),signal);return true;
    }
    if(request.operation==='enter'&&(task.kind==='lesson_quiz'||task.kind==='chapter_quiz')&&['quiz','result'].includes(this.reading().stage)&&this.reading().current_lesson_id===task.lesson_id){
      if(catalog.page_type==='zhidao_shared'&&this.reading().current_resource_id!==(task.resource_id??task.id.split(':').at(-1)))throw new Error('测验活动资源身份已改变。');
      this.#active=task;return true;
    }
    if(request.operation==='retry'){
      if(this.reading().quiz_rules.retry_allowed!==true||this.reading().quiz_rules.remaining_attempts===0)throw new Error('当前测验没有允许的重答机会。');
      this.click(this.control('retry'),signal);return true;
    }
    if(request.operation==='verify'&&catalog.page_type==='zhidao_ai'&&task.kind==='lesson_quiz'){
      const navigation=readZhidaoNavigation(this.document),reading=this.reading();
      if(navigation?.course_id!==catalog.course_id||navigation.context_id!==catalog.context_id||navigation.point_id!==task.lesson_id)throw new Error('知识点测验记录归属无法核验。');
      const submitted=['result','review','mastery_history'].includes(navigation.stage)&&reading.submission_ids.length>0&&reading.submission_ids.every(id=>/已提交|提交成功|成绩|得分|作答记录|已答对|submitted|score|result/i.test(normalizedText(this.element(id).innerText)));
      return {task_id:task.id,media_ended:false,progress_recorded:submitted,submission_confirmed:submitted,completed:submitted,passed:reading.passed,pending_grading:false,visible_score:submitted?reading.submission_ids.map(id=>normalizedText(this.element(id).innerText)).join(' ').slice(0,200):null} satisfies CourseVerification;
    }
    if(this.#snapshot?.native&&(readChaoxingLearningPage(this.document)||readZhidaoNavigation(this.document)&&catalog.page_type==='zhidao_ai')){
      if(request.operation==='enter')this.#active=task;
      this.#native.bind(catalog);
      if(request.operation==='speed'){
        const video=await this.#native.execute({...request,operation:'video'},signal) as VideoSnapshot;
        if(video.rate===null||!Number.isFinite(video.rate)||video.rate<=0)throw new Error('实际播放速度无效。');
        if(this.reading().speed_allowed===false&&video.rate!==1)throw new Error('课程明确禁止倍速，请调整速度插件。');return true;
      }
      const result=await this.#native.execute(request,signal);
      if(request.operation==='video'){const video=result as VideoSnapshot;if(this.reading().speed_allowed===false&&video.rate!==1)throw new Error('课程明确禁止倍速，请调整速度插件。');if(video.popup)video.popup={...video.popup,rules:this.reading().quiz_rules};return video;}
      if(request.operation==='quiz')return {...result as QuizBoundary,rules:this.reading().quiz_rules};
      if(request.operation==='verify')return {...result as CourseVerification,passed:this.reading().passed};
      return result;
    }
    if(request.operation==='enter'){
      this.#active=task;
      if(this.reading().current_lesson_id===task.lesson_id&&task.kind==='lesson')return true;
      if(this.#snapshot?.parent_course&&this.reading().current_lesson_id===task.lesson_id&&this.reading().current_resource_id===this.#snapshot.parent_course.current_resource_id)return true;
      const id=task.kind==='lesson'?task.lesson_id:task.resource_id??task.id.split(':').at(-1)!,row=this.#rows.get((task.kind==='lesson'?'lesson:':'resource:')+id);
      if(!row)throw new Error('当前课程页面没有选定任务的入口。');
      this.click(row.enter,signal);return true;
    }
    if(request.operation==='children'){
      if(this.reading().current_lesson_id!==task.lesson_id)throw new Error('实际课时身份未确认。');
      if(!this.reading().resources_complete)throw new Error('当前课时资源发现尚未完成。');
      const resources=this.reading().resources;
      if(!resources.length)throw new Error('当前课时资源尚未加载。');
      return courseResourceTasks(task,resources);
    }
    if(request.operation==='quiz'){
      if(task.kind==='video'){const popup=this.popup(task);if(!popup)throw new Error('当前视频没有弹题。');return popup;}
      if(!this.reading().quiz_root_id)throw new Error('关联测验边界未确认。');
      return {id:task.id,task_id:task.id,course_id:catalog.course_id,kind:task.kind as QuizBoundary['kind'],rules:this.reading().quiz_rules};
    }
    if(request.operation==='verify'){
      if(this.#active?.id!==task.id)throw new Error('核验资源与当前活动任务身份不一致。');
      if(this.reading().current_resource_id!==(task.resource_id??task.id.split(':').at(-1)))throw new Error('实际活动资源身份未确认。');
      const record_ids=this.reading().record_ids,submission_ids=this.reading().submission_ids;
      const row=this.#rows.get('resource:'+this.reading().current_resource_id),quizId=this.reading().quiz_root_id;
      const scope=task.kind==='video'?row?.root:quizId?this.element(quizId):row?.root;
      const recorded=record_ids.length>0&&record_ids.every(id=>{const element=this.#mapping.element(id);return Boolean((row?.root.contains(element)||scope?.contains(element))&&/已完成|已学完|100\s*%|completed|finished/i.test(normalizedText(element.innerText+' '+element.getAttribute('aria-label'))));});
      const submitted=submission_ids.length>0&&submission_ids.every(id=>{const element=this.#mapping.element(id);return Boolean(scope?.contains(element)&&/已提交|提交成功|成绩|得分|已批阅|submitted|score|result/i.test(normalizedText(element.innerText)));});
      return {task_id:task.id,media_ended:task.kind==='video'&&this.media().ended,progress_recorded:recorded,submission_confirmed:submitted,completed:recorded&&(task.kind==='video'||submitted),passed:this.reading().passed,pending_grading:false,visible_score:submission_ids.map(id=>normalizedText(this.#mapping.element(id).innerText)).join(' ').slice(0,200)||null} satisfies CourseVerification;
    }
    const video=this.media();
    if(request.operation==='speed'){
      if(!Number.isFinite(video.playbackRate)||video.playbackRate<=0)throw new Error('实际播放速度无效。');
      if(this.reading().speed_allowed===false&&video.playbackRate!==1)throw new Error('课程明确禁止倍速，请调整速度插件。');return true;
    }
    if(request.operation==='mute'){if(!video.muted&&video.volume!==0&&!request.tab_muted)this.click(this.control('mute'),signal);return request.tab_muted===true||video.muted||video.volume===0;}
    if(request.operation==='play'){if(video.ended)throw new Error('当前视频已结束。');if(video.paused)this.click(this.control('play'),signal);return this.confirmPlayback(false,signal);}
    if(request.operation==='pause'){if(!video.paused)this.click(this.control(this.reading().controls.some(control=>control.role==='pause')?'pause':'play'),signal);return this.confirmPlayback(true,signal);}
    if(request.operation==='speed_target'){
      video.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      const geometry=courseQuizGeometry(this.document,video,null);
      return {point:{x:geometry.region.x+geometry.region.width/2,y:geometry.region.y+geometry.region.height/2},captured_at:Date.now(),geometry};
    }
    if(request.operation==='rewatch'){
      const before=video.currentTime;this.click(this.control('rewatch'),signal);const deadline=Date.now()+10000;
      while(Date.now()<deadline){signal.throwIfAborted();if(video.currentTime<before&&!this.popup(task))return true;await new Promise<void>(resolve=>setTimeout(resolve,100));}return false;
    }
    const url=video.currentSrc?new URL(video.currentSrc):null;
    if(this.reading().speed_allowed===false&&video.playbackRate!==1)throw new Error('课程明确禁止倍速，请调整速度插件。');
    const source=url?publicMediaIdentity(url.href):null;
    return {course_id:catalog.course_id,task_id:task.id,video_id:fnv1a(task.id+(source??url?.href??'')),...(source?{resource_fingerprint:source}:{}),observed_at:Date.now(),duration:Number.isFinite(video.duration)?video.duration:null,position:video.currentTime,rate:video.playbackRate,paused:video.paused,buffering:video.readyState<3,seeking:video.seeking,ended:video.ended,visible:!this.document.hidden,popup:this.popup(task),background_input_confirmed:Boolean(request.hover_at&&Date.now()-request.hover_at<5000)} satisfies VideoSnapshot;
  }
}
