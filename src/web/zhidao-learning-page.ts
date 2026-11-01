import type { CourseCatalog, CourseVerification, LearningTask, VideoSnapshot } from '../core/course';
import type { CoursePageRequest, CoursePageResult } from './course-adapter';
import { normalizedText } from './dom-utils';
import { readZhidaoDirectory } from './zhidao-directory';
import { isZhidaoPptLearner, readZhidaoNavigation, resolveZhidaoLearnerReturn } from './zhidao-navigation';
import { readZhidaoPlayer, isVisibleZhidaoPlayerElement as visible } from './zhidao-player';
import { ZhidaoPlayerControls } from './zhidao-player-controls';
import { captureVisualGeometry } from './visual-geometry';
import {publicResourceId,resourceTaskId,requireResourceId} from './course-resource-identity';
import {publicMediaIdentity} from './public-course-url';

/** A deliberately explicit current-knowledge-point scope. A directory card is
 * not a video, and a document or mastery percentage never completes a video. */
export class ZhidaoLearningPage {
  #catalog: CourseCatalog | null=null;
  #point: string | null=null;
  #context: string | null=null;
  #controls: ZhidaoPlayerControls | null=null;
  #lease: {card:HTMLElement;media:HTMLVideoElement;resourceId:string;source:string;course:string;point:string;context:string} | null=null;
  #cards=new Map<string,HTMLElement>();
  #identities=new WeakMap<HTMLElement,string>();
  #sources=new Map<string,string>();
  constructor(private readonly document:Document){}
  close():void {this.#controls?.close();this.#controls=null;this.#lease=null;}
  handles():boolean {
    const nav=readZhidaoNavigation(this.document);
    return nav?.stage==='learner' && nav.ready || Boolean(this.#catalog&&nav?.stage==='directory');
  }
  private requiredCards():HTMLElement[]{
    const sections=Array.from(this.document.querySelectorAll<HTMLElement>('.resources-section')).filter(section=>visible(section)&&normalizedText(section.querySelector(':scope >.resources-detail-title')?.textContent)==='必学资源');
    if(sections.length!==1)throw new Error('必学资源分区缺失或不唯一。');
    return Array.from(sections[0]!.querySelectorAll<HTMLElement>('.resources-list >.basic-info-video-card-container')).filter(visible);
  }
  private cardId(card:HTMLElement):string|null {
    const links=Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).map(link=>link.href);
    return publicResourceId(card,'video',links)??this.#identities.get(card)??null;
  }
  async discover(signal:AbortSignal):Promise<void>{
    const nav=readZhidaoNavigation(this.document);
    if(!nav?.ready||nav.stage!=='learner'||!nav.point_id)throw new Error('知识点资源页尚未加载。');
    const original=this.requiredCards().find(card=>card.classList.contains('active'));
    const originalIsVideo=Boolean(original?.querySelector(':scope >.video-wrap >.icon-box.video'));
    const originalIsPpt=Boolean(original&&!originalIsVideo&&isZhidaoPptLearner(this.document));
    const pause=()=>{for(const video of this.document.querySelectorAll<HTMLVideoElement>('.videoNameBox video.vjs-tech'))if(!video.paused)video.pause();};
    const check=()=>{signal.throwIfAborted();const current=readZhidaoNavigation(this.document);if(current?.course_id!==nav.course_id||current.context_id!==nav.context_id||current.point_id!==nav.point_id)throw new Error('资源发现期间课程身份已经改变。');};
    const capture=async(card:HTMLElement)=>{
      check();if(!card.isConnected||!visible(card))throw new Error('资源入口已改变，请重新加载课程。');
      pause();const oldMedia=this.document.querySelector<HTMLVideoElement>('.videoNameBox video');const oldSource=oldMedia?.currentSrc||oldMedia?.src;
      const wasActive=card.classList.contains('active');if(!wasActive){this.close();card.click();}
      await this.ready(()=>{check();pause();const media=this.document.querySelector<HTMLVideoElement>('.videoNameBox video');const source=media?.currentSrc||media?.src;
        return card.classList.contains('active')&&Boolean(media&&media.readyState>=1&&source&&(wasActive||media!==oldMedia||source!==oldSource));},signal);
      const media=this.document.querySelector<HTMLVideoElement>('.videoNameBox video')!;
      const source=publicMediaIdentity(new URL(media.currentSrc||media.src,this.document.location.href).href);
      if(!source)throw new Error('必学视频缺少稳定媒体身份。');
      const links=Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).map(link=>link.href);
      const id=publicResourceId(card,'video',links)??`media:${source}`;
      const expected=this.#sources.get(id);
      if(expected&&expected!==source)throw new Error('资源发现期间视频媒体身份已经改变。');
      this.#identities.set(card,id);this.#sources.set(id,source);pause();
    };
    signal.addEventListener('abort',pause,{once:true});
    try{
      for(const card of this.requiredCards().filter(card=>card.querySelector(':scope >.video-wrap >.icon-box.video'))){check();if(!this.cardId(card))await capture(card);}
      if(original?.isConnected&&!original.classList.contains('active')){
        if(originalIsVideo)await capture(original);
        else if(originalIsPpt){
          // PPT 只核对真实导航预览，不等待视频，也不生成媒体身份。
          check();pause();this.close();original.click();
          await this.ready(()=>{check();pause();return original.classList.contains('active')&&readZhidaoNavigation(this.document)?.ready===true&&isZhidaoPptLearner(this.document);},signal);
        }else throw new Error('原活动资源类型尚未核对，无法恢复。');
      }
      check();this.catalog();
    }finally{pause();signal.removeEventListener('abort',pause);}
  }
  catalog():CourseCatalog {
    const nav=readZhidaoNavigation(this.document);
    if(!nav?.ready)throw new Error('知到页面尚未就绪。');
    if(nav.stage==='directory'){
      const directory=readZhidaoDirectory(this.document);
      if(!this.#catalog||directory?.course_id!==this.#catalog.course_id||directory.context_id!==this.#context||
        !directory.points.some(p=>p.id===this.#point))throw new Error('当前知识点的目录归属已改变。');
      return structuredClone(this.#catalog);
    }
    if(nav.stage!=='learner'||!nav.point_id||!nav.context_id)throw new Error('请先打开要学习的知识点视频。');
    if(this.#catalog&&(nav.course_id!==this.#catalog.course_id||nav.point_id!==this.#point||nav.context_id!==this.#context))
      throw new Error('当前知识点已改变，请重新预览并选择范围。');
    const titles=Array.from(this.document.querySelectorAll<HTMLElement>('.videoNameBox.able-player-container')).filter(visible);
    if(isZhidaoPptLearner(this.document)?titles.length!==0:titles.length!==1)throw new Error('知到资源预览范围不唯一。');
    const sections=Array.from(this.document.querySelectorAll<HTMLElement>('.resources-section')).filter(visible);
    const required=sections.filter(s=>normalizedText(s.querySelector(':scope >.resources-detail-title')?.textContent)==='必学资源');
    if(required.length!==1)throw new Error('必学资源分区缺失或不唯一。');
    const cards=Array.from(required[0]!.querySelectorAll<HTMLElement>('.resources-list >.basic-info-video-card-container')).filter(visible);
    if(!cards.length)throw new Error('必学资源清单尚未加载。');
    const tasks:LearningTask[]=[];const bindings=new Map<string,HTMLElement>();
    for(const [index,card] of cards.entries()){
      const info=card.querySelector<HTMLElement>(':scope >.video-info');
      if(!info)throw new Error('资源标题缺失。');
      const heading=info.querySelector<HTMLElement>(':scope >div:not(.finished-icon)');
      const label=normalizedText(heading?.innerText||info.innerText);
      const isVideo=card.querySelectorAll(':scope >.video-wrap >.icon-box.video').length===1;
      const time=/^(.*?)\s+(\d{2}):(\d{2}):(\d{2})$/.exec(label);
      const title=time?time[1]!:label;if(!title)throw new Error('资源标题缺失。');
      const resourceId=isVideo?this.cardId(card):null;
      if(isVideo&&!resourceId)throw new Error(`视频缺少公开资源身份：${title}，请加载课程完成资源发现。`);
      const id=isVideo?resourceTaskId(`zhidao:${nav.course_id}:${nav.context_id}:${nav.point_id}`,'video',resourceId!):`zhidao:${nav.course_id}:${nav.context_id}:${nav.point_id}:excluded:${index}`;
      if(tasks.some(t=>t.id===id))throw new Error(`同一知识点资源编号重复：${resourceId}`);
      const raw=normalizedText(info.querySelector(':scope >.finished-icon')?.textContent);
      // The real resource card replaces its percentage with this explicit
      // completion label. Keep this distinct from knowledge mastery or grades.
      const match=/^(\d+(?:\.\d+)?)%$/.exec(raw);const percent=raw==='已完成'?100:match?Number(match[1]):null;
      if(isVideo&&(percent===null||percent<0||percent>100))throw new Error('视频的公开学习进度尚未确认。');
      tasks.push({id,...(resourceId?{resource_id:resourceId}:{}),lesson_id:nav.point_id,chapter_id:nav.point_id,title:isVideo?title:`未纳入：${label}`,kind:isVideo?'video':'excluded',
        order:index,status:isVideo?(percent===100?'completed':percent!>0?'in_progress':'not_started'):'unknown',prerequisites:[]});
      bindings.set(id,card);
    }
    if(!tasks.some(t=>t.kind==='video'))throw new Error('本知识点没有已核对的必学视频。');
    if(this.#catalog&&JSON.stringify(this.#catalog.tasks.filter(t=>t.kind==='video').map(t=>t.id).sort())!==JSON.stringify(tasks.filter(t=>t.kind==='video').map(t=>t.id).sort()))
      throw new Error('本知识点资源清单已改变，请重新选择范围。');
    this.#cards=bindings;this.#point=nav.point_id;this.#context=nav.context_id;
    this.#catalog={course_id:nav.course_id,context_id:nav.context_id,platform:'zhidao',title:'当前知识点的必学视频',
      revision:JSON.stringify(tasks.map(t=>[t.id,t.status,t.kind])),complete:true,tasks,
      // Conservative execution policy: require actual visibility. This does not
      // claim the platform universally requires it or emulate visibility.
      rules:{visibility_required:true,speed_allowed:true},diagnostics:[]};
    return structuredClone(this.#catalog);
  }
  private assertTask(course:string,task:LearningTask):void {
    const catalog=this.catalog();const fresh=catalog.tasks.find(t=>t.id===task.id);
    if(catalog.course_id!==course||!fresh||fresh.kind!==task.kind||fresh.lesson_id!==task.lesson_id||fresh.chapter_id!==task.chapter_id||task.kind!=='video')
      throw new Error('当前视频不属于已选知识点范围。');
  }
  private player(course:string,task:LearningTask):ZhidaoPlayerControls {
    this.assertTask(course,task);
    const card=this.#cards.get(task.id);const reading=readZhidaoPlayer(this.document);const media=this.document.querySelector<HTMLVideoElement>('.videoNameBox >.video-js >video.vjs-tech');
    if(!card?.classList.contains('active')||!reading||!media)throw new Error('当前活动视频不属于所选任务。');
    const rawSource=media.currentSrc||media.src;if(!rawSource)throw new Error('活动视频媒体地址尚未加载。');
    const source=publicMediaIdentity(new URL(rawSource,this.document.location.href).href),resourceId=requireResourceId(task),expected=this.#sources.get(resourceId);
    if(!source||this.cardId(card)!==resourceId||resourceId.startsWith('media:')&&resourceId!==`media:${source}`||expected&&expected!==source)
      throw new Error('活动播放器媒体与资源身份不一致。');
    this.#sources.set(resourceId,source);
    // 播放器可能复用同一媒体 DOM；卡片或资源身份改变时必须重建租约。
    const lease=this.#lease;
    if(!this.#controls||!lease||lease.media!==media||lease.card!==card||lease.resourceId!==resourceId||lease.source!==source||
      lease.course!==reading.course_id||lease.point!==reading.point_id||lease.context!==reading.context_id){
      this.close();
      this.#controls=new ZhidaoPlayerControls(this.document,reading,card,resourceId,source);
      this.#lease={card,media,resourceId,source,course:reading.course_id,point:reading.point_id,context:reading.context_id};
    }
    return this.#controls;
  }
  private async ready(predicate:()=>boolean,signal:AbortSignal):Promise<void>{
    const until=Date.now()+15000;
    while(Date.now()<until){signal.throwIfAborted();if(predicate())return;await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},100);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });}
    throw new Error('正常导航后页面尚未就绪。');
  }
  async execute(request:CoursePageRequest,signal:AbortSignal):Promise<CoursePageResult>{
    signal.throwIfAborted();if(request.operation==='catalog')return this.catalog();
    if(request.operation==='bind')return true;
    if(request.operation==='children'){await this.discover(signal);return this.catalog().tasks;}
    if(request.operation==='directory'){
      const nav=readZhidaoNavigation(this.document);
      if(nav?.stage==='directory'){if(nav.course_id!==request.course_id)throw new Error('课程改变。');return true;}
      if(!nav||nav.course_id!==request.course_id)throw new Error('课程改变。');
      const media=this.document.querySelector<HTMLVideoElement>('.videoNameBox video');
      if(media&&!media.paused&&!media.ended)throw new Error('离开学习页前视频尚未暂停。');
      resolveZhidaoLearnerReturn(this.document,nav).click();this.close();
      await this.ready(()=>readZhidaoDirectory(this.document)?.course_id===request.course_id,signal);return true;
    }
    const {course_id,task}=request;
    if(request.operation==='enter'&&readZhidaoNavigation(this.document)?.stage==='learner')await this.discover(signal);
    this.assertTask(course_id,task);
    if(request.operation==='enter'){
      if(readZhidaoNavigation(this.document)?.stage==='directory'){
        const cards=Array.from(this.document.querySelectorAll<HTMLElement>('.knowledge-content .item-content[knowledgeid]')).filter(e=>e.getAttribute('knowledgeid')===this.#point&&visible(e));
        if(cards.length!==1)throw new Error('所选知识点入口不唯一。');cards[0]!.click();
        await this.ready(()=>readZhidaoPlayer(this.document)!==null&&this.document.querySelector('.resources-section .basic-info-video-card-container.active')!==null,signal);
        this.catalog();
      }
      const card=this.#cards.get(task.id);if(!card||!visible(card))throw new Error('所选视频卡片不存在。');
      if(!card.classList.contains('active')){
        this.close();card.click();
        await this.ready(()=>{
          if(!card.classList.contains('active')||!readZhidaoPlayer(this.document))return false;
          const media=this.document.querySelector<HTMLVideoElement>('.videoNameBox video'),raw=media?.currentSrc||media?.src;
          if(!media||media.readyState<1||!raw)return false;
          const source=publicMediaIdentity(new URL(raw,this.document.location.href).href),id=requireResourceId(task),expected=this.#sources.get(id);
          return (!id.startsWith('media:')||id===`media:${source}`)&&(!expected||expected===source);
        },signal);
      }
      this.player(course_id,task);return true;
    }
    if(request.operation==='verify'){
      if(readZhidaoNavigation(this.document)?.stage!=='learner')throw new Error('需返回本视频页独立核对任务进度。');
      const reading=this.player(course_id,task).snapshot();
      const recorded=this.catalog().tasks.find(t=>t.id===task.id)?.status==='completed';
      const result:CourseVerification={task_id:task.id,media_ended:reading.ended,progress_recorded:recorded,submission_confirmed:false,
        completed:recorded,passed:null,pending_grading:false,visible_score:null};return result;
    }
    const controls=this.player(course_id,task);
    switch(request.operation){
      case 'video':{const v=controls.snapshot();
        if(!v.paused&&!v.ended&&!(v.muted||v.volume===0))throw new Error('静音状态已失效。');
        return {course_id,task_id:task.id,video_id:task.id,observed_at:v.observed_at,duration:v.duration,position:v.position,rate:v.rate,
          paused:v.paused,buffering:v.buffering,seeking:v.seeking,ended:v.ended,visible:v.visible,popup:null} satisfies VideoSnapshot;}
      case 'speed_target':{const root=this.document.querySelector<HTMLElement>('.videoNameBox >.video-js');root?.dispatchEvent(new this.document.defaultView!.MouseEvent('mousemove',{bubbles:true}));
        const captions=Array.from(this.document.querySelectorAll<HTMLElement>('.videoNameBox .controlsBar >.speedBox >span')).filter(visible);
        if(captions.length>1)throw new Error('倍速控件不唯一。');
        const target=captions[0]??root;if(!target||!visible(target))throw new Error('播放器悬停目标不可见。');
        const r=target.getBoundingClientRect();const geometry=captureVisualGeometry(this.document,null);geometry.region={x:0,y:0,width:geometry.viewport.width,height:geometry.viewport.height};
        return {point:{x:r.x+r.width/2,y:r.y+r.height/2},captured_at:Date.now(),geometry};}
      case 'mute':await controls.mute(signal);return true;
      case 'speed':await controls.highestAllowedSpeed(this.document.querySelector('.videoNameBox .controlsBar >.speedBox >span')!==null,signal);return true;
      case 'play':await controls.play(signal);return true;
      case 'pause':await controls.pause(signal);return controls.snapshot().paused;
      case 'quiz':case 'rewatch':case 'retry':case 'record':throw new Error('当前视频范围没有纳入练习或已确认的弹题规则。');
    }
  }
}
