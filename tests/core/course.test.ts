import { describe, expect, it, vi } from 'vitest';
import { CourseOrchestrator, VideoEstimate, courseModels, nextCourseTask, validateCourseScope } from '../../src/core/course';
import type { CourseAdapter, CourseCatalog, CourseQuizRunner, CourseQuizResult, LearningTask, VideoSnapshot } from '../../src/core/course';
import { ModelCallBudget } from '../../src/core/call-budget';

const task=(id:string,order:number,kind:LearningTask['kind']='video',status:LearningTask['status']='not_started',lesson=id):LearningTask=>({id,order,kind,status,title:id,lesson_id:lesson,chapter_id:'chapter',prerequisites:[]});
const catalog=(tasks:LearningTask[]):CourseCatalog=>({course_id:'course',platform:'chaoxing',title:'local course',revision:'1',complete:true,tasks,rules:{visibility_required:false,speed_allowed:true},diagnostics:[]});
const video=(overrides:Partial<VideoSnapshot>={}):VideoSnapshot=>({course_id:'course',task_id:'v1',video_id:'media',observed_at:0,duration:100,position:20,rate:2,paused:false,buffering:false,seeking:false,ended:false,visible:true,popup:null,...overrides});

function fixture(){
  let now=0;
  const list=catalog([task('v1',0,'video','in_progress','l1'),{...task('q1',1,'lesson_quiz','not_started','l1'),prerequisites:['v1']},task('v2',2)]);
  const entered:string[]=[];
  const submitState=new Set<string>();
  const adapter:CourseAdapter={
    catalog:vi.fn(async()=>structuredClone(list)),
    enter:vi.fn(async t=>{entered.push(t.id);}),
    video:vi.fn(async t=>video({task_id:t.id,observed_at:now,position:100,ended:true})),
    highestAllowedSpeed:vi.fn(async()=>{}),mute:vi.fn(async()=>{}),play:vi.fn(async()=>{}),pauseVideo:vi.fn(async()=>true),
    verify:vi.fn(async t=>{list.tasks.find(x=>x.id===t.id)!.status='completed';return {task_id:t.id,media_ended:t.kind==='video',progress_recorded:true,submission_confirmed:submitState.has(t.id),completed:submitState.has(t.id)||t.kind==='video',passed:null,pending_grading:false,visible_score:null};}),
    returnToCatalog:vi.fn(async()=>{}),
    quiz:vi.fn(async t=>({id:'same-id',task_id:t.id,course_id:'course',kind:'lesson_quiz' as const,rules:{retry_allowed:true,requires_rewatch:false,requires_pass:false,remaining_attempts:3,scored:true}})),
  };
  const result:CourseQuizResult={status:'completed',reason:null,submission_confirmed:true,passed:null,visible_score:'75',retried:0};
  const budget=new ModelCallBudget(3);
  const runner:CourseQuizRunner={run:vi.fn(async b=>{budget.consume();submitState.add(b.task_id);return result;}),pause:vi.fn()};
  const run=new CourseOrchestrator(adapter,runner,{session_id:'parent',catalog:list,scope:list.tasks.map(t=>t.id),strategy:'unattended',provider_profile_id:'p',model_id:'gemini-3.8-flash',budget,now:()=>now,wait:async ms=>{now+=ms;}});
  return {adapter,runner,run,list,entered,budget,result,get now(){return now;}};
}

