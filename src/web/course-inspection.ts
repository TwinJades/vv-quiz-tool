import { isExplicitlyHidden } from './dom-utils';
import { coursePlatform } from './course-adapter';

export interface CourseInspection {
  platform: string | null;
  path: string;
  closed: boolean;
  limitations: string[];
  nodes: Array<{tag:string;id:string;classes:string[];role:string|null;text:string;attributes:string[];parents:string[];link:{path:string;ids:Record<string,string>}|null}>;
  videos: Array<{position:number;duration:number|null;rate:number;paused:boolean;ended:boolean;ready_state:number}>;
  frames: Array<{origin:string;path:string}>;
  controls: {visible_choices:number;hidden_choices:number;visible_buttons:number};
}
function publicPath(path:string):string {
  return path.split('/').map(part=>part.length>32&&!/^\d+$/.test(part)?'[已省略不透明路径参数]':part).join('/');
}
function visibleText(element:HTMLElement):string {
  const parts:string[]=[];
  const visit=(node:Node):void=>{
    if(node.nodeType===3){parts.push(node.textContent??'');return;}
    if(node.nodeType!==1)return;
    const e=node as HTMLElement;
    if(e.matches('script,style,template,noscript,input,textarea,select')||isExplicitlyHidden(e))return;
    for(const child of Array.from(e.childNodes))visit(child);
  };
  visit(element);return parts.join(' ').replace(/\s+/g,' ').trim();
}
/** User-requested, read-only structural material. No HTML, scripts, input values,
 * cookies, private attributes, hidden answers, or URL credentials are exported. */
export function inspectCoursePage(document:Document):CourseInspection {
  const view=document.defaultView!;
  const selector='a[href],button,[role="button"],[role="dialog"],[role="radio"],[role="checkbox"],input[type="radio"],input[type="checkbox"],label,h1,h2,h3,video,[class*="chapter"],[class*="catalog"],[class*="task"],[class*="quiz"],[class*="question"],[class*="answer"],[class*="option"],[class*="radio"],[class*="ans-"]';
  const elements=Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(e=>!isExplicitlyHidden(e)&&!e.closest('script,style,template,noscript,[hidden]'));
  const nodes=elements.slice(0,220).map(element=>{
    let link:CourseInspection['nodes'][number]['link']=null;
    if(element instanceof view.HTMLAnchorElement){
      try{const url=new URL(element.href,document.location.href);const ids:Record<string,string>={};
        for(const key of ['courseId','courseid','chapterId','chapterid','knowledgeId','knowledgeid']){const value=url.searchParams.get(key);if(value&&/^\d+$/.test(value))ids[key]=value;}
        link={path:url.protocol==='https:'?url.origin+publicPath(url.pathname):'[非HTTPS链接]',ids};}catch{}
    }
    const parents:string[]=[];for(let p=element.parentElement;p&&parents.length<4;p=p.parentElement)parents.push(p.tagName.toLowerCase()+'.'+Array.from(p.classList).slice(0,6).join('.'));
    return {tag:element.tagName.toLowerCase(),id:element.id,classes:Array.from(element.classList).slice(0,12),role:element.getAttribute('role'),
      text:(element.getAttribute('aria-label')||visibleText(element)).replace(/\s+/g,' ').trim().slice(0,200),
      attributes:Array.from(element.attributes).map(a=>a.name).filter(name=>name!=='value'&&name!=='onclick'),parents,link};
  });
  const videos=Array.from(document.querySelectorAll<HTMLVideoElement>('video')).filter(e=>!isExplicitlyHidden(e)).map(video=>({position:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,rate:video.playbackRate,paused:video.paused,ended:video.ended,ready_state:video.readyState}));
  const frames=Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).filter(e=>!isExplicitlyHidden(e)).flatMap(frame=>{
    try{const url=new URL(frame.src,document.location.href);return url.protocol==='https:'?[{origin:url.origin,path:publicPath(url.pathname)}]:[];}catch{return [];}
  });
  const closed=/本课程已结课|课程已结束/.test(document.body?.innerText||document.body?.textContent||'');
  const choices=Array.from(document.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]'));
  const visibleChoices=choices.filter(e=>!isExplicitlyHidden(e)).length;
  return {platform:coursePlatform(document.location.href),path:publicPath(document.location.pathname),closed,nodes,videos,frames,
    controls:{visible_choices:visibleChoices,hidden_choices:choices.length-visibleChoices,visible_buttons:elements.filter(e=>e.matches('button,[role="button"]')).length},
    limitations:['只读结构资料，不证明动作或平台进度已验收。',...(elements.length>220?['节点已截取，需按目录/视频/弹题/测验各页分别采集。']:[])]};
}
