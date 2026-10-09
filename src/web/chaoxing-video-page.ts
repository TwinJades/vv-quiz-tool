import {isExplicitlyHidden,normalizedText} from './dom-utils';
import {readChaoxingLearningPage} from './chaoxing-learning-page';
import {ChaoxingPlayerControls} from './chaoxing-player-controls';

export class ChaoxingVideoPage {
  #controls:ChaoxingPlayerControls|null=null;
  #selected=-1;
  constructor(private readonly document:Document,private readonly courseId:string,private readonly classId:string){}

  reading(){
    const reading=readChaoxingLearningPage(this.document);
    if(!reading||reading.course_id!==this.courseId||reading.class_id!==this.classId)throw new Error('课程或班级身份已经改变。');
    const text=normalizedText(this.document.body?.innerText);
    if(/本课程已结课|课程已结束|完成验证|拖动滑块|扫码登录/.test(text))throw new Error('课程关闭、登录失效或出现验证，停止自动播放。');
    return reading;
  }

  lessons(){
    this.reading();
    const rows=Array.from(this.document.querySelectorAll<HTMLElement>('.posCatalog_select[id^="cur"]')).filter(row=>!isExplicitlyHidden(row));
    const seen=new Set<string>();
    return rows.map(row=>{
      const id=/^cur(\d+)$/.exec(row.id)?.[1];
      const names=Array.from(row.querySelectorAll<HTMLElement>(':scope >.posCatalog_name')).filter(element=>!isExplicitlyHidden(element));
      const title=names.length===1?normalizedText(names[0]!.innerText):'';
      if(!id||!title||seen.has(id))throw new Error('课时目录身份或标题无法唯一确认。');
      seen.add(id);
      return {id,title,locked:row.hasAttribute('disabled')||row.getAttribute('aria-disabled')==='true'};
    });
  }

  selectLesson(id:string,title:string,signal:AbortSignal):void {
    signal.throwIfAborted();const reading=this.reading();
    const lesson=this.lessons().find(lesson=>lesson.id===id&&lesson.title===title);
    if(!lesson||lesson.locked)throw new Error('所选课时不在目录中或已锁定。');
    if(reading.lesson_id===id)return;
    this.pauseAll(signal);
    const rows=Array.from(this.document.querySelectorAll<HTMLElement>('.posCatalog_select[id^="cur"]')).filter(row=>row.id===`cur${id}`&&!isExplicitlyHidden(row));
    if(rows.length!==1)throw new Error('正常课时入口不唯一。');
    this.#controls=null;this.#selected=-1;
    rows[0]!.click();
  }

  selectVideo(index:number,signal?:AbortSignal):void {
    const reading=this.reading();
    if(signal&&this.#selected!==index)for(const video of reading.videos)if(video.index!==index)new ChaoxingPlayerControls(this.document,reading,video.index).pause(signal);
    if(this.#selected===index&&this.#controls){this.#controls.snapshot();return;}
    this.#controls=new ChaoxingPlayerControls(this.document,reading,index);this.#selected=index;
  }

  private controls():ChaoxingPlayerControls {
    if(!this.#controls||this.#selected<0)throw new Error('请先绑定当前视频。');
    this.#controls.snapshot();return this.#controls;
  }

  snapshot(){
    const reading=this.controls().snapshot();
    const video=reading.videos[this.#selected]!;
    const cards=this.document.querySelector<HTMLIFrameElement>('iframe#iframe')!.contentDocument!;
    const frame=Array.from(cards.querySelectorAll<HTMLIFrameElement>('iframe')).filter(frame=>!isExplicitlyHidden(frame)&&new URL(frame.src,cards.location.href).pathname==='/ananas/modules/video/index.html')[this.#selected]!;
    const doc=frame.contentDocument!;
    const choices=Array.from(doc.querySelectorAll<HTMLElement>('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]')).filter(element=>!isExplicitlyHidden(element));
    const dialogs=Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"],.vjs-modal-dialog')).filter(element=>!isExplicitlyHidden(element));
    return {course_id:reading.course_id,class_id:reading.class_id,lesson_id:reading.lesson_id,title:reading.lesson_title,
      index:this.#selected,video_count:reading.videos.length,observed_at:reading.observed_at,hidden:this.document.hidden,
      focused:this.document.hasFocus(),task_recorded:video.task_recorded,media:video.media,
      blocked:choices.length>0||dialogs.length>0,visible_feedback:normalizedText(doc.body?.innerText).slice(0,500)};
  }

  hoverPoint(signal:AbortSignal){return this.controls().hoverPoint(signal);}
  async play(signal:AbortSignal,backgroundHoverAt:number,tabMutedConfirmed:boolean){await this.controls().play(signal,backgroundHoverAt,tabMutedConfirmed);}
  mute(signal:AbortSignal,tabMutedConfirmed=false){this.controls().mute(signal,tabMutedConfirmed);}
  pause(signal:AbortSignal){return this.controls().pause(signal);}
  pauseAll(signal:AbortSignal):void {
    const reading=this.reading();
    for(let index=0;index<reading.videos.length;index++)new ChaoxingPlayerControls(this.document,reading,index).pause(signal);
  }
}
