import {publicMediaIdentity} from './public-course-url';
import {isExplicitlyHidden} from './dom-utils';
import type {LearningTask} from '../core/course';

export function requireResourceId(task:LearningTask):string {
  if(!task.resource_id?.trim())throw new Error(`资源缺少公开编号：${task.title}`);
  return task.resource_id;
}

export function resourceTaskId(parent:string,kind:LearningTask['kind'],resource:string):string {
  if(!resource.trim())throw new Error('资源身份为空。');
  return `${parent}:${kind}:${encodeURIComponent(resource)}`;
}

export function publicResourceIdentity(kind:'video'|'quiz',attributes:Record<string,string|null>,urls:URL[]):string|null {
  const names=kind==='video'?['videoid','videoId','objectid','objectId','resourceid','resourceId','data-video-id','data-object-id','data-resource-id']:['workid','workId','resourceid','resourceId','data-work-id','data-resource-id'];
  for(const name of names){
    const values=new Set<string>();
    const attribute=attributes[name];if(attribute?.trim())values.add(attribute.trim());
    for(const url of urls)for(const id of url.searchParams.getAll(name))if(id.trim())values.add(id.trim());
    if(values.size>1)throw new Error(`公开资源编号冲突：${name}`);
    if(values.size===1)return `${kind}:${[...values][0]}`;
  }
  return null;
}

export function publicResourceId(element:Element,kind:'video'|'quiz',urls:string[]=[]):string|null {
  return publicResourceIdentity(kind,Object.fromEntries([...element.attributes].map(attribute=>[attribute.name,attribute.value])),urls.map(value=>new URL(value,element.ownerDocument.location.href)));
}

export function chaoxingWorkEntryIdentity(entryUrl:string,documentUrl:string|null,base:string):string|null {
  // 入口编号与重定向后的答题编号属于不同地址，保持入口身份。
  const entry=publicResourceIdentity('quiz',{},[new URL(entryUrl,base)]);
  if(entry)return entry;
  return documentUrl?publicResourceIdentity('quiz',{},[new URL(documentUrl,base)]):null;
}

export function chaoxingFrameResourceId(frame:HTMLIFrameElement,kind:'video'|'quiz'):string|null {
  const child=frame.contentDocument;
  const work=kind==='quiz'?child?.querySelector<HTMLIFrameElement>('iframe#frame_content'):null;
  const urls=[frame.src,...(child?[child.location.href]:[])];
  const numbered=publicResourceId(frame,kind,urls);if(numbered)return numbered;
  if(work){
    const entry=chaoxingWorkEntryIdentity(work.src,work.contentDocument?.location.href??null,child!.location.href);
    if(entry)return entry;
  }
  if(kind==='video'){
    const videos=Array.from(child?.querySelectorAll<HTMLVideoElement>('video.vjs-tech')??[]).filter(video=>!isExplicitlyHidden(video));
    if(videos.length>1)throw new Error('资源存在多个实际视频。');
    const video=videos[0];
    if(video){const publicId=publicResourceId(video,kind);if(publicId)return publicId;
      const source=video.currentSrc||video.src;if(source){const identity=publicMediaIdentity(new URL(source,child!.location.href).href);if(identity)return `media:${identity}`;}}
  }
  return null;
}

export function resolveChaoxingResourceFrame(document:Document,kind:'video'|'quiz',resourceId:string):HTMLIFrameElement {
  if(!resourceId.trim())throw new Error('资源缺少公开编号。');
  const cards=document.querySelector<HTMLIFrameElement>('iframe#iframe')?.contentDocument;
  if(!cards)throw new Error('课时资源页面尚未加载。');
  const path=kind==='video'?'/ananas/modules/video/index.html':'/ananas/modules/work/index.html';
  const matches=Array.from(cards.querySelectorAll<HTMLIFrameElement>('.ans-attach-ct iframe')).filter(frame=>!isExplicitlyHidden(frame)&&new URL(frame.src,cards.location.href).pathname===path&&chaoxingFrameResourceId(frame,kind)===resourceId);
  if(matches.length!==1)throw new Error(`资源编号无法唯一定位：${resourceId}（找到 ${matches.length} 个）`);
  return matches[0]!;
}