describe('course scheduling and restricted models',()=>{
  it('prioritizes started lessons, retains their pending quiz, and respects prerequisites',()=>{
    const list=catalog([task('first',0),task('started',2,'video','in_progress','l2'),task('done',3,'video','completed','l3'),task('quiz',4,'lesson_quiz','not_started','l3')]);
    expect(nextCourseTask(list,list.tasks.map(t=>t.id))?.id).toBe('started');
    list.tasks[1]!.status='completed';expect(nextCourseTask(list,['first','done','quiz'])?.id).toBe('quiz');
    list.tasks[3]!.prerequisites=['first'];expect(()=>nextCourseTask(list,['quiz'])).toThrow(/前置/);
  });
  it('does not expand scope to fulfill prerequisites or consume excluded tasks',()=>{
    const list=catalog([task('outside',0),{...task('quiz',1,'chapter_quiz'),prerequisites:['outside']},task('exam',2,'excluded')]);
    expect(()=>nextCourseTask(list,['quiz'])).toThrow(/前置/);
    expect(()=>validateCourseScope(list,['exam'])).toThrow(/不支持/);
    expect(()=>validateCourseScope(list,[])).toThrow(/范围/);
    expect(()=>validateCourseScope({...list,complete:false},['outside'])).toThrow(/不完整/);
  });
  it('accepts only the authorized configured model families in priority order',()=>{
    expect(courseModels(['gpt-6','gemini-3.1-pro','gemini-3.8-flash-high','gemini-3.7-flash','gemini-3.8-flash-high','gemini-3.80-flash','gemini-3.8-flashfake'])).toEqual(['gemini-3.8-flash-high','gemini-3.7-flash','gemini-3.1-pro']);
  });
});

describe('playback estimates',()=>{
  it('uses actual position and rate, freezes without a wall-clock decrement, and grows after replay',()=>{
    const estimate=new VideoEstimate();estimate.observe(video(),0);expect(estimate.seconds).toBe(40);
    estimate.observe(video({observed_at:1000,position:30,paused:true}),1000);expect(estimate.seconds).toBe(40);expect(estimate.frozen).toBe(true);
    estimate.observe(video({observed_at:2000,position:40,buffering:true}),2000);expect(estimate.seconds).toBe(40);
    estimate.observe(video({observed_at:3000,position:10,seeking:true}),3000);expect(estimate.seconds).toBe(40);
    estimate.observe(video({observed_at:4000,position:10,rate:1}),4000);expect(estimate.seconds).toBe(90);
    estimate.observe(video({observed_at:5000,position:20,rate:2}),5000);expect(estimate.seconds).toBe(40);
  });
  it.each([video({duration:null}),video({rate:0}),video({position:200}),video({observed_at:-6000})])('does not estimate from invalid or stale samples',sample=>{
    const estimate=new VideoEstimate();estimate.observe(sample,0);expect(estimate.seconds).toBeNull();expect(estimate.frozen).toBe(true);
  });
});

