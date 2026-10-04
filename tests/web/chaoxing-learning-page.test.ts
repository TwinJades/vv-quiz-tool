// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { readChaoxingLearningPage } from '../../src/web/chaoxing-learning-page';
import { ChaoxingCourseAdapter } from '../../src/web/course-adapter';

function fixture(){
  const top=new Window({url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&chapterId=22&clazzid=33',settings:{disableIframePageLoading:true}});
  const cards=new Window({url:'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=11&knowledgeid=22&clazzid=33',settings:{disableIframePageLoading:true}});
  const player=new Window({url:'https://mooc1.chaoxing.com/ananas/modules/video/index.html'});
  const module=new Window({url:'https://mooc1.chaoxing.com/ananas/modules/work/index.html',settings:{disableIframePageLoading:true}});
  const work=new Window({url:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=11&knowledgeid=22'});
  top.document.body.innerHTML='<div id="cur22"><span class="posCatalog_name">2.2 当前课时</span></div><iframe id="iframe"></iframe>';
  cards.document.body.innerHTML='<p>观看时长需 ≥ 总时长的 100% (未完成任务点前, 当前视频不可拖拽、观看时不可离开或将页面最小化)</p><div class="ans-attach-ct"><div class="ans-job-icon ans-job-video ans-job-icon-clear" aria-label="任务点已完成"></div><iframe class="ans-attach-online ans-insertvideo-online"></iframe></div><div class="ans-attach-ct"><div class="ans-job-icon" aria-label="任务点未完成"></div><iframe></iframe></div>';
  player.document.body.innerHTML='<video class="vjs-tech"></video>';
  module.document.body.innerHTML='<iframe id="frame_content"></iframe>';
  work.document.body.innerHTML='<h1>章节测验</h1><p>待完成</p><p class="font-cxsecret">乱码题干</p>';
  const bind=(frame:import('happy-dom').Element,child:Window)=>{frame.setAttribute('src',child.location.href);Object.defineProperty(frame,'contentDocument',{configurable:true,value:child.document});};
  bind(top.document.querySelector('iframe')!,cards);
  const inner=cards.document.querySelectorAll('iframe');bind(inner[0]!,player);bind(inner[1]!,module);bind(module.document.querySelector('iframe')!,work);
  return {document:top.document as unknown as Document,top,cards,player,module,work};
}
describe('observed Chaoxing current lesson',()=>{
  it('does not mistake ans-job-icon-clear for completion on the actual pending layout',()=>{
    const f=fixture();const marker=f.cards.document.querySelector('.ans-job-video')!;
    marker.setAttribute('aria-label','任务点未完成');expect(readChaoxingLearningPage(f.document)!.videos[0]!.task_recorded).toBe(false);
    marker.removeAttribute('aria-label');expect(readChaoxingLearningPage(f.document)!.videos[0]!.task_recorded).toBeNull();
  });
  it('keeps a recorded video separate from ended and pending quiz submission',()=>{
    const f=fixture();const r=readChaoxingLearningPage(f.document)!;
    expect(r).toMatchObject({course_id:'11',lesson_id:'22',class_id:'33',visibility_required:true,seek_forbidden:true,required_watch_percent:100});
    expect(r.videos[0]).toMatchObject({task_recorded:true,media:{ended:false,paused:true}});
    expect(r.quizzes[0]).toMatchObject({task_recorded:false,status:'pending',visual_text_required:true,submission_confirmed:false});
  });
  it('rejects a cards frame that belongs to another lesson',()=>{
    const f=fixture();f.cards.location.href='https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=11&knowledgeid=99&clazzid=33';
    const r=readChaoxingLearningPage(f.document)!;expect(r.videos).toEqual([]);expect(r.diagnostics.join()).toContain('失配');
  });
  it('does not accept duplicated public course parameters or lookalike domains',()=>{
    const f=fixture();f.top.location.href+='&courseId=11';expect(readChaoxingLearningPage(f.document)).toBeNull();
    f.top.location.href='https://mooc1.chaoxing.com.evil.test/mycourse/studentstudy?courseId=11&chapterId=22&clazzid=33';expect(readChaoxingLearningPage(f.document)).toBeNull();
  });
  it('does not attach a redirected quiz from another course',()=>{
    const f=fixture();f.work.location.href='https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=99&knowledgeid=22';
    expect(readChaoxingLearningPage(f.document)!.quizzes[0]).toMatchObject({status:'unknown',visual_text_required:false,submission_confirmed:false});
  });
  it('keeps missing video and ambiguous job markers unknown',()=>{
    const f=fixture();f.player.document.body.innerHTML='';f.cards.document.querySelector('.ans-attach-ct')!.insertAdjacentHTML('afterbegin','<div class="ans-job-icon"></div>');
    expect(readChaoxingLearningPage(f.document)!.videos[0]).toEqual({index:0,task_recorded:null,media:null});
  });
  it('previews the current lesson without promoting it to an executable full catalog',()=>{
    const f=fixture();const catalog=new ChaoxingCourseAdapter(f.document).catalog();
    expect(catalog).toMatchObject({complete:false,tasks:[],rules:{visibility_required:true,speed_allowed:null}});
    expect(catalog.diagnostics.join()).toContain('乱码');
  });
});
