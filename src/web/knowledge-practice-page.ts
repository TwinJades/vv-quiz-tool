import type {KnowledgeCatalog,KnowledgePoint} from '../core/knowledge-practice';
import {isExplicitlyHidden,normalizedText} from './dom-utils';
import {readZhidaoDirectory} from './zhidao-directory';
import {readZhidaoNavigation,resolveZhidaoImprove,resolveZhidaoLearnerReturn,resolveZhidaoReportReturn} from './zhidao-navigation';
import type {ZhidaoNavigationReading} from './zhidao-navigation';

export type KnowledgePageRequest={operation:'catalog'}|{operation:'state'|'enter'|'pause'|'improve'|'back'|'directory';course_id:string;context_id:string;point:KnowledgePoint};
export interface KnowledgePageState {navigation:ZhidaoNavigationReading;paused:boolean|null;has_video:boolean;no_practice:boolean;history_empty:boolean;history_count:number;}
export type KnowledgePageResult=KnowledgeCatalog|KnowledgePageState|boolean;
export function readKnowledgeCatalog(document:Document):KnowledgeCatalog {
  const directory=readZhidaoDirectory(document);
  if(!directory?.points.length||directory.diagnostics.length>2)throw new Error('知到已加载知识点目录不完整或身份不明确。');
  const points=directory.points.map(({id,title,order})=>({id,title,order}));
  return {course_id:directory.course_id,context_id:directory.context_id,title:document.title+'（仅选定知识点练习）',
    revision:JSON.stringify(directory.points.map(p=>[p.id,p.title,p.module_id,p.order])),points};
}
function visible(document:Document,selector:string):HTMLElement[] {return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(e=>!isExplicitlyHidden(e));}
export class KnowledgePracticePage {
  constructor(private document:Document){}
  state(request:Exclude<KnowledgePageRequest,{operation:'catalog'}>):KnowledgePageState {
    const navigation=readZhidaoNavigation(this.document);
    if(!navigation||navigation.course_id!==request.course_id||navigation.context_id!==request.context_id||
      (navigation.stage!=='directory'&&navigation.point_id!==request.point.id))throw new Error('当前课程、班级或知识点不属于本次练习范围。');
    if(navigation.stage==='directory'){
      const directory=readZhidaoDirectory(this.document);
      // Normal SPA return can expose the directory route before its cards load.
      // Polling must wait for rendered identity rather than fail on that gap.
      if(!directory?.points.length)navigation.ready=false;
      else if(directory.diagnostics.length>2)throw new Error('知到知识点目录结构存在歧义。');
      else if(directory.points.find(p=>p.id===request.point.id)?.title!==request.point.title)throw new Error('知识点标题已改变。');
    }
    if(navigation.stage==='mastery_history'&&normalizedText(this.document.querySelector('.mastery-header .title-content')?.textContent)!==request.point.title)
      navigation.ready=false;
    if(navigation.stage==='learner'&&normalizedText(this.document.querySelector('.middle-section >.header-section .point-title-text')?.textContent)!==request.point.title)
      navigation.ready=false;
    const videos=visible(this.document,'.videoNameBox >.video-js >video.vjs-tech') as unknown as HTMLVideoElement[];
    if(videos.length>1)throw new Error('当前播放器不唯一。');
    // A normal full-page refresh can expose the route before <body> exists.
    // Keep observation pollable, but never resolve actions from that gap.
    if(!this.document.body)navigation.ready=false;
    const text=normalizedText(this.document.body?.innerText);
    const noPractice=navigation.stage==='learner'&&navigation.ready&&/免考知识点[，,\s]*无练习题/.test(text)&&!navigation.improve_available;
    const histories=navigation.stage==='mastery_history'?visible(this.document,'.mastery-history-container .history-item'):[];
    return {navigation,paused:videos[0]?.paused??null,has_video:videos.length===1,no_practice:noPractice,
      history_empty:navigation.stage==='mastery_history'&&navigation.ready&&histories.length===0&&text.includes('暂无数据'),history_count:histories.length};
  }
  execute(request:KnowledgePageRequest,signal:AbortSignal):KnowledgePageResult {
    signal.throwIfAborted();if(request.operation==='catalog')return readKnowledgeCatalog(this.document);
    const state=this.state(request),nav=state.navigation;
    if(request.operation==='state')return state;
    if(request.operation==='pause'){
      if(nav.stage!=='learner'||!state.has_video)return true;
      const video=this.document.querySelector<HTMLVideoElement>('.videoNameBox >.video-js >video.vjs-tech')!;
      if(video.paused)return true;
      const controls=visible(this.document,'.videoNameBox .controlsBar >.pauseButton');
      if(controls.length!==1)throw new Error('没有唯一正常暂停控件。');
      signal.throwIfAborted();controls[0]!.click();return video.paused;
    }
    if(!nav.ready)throw new Error('知识点页面尚未就绪，未执行导航。');
    let control:HTMLElement;
    if(request.operation==='enter'){
      if(nav.stage!=='directory')throw new Error('进入知识点需要重新核对目录。');
      const cards=visible(this.document,'.knowledge-content .item-content[knowledgeid]').filter(e=>e.getAttribute('knowledgeid')===request.point.id);
      if(cards.length!==1)throw new Error('知识点正常入口不唯一。');control=cards[0]!;
    }else if(request.operation==='improve'){
      if(nav.stage==='learner'&&state.has_video&&!state.paused)throw new Error('进入练习前应先暂停视频。');
      control=resolveZhidaoImprove(this.document,nav);
    }else if(request.operation==='back')control=resolveZhidaoReportReturn(this.document,nav);
    else control=resolveZhidaoLearnerReturn(this.document,nav);
    signal.throwIfAborted();control.click();return true;
  }
}
