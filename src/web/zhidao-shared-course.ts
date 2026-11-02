import {isExplicitlyHidden} from './dom-utils';

// Adapted from Autovisor modules/lesson_navigation.py at 5c715623030877d1daac0eaa14ac91f0abb2d003 (MIT, Copyright 2024 PengChengxu).
export interface SharedCatalog {
  name:'wisdom'|'fusion'|'hike'|'legacy';
  item:string;
  active:string;
  finish:string;
  title:string;
  activeClass:string;
  progress:string|null;
  progressAttribute:string|null;
}

const wisdom:SharedCatalog={name:'wisdom',item:'.child-info.hasvideo',active:'.child-info.hasvideo.current',finish:'.child-check',title:'.child-name',activeClass:'current',progress:'[role="progressbar"][aria-valuenow]',progressAttribute:'aria-valuenow'};
const fusion:SharedCatalog={name:'fusion',item:'.chapter-item',active:'.chapter-content-second.current',finish:'.finish-icon',title:'.item-name',activeClass:'current',progress:'.el-progress[aria-valuenow]',progressAttribute:'aria-valuenow'};
const hike:SharedCatalog={name:'hike',item:'.file-item',active:'.file-item.active',finish:'.icon-finish',title:'span[title]',activeClass:'active',progress:'.rate',progressAttribute:null};
const legacy:SharedCatalog={name:'legacy',item:'.clearfix.video',active:'.clearfix.video.current_play',finish:'.time_icofinish',title:'#lessonOrder',activeClass:'current_play',progress:'.progress-num',progressAttribute:null};

export function detectSharedCatalog(document:Document):SharedCatalog|null {
  const host=document.location.hostname.toLowerCase();
  if(host.startsWith('ai-smart-course'))return null;
  const candidates=host==='hike.zhihuishu.com'?[hike]:document.location.href.toLowerCase().includes('fusioncourseh5')?[fusion,wisdom,legacy]:[wisdom,legacy,fusion];
  return candidates.find(catalog=>document.querySelector(catalog.item)!==null)??null;
}

export function sharedLessonProgress(row:HTMLElement,catalog:SharedCatalog):number|null {
  if([...row.querySelectorAll(catalog.finish)].some(element=>!isExplicitlyHidden(element)))return 100;
  if(!catalog.progress)return null;
  const element=row.querySelector(catalog.progress);
  if(!element)return null;
  const raw=catalog.progressAttribute?element.getAttribute(catalog.progressAttribute):element.textContent;
  const text=raw?.trim().replace(/%$/, '').trim();
  if(!text)return null;
  const value=Number(text);
  return Number.isFinite(value)?Math.max(0,Math.min(Math.trunc(value),100)):null;
}

export function sharedLessonActive(row:HTMLElement,catalog:SharedCatalog):boolean {
  return row.classList.contains(catalog.activeClass)||row.querySelector(catalog.active)!==null;
}

export async function waitForSharedLessonActive(resolve:()=>HTMLElement|null,catalog:SharedCatalog,signal:AbortSignal):Promise<boolean> {
  const deadline=Date.now()+8000;
  for(;;){
    signal.throwIfAborted();
    const row=resolve();
    if(row&&sharedLessonActive(row,catalog))return true;
    const remaining=deadline-Date.now();
    if(remaining<=0)return false;
    await new Promise<void>((done,reject)=>{
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);done();},Math.min(200,remaining));
      signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    });
  }
}
