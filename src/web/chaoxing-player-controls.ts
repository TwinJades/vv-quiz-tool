import {readChaoxingLearningPage, type ChaoxingLearningReading} from './chaoxing-learning-page';
import {isExplicitlyHidden} from './dom-utils';

export class ChaoxingPlayerControls {
  readonly #video:HTMLVideoElement;
  readonly #playerDocument:Document;
  readonly #identity:string;
  readonly #index:number;
  readonly #count:number;

  constructor(private readonly document:Document,expected:ChaoxingLearningReading,index=0){
    this.#identity=JSON.stringify([expected.course_id,expected.class_id,expected.lesson_id]);
    this.#index=index;this.#count=expected.videos.length;
    const reading=readChaoxingLearningPage(document);
    if(!reading||JSON.stringify([reading.course_id,reading.class_id,reading.lesson_id])!==this.#identity||reading.videos.length!==this.#count||
      !Number.isInteger(index)||index<0||index>=this.#count)
      throw new Error('当前课程、课时或播放器身份失配。');
    const cards=document.querySelector<HTMLIFrameElement>('iframe#iframe')?.contentDocument;
    if(!cards)throw new Error('课时页面尚未就绪。');
    const frames=Array.from(cards.querySelectorAll<HTMLIFrameElement>('iframe')).filter(frame=>
      !isExplicitlyHidden(frame)&&new URL(frame.src,cards.location.href).pathname==='/ananas/modules/video/index.html');
    if(frames.length!==this.#count||!frames[index]!.contentDocument)throw new Error('播放器页面无法唯一确认。');
    this.#playerDocument=frames[index]!.contentDocument;
    const videos=Array.from(this.#playerDocument.querySelectorAll<HTMLVideoElement>('video.vjs-tech')).filter(video=>!isExplicitlyHidden(video));
    if(videos.length!==1)throw new Error('视频无法唯一确认。');
    this.#video=videos[0]!;
  }

  snapshot():ChaoxingLearningReading {
    const reading=readChaoxingLearningPage(this.document);
    if(!reading||JSON.stringify([reading.course_id,reading.class_id,reading.lesson_id])!==this.#identity||
      reading.videos.length!==this.#count||!this.#video.isConnected||this.#playerDocument.defaultView?.frameElement?.ownerDocument!==
      this.document.querySelector<HTMLIFrameElement>('iframe#iframe')?.contentDocument)
      throw new Error('课时或播放器已经改变，请重新观察页面。');
    return reading;
  }

  private button(selector:string):HTMLElement {
    const controls=Array.from(this.#playerDocument.querySelectorAll<HTMLElement>(selector)).filter(element=>
      !isExplicitlyHidden(element)&&!element.hasAttribute('disabled')&&element.getAttribute('aria-disabled')!=='true');
    if(controls.length!==1)throw new Error('正常播放器控件无法唯一确认。');
    return controls[0]!;
  }

  pause(signal:AbortSignal):boolean {
    signal.throwIfAborted();this.snapshot();
    if(!this.#video.paused){this.button('button.vjs-play-control').click();signal.throwIfAborted();this.snapshot();}
    if(!this.#video.paused)throw new Error('播放器暂停未确认。');
    return true;
  }

  mute(signal:AbortSignal,tabMutedConfirmed=false):void {
    signal.throwIfAborted();this.snapshot();
    if(this.#video.muted||this.#video.volume===0)return;
    const muteControls=Array.from(this.#playerDocument.querySelectorAll<HTMLElement>('button.vjs-mute-control')).filter(element=>!isExplicitlyHidden(element));
    if(!muteControls.length&&tabMutedConfirmed&&this.#video.paused&&Array.from(this.#playerDocument.querySelectorAll('button.vjs-big-play-button')).filter(element=>!isExplicitlyHidden(element)).length===1)return;
    this.button('button.vjs-mute-control').click();signal.throwIfAborted();this.snapshot();
    if(!this.#video.muted&&this.#video.volume!==0)throw new Error('播放器静音未确认。');
  }

  async play(signal:AbortSignal,backgroundHoverAt?:number,tabMutedConfirmed=false):Promise<void> {
    signal.throwIfAborted();const reading=this.snapshot();
    const backgroundInputConfirmed=backgroundHoverAt!==undefined&&Date.now()>=backgroundHoverAt&&Date.now()-backgroundHoverAt<=5000;
    if(!backgroundInputConfirmed)
      throw new Error('课程页面可见性规则、实际可见状态或播放器输入状态尚未确认。');
    if(!this.#video.muted&&this.#video.volume!==0){
      const muteControls=Array.from(this.#playerDocument.querySelectorAll<HTMLElement>('button.vjs-mute-control')).filter(element=>!isExplicitlyHidden(element));
      if(muteControls.length>1)throw new Error('静音控件不唯一。');
      if(muteControls.length===0){
        if(!tabMutedConfirmed)throw new Error('初始播放器尚未显示静音控件，需要先确认浏览器标签静音。');
        const initial=this.button('button.vjs-big-play-button');
        initial.click();
        const until=Date.now()+10000;
        while(Date.now()<until){
          signal.throwIfAborted();this.snapshot();
          if(Array.from(this.#playerDocument.querySelectorAll<HTMLElement>('button.vjs-mute-control')).some(element=>!isExplicitlyHidden(element)))break;
          await new Promise<void>(resolve=>setTimeout(resolve,100));
        }
        this.pause(signal);
      }
      this.mute(signal);
    }
    if(this.#video.ended||!this.#video.paused)return;
    const initial=Array.from(this.#playerDocument.querySelectorAll<HTMLElement>('button.vjs-big-play-button')).filter(element=>!isExplicitlyHidden(element));
    if(initial.length>1)throw new Error('初始播放控件无法唯一确认。');
    const button=initial.length===1?initial[0]!:this.button('button.vjs-play-control');
    signal.throwIfAborted();this.snapshot();button.click();
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      signal.throwIfAborted();this.snapshot();
      if(!this.#video.paused)return;
      await new Promise<void>(resolve=>setTimeout(resolve,100));
    }
    throw new Error('正常播放启动未确认。');
  }

  hoverPoint(signal:AbortSignal):{x:number;y:number;captured_at:number} {
    signal.throwIfAborted();this.snapshot();
    const cardsFrame=this.document.querySelector<HTMLIFrameElement>('iframe#iframe')!;
    const videoFrame=this.#playerDocument.defaultView!.frameElement as HTMLIFrameElement;
    const outer=cardsFrame.getBoundingClientRect(),inner=videoFrame.getBoundingClientRect(),media=this.#video.getBoundingClientRect();
    const x0=outer.left+cardsFrame.clientLeft+inner.left+videoFrame.clientLeft;
    const y0=outer.top+cardsFrame.clientTop+inner.top+videoFrame.clientTop;
    const left=Math.max(0,x0+media.left),top=Math.max(0,y0+media.top);
    const right=Math.min(this.document.defaultView!.innerWidth,x0+media.right),bottom=Math.min(this.document.defaultView!.innerHeight,y0+media.bottom);
    if(right<=left||bottom<=top)throw new Error('播放器位于视口之外，无法正常悬停。');
    return {x:(left+right)/2,y:(top+bottom)/2,captured_at:Date.now()};
  }
}
