import {describe,expect,it,vi} from 'vitest';
import {Window} from 'happy-dom';
import {ChaoxingVideoPage} from '../../src/web/chaoxing-video-page';
import {readChaoxingLearningPage} from '../../src/web/chaoxing-learning-page';
import {LiveCoursePage} from '../../src/web/live-course-page';

function fixture(){
  const root=new Window({url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&chapterId=22&clazzid=33'});
  const cards=new Window({url:'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=11&knowledgeid=22&clazzid=33'});
  const player=new Window({url:'https://mooc1.chaoxing.com/ananas/modules/video/index.html?videoid=44'});
  const document=root.document as unknown as Document,cardDoc=cards.document as unknown as Document,playerDoc=player.document as unknown as Document;
  document.body.innerHTML='<div class="posCatalog_select posCatalog_active" id="cur22"><span class="posCatalog_name">课时</span></div><iframe id="iframe" src="/mooc-ans/knowledge/cards?courseid=11&knowledgeid=22&clazzid=33"></iframe>';
  cardDoc.body.innerHTML='<div class="ans-attach-ct"><iframe src="/ananas/modules/video/index.html?videoid=44"></iframe></div>';
  playerDoc.body.innerHTML='<div class="video-js"><video class="vjs-tech"></video></div>';
  const outer=document.querySelector('iframe')!,inner=cardDoc.querySelector('iframe')!;
  Object.defineProperty(outer,'contentDocument',{configurable:true,value:cardDoc});
  Object.defineProperty(inner,'contentDocument',{configurable:true,value:playerDoc});
  Object.defineProperty(player,'frameElement',{configurable:true,value:inner});
  const video=playerDoc.querySelector('video')!;
  let paused=true;
  Object.defineProperty(video,'paused',{configurable:true,get:()=>paused});
  const pause=vi.fn(()=>{paused=true;});
  const play=vi.fn(()=>{paused=false;video.dispatchEvent(new player.Event('playing') as unknown as Event);return Promise.resolve();});
  Object.defineProperty(video,'pause',{configurable:true,value:pause});Object.defineProperty(video,'play',{configurable:true,value:play});
  const page=new ChaoxingVideoPage(document,'11','33');
  return {document,cardDoc,playerDoc,video,page,play,pause,setPaused:(value:boolean)=>{paused=value;}};
}

describe('学习通真实播放器控制',()=>{
  it('无播放按钮与悬停时调用真实 media.play',async()=>{
    const f=fixture();f.page.selectVideo('video:44');await f.page.play(new AbortController().signal,true);
    expect(f.play).toHaveBeenCalledOnce();expect(f.video.paused).toBe(false);
  });
  it('优先点击唯一正常播放按钮',async()=>{
    const f=fixture(),button=f.playerDoc.createElement('button');button.className='vjs-big-play-button';f.video.parentElement!.append(button);
    const click=vi.fn(()=>{f.setPaused(false);f.video.dispatchEvent(new f.playerDoc.defaultView!.Event('playing'));});button.addEventListener('click',click);
    f.page.selectVideo('video:44');await f.page.play(new AbortController().signal,true);
    expect(click).toHaveBeenCalledOnce();expect(f.play).not.toHaveBeenCalled();
  });
  it('取消后暂停本次媒体且迟到的 play promise 再次暂停',async()=>{
    const f=fixture(),controller=new AbortController();let complete!:()=>void;
    Object.defineProperty(f.video,'play',{configurable:true,value:()=>new Promise<void>(resolve=>{complete=()=>{f.setPaused(false);resolve();};})});
    f.page.selectVideo('video:44');const pending=f.page.play(controller.signal,true);controller.abort();
    await expect(pending).rejects.toBeDefined();complete();await Promise.resolve();expect(f.video.paused).toBe(true);expect(f.pause).toHaveBeenCalledTimes(2);
  });
  it('同资源视频重建可重绑定，不同资源不能误操作',()=>{
    const f=fixture();f.page.selectVideo('video:44');const replacement=f.video.cloneNode() as HTMLVideoElement;f.video.replaceWith(replacement);
    expect(()=>f.page.selectVideo('video:44')).not.toThrow();
    f.cardDoc.querySelector('iframe')!.src='/ananas/modules/video/index.html?videoid=55';
    expect(()=>f.page.selectVideo('video:44')).toThrow();expect(f.play).not.toHaveBeenCalled();
  });
  it('未知任务状态不算平台完成',()=>{
    const f=fixture();expect(readChaoxingLearningPage(f.document)?.videos[0]?.task_recorded).toBeNull();
  });
});

describe('学习通实际课程执行边界',()=>{
  it.each(['children','enter'] as const)('%s 等待目标课时目录激活，即使 URL 已匹配',async operation=>{
    vi.useFakeTimers();
    try{
      const f=fixture(),page=new LiveCoursePage(f.document),signal=new AbortController().signal;
      Object.defineProperty(f.cardDoc,'readyState',{configurable:true,value:'complete'});
      const lesson=page.catalog().tasks[0]!,row=f.document.querySelector<HTMLElement>('#cur22')!;
      const click=vi.fn();row.querySelector('.posCatalog_name')!.addEventListener('click',click);
      row.classList.remove('posCatalog_active');
      let settled=false;
      const pending=page.execute({operation,course_id:'11',task:lesson},signal).then(result=>{settled=true;return result;});
      await vi.advanceTimersByTimeAsync(400);
      expect(settled).toBe(false);expect(click).not.toHaveBeenCalled();
      row.classList.add('posCatalog_active');
      await vi.advanceTimersByTimeAsync(200);
      const result=await pending;
      if(operation==='children')expect(result).toEqual(expect.arrayContaining([expect.objectContaining({kind:'video',resource_id:'video:44'})]));
      else expect(result).toBe(true);
      expect(click).not.toHaveBeenCalled();
    }finally{vi.useRealTimers();}
  });
  it('同一资源中有两个实际视频时不会选第一个视频的弹题',async()=>{
    const f=fixture(),page=new LiveCoursePage(f.document),signal=new AbortController().signal;
    Object.defineProperty(f.cardDoc,'readyState',{configurable:true,value:'complete'});
    const lesson=page.catalog().tasks[0]!;
    const children=await page.children(lesson,signal),task=children.find(child=>child.kind==='video')!;
    const popup=f.playerDoc.createElement('div');popup.className='ans-videoquiz';popup.innerHTML='<div class="tkItem"><input type="radio" name="answer"></div>';
    f.video.parentElement!.append(popup);
    const second=f.playerDoc.createElement('video');second.className='vjs-tech';f.video.parentElement!.append(second);
    await expect(page.execute({operation:'quiz',course_id:'11',task},signal)).rejects.toBeInstanceOf(Error);
    expect(f.play).not.toHaveBeenCalled();
  });
  it('普通占位视频不改变实际播放器弹题归属',async()=>{
    const f=fixture(),page=new LiveCoursePage(f.document),signal=new AbortController().signal;
    Object.defineProperty(f.cardDoc,'readyState',{configurable:true,value:'complete'});
    const lesson=page.catalog().tasks[0]!,children=await page.children(lesson,signal),task=children.find(child=>child.kind==='video')!;
    f.playerDoc.body.prepend(f.playerDoc.createElement('video'));
    const popup=f.playerDoc.createElement('div');popup.className='ans-videoquiz';popup.innerHTML='<div class="tkItem" data-questionid="q1"><label><input type="radio" name="answer">选项</label></div>';
    f.video.parentElement!.append(popup);
    await expect(page.execute({operation:'quiz',course_id:'11',task},signal)).resolves.toMatchObject({kind:'video_popup',task_id:task.id});
  });
});
