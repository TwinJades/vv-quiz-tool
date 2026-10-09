import type { CourseCatalog, CourseVerification, LearningTask, VideoSnapshot } from '../core/course';
import type { CoursePageRequest, CoursePageResult } from './course-adapter';
import { fnv1a, normalizedText } from './dom-utils';
import { readZhidaoDirectory } from './zhidao-directory';
import { readZhidaoNavigation, resolveZhidaoLearnerReturn } from './zhidao-navigation';
import { readZhidaoPlayer, isVisibleZhidaoPlayerElement as visible } from './zhidao-player';
import { ZhidaoPlayerControls } from './zhidao-player-controls';
import { captureVisualGeometry } from './visual-geometry';

/** A deliberately explicit current-knowledge-point scope. A directory card is
 * not a video, and a document or mastery percentage never completes a video. */
export class ZhidaoLearningPage {
  #catalog: CourseCatalog | null=null;
  #point: string | null=null;
  #context: string | null=null;
  #controls: ZhidaoPlayerControls | null=null;
  #media: HTMLVideoElement | null=null;
  #cards=new Map<string,HTMLElement>();
  constructor(private readonly document:Document){}
  close():void {this.#controls?.close();this.#controls=null;this.#media=null;}
  handles():boolean {
    const nav=readZhidaoNavigation(this.document);
    return nav?.stage==='learner' && nav.ready || Boolean(this.#catalog&&nav?.stage==='directory');
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
    if(titles.length!==1)throw new Error('知到播放器范围不唯一。');
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
      if(isVideo&&!time)throw new Error('视频标题及时长未知，不能生成任务。');
      const id=`zhidao:${nav.course_id}:${nav.point_id}:${isVideo?'video':'excluded'}:${fnv1a(label)}`;
      if(tasks.some(t=>t.id===id))throw new Error('同一知识点存在重名资源，不能可靠绑定。');
      const raw=normalizedText(info.querySelector(':scope >.finished-icon')?.textContent);
      // The real resource card replaces its percentage with this explicit
      // completion label. Keep this distinct from knowledge mastery or grades.
      const match=/^(\d+(?:\.\d+)?)%$/.exec(raw);const percent=raw==='已完成'?100:match?Number(match[1]):null;
      if(isVideo&&(percent===null||percent<0||percent>100))throw new Error('视频的公开学习进度尚未确认。');
      tasks.push({id,lesson_id:nav.point_id,chapter_id:nav.point_id,title:isVideo?label:`未纳入：${label}`,kind:isVideo?'video':'excluded',
        order:index,status:isVideo?(percent===100?'completed':percent!>0?'in_progress':'not_started'):'unknown',prerequisites:[]});
      bindings.set(id,card);
    }
    if(!tasks.some(t=>t.kind==='video'))throw new Error('本知识点没有已核对的必学视频。');
    if(this.#catalog&&JSON.stringify(this.#catalog.tasks.map(t=>[t.id,t.kind]))!==JSON.stringify(tasks.map(t=>[t.id,t.kind])))
      throw new Error('本知识点资源清单已改变，请重新选择范围。');
    this.#cards=bindings;this.#point=nav.point_id;this.#context=nav.context_id;
    this.#catalog={course_id:nav.course_id,platform:'zhidao',title:'当前知识点的必学视频（文档、练习及其他知识点未纳入）',
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
    if(this.#media!==media||!this.#controls){this.#controls?.close();this.#media=media;this.#controls=new ZhidaoPlayerControls(this.document,reading,async()=>{
      if(!readZhidaoPlayer(this.document)?.speed_menu_visible)throw new Error('正常倍速菜单没有展开。');
    });}
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
    if(request.operation==='children')return this.catalog().tasks;
    if(request.operation==='directory'){
      const nav=readZhidaoNavigation(this.document);
      if(nav?.stage==='directory'){if(nav.course_id!==request.course_id)throw new Error('课程改变。');return true;}
      if(!nav||nav.course_id!==request.course_id)throw new Error('课程改变。');
      const media=this.document.querySelector<HTMLVideoElement>('.videoNameBox video');
      if(media&&!media.paused&&!media.ended)throw new Error('离开学习页前视频尚未暂停。');
      resolveZhidaoLearnerReturn(this.document,nav).click();this.#controls?.close();this.#controls=null;this.#media=null;
      await this.ready(()=>readZhidaoDirectory(this.document)?.course_id===request.course_id,signal);return true;
    }
    const {course_id,task}=request;this.assertTask(course_id,task);
    if(request.operation==='enter'){
      if(readZhidaoNavigation(this.document)?.stage==='directory'){
        const cards=Array.from(this.document.querySelectorAll<HTMLElement>('.knowledge-content .item-content[knowledgeid]')).filter(e=>e.getAttribute('knowledgeid')===this.#point&&visible(e));
        if(cards.length!==1)throw new Error('所选知识点入口不唯一。');cards[0]!.click();
        await this.ready(()=>readZhidaoPlayer(this.document)!==null&&this.document.querySelector('.resources-section .basic-info-video-card-container.active')!==null,signal);
        this.catalog();
      }
      const card=this.#cards.get(task.id);if(!card||!visible(card))throw new Error('所选视频卡片不存在。');
      if(!card.classList.contains('active')){this.#controls?.close();this.#controls=null;this.#media=null;card.click();await this.ready(()=>card.classList.contains('active')&&readZhidaoPlayer(this.document)!==null,signal);}
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