describe('course flow and independent completion checks',()=>{
  it('runs videos, verifies platform records, submits linked quiz once, and completes the explicit range',async()=>{
    const f=fixture();await f.run.run();expect(f.entered).toEqual(['v1','q1','v2']);expect(f.runner.run).toHaveBeenCalledTimes(1);
    expect(f.run.snapshot()).toMatchObject({state:'COMPLETE',model_calls:{used:1,limit:3},progress:{total:3,answered:3},course:{phase:'RANGE_COMPLETE',results:[{kind:'lesson_quiz',result:{visible_score:'75'}}]}});
    expect(f.adapter.mute).toHaveBeenCalledTimes(2);
  });
  it('does not start playback if mute could not be verified',async()=>{
    const f=fixture();f.adapter.mute=vi.fn(async()=>{throw new Error('静音未确认');});await f.run.run();
    expect(f.run.snapshot().notice).toContain('静音未确认');expect(f.adapter.play).not.toHaveBeenCalled();expect(f.adapter.highestAllowedSpeed).not.toHaveBeenCalled();
  });
  it('does not enter a quiz or the next lesson when video completion was not recorded',async()=>{
    const f=fixture();f.adapter.verify=vi.fn(async t=>({task_id:t.id,media_ended:true,progress_recorded:false,submission_confirmed:false,completed:false,passed:null,pending_grading:false,visible_score:null}));
    await f.run.run();expect(f.run.snapshot()).toMatchObject({state:'PAUSED',course:{video:{ended:true,progress_recorded:false}}});
    expect(f.entered).toEqual(['v1','v1']);expect(f.runner.run).not.toHaveBeenCalled();expect(f.adapter.returnToCatalog).toHaveBeenCalledTimes(1);
  });
  it('does not consider estimate zero to be video ended',async()=>{
    const f=fixture();f.adapter.video=vi.fn(async()=>video({observed_at:f.now,position:100,ended:false}));await f.run.run();
    expect(f.run.snapshot()).toMatchObject({state:'PAUSED',course:{estimate_seconds:0,video:{ended:false}}});expect(f.adapter.verify).not.toHaveBeenCalled();expect(f.entered).toEqual(['v1']);
  });
  it('does not accept another task progress as the current video completion',async()=>{
    const f=fixture();f.adapter.verify=vi.fn(async()=>({task_id:'other',media_ended:true,progress_recorded:true,submission_confirmed:false,completed:true,passed:null,pending_grading:false,visible_score:null}));
    await f.run.run();expect(f.run.snapshot().notice).toContain('不属于当前任务');expect(f.entered).toEqual(['v1']);
  });
  it('stops if the platform replaces the video within the same task',async()=>{
    const f=fixture();f.adapter.video=vi.fn().mockImplementationOnce(async()=>video({observed_at:f.now})).mockImplementation(async()=>video({observed_at:f.now,video_id:'other'}));
    await f.run.run();expect(f.run.snapshot().notice).toContain('视频身份');expect(f.adapter.verify).not.toHaveBeenCalled();
  });
  it('pauses if the current course changed, with no navigation or answers',async()=>{
    const f=fixture();f.adapter.catalog=vi.fn(async()=>({...f.list,course_id:'other'}));await f.run.run();
    expect(f.run.snapshot().state).toBe('PAUSED');expect(f.entered).toEqual([]);expect(f.runner.run).not.toHaveBeenCalled();
  });
  it('cancels late entry and pauses the player without allowing further actions',async()=>{
    const f=fixture();let entered!:()=>void;let release!:()=>void;
    const reached=new Promise<void>(resolve=>{entered=resolve;});f.adapter.enter=vi.fn(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});});
    const running=f.run.run();await reached;f.run.pause();release();await running;
    expect(f.run.snapshot().state).toBe('PAUSED');expect(f.adapter.pauseVideo).toHaveBeenCalledOnce();expect(f.adapter.highestAllowedSpeed).not.toHaveBeenCalled();expect(f.runner.pause).toHaveBeenCalled();
  });
  it('reconciles a possibly submitted quiz on resume before navigating again',async()=>{
    const f=fixture();f.result.status='paused';f.result.reason='submission unknown';f.result.submission_confirmed=false;
    await f.run.run();expect(f.run.snapshot().state).toBe('PAUSED');const entries=f.entered.length;
    f.result.status='completed';f.result.submission_confirmed=true;
    await f.run.resume();expect(f.run.snapshot().state).toBe('COMPLETE');expect(f.entered.slice(entries)).toEqual(['v2']);expect(f.runner.run).toHaveBeenCalledTimes(2);
  });
  it('checks the course identity before reconciling a pending submission on resume',async()=>{
    const f=fixture();f.result.status='paused';f.result.reason='submission unknown';f.result.submission_confirmed=false;
    await f.run.run();expect(f.runner.run).toHaveBeenCalledTimes(1);
    f.adapter.catalog=vi.fn(async()=>({...structuredClone(f.list),course_id:'different-course'}));
    f.result.status='completed';f.result.submission_confirmed=true;
    await f.run.resume();
    expect(f.run.snapshot().state).toBe('PAUSED');expect(f.runner.run).toHaveBeenCalledTimes(1);
    expect(f.budget.used).toBe(1);expect(f.entered).toEqual(['v1','q1']);
  });
  it('pauses a popup whose scoring rule is unknown without requesting answers',async()=>{
    const f=fixture();f.adapter.video=vi.fn(async()=>video({observed_at:f.now,popup:{id:'popup',course_id:'course',task_id:'v1',kind:'video_popup',rules:{scored:null,retry_allowed:true,requires_pass:false,requires_rewatch:false,remaining_attempts:3}}}));
    await f.run.run();expect(f.run.snapshot().state).toBe('PAUSED');expect(f.runner.run).not.toHaveBeenCalled();
  });
  it('stops when visibility is required, rather than simulating focus',async()=>{
    const f=fixture();f.list.rules.visibility_required=true;f.adapter.video=vi.fn(async()=>video({visible:false,observed_at:f.now}));await f.run.run();
    expect(f.run.snapshot().notice).toContain('页面可见');expect(f.adapter.play).not.toHaveBeenCalled();expect(f.runner.run).not.toHaveBeenCalled();
  });
});
