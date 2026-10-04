// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { readZhidaoPlayer } from '../../src/web/zhidao-player';
import { ZhidaoPlayerControls, type ZhidaoNormalHover } from '../../src/web/zhidao-player-controls';

// Layout and media state are supplied by the local fixture. This does not play
// a real course or write a platform completion record.
function fixture() {
  const window=new Window({url:'https://ai-smart-course-student-pro.zhihuishu.com/learnPage/2100038049123758080/1983453416280805376/286605'});
  const document=window.document as unknown as Document;
  vi.spyOn(window.HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>new window.DOMRect(0,0,600,340));
  document.body.innerHTML=`<div class="videoNameBox able-player-container"><div class="video-js">
    <video class="vjs-tech" id="vjs_local_media"></video>
    <div class="controlsBar" style="display:none"><div class="pauseButton"><div class="bigPlayButton pointer"></div></div>
      <div class="volumeBox"><div class="volumeIcon">音量</div></div>
      <div class="speedBox"><span>X 1.0</span><div class="speedList" style="display:none">
        <div class="speedTab" rate="1.5">X 1.5</div><div class="speedTab" rate="1.25">X 1.25</div><div class="speedTab" rate="1">X 1.0</div>
      </div></div>
    </div></div></div>
    <div class="resources-section"><div class="resources-detail-title">必学资源</div><div class="resources-list">
      <div class="basic-info-video-card-container active"><div class="video-wrap"><div class="icon-box video"></div></div>
        <div class="video-info"><div>裁判员工作指南 <span>00:24:04</span></div><div class="finished-icon">12%</div></div>
      </div></div></div>`;
  const video=document.querySelector('video')!;
  const state={paused:true,ended:false,duration:1444.052993,currentTime:56.392737,readyState:4};
  for(const key of Object.keys(state) as Array<keyof typeof state>) Object.defineProperty(video,key,{configurable:true,get:()=>state[key]});
  video.volume=.5;video.muted=false;video.playbackRate=1;
  const root=document.querySelector<HTMLElement>('.video-js')!;
  const bar=document.querySelector<HTMLElement>('.controlsBar')!;
  const menu=document.querySelector<HTMLElement>('.speedList')!;
  root.addEventListener('mousemove',()=>{bar.style.display='block';});
  const toggle=vi.fn(()=>{state.paused=!state.paused;});
  const mute=vi.fn(()=>{video.volume=video.volume===0?.5:0;});
  document.querySelector('.pauseButton')!.addEventListener('click',toggle);
  document.querySelector('.volumeIcon')!.addEventListener('click',mute);
  const selected:number[]=[];
  document.querySelectorAll<HTMLElement>('.speedTab').forEach(option=>option.addEventListener('click',()=>{
    selected.push(Number(option.getAttribute('rate')));video.playbackRate=selected.at(-1)!;
  }));
  const hover:ZhidaoNormalHover=async()=>{menu.style.display='block';};
  const bind=(normalHover:ZhidaoNormalHover=hover)=>new ZhidaoPlayerControls(document,readZhidaoPlayer(document)!,normalHover);
  return {document,window,video,state,root,menu,toggle,mute,selected,bind};
}
const signal=()=>new AbortController().signal;
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

describe('observed Zhidao player controls',()=>{
  it('mutes before playback and does not toggle an already muted resource',async()=>{
    const f=fixture();const controls=f.bind();
    try { await controls.play(signal());await controls.mute(signal());
      expect(f.video.volume).toBe(0);expect(f.mute).toHaveBeenCalledOnce();expect(f.state.paused).toBe(false);
    } finally {controls.close();}
  });
  it('does not turn a site pause into playback while waiting for controls',async()=>{
    const f=fixture();f.state.paused=false;const controls=f.bind();
    f.root.addEventListener('mousemove',()=>{f.state.paused=true;});
    try { await controls.pause(signal());expect(f.toggle).not.toHaveBeenCalled();expect(f.state.paused).toBe(true); }
    finally {controls.close();}
  });
  it('does not unmute when the site has already muted during reveal',async()=>{
    const f=fixture();const controls=f.bind();f.root.addEventListener('mousemove',()=>{f.video.volume=0;});
    try { await controls.mute(signal());expect(f.mute).not.toHaveBeenCalled();expect(f.video.volume).toBe(0); }
    finally {controls.close();}
  });
  it('selects only the highest enabled normal menu rate and confirms actual rate',async()=>{
    const f=fixture();f.document.querySelector('[rate="1.5"]')!.setAttribute('aria-disabled','true');const controls=f.bind();
    try { await controls.highestAllowedSpeed(true,signal());expect(f.selected).toEqual([1.25]);
      await controls.play(signal());expect(f.video.playbackRate).toBe(1.25);expect(f.video.volume).toBe(0);
    } finally {controls.close();}
  });
  it('stops a cancelled hover before selecting speed',async()=>{
    const f=fixture();const controller=new AbortController();const controls=f.bind(async()=>{f.menu.style.display='block';controller.abort();});
    try { await expect(controls.highestAllowedSpeed(true,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(f.selected).toEqual([]); }
    finally {controls.close();}
  });
  it('rejects a resource replacement during hover even if the media DOM id remains',async()=>{
    const f=fixture();const controls=f.bind(async()=>{
      f.menu.style.display='block';f.document.querySelector('.video-info > div:not(.finished-icon)')!.textContent='另一个视频 00:24:04';
    });
    try { await expect(controls.highestAllowedSpeed(true,signal())).rejects.toThrow(/媒体已改变/);expect(f.selected).toEqual([]); }
    finally {controls.close();}
  });
  it('allows a displayed percentage update without changing the local resource binding',()=>{
    const f=fixture();const controls=f.bind();
    try {f.document.querySelector('.finished-icon')!.textContent='13%';expect(controls.snapshot().position).toBe(56.392737);}
    finally {controls.close();}
  });
  it('detects an external speed change during playback and still permits normal pause',async()=>{
    const f=fixture();const controls=f.bind();
    try{
      await controls.highestAllowedSpeed(true,signal());await controls.play(signal());
      f.video.playbackRate=2;
      expect(()=>controls.snapshot()).toThrow(/超出本次已确认/);
      await controls.pause(signal());expect(controls.snapshot().paused).toBe(true);
      await expect(controls.play(signal())).rejects.toThrow(/不在当前已确认/);
    }finally{controls.close();}
  });
  it('refuses external speed when speed is forbidden and never replays an ended video',async()=>{
    const f=fixture();const controls=f.bind();
    try { f.video.playbackRate=2;await expect(controls.highestAllowedSpeed(false,signal())).rejects.toThrow(/不是1x/);
      f.video.playbackRate=1;f.video.volume=0;f.state.ended=true;
      await expect(controls.play(signal())).rejects.toThrow(/视频已结束/);expect(f.toggle).not.toHaveBeenCalled();expect(f.selected).toEqual([]);
    } finally {controls.close();}
  });
  it('separates waiting/stalled state from paused state and invalidates a closed binding',()=>{
    const f=fixture();const controls=f.bind();
    f.video.dispatchEvent(new f.window.Event('waiting') as unknown as Event);expect(controls.snapshot().buffering).toBe(true);
    f.video.dispatchEvent(new f.window.Event('canplay') as unknown as Event);expect(controls.snapshot().buffering).toBe(false);
    controls.close();expect(()=>controls.snapshot()).toThrow(/停止播放器操作/);
  });
});
