import { isExplicitlyHidden } from './dom-utils';
import { coursePlatform } from './course-adapter';
import { readZhidaoDirectory, type ZhidaoDirectoryReading } from './zhidao-directory';
import { ZHIDAO_CHOICE_SELECTOR, ZHIDAO_NEXT_SELECTOR, isZhidaoChoice, isZhidaoNext, readZhidaoPractice, zhidaoSelected, type ZhidaoPracticeReading } from './zhidao-practice';
import { readChaoxingDirectory, type ChaoxingDirectoryReading } from './chaoxing-directory';
import { observedZhidaoElements, readZhidaoNavigation, type ZhidaoNavigationReading } from './zhidao-navigation';
import { readZhidaoReview, type ZhidaoReviewReading } from './zhidao-review';
import { readZhidaoPlayer, type ZhidaoPlayerReading } from './zhidao-player';
import { readChaoxingLearningPage, type ChaoxingLearningReading } from './chaoxing-learning-page';
import { readChaoxingPractice, readChaoxingPracticeReview, type ChaoxingPracticeReading, type ChaoxingPracticeReviewReading } from './chaoxing-practice';

export interface CourseInspection {
  platform: string | null;
  path: string;
  closed: boolean;
  visible_text: string;
  visibility: DocumentVisibilityState;
  node_count: number;
  limitations: string[];
  zhidao_directory?: ZhidaoDirectoryReading;
  chaoxing_directory?: ChaoxingDirectoryReading;
  chaoxing_learning?: ChaoxingLearningReading;
  chaoxing_practice?: ChaoxingPracticeReading;
  chaoxing_review?: ChaoxingPracticeReviewReading;
  zhidao_practice?: ZhidaoPracticeReading;
  zhidao_navigation?: ZhidaoNavigationReading;
  zhidao_review?: ZhidaoReviewReading;
  zhidao_player?: ZhidaoPlayerReading;
  nodes: Array<{index:number;parent_index:number|null;tag:string;id:string;classes:string[];role:string|null;text:string;attributes:string[];parents:string[];
    state:{type:string|null;disabled:boolean;checked:boolean|null;selected:string|null;expanded:string|null;label_for:string|null;labelled_by:string[]};
    link:{path:string;ids:Record<string,string>}|null}>;
  videos: Array<{position:number;duration:number|null;rate:number;paused:boolean;ended:boolean;seeking:boolean;muted:boolean;volume:number;ready_state:number}>;
  frames: Array<{origin:string;path:string}>;
  hidden_choice_structure: Array<{tag:string;id:string;classes:string[];role:string|null;type:string|null;parents:string[]}>;
  controls: {visible_choices:number;hidden_choices:number;visible_buttons:number};
}
export interface CourseInspectionBundle {
  schema_version: 1;
  captured_at: string;
  complete: boolean;
  frames: Array<{frame_id:number;inspection?:CourseInspection;error?:'not_authorized'|'page_changed'|'read_failed'}>;
}
function publicPath(path:string):string {
  return path.split('/').map(part=>part.length>32&&!/^\d+$/.test(part)?'[已省略不透明路径参数]':part).join('/');
}
function publicIdentifier(value:string):string {
  return value.length>64?'[已省略长标识]':value;
}
function inspectionVisible(element:Element):boolean {
  if(isExplicitlyHidden(element))return false;
  for(let current:Element|null=element;current;current=current.parentElement){
    const style=current.ownerDocument.defaultView?.getComputedStyle(current);
    if(style?.opacity==='0'||style?.visibility==='collapse')return false;
  }
  return true;
}
function visibleText(element:HTMLElement,limit=200):string {
  const parts:string[]=[];let length=0;
  const visit=(node:Node):void=>{
    if(length>=limit)return;
    if(node.nodeType===3){const text=(node.textContent??'').replace(/\s+/g,' ').slice(0,limit-length);parts.push(text);length+=text.length;return;}
    if(node.nodeType!==1)return;
    const e=node as HTMLElement;
    // HTML5 video fallback children are not rendered by a supported browser.
    // Keep media state separately instead of reporting fallback as a page error.
    if(e.matches('script,style,template,noscript,input,textarea,select,video')||!inspectionVisible(e))return;
    for(const child of Array.from(e.childNodes))visit(child);
  };
  visit(element);return parts.join(' ').replace(/\s+/g,' ').trim().slice(0,limit);
}
/** User-requested, read-only structural material. No HTML, scripts, input values,
 * cookies, private attributes, hidden answers, or URL credentials are exported. */
