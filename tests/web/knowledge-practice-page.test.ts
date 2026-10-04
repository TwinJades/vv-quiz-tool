// @vitest-environment happy-dom
import {describe,it,expect,vi} from 'vitest';
import {Window} from 'happy-dom';
import {KnowledgePracticePage} from '../../src/web/knowledge-practice-page';
const point={id:'301',title:'Local point',order:0};
const request={operation:'state' as const,course_id:'101',context_id:'201',point};
function fixture(path='/masteryHistory/101/201/301'){
  const w=new Window({url:'https://ai-smart-course-student-pro.zhihuishu.com'+path});
  const d=w.document as unknown as Document;
  d.body.innerHTML='<div class="mastery-history-container"><div class="mastery-header"><div class="title-content">Local point</div><div class="mastery-title"><button class="improve-btn">去提升 →</button></div></div><div>暂无数据</div></div>';
  return {d,page:new KnowledgePracticePage(d)};
}
describe('knowledge practice navigation boundaries',()=>{
  it('waits for the document body after a normal refresh without navigating',()=>{
    const {d,page}=fixture('/learnPage/101/301/201');d.body.remove();
    expect(page.execute(request,new AbortController().signal)).toMatchObject({navigation:{ready:false},has_video:false,no_practice:false,history_empty:false});
    expect(()=>page.execute({...request,operation:'directory'},new AbortController().signal)).toThrow(/尚未就绪/);
  });
  it('waits during a normal directory return before cards render',()=>{
    const {d,page}=fixture('/singleCourse/knowledgeStudy/101/201');d.body.innerHTML='<div class="knowledge"><div class="knowledge-content"></div></div>';
    expect(page.execute(request,new AbortController().signal)).toMatchObject({navigation:{stage:'directory',ready:false}});
    expect(()=>page.execute({...request,operation:'enter'},new AbortController().signal)).toThrow(/尚未就绪/);
  });
  it('permits normal practice entry on the observed PPT layout without marking the document complete',()=>{
    const {d,page}=fixture('/learnPage/101/301/201');d.body.innerHTML='<div class="preview-content"><div class="ppt-preview-box"><div class="ppt-preview-container"></div></div></div><div class="resources-section"><div class="resources-list"><div class="basic-info-video-card-container active"><div class="page-num">105页</div><h5 class="video-title">Local.pptx</h5></div></div></div><button class="simplified-mastery__action">去提升</button>';
    const heading=d.createElement('div');heading.className='middle-section';heading.innerHTML='<div class="header-section"><div class="point-title-text">Local point</div></div>';d.body.prepend(heading);
    expect(page.execute(request,new AbortController().signal)).toMatchObject({navigation:{ready:true},has_video:false,paused:null,no_practice:false});
    const click=vi.spyOn(d.querySelector<HTMLElement>('.simplified-mastery__action')!,'click');page.execute({...request,operation:'improve'},new AbortController().signal);expect(click).toHaveBeenCalledOnce();
    d.querySelector('.video-title')!.textContent='Unknown resource';expect(()=>page.execute({...request,operation:'improve'},new AbortController().signal)).toThrow(/尚未就绪/);
  });
  it('permits only practice navigation for an identified unmounted video, and blocks stale learner titles',()=>{
    const {d,page}=fixture('/learnPage/101/301/201');d.body.innerHTML='<div class="middle-section"><div class="header-section"><div class="point-title-text">Local point</div></div></div><div class="preview-content"><div class="video-player-wrapper"><div resourceid="12345"><div class="videoNameBox"></div></div></div></div><div class="resources-section"><div class="resources-list"><div class="basic-info-video-card-container active"><div class="icon-box video"></div><div class="page-num">00:21:22</div><div class="video-title">A video</div></div></div></div><button class="simplified-mastery__action">去提升</button>';
    expect(page.execute(request,new AbortController().signal)).toMatchObject({navigation:{ready:true},has_video:false,paused:null});
    d.querySelector('.point-title-text')!.textContent='Stale point';expect(()=>page.execute({...request,operation:'improve'},new AbortController().signal)).toThrow(/尚未就绪/);
  });
  it('permits navigation from a paused source-free player stub but rejects loaded or playing media',()=>{
    const {d,page}=fixture('/learnPage/101/301/201');
    d.body.innerHTML='<div class="middle-section"><div class="header-section"><div class="point-title-text">Local point</div></div></div><div class="preview-content"><div class="video-player-wrapper"><div resourceid="12345"><div class="videoNameBox"><video class="video-js"></video></div></div></div></div><div class="resources-section"><div class="resources-list"><div class="basic-info-video-card-container active"><div class="icon-box video"></div><div class="page-num">00:17:04</div><div class="video-title">Video</div></div></div></div><button class="simplified-mastery__action">去提升</button>';
    const media=d.querySelector('video')!;let paused=true;
    Object.defineProperty(media,'paused',{configurable:true,get:()=>paused});Object.defineProperty(media,'readyState',{configurable:true,value:0});
    expect(page.execute(request,new AbortController().signal)).toMatchObject({navigation:{ready:true},has_video:false});
    paused=false;expect(()=>page.execute({...request,operation:'improve'},new AbortController().signal)).toThrow(/尚未就绪/);
    paused=true;media.setAttribute('src','https://example.test/video.mp4');expect(()=>page.execute({...request,operation:'improve'},new AbortController().signal)).toThrow(/尚未就绪/);
  });
  it('requires rendered empty history and the matching title before another improve',()=>{
    const {d,page}=fixture();expect(page.execute(request,new AbortController().signal)).toMatchObject({history_empty:true,history_count:0});
    const control=d.querySelector<HTMLElement>('.improve-btn')!,click=vi.spyOn(control,'click');
    page.execute({...request,operation:'improve'},new AbortController().signal);expect(click).toHaveBeenCalledOnce();
    d.querySelector('.title-content')!.textContent='Different point';
    expect(()=>page.execute({...request,operation:'improve'},new AbortController().signal)).toThrow(/尚未就绪/);
    expect(click).toHaveBeenCalledOnce();
  });
  it('does not infer a new attempt from old rendered history',()=>{
    const {d,page}=fixture();const row=d.createElement('div');row.className='history-item';row.innerText='An existing attempt';d.querySelector('.mastery-history-container')!.append(row);
    expect(page.execute(request,new AbortController().signal)).toMatchObject({history_empty:false,history_count:1});
  });
  it('rejects a different point or cancelled action before any click',()=>{
    const {d,page}=fixture('/masteryHistory/101/201/302');const click=vi.spyOn(d.querySelector<HTMLElement>('.improve-btn')!,'click');
    expect(()=>page.execute({...request,operation:'improve'},new AbortController().signal)).toThrow(/范围/);
    const controller=new AbortController();controller.abort();expect(()=>page.execute({...request,operation:'improve'},controller.signal)).toThrow();expect(click).not.toHaveBeenCalled();
  });
});
