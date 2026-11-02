import {readChaoxingLearningPage, type ChaoxingLearningReading} from './chaoxing-learning-page';
import {isExplicitlyHidden} from './dom-utils';
import {resolveChaoxingResourceFrame,chaoxingFrameResourceId} from './course-resource-identity';
import {projectCourseFrame} from './frame-projection';

// Adapted from course-page-adapter.js courseVideoStartButton, MIT, zhu-hailin/chaoxing-ai-assistant@a34e9beefe50c2db92625367ca9e49eafc2c143f.
export class ChaoxingPlayerControls {
  readonly #video:HTMLVideoElement;
  readonly #playerDocument:Document;
  readonly #identity:string;
  readonly #resourceId:string;
  readonly #fingerprint:string;

  constructor(private readonly document:Document,expected:ChaoxingLearningReading,resourceId:string){
    this.#identity=JSON.stringify([expected.course_id,expected.class_id,expected.lesson_id]);
    this.#resourceId=resourceId;
    const reading=readChaoxingLearningPage(document);
    if(!reading||JSON.stringify([reading.course_id,reading.class_id,reading.lesson_id])!==this.#identity)
      throw new Error('COURSE_IDENTITY_MISMATCH: 当前课程、班级或课时身份失配。');
    const matches=reading.videos.filter(video=>video.resource_id===resourceId);
    if(matches.length!==1)throw new Error('COURSE_OBSERVATION_STALE: 当前视频资源尚未唯一就绪。');
    this.#fingerprint=matches[0]!.media?.source_fingerprint??'';
    const frame=resolveChaoxingResourceFrame(document,'video',resourceId);
    if(!frame.contentDocument)throw new Error('COURSE_OBSERVATION_STALE: 播放器页面尚未就绪。');
    this.#playerDocument=frame.contentDocument;
    const videos=Array.from(this.#playerDocument.querySelectorAll<HTMLVideoElement>('video.vjs-tech')).filter(video=>!isExplicitlyHidden(video));
    if(videos.length!==1)throw new Error('播放器实际视频无法唯一确认。');
    this.#video=videos[0]!;
  }

  snapshot():ChaoxingLearningReading {
    const reading=readChaoxingLearningPage(this.document);
    if(!reading||JSON.stringify([reading.course_id,reading.class_id,reading.lesson_id])!==this.#identity)
      throw new Error('COURSE_IDENTITY_MISMATCH: 课程、班级或课时身份已经改变。');
    const matches=reading.videos.filter(video=>video.resource_id===this.#resourceId);
    if(matches.length>1)throw new Error('COURSE_IDENTITY_MISMATCH: 公开资源身份不唯一。');
    if(matches.length===1&&this.#fingerprint&&matches[0]!.media?.source_fingerprint&&this.#fingerprint!==matches[0]!.media!.source_fingerprint)
      throw new Error('COURSE_IDENTITY_MISMATCH: 固定媒体身份已经改变。');
    const frame=this.#playerDocument.defaultView?.frameElement as HTMLIFrameElement|null;
    if(frame?.isConnected&&frame.contentDocument===this.#playerDocument){
      const actual=chaoxingFrameResourceId(frame,'video');
      if(actual&&actual!==this.#resourceId)throw new Error('COURSE_IDENTITY_MISMATCH: 播放器公开资源身份已经改变。');
    }
    if(matches.length!==1||!this.#video.isConnected||!frame||frame.contentDocument!==this.#playerDocument||chaoxingFrameResourceId(frame,'video')!==this.#resourceId||frame.ownerDocument!==this.document.querySelector<HTMLIFrameElement>('iframe#iframe')?.contentDocument)
      throw new Error('COURSE_OBSERVATION_STALE: 播放器页面已重建，请重新定位。');
    return reading;
  }

  pause(signal:AbortSignal):boolean {
    signal.throwIfAborted();this.snapshot();
    if(!this.#video.paused)this.#video.pause();
    signal.throwIfAborted();this.snapshot();
    if(!this.#video.paused)throw new Error('播放器暂停未确认。');
    return true;
  }

  mute(signal:AbortSignal,tabMutedConfirmed=false):void {
    signal.throwIfAborted();this.snapshot();
    if(tabMutedConfirmed||this.#video.muted||this.#video.volume===0)return;
    this.#video.muted=true;
    signal.throwIfAborted();this.snapshot();
    if(!this.#video.muted&&this.#video.volume!==0)throw new Error('播放器静音未确认。');
  }

  async play(signal:AbortSignal,tabMutedConfirmed=false):Promise<void> {
    signal.throwIfAborted();this.snapshot();this.mute(signal,tabMutedConfirmed);
    const video=this.#video;
    if(video.ended||!video.paused)return;
    const player=video.closest('.video-js,.prism-player,[data-video-player]')??video.parentElement;
    let button:HTMLElement|null=null;
    if(player)for(const selector of ['.vjs-big-play-button','.prism-big-play-btn','[data-video-play]','.vjs-play-control']){
      const found=Array.from(player.querySelectorAll<HTMLElement>(selector)).filter(element=>!isExplicitlyHidden(element)&&!element.hasAttribute('disabled')&&element.getAttribute('aria-disabled')!=='true');
      if(found.length>1)throw new Error('正常播放控件无法唯一确认。');
      if(found.length===1){button=found[0]!;break;}
    }
    let done=false,timer:number|undefined,poll:number|undefined;
    let resolve!:()=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    const cleanup=()=>{clearTimeout(timer);clearInterval(poll);video.removeEventListener('playing',check);video.removeEventListener('play',check);signal.removeEventListener('abort',abort);};
    const finish=(error?:unknown)=>{if(done)return;done=true;cleanup();if(error!==undefined)reject(error);else resolve();};
    const abort=()=>{video.pause();finish(signal.reason??new DOMException('Aborted','AbortError'));};
    const check=()=>{try{signal.throwIfAborted();this.snapshot();if(!video.paused||video.ended)finish();}catch(error){finish(error);}};
    signal.addEventListener('abort',abort,{once:true});video.addEventListener('playing',check);video.addEventListener('play',check);
    timer=this.document.defaultView!.setTimeout(()=>finish(new Error('正常播放启动未确认。')),60000);poll=this.document.defaultView!.setInterval(check,100);
    try{
      signal.throwIfAborted();this.snapshot();
      if(button)button.click();
      else {const pending=video.play();Promise.resolve(pending).then(()=>{if(signal.aborted)video.pause();else check();},error=>finish(error));}
      check();
    }catch(error){finish(error);}
    await promise;
  }

  hoverPoint(signal:AbortSignal):{x:number;y:number;captured_at:number} {
    signal.throwIfAborted();this.snapshot();
    const cardsFrame=this.document.querySelector<HTMLIFrameElement>('iframe#iframe')!;
    const videoFrame=this.#playerDocument.defaultView!.frameElement as HTMLIFrameElement;
    const media=this.#video.getBoundingClientRect();
    let projected={point:{x:media.x+media.width/2,y:media.y+media.height/2},region:{x:media.x,y:media.y,width:media.width,height:media.height}};
    for(const frame of [videoFrame,cardsFrame]){
      const rect=frame.getBoundingClientRect();projected=projectCourseFrame(projected.point,projected.region,{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},width:frame.offsetWidth,height:frame.offsetHeight,left:frame.clientLeft,top:frame.clientTop});
    }
    const left=Math.max(0,projected.region.x),top=Math.max(0,projected.region.y);
    const right=Math.min(this.document.defaultView!.innerWidth,projected.region.x+projected.region.width),bottom=Math.min(this.document.defaultView!.innerHeight,projected.region.y+projected.region.height);
    if(right<=left||bottom<=top)throw new Error('播放器位于视口之外。');
    return {x:(left+right)/2,y:(top+bottom)/2,captured_at:Date.now()};
  }
}
