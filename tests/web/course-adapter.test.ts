// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { ChaoxingCourseAdapter, ZhidaoCourseAdapter, coursePlatform } from '../../src/web/course-adapter';
import { inspectCoursePage } from '../../src/web/course-inspection';
import { DomWebAdapter } from '../../src/web/dom-adapter';

function page(url='https://mooc1.chaoxing.com/mycourse/studentstudy'){
  const window=new Window({url});const document=window.document as unknown as Document;
  document.body.innerHTML=`<main data-course-id="course" data-course-title="Local fixture" data-course-catalog data-catalog-complete="true" data-speed-allowed="true" data-visibility-required="false">
    <button data-course-action="directory">返回课程</button>
    <nav><div data-learning-task-id="v1" data-lesson-id="l1" data-chapter-id="c1" data-task-kind="video" data-task-status="in_progress">视频1<button data-course-action="enter">进入</button></div></nav>
    <section data-active-task-id="v1"><video data-video-id="media"></video><button data-course-action="play">播放</button><button data-course-action="pause">暂停</button><button data-course-action="mute">静音</button>
      <button data-playback-rate="1">1x</button><button data-playback-rate="2">2x</button><button data-playback-rate="3" disabled>3x</button>
    </section></main>`;
  return {window,document,adapter:new ChaoxingCourseAdapter(document)};
}
afterEach(()=>{document.body.innerHTML='';});
describe('course DOM capability boundaries',()=>{
  it('matches only exact platform domains, and refuses lookalike hosts',()=>{
    expect(coursePlatform('https://mooc1.chaoxing.com/mycourse')).toBe('chaoxing');expect(coursePlatform('https://study.zhihuishu.com/')).toBe('zhidao');
    expect(coursePlatform('https://zhihuishu.com.evil.test/')).toBeNull();expect(coursePlatform('http://mooc1.chaoxing.com/')).toBeNull();
  });
  it('requires evidenced structure and course identity instead of guessing from screenshot labels',()=>{
    const f=page();f.document.body.innerHTML='<h1>章节详情</h1><button>下一节</button>';expect(()=>f.adapter.catalog()).toThrow(/结构尚未验证/);
  });
  it('hard stops the closed course banner supplied in the user screenshots',()=>{
    const f=page();f.document.body.insertAdjacentHTML('afterbegin','<aside>本课程已结课，任务点、作业、章节测验将无法完成</aside>');
    expect(()=>f.adapter.catalog()).toThrow(/已结课/);expect(inspectCoursePage(f.document).closed).toBe(true);
  });
  it('keeps platform entries separate',()=>{
    const f=page('https://study.zhihuishu.com/course');expect(new ZhidaoCourseAdapter(f.document).catalog().platform).toBe('zhidao');
    expect(()=>f.adapter.catalog()).toThrow(/平台/);
  });
  it('clicks only enabled normal speed controls and verifies actual speed',async()=>{
    const f=page();const task=f.adapter.catalog().tasks[0]!;const media=f.document.querySelector('video')!;
    const clicked=vi.fn();f.document.querySelector<HTMLElement>('[data-playback-rate="2"]')!.addEventListener('click',()=>{clicked();media.playbackRate=2;});
    await f.adapter.speed('course',task);expect(clicked).toHaveBeenCalledOnce();expect(media.playbackRate).toBe(2);
    f.document.querySelector<HTMLElement>('[data-playback-rate="2"]')!.replaceWith(f.document.querySelector('[data-playback-rate="2"]')!.cloneNode(true));
    media.playbackRate=1;await expect(f.adapter.speed('course',task)).rejects.toThrow(/未确认/);
  });
  it('preserves normal speed when the course forbids speed changes',async()=>{
    const f=page();f.document.querySelector<HTMLElement>('main')!.dataset.speedAllowed='false';const task=f.adapter.catalog().tasks[0]!;
    const click=vi.fn();f.document.querySelectorAll('[data-playback-rate]').forEach(e=>e.addEventListener('click',click));await f.adapter.speed('course',task);expect(click).not.toHaveBeenCalled();
  });
  it('mutes through the normal control, verifies it, and does not toggle an already muted video',()=>{
    const f=page();const task=f.adapter.catalog().tasks[0]!;const media=f.document.querySelector('video')!;const click=vi.fn(()=>{media.muted=true;});
    f.document.querySelector('[data-course-action="mute"]')!.addEventListener('click',click);
    f.adapter.mute('course',task);f.adapter.mute('course',task);expect(click).toHaveBeenCalledOnce();expect(media.muted).toBe(true);
  });
  it('refuses to claim mute success when its control has no effect',()=>{
    const f=page();expect(()=>f.adapter.mute('course',f.adapter.catalog().tasks[0]!)).toThrow(/静音未确认/);
  });
  it('does not accept external speed-up when the course forbids speed changes',async()=>{
    const f=page();f.document.querySelector<HTMLElement>('main')!.dataset.speedAllowed='false';f.document.querySelector('video')!.playbackRate=8;
    await expect(f.adapter.speed('course',f.adapter.catalog().tasks[0]!)).rejects.toThrow(/关闭外部加速/);
  });
  it('uses only the normal required rewatch control and confirms actual backwards progress',()=>{
    const f=page();const task=f.adapter.catalog().tasks[0]!;const media=f.document.querySelector('video')!;media.currentTime=80;
    const active=f.document.querySelector<HTMLElement>('[data-active-task-id]')!;
    active.insertAdjacentHTML('beforeend','<section data-quiz-id="p" data-quiz-kind="video_popup" data-feedback="incorrect" data-requires-rewatch="true"><button data-course-action="rewatch">回看</button></section>');
    f.adapter.video('course',task);
    const popup=active.querySelector<HTMLElement>('[data-quiz-id]')!;
    popup.querySelector('button')!.addEventListener('click',()=>{popup.hidden=true;media.currentTime=20;});
    expect(f.adapter.rewatch('course',task)).toBe(true);expect(media.currentTime).toBe(20);
  });
  it('rejects task identity changes before any player click',()=>{
    const f=page();const task=f.adapter.catalog().tasks[0]!;f.document.querySelector<HTMLElement>('[data-learning-task-id]')!.dataset.lessonId='other';
    expect(()=>f.adapter.playback('course',task,false)).toThrow(/归属/);
  });
  it('exports only visible structure and public URL IDs, without credentials, input values or hidden answers',()=>{
    const f=page();f.document.body.insertAdjacentHTML('beforeend','<a href="https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123&enc=SECRET_TOKEN&cpi=PRIVATE_ID">课时</a><input type="password" value="PASSWORD_SECRET"><div class="question"><div hidden class="quiz">HIDDEN_ANSWER</div></div><a href="https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/123/THIS_IS_AN_OPAQUE_SECRET_PATH_TOKEN_TOO_LONG">测验</a>');
    const result=JSON.stringify(inspectCoursePage(f.document));expect(result).toContain('123');expect(result).not.toMatch(/SECRET_TOKEN|PRIVATE_ID|PASSWORD_SECRET|HIDDEN_ANSWER/);
    expect(result).not.toContain('THIS_IS_AN_OPAQUE_SECRET_PATH_TOKEN_TOO_LONG');
  });
  it('does not infer quiz submission from a completed directory task alone',()=>{
    const f=page();const row=f.document.querySelector<HTMLElement>('[data-learning-task-id]')!;
    row.dataset.taskKind='lesson_quiz';row.dataset.taskStatus='completed';
    const task=f.adapter.catalog().tasks[0]!;
    expect(f.adapter.verify('course',task)).toMatchObject({progress_recorded:true,completed:true,submission_confirmed:false});
    f.document.querySelector('[data-active-task-id]')!.insertAdjacentHTML('beforeend','<section data-quiz-id="q" data-quiz-kind="lesson_quiz" data-submission-confirmed="true"></section>');
    expect(f.adapter.verify('course',task).submission_confirmed).toBe(true);
  });
  it('blocks a stale quiz boundary when scoring or pass rules changed',()=>{
    const f=page();const task=f.adapter.catalog().tasks[0]!;
    f.document.querySelector('[data-active-task-id]')!.insertAdjacentHTML('beforeend','<section data-quiz-id="p" data-quiz-kind="video_popup" data-scored="false" data-retry-allowed="true" data-requires-rewatch="false" data-requires-pass="false" data-remaining-attempts="3"></section>');
    const boundary=f.adapter.boundary('course',task);
    const root=f.document.querySelector<HTMLElement>('[data-quiz-id]')!;
    root.dataset.requiresPass='true';
    expect(()=>f.adapter.assertBoundary('course',task,boundary)).toThrow(/规则/);
  });
  it('limits question controls, feedback and countdown to the current quiz boundary',async()=>{
    document.body.innerHTML='<div class="feedback">回答错误</div><div data-remaining-seconds="1"></div><button>Finish quiz</button><section id="scope"><fieldset><legend>Choose?</legend><label><input type="radio" name="q" value="a">Alpha</label><label><input type="radio" name="q" value="b">Beta</label><button>Submit</button></fieldset></section><button>Next question</button>';
    const scoped=new DomWebAdapter(document,undefined,document.querySelector<HTMLElement>('#scope')!);
    const observed=await scoped.observeSession('child',new AbortController().signal,'semantic_snapshot');
    expect(observed.questions[0]!.locator_map.targets.control_next).toBeUndefined();expect(observed.questions[0]!.locator_map.targets.control_submit_session).toBeUndefined();
    expect(observed.page_context?.visible_text).not.toContain('Finish quiz');
    expect(await scoped.readState(new AbortController().signal)).toMatchObject({completed:false,feedback:null,timer_remaining_seconds:null,has_next:false});
  });
});
