import { isExplicitlyHidden, normalizedText, fnv1a } from './dom-utils';
import { readChaoxingPracticeReview } from './chaoxing-practice';
import {publicMediaIdentity} from './public-course-url';

export interface ChaoxingLearningReading {
  course_id: string;
  class_id: string;
  lesson_id: string;
  lesson_title: string | null;
  observed_at: number;
  visibility_required: boolean | null;
  seek_forbidden: boolean | null;
  required_watch_percent: number | null;
  resources_ready:boolean;
  resource_count:number;
  excluded_resources?:Array<{index:number;title:string}>;
  cross_origin_resources?:boolean;
  /** Page markers and media ended deliberately remain independent. */
  videos: Array<{ index: number; task_recorded: boolean | null; media: {
    source_fingerprint:string;
    position: number; duration: number | null; rate: number; paused: boolean;
    ended: boolean; seeking: boolean; ready_state: number; muted: boolean; volume: number;
  } | null }>;
  quizzes: Array<{ index: number; task_recorded: boolean | null; status: 'pending' | 'submitted' | 'unknown';
    visual_text_required: boolean; submission_confirmed: boolean;score:number|null;attempt:number|null }>;
  diagnostics: string[];
}

function id(url: URL, key: string): string | null {
  const values=url.searchParams.getAll(key);
  return values.length===1 && /^\d+$/.test(values[0]!) ? values[0]! : null;
}
function childDocument(frame: HTMLIFrameElement, parent: Document, path: string): Document | null {
  try {
    if(isExplicitlyHidden(frame))return null;
    const declared=new URL(frame.src,parent.location.href), child=frame.contentDocument;
    if(declared.origin!==parent.location.origin || declared.pathname!==path || !child)return null;
    const current=new URL(child.location.href);
    return current.origin===parent.location.origin && current.pathname===path ? child : null;
  } catch { return null; }
}
function jobRecorded(frame: HTMLIFrameElement): boolean | null {
  const parent=frame.parentElement;
  if(!parent?.matches('.ans-attach-ct'))return null;
  const markers=Array.from(parent.querySelectorAll(':scope > .ans-job-icon')).filter(e=>!isExplicitlyHidden(e));
  if(markers.length!==1)return null;
  // The real pending sample also has ans-job-icon-clear. Its accessible
  // status label is the completion evidence, not that presentation class.
  const status=normalizedText(markers[0]!.getAttribute('aria-label'));
  return status==='任务点已完成' ? true : status==='任务点未完成' ? false : null;
}

/** Observed studentstudy -> cards -> video/work hierarchy, read only. Frame
 * URLs and parent course/class/lesson must agree before reading task state.
 * No encoded attachment attributes, hidden form values or private APIs. Array
 * indices are observation positions, never stable platform task identities. */