export function inspectCoursePage(document:Document):CourseInspection {
  const view=document.defaultView!;
  const selector='a[href],button,[role="button"],[role="dialog"],[role="radio"],[role="checkbox"],input[type="radio"],input[type="checkbox"],input[type="button"],label,h1,h2,h3,main,article,section,video,[class*="chapter"],[class*="catalog"],[class*="task"],[class*="quiz"],[class*="question"],[class*="answer"],[class*="option"],[class*="radio"],[class*="ans-"],[class*="exercise"],[class*="test"]';
  const customChoices=Array.from(document.querySelectorAll<HTMLElement>(ZHIDAO_CHOICE_SELECTOR)).filter(isZhidaoChoice);
  const customNext=Array.from(document.querySelectorAll<HTMLElement>(ZHIDAO_NEXT_SELECTOR)).filter(isZhidaoNext);
  const zhidaoNavigation=readZhidaoNavigation(document);
  const observedElements=observedZhidaoElements(document,zhidaoNavigation);
  const elements=Array.from(new Set([...document.querySelectorAll<HTMLElement>(selector),...customChoices,...customNext,...observedElements])).filter(e=>inspectionVisible(e)&&!e.closest('script,style,template,noscript,[hidden]'));
  const retained=elements.slice(0,500);
  const indices=new Map(retained.map((element,index)=>[element,index]));
  const nodes=retained.map((element,index)=>{
    let link:CourseInspection['nodes'][number]['link']=null;
    if(element instanceof view.HTMLAnchorElement){
      try{const url=new URL(element.href,document.location.href);const ids:Record<string,string>={};
        for(const key of ['courseId','courseid','chapterId','chapterid','knowledgeId','knowledgeid']){const value=url.searchParams.get(key);if(value&&/^\d+$/.test(value))ids[key]=value;}
        link={path:url.protocol==='https:'?url.origin+publicPath(url.pathname):'[非HTTPS链接]',ids};}catch{}
    }
    const parents:string[]=[];let parentIndex:number|null=null;
    for(let p=element.parentElement;p;p=p.parentElement){
      if(parentIndex===null&&indices.has(p))parentIndex=indices.get(p)!;
      if(parents.length<4)parents.push(p.tagName.toLowerCase()+'.'+Array.from(p.classList).slice(0,6).map(publicIdentifier).join('.'));
    }
    const input=element instanceof view.HTMLInputElement?element:null;
    const choice=input&&['radio','checkbox'].includes(input.type);
    const ariaChecked=element.getAttribute('aria-checked');
    return {index,parent_index:parentIndex,tag:element.tagName.toLowerCase(),id:publicIdentifier(element.id),classes:Array.from(element.classList).slice(0,12).map(publicIdentifier),role:element.getAttribute('role'),
      text:(element.getAttribute('aria-label')||visibleText(element)).replace(/\s+/g,' ').trim().slice(0,200),
      attributes:Array.from(element.attributes).map(a=>a.name).filter(name=>name!=='value'&&!name.startsWith('on')),parents,
      state:{type:input?.type??null,disabled:element.hasAttribute('disabled')||element.getAttribute('aria-disabled')==='true',
        checked:isZhidaoChoice(element)?zhidaoSelected(element):choice?input.checked:ariaChecked==='true'?true:ariaChecked==='false'?false:null,
        selected:['true','false'].includes(element.getAttribute('aria-selected')??'')?element.getAttribute('aria-selected'):null,
        expanded:['true','false'].includes(element.getAttribute('aria-expanded')??'')?element.getAttribute('aria-expanded'):null,
        label_for:element instanceof view.HTMLLabelElement?publicIdentifier(element.htmlFor):null,
        labelled_by:(element.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(publicIdentifier)},link};
  });
  const videos=Array.from(document.querySelectorAll<HTMLVideoElement>('video')).filter(inspectionVisible).map(video=>({position:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,rate:video.playbackRate,paused:video.paused,ended:video.ended,seeking:video.seeking,muted:video.muted,volume:video.volume,ready_state:video.readyState}));
  const frames=Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).filter(inspectionVisible).flatMap(frame=>{
    try{const url=new URL(frame.src,document.location.href);return url.protocol==='https:'?[{origin:url.origin,path:publicPath(url.pathname)}]:[];}catch{return [];}
  });
  const pageText=document.body?visibleText(document.body,12001):'';
  const zhidaoDirectory=readZhidaoDirectory(document);
  const chaoxingDirectory=readChaoxingDirectory(document);
  const chaoxingLearning=readChaoxingLearningPage(document);
  const chaoxingPractice=readChaoxingPractice(document);
  const chaoxingReview=readChaoxingPracticeReview(document);
  const zhidaoPractice=readZhidaoPractice(document);
  const zhidaoReview=readZhidaoReview(document);
  const zhidaoPlayer=readZhidaoPlayer(document);
  const closed=/本课程已结课|课程已结束/.test(pageText);
  const choices=Array.from(document.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]'));
  const visibleChoices=choices.filter(inspectionVisible).length;
  // Hidden native inputs often sit behind visible labels in custom quiz widgets.
  // Export their structure only: never their text, values, selection or answers.
  const hiddenChoices=choices.filter(element=>!inspectionVisible(element));
  const hiddenChoiceStructure=hiddenChoices.slice(0,150).map(element=>{
    const parents:string[]=[];
    for(let parent=element.parentElement;parent&&parents.length<4;parent=parent.parentElement)
      parents.push(parent.tagName.toLowerCase()+'.'+Array.from(parent.classList).slice(0,6).map(publicIdentifier).join('.'));
    return {tag:element.tagName.toLowerCase(),id:publicIdentifier(element.id),classes:Array.from(element.classList).slice(0,12).map(publicIdentifier),
      role:element.getAttribute('role'),type:element instanceof view.HTMLInputElement?element.type:null,parents};
  });
  return {platform:coursePlatform(document.location.href),path:publicPath(document.location.pathname),closed,visible_text:pageText.slice(0,12000),visibility:document.visibilityState,node_count:elements.length,nodes,videos,frames,
    ...(zhidaoDirectory?{zhidao_directory:zhidaoDirectory}:{}),
    ...(chaoxingDirectory?{chaoxing_directory:chaoxingDirectory}:{}),
    ...(chaoxingLearning?{chaoxing_learning:chaoxingLearning}:{}),
    ...(chaoxingPractice?{chaoxing_practice:chaoxingPractice}:{}),
    ...(chaoxingReview?{chaoxing_review:chaoxingReview}:{}),
    ...(chaoxingPractice?{chaoxing_practice:chaoxingPractice}:{}),
    ...(zhidaoPractice?{zhidao_practice:zhidaoPractice}:{}),
    ...(zhidaoNavigation?{zhidao_navigation:zhidaoNavigation}:{}),
    ...(zhidaoReview?{zhidao_review:zhidaoReview}:{}),
    ...(zhidaoPlayer?{zhidao_player:zhidaoPlayer}:{}),
    hidden_choice_structure:hiddenChoiceStructure,
    controls:{visible_choices:visibleChoices+customChoices.filter(inspectionVisible).length,hidden_choices:choices.length-visibleChoices,visible_buttons:elements.filter(e=>e.matches('button,[role="button"]')||isZhidaoNext(e)).length},
    limitations:['只读结构资料，不证明动作或平台进度已验收。','可能包含页面可见的姓名和题目；分享前请检查。','不读取隐藏控件值、隐藏答案或未展开/未加载内容。',
      ...(elements.length>500||hiddenChoices.length>150?['节点已截取，需按目录/视频/弹题/测验各页分别采集。']:[]),...(pageText.length>12000?['可见文字已截取。']:[])]};
}
