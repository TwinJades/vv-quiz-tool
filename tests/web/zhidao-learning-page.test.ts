// @vitest-environment happy-dom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {Window} from 'happy-dom';
import {ZhidaoLearningPage} from '../../src/web/zhidao-learning-page';
import {CoursePageLease} from '../../src/web/course-adapter';
function fixture(progress:string){
  const w=new Window({url:'https://ai-smart-course-student-pro.zhihuishu.com/learnPage/101/301/201'});
  vi.spyOn(w.HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>new w.DOMRect(0,0,600,340));
  const document=w.document as unknown as Document;
  document.body.innerHTML=`<div class="videoNameBox able-player-container"><div class="video-js"><video id="local_media" class="vjs-tech"></video></div></div>
  <div class="resources-section"><div class="resources-detail-title">必学资源</div><div class="resources-list">
    <div class="basic-info-video-card-container active"><div class="video-wrap"><div class="icon-box video"></div></div>
      <div class="video-info"><div><h5>Video</h5><div>00:13:33</div></div><div class="finished-icon"><svg></svg><span>${progress}</span></div></div></div>
    <div class="basic-info-video-card-container"><div class="video-wrap"><div class="icon-box ppt"></div></div><div class="video-info"><div>Slides.pptx</div><div class="finished-icon">已完成</div></div></div>
  </div></div><aside>知识点最高掌握度：100%</aside>`;
  return {document,window:w,page:new ZhidaoLearningPage(document)};
}
afterEach(()=>vi.restoreAllMocks());
describe('actual Zhidao resource completion labels',()=>{
  it('accepts the completed label on the bound video card without inventing a media-ended event',async()=>{
    const f=fixture('已完成'),catalog=f.page.catalog(),video=catalog.tasks.find(t=>t.kind==='video')!;
    expect(video.status).toBe('completed');expect(catalog.tasks.find(t=>t.kind==='excluded')?.status).toBe('unknown');
    const result=await f.page.execute({operation:'verify',course_id:'101',task:video},new AbortController().signal);
    expect(result).toMatchObject({progress_recorded:true,completed:true,media_ended:false,submission_confirmed:false});
  });
  it('does not accept mastery, generic text or out-of-range percentages as video progress',()=>{
    for(const raw of ['掌握度100%','完成','101%',''])expect(()=>fixture(raw).page.catalog()).toThrow(/公开学习进度/);
    expect(fixture('36%').page.catalog().tasks.find(t=>t.kind==='video')?.status).toBe('in_progress');
  });
  it('previews a new point independently while retaining the old session identity boundary',()=>{
    const f=fixture('36%'),lease=new CoursePageLease(f.document),first=lease.forSession('zhidao','first');first.catalog();
    f.window.history.replaceState(null,'','/learnPage/101/302/201');
    expect(lease.preview('zhidao').catalog().tasks[0]?.lesson_id).toBe('302');
    expect(()=>lease.forSession('zhidao','first').catalog()).toThrow(/已改变/);
    expect(lease.forSession('zhidao','second').catalog().tasks[0]?.lesson_id).toBe('302');
  });
});