export function readChaoxingLearningPage(document: Document): ChaoxingLearningReading | null {
  const url=new URL(document.location.href);
  if(url.origin!=='https://mooc1.chaoxing.com' || url.pathname!=='/mycourse/studentstudy')return null;
  const course=id(url,'courseId'), lesson=id(url,'chapterId'), clazz=id(url,'clazzid');
  if(!course || !lesson || !clazz)return null;
  const rows=Array.from(document.querySelectorAll<HTMLElement>('[id]')).filter(e=>e.id===`cur${lesson}`&&!isExplicitlyHidden(e));
  const titles=rows.length===1 ? Array.from(rows[0]!.querySelectorAll(':scope > .posCatalog_name')).filter(e=>!isExplicitlyHidden(e)) : [];
  const reading:ChaoxingLearningReading={course_id:course,class_id:clazz,lesson_id:lesson,
    lesson_title:titles.length===1 ? normalizedText(titles[0]!.textContent) : null,observed_at:Date.now(),
    visibility_required:null,seek_forbidden:null,required_watch_percent:null,resources_ready:false,resource_count:0,videos:[],quizzes:[],diagnostics:[]};
  if(!reading.lesson_title)reading.diagnostics.push('当前课时目录身份或标题不唯一。');
  const frames=Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe#iframe')).filter(e=>!isExplicitlyHidden(e));
  reading.cross_origin_resources=frames.some(frame=>new URL(frame.src,document.location.href).origin!==url.origin);
  const cards=frames.length===1 ? childDocument(frames[0]!,document,'/mooc-ans/knowledge/cards') : null;
  if(!cards){reading.diagnostics.push('课时任务frame尚未加载或无法读取。');return reading;}
  const cardsUrl=new URL(cards.location.href);
  if(id(cardsUrl,'courseid')!==course || id(cardsUrl,'knowledgeid')!==lesson || id(cardsUrl,'clazzid')!==clazz){
    reading.diagnostics.push('课时任务frame与当前课程、班级或课时失配。');return reading;
  }
  const rules=normalizedText(cards.body?.innerText ?? cards.body?.textContent);
  const percent=/观看时长需\s*≥\s*总时长的\s*(\d+(?:\.\d+)?)%/.exec(rules);
  if(percent && Number(percent[1])<=100)reading.required_watch_percent=Number(percent[1]);
  if(/观看时不可离开或将页面最小化/.test(rules))reading.visibility_required=true;
  if(/当前视频不可拖拽/.test(rules))reading.seek_forbidden=true;
  const resources=Array.from(cards.querySelectorAll<HTMLIFrameElement>('.ans-attach-ct iframe')).filter(e=>!isExplicitlyHidden(e));
  reading.resource_count=resources.length;
  let unknownResource=false;reading.excluded_resources=[];
  for(const frame of resources){
    let path:string;try{path=new URL(frame.src,cards.location.href).pathname;}catch{unknownResource=true;continue;}
    if(new URL(frame.src,cards.location.href).origin!==cardsUrl.origin)reading.cross_origin_resources=true;
    if(path==='/ananas/modules/video/index.html'){
      const child=childDocument(frame,cards,path);
      const media=child ? Array.from(child.querySelectorAll<HTMLVideoElement>('video.vjs-tech')).filter(e=>!isExplicitlyHidden(e)) : [];
      const video=media.length===1 ? media[0]! : null;
      const source=video&&(video.currentSrc||video.src),sourceUrl=source?new URL(source,child!.location.href):null;
      const publicSource=sourceUrl?publicMediaIdentity(sourceUrl.href):null;
      reading.videos.push({index:reading.videos.length,task_recorded:jobRecorded(frame),media:video ? {
        position:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,rate:video.playbackRate,
        paused:video.paused,ended:video.ended,seeking:video.seeking,ready_state:video.readyState,muted:video.muted,volume:video.volume,
        source_fingerprint:publicSource?fnv1a(publicSource):'',
      } : null});
      if(!video)reading.diagnostics.push('视频尚未加载或播放器不唯一。');
    }else if(path==='/ananas/modules/work/index.html'){
      const module=childDocument(frame,cards,path);
      const workFrames=module ? Array.from(module.querySelectorAll<HTMLIFrameElement>('iframe#frame_content')).filter(e=>!isExplicitlyHidden(e)) : [];
      if(workFrames.some(child=>new URL(child.src,module!.location.href).origin!==cardsUrl.origin))reading.cross_origin_resources=true;
      // The declared module src redirects to the public doHomeWorkNew page.
      let work:Document|null=null;
      if(workFrames.length===1)try{const candidate=workFrames[0]!.contentDocument;const u=candidate&&new URL(candidate.location.href);
        if(u?.origin===cards.location.origin&&['/mooc-ans/work/doHomeWorkNew','/mooc-ans/work/selectWorkQuestionYiPiYue'].includes(u.pathname)&&
          id(u,'courseId')===course&&id(u,'knowledgeid')===lesson)work=candidate;}catch{ /* unavailable */ }
      const body=work ? normalizedText(work.body?.innerText ?? work.body?.textContent) : '';
      const review=work ? readChaoxingPracticeReview(work) : null;
      reading.quizzes.push({index:reading.quizzes.length,task_recorded:jobRecorded(frame),
        status:review?'submitted':/章节测验\s+待完成/.test(body)?'pending':'unknown',
        visual_text_required:Boolean(work&&Array.from(work.querySelectorAll('.font-cxsecret')).some(e=>!isExplicitlyHidden(e))),
        submission_confirmed:Boolean(review),score:review?.score??null,attempt:review?.attempt??null});
      if(!work)reading.diagnostics.push('章节测验frame尚未加载或无法读取。');
    }else if(/^\/ananas\/modules\/(?:document|pdf|ppt|office|read)\/index\.html$/.test(path))reading.excluded_resources.push({index:resources.indexOf(frame),title:'文档资源'});
    else unknownResource=true;
  }
  reading.resources_ready=cards.readyState==='complete'&&!unknownResource&&(resources.length>0||/本节(?:课)?无任务点|当前课时无任务点/.test(rules));
  reading.diagnostics.push('当前课时只读信息；完成图标不证明视频结束、测验提交或达到及格条件。');
  return reading;
}
