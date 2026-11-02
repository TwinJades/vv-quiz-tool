import {describe,expect,it} from 'vitest';
import {CourseOrchestrator,courseRecordConfirms,courseScopeForSelection,courseScopeConfirmed,nextCourseResource,validateCourseResources,validateCourseScope,VideoEstimate} from '../../src/core/course';
import type {CourseAdapter,CourseCatalog,CourseQuizRunner,LearningTask,CourseVerification,QuizBoundary,VideoSnapshot} from '../../src/core/course';
import {ModelCallBudget} from '../../src/core/call-budget';
import {projectCourseFrame} from '../../src/web/frame-projection';

const parent:LearningTask={id:'lesson',lesson_id:'lesson',chapter_id:'chapter',title:'lesson',kind:'lesson',status:'not_started',order:0,prerequisites:[]};
const first:LearningTask={...parent,id:'video-a',resource_id:'media-a',kind:'video',order:0};
const second:LearningTask={...parent,id:'video-b',resource_id:'media-b',kind:'video',order:1};
const quiz:LearningTask={...parent,id:'quiz',resource_id:'work-a',kind:'lesson_quiz',order:2,prerequisites:[first.id]};
const catalog:CourseCatalog={course_id:'course',platform:'chaoxing',title:'course',revision:'revision',complete:true,diagnostics:[],rules:{speed_allowed:null,visibility_required:null},tasks:[parent,{...parent,id:'done',lesson_id:'done',status:'completed'},{...parent,id:'document',kind:'excluded'}]};
const record:CourseVerification={task_id:first.id,media_ended:true,progress_recorded:true,submission_confirmed:false,completed:true,passed:null,pending_grading:false,visible_score:null};

describe('课程范围和资源依赖的纯逻辑',()=>{
  it('默认范围排除已完成课时和范围外任务，明确课时选择保持原范围',()=>{
    expect(courseScopeForSelection(catalog,'all')).toEqual([parent.id]);
    expect(courseScopeForSelection(catalog,'lesson:done')).toEqual(['done']);
    expect(courseScopeForSelection(catalog,'chapter:chapter')).toEqual([parent.id,'done']);
    expect(()=>courseScopeForSelection(catalog,'other')).toThrow();
    expect(()=>validateCourseScope({...catalog,coverage:{loaded:3,total:4,exhausted:false}},[parent.id])).toThrow();
    expect(()=>validateCourseScope(catalog,[parent.id,parent.id])).toThrow();
  });
  it('资源失败后允许独立资源继续，关联测验等待实际前置资源',()=>{
    const children=[quiz,second,first],completed=new Set<string>(),failed=new Set([first.id]);
    validateCourseResources(parent,children);
    expect(nextCourseResource(children,completed,failed)?.id).toBe(second.id);
    completed.add(second.id);expect(nextCourseResource(children,completed,failed)).toBeNull();
    completed.add(first.id);expect(nextCourseResource(children,completed,failed)?.id).toBe(quiz.id);
  });
  it('拒绝循环、范围外依赖、重复资源和资源归属改变',()=>{
    expect(()=>validateCourseResources(parent,[{...first,prerequisites:[quiz.id]},quiz])).toThrow(/循环/);
    expect(()=>validateCourseResources(parent,[{...first,prerequisites:['outside']}])).toThrow(/范围外/);
    expect(()=>validateCourseResources(parent,[first,first])).toThrow();
    expect(()=>validateCourseResources(parent,[{...first,lesson_id:'other'}])).toThrow();
  });
  it('媒体结束不能代替平台记录，测验还需要提交和及格依据',()=>{
    expect(courseRecordConfirms(first,{...record,progress_recorded:false})).toBe(false);
    expect(courseRecordConfirms(first,{...record,media_ended:false})).toBe(true);
    expect(courseRecordConfirms(quiz,{...record,task_id:quiz.id})).toBe(false);
    const grade={...record,task_id:quiz.id,submission_confirmed:true};
    const rules={requires_pass:true,scored:true,retry_allowed:true,remaining_attempts:2,requires_rewatch:false};
    expect(courseRecordConfirms(quiz,grade,rules)).toBe(false);
    expect(courseRecordConfirms(quiz,{...grade,passed:true},rules)).toBe(true);
    expect(courseRecordConfirms(quiz,{...grade,passed:true,pending_grading:true},rules)).toBe(false);
    expect(()=>courseRecordConfirms(first,{...record,task_id:second.id})).toThrow();
  });
  it('待处理、未完成以及全部排除的范围不能显示全部完成',()=>{
    const done={...catalog,tasks:[{...parent,status:'completed' as const}]};
    expect(courseScopeConfirmed(done,[parent.id],new Set(),[])).toBe(true);
    expect(courseScopeConfirmed(catalog,[parent.id],new Set(),[])).toBe(false);
    expect(courseScopeConfirmed(done,[parent.id],new Set([parent.id]),[])).toBe(false);
    expect(courseScopeConfirmed(done,[parent.id],new Set(),[{task_id:parent.id,title:parent.title,reason:'pending',checked:true}])).toBe(false);
  });
});

describe('课程预算、播放估计和框架坐标的纯逻辑',()=>{
  it('课程预算分别计算，预留费用先保存，恢复采用已保存的调用数量',async()=>{
    const a=new ModelCallBudget(3),b=new ModelCallBudget(3),saved:number[]=[];
    a.setPersistence(async used=>{saved.push(used);});
    const reservation=a.reserve(2);await a.flush();expect(saved).toEqual([2]);expect(b.used).toBe(0);
    reservation.settle(1);await a.flush();expect(saved).toEqual([2,1]);
    const restored=new ModelCallBudget(3);restored.reserve(saved.at(-1)!).settle(saved.at(-1)!);expect(restored.remaining).toBe(2);
    b.consume();expect(a.used).toBe(1);expect(b.used).toBe(1);
    expect(()=>a.reserve(3)).toThrow();
  });
  it('播放估计采用实际位置和速度，暂停期间冻结，倍速改变后重新计算',()=>{
    const estimate=new VideoEstimate(),reading:VideoSnapshot={course_id:'course',task_id:first.id,video_id:'media',observed_at:0,duration:100,position:20,rate:2,paused:false,buffering:false,seeking:false,ended:false,visible:false,popup:null};
    estimate.observe(reading,0);expect(estimate.seconds).toBe(40);
    estimate.observe({...reading,observed_at:1000,paused:true,position:30},1000);expect(estimate.seconds).toBe(40);expect(estimate.frozen).toBe(true);
    estimate.observe({...reading,observed_at:2000,position:30,rate:1},2000);expect(estimate.seconds).toBe(70);
  });
  it('框架坐标保留实际边框和缩放，连续转换至父标签',()=>{
    const firstProjection=projectCourseFrame({x:20,y:30},{x:10,y:20,width:40,height:50},{rect:{x:100,y:200,width:400,height:300},width:200,height:150,left:2,top:3});
    expect(firstProjection).toEqual({point:{x:144,y:266},region:{x:124,y:246,width:80,height:100}});
    const secondProjection=projectCourseFrame(firstProjection.point,firstProjection.region,{rect:{x:5,y:10,width:500,height:400},width:500,height:400,left:1,top:1});
    expect(secondProjection.point).toEqual({x:150,y:277});
    expect(()=>projectCourseFrame({x:0,y:0},{x:0,y:0,width:1,height:1},{rect:{x:0,y:0,width:1,height:1},width:0,height:1,left:0,top:0})).toThrow();
  });
});

type PlaybackScenario={
  video:(time:number)=>Partial<VideoSnapshot>;
  verified?:boolean;
  popupDuration?:number;
};

function playbackScenario(scenario:PlaybackScenario){
  let time=0,pauses=0,returns=0,quizRuns=0,mediaEnded=false;
  const plays:number[]=[],waits:number[]=[];
  const course:CourseCatalog={...catalog,tasks:[{...parent}]};
  const child:LearningTask={...first,prerequisites:[]};
  const boundary:QuizBoundary={id:'popup',course_id:'course',task_id:child.id,kind:'video_popup',rules:{scored:false,retry_allowed:false,remaining_attempts:null,requires_pass:false,requires_rewatch:false}};
  const adapter:CourseAdapter={
    catalog:async()=>structuredClone(course),children:async()=>[{...child}],enter:async()=>{},
    video:async()=>{const video:VideoSnapshot={course_id:'course',task_id:child.id,video_id:'media-a',observed_at:time,duration:1000,position:0,rate:1,paused:false,buffering:false,seeking:false,ended:false,visible:true,popup:null,...scenario.video(time)};mediaEnded ||= video.ended;return video;},
    highestAllowedSpeed:async()=>{},mute:async()=>{},play:async()=>{plays.push(time);},pauseVideo:async()=>{pauses++;return true;},
    verify:async task=>({...record,task_id:task.id,progress_recorded:mediaEnded&&scenario.verified!==false,completed:mediaEnded&&scenario.verified!==false}),
    returnToCatalog:async()=>{returns++;},quiz:async()=>boundary,
  };
  const quizzes:CourseQuizRunner={pause:()=>{},run:async()=>{quizRuns++;time+=scenario.popupDuration??0;return {status:'completed',reason:null,submission_confirmed:true,passed:true,visible_score:null,retried:0};}};
  const orchestrator=new CourseOrchestrator(adapter,quizzes,{session_id:'session',catalog:course,scope:[parent.id],strategy:'unattended',provider_profile_id:'profile',model_id:'model',budget:new ModelCallBudget(10),now:()=>time,wait:async(ms,signal)=>{signal.throwIfAborted();waits.push(ms);time+=ms;}});
  return {orchestrator,boundary,plays,waits,get time(){return time;},get pauses(){return pauses;},get returns(){return returns;},get quizRuns(){return quizRuns;}};
}

describe('课程编排器的有界播放恢复',()=>{
  it('缓冲超过两分钟后仍可恢复，并只在平台确认记录后完成',async()=>{
    const run=playbackScenario({video:time=>time<130000?{buffering:true}:{position:(time-130000)/1000,ended:time>=132000}});
    await run.orchestrator.run();
    expect(run.time).toBeGreaterThanOrEqual(132000);
    expect(run.plays).toEqual([]);
    expect(run.orchestrator.snapshot().state).toBe('COMPLETE');
    expect(run.orchestrator.snapshot().course?.video.progress_recorded).toBe(true);
    expect(run.waits).toContain(500);
  });
  it('持续无进展到五分钟停止，边界不再发起播放',async()=>{
    const run=playbackScenario({video:time=>({buffering:true,paused:time>=300000})});
    await run.orchestrator.run();
    expect(run.time).toBe(300000);
    expect(run.plays).toEqual([]);
    expect(run.orchestrator.snapshot().state).toBe('PAUSED');
    expect(run.orchestrator.snapshot().course?.issues?.some(issue=>issue.reason.startsWith('COURSE_VIDEO_STALLED:'))).toBe(true);
    expect(run.pauses).toBeGreaterThan(0);
  });
  it('同一资源的播放器重建不会重置五分钟停滞时钟',async()=>{
    let surface={video_id:'media-a',resource_fingerprint:'same-resource',buffering:true,position:0},rebuilds=0;
    const run=playbackScenario({video:time=>{
      if(time>0&&time%60000===0){surface={...surface};rebuilds++;}
      return surface;
    }});
    await run.orchestrator.run();
    expect(rebuilds).toBe(5);
    expect(run.time).toBe(300000);
    expect(run.plays).toEqual([]);
    expect(run.orchestrator.snapshot().state).toBe('PAUSED');
    expect(run.orchestrator.snapshot().course?.issues?.some(issue=>issue.reason.startsWith('COURSE_VIDEO_STALLED:'))).toBe(true);
  });
  it('暂停恢复每三秒最多一次，八次后确认暂停而不发第九次',async()=>{
    const run=playbackScenario({video:()=>({paused:true})});
    await run.orchestrator.run();
    expect(run.plays).toEqual([0,3000,6000,9000,12000,15000,18000,21000]);
    expect(run.time).toBe(24000);
    expect(run.pauses).toBeGreaterThan(0);
    expect(run.orchestrator.snapshot().state).toBe('PAUSED');
  });
  it('真实连续前进十秒后重置恢复次数',async()=>{
    const run=playbackScenario({video:time=>time<21000?{paused:true}:time<32500?{position:(time-21000)/1000}:time<60000?{position:11.5,paused:true}:{position:12,ended:true}});
    await run.orchestrator.run();
    expect(run.plays.slice(0,7)).toEqual([0,3000,6000,9000,12000,15000,18000]);
    expect(run.plays.filter(time=>time>=32500).length).toBe(8);
    expect(run.orchestrator.snapshot().state).toBe('PAUSED');
  });
  it('拖动产生的位置变化不计有效进展',async()=>{
    const run=playbackScenario({video:time=>({position:time/500,seeking:true})});
    await run.orchestrator.run();
    expect(run.time).toBe(300000);
    expect(run.plays).toEqual([]);
    expect(run.orchestrator.snapshot().state).toBe('PAUSED');
  });
  it('弹题处理耗时不计入停滞，解除后重新计时',async()=>{
    let boundary:QuizBoundary;
    const run=playbackScenario({popupDuration:200000,video:time=>time===100000?{popup:boundary}:time>=499000?{ended:true}: {buffering:true}});
    boundary=run.boundary;
    await run.orchestrator.run();
    expect(run.quizRuns).toBe(1);
    expect(run.time).toBe(499000);
    expect(run.orchestrator.snapshot().state).toBe('COMPLETE');
  });
  it('媒体结束但平台始终无记录时两分钟后停止且不显示完成',async()=>{
    const run=playbackScenario({video:()=>({ended:true}),verified:false});
    await run.orchestrator.run();
    expect(run.time).toBe(120000);
    expect(run.returns).toBeGreaterThanOrEqual(1);
    expect(run.orchestrator.snapshot().state).not.toBe('COMPLETE');
    expect(run.orchestrator.snapshot().course?.video.progress_recorded).toBe(false);
  });
  it('关联测验目录状态滞后但已有记录时不请求模型或再次提交',async()=>{
    const course:CourseCatalog={...catalog,tasks:[{...parent}]};
    const child:LearningTask={...quiz,prerequisites:[],status:'in_progress'};
    const boundary:QuizBoundary={id:'existing-child',course_id:'course',task_id:child.id,kind:'lesson_quiz',rules:{scored:true,retry_allowed:false,remaining_attempts:0,requires_pass:true,requires_rewatch:false}};
    let runs=0,reads=0;
    const adapter:CourseAdapter={catalog:async()=>structuredClone(course),children:async()=>[{...child}],enter:async()=>{},video:async()=>{throw new Error('unexpected video');},highestAllowedSpeed:async()=>{},mute:async()=>{},play:async()=>{},pauseVideo:async()=>true,verify:async task=>{reads++;return {...record,task_id:task.id,submission_confirmed:true,passed:true,record_source:'existing_record'};},returnToCatalog:async()=>{},quiz:async()=>boundary};
    const quizzes:CourseQuizRunner={pause:()=>{},run:async()=>{runs++;throw new Error('已有记录不应请求模型');}};
    const orchestrator=new CourseOrchestrator(adapter,quizzes,{session_id:'child-existing',catalog:course,scope:[parent.id],strategy:'unattended',provider_profile_id:'profile',model_id:'model',budget:new ModelCallBudget(10)});
    await orchestrator.run();
    expect(reads).toBeGreaterThan(0);
    expect(runs).toBe(0);
    expect(orchestrator.snapshot().model_calls.used).toBe(0);
    expect(orchestrator.snapshot().state).toBe('COMPLETE');
  });
  it('关联子测验已提交不及格且要求及格时交由答题器处理重试',async()=>{
    const course:CourseCatalog={...catalog,tasks:[{...parent}]};
    const child:LearningTask={...quiz,prerequisites:[],status:'in_progress'};
    const boundary:QuizBoundary={id:'retry-child',course_id:'course',task_id:child.id,kind:'lesson_quiz',rules:{scored:true,retry_allowed:true,remaining_attempts:1,requires_pass:true,requires_rewatch:false}};
    let runs=0;
    const adapter:CourseAdapter={catalog:async()=>structuredClone(course),children:async()=>[{...child}],enter:async()=>{},video:async()=>{throw new Error('unexpected video');},highestAllowedSpeed:async()=>{},mute:async()=>{},play:async()=>{},pauseVideo:async()=>true,verify:async task=>({...record,task_id:task.id,submission_confirmed:true,passed:runs>0,record_source:'existing_record'}),returnToCatalog:async()=>{},quiz:async()=>boundary};
    const quizzes:CourseQuizRunner={pause:()=>{},run:async received=>{expect(received).toEqual(boundary);runs++;return {status:'completed',reason:null,submission_confirmed:true,passed:true,visible_score:null,retried:1};}};
    const orchestrator=new CourseOrchestrator(adapter,quizzes,{session_id:'child-retry',catalog:course,scope:[parent.id],strategy:'unattended',provider_profile_id:'profile',model_id:'model',budget:new ModelCallBudget(10)});
    await orchestrator.run();
    expect(runs).toBe(1);
    expect(orchestrator.snapshot().state).toBe('COMPLETE');
  });
  it('关联子测验已提交待批阅时即使显示不及格也不调用答题器',async()=>{
    const course:CourseCatalog={...catalog,tasks:[{...parent}]};
    const child:LearningTask={...quiz,prerequisites:[],status:'in_progress'};
    const boundary:QuizBoundary={id:'pending-child',course_id:'course',task_id:child.id,kind:'lesson_quiz',rules:{scored:true,retry_allowed:true,remaining_attempts:1,requires_pass:true,requires_rewatch:false}};
    let runs=0;
    const adapter:CourseAdapter={catalog:async()=>structuredClone(course),children:async()=>[{...child}],enter:async()=>{},video:async()=>{throw new Error('unexpected video');},highestAllowedSpeed:async()=>{},mute:async()=>{},play:async()=>{},pauseVideo:async()=>true,verify:async task=>({...record,task_id:task.id,submission_confirmed:true,passed:false,pending_grading:true,record_source:'existing_record'}),returnToCatalog:async()=>{},quiz:async()=>boundary};
    const quizzes:CourseQuizRunner={pause:()=>{},run:async()=>{runs++;throw new Error('待批阅不应请求模型');}};
    const orchestrator=new CourseOrchestrator(adapter,quizzes,{session_id:'child-pending',catalog:course,scope:[parent.id],strategy:'unattended',provider_profile_id:'profile',model_id:'model',budget:new ModelCallBudget(10)});
    await orchestrator.run();
    expect(runs).toBe(0);
    expect(orchestrator.snapshot().model_calls.used).toBe(0);
    expect(orchestrator.snapshot().state).not.toBe('COMPLETE');
  });
  it('已有测验记录直接核对，不再调用答题模型',async()=>{
    const course:CourseCatalog={...catalog,tasks:[{...quiz,prerequisites:[]}]};
    const boundary:QuizBoundary={id:'quiz-boundary',course_id:'course',task_id:quiz.id,kind:'lesson_quiz',rules:{scored:true,retry_allowed:false,remaining_attempts:0,requires_pass:true,requires_rewatch:false}};
    let runs=0,finished=false;
    const adapter:CourseAdapter={catalog:async()=>({...course,tasks:[{...course.tasks[0]!,status:finished?'completed':'not_started'}]}),enter:async()=>{},video:async()=>{throw new Error('unexpected video');},highestAllowedSpeed:async()=>{},mute:async()=>{},play:async()=>{},pauseVideo:async()=>true,verify:async()=>({...record,task_id:quiz.id,submission_confirmed:true,passed:true,record_source:'existing_record'}),returnToCatalog:async()=>{finished=true;},quiz:async()=>boundary};
    const quizzes:CourseQuizRunner={pause:()=>{},run:async()=>{runs++;throw new Error('已有记录不应请求模型');}};
    const orchestrator=new CourseOrchestrator(adapter,quizzes,{session_id:'existing',catalog:course,scope:[quiz.id],strategy:'unattended',provider_profile_id:'profile',model_id:'model',budget:new ModelCallBudget(10)});
    await orchestrator.run();
    expect(orchestrator.snapshot().state).toBe('COMPLETE');
    expect(orchestrator.snapshot().model_calls.used).toBe(0);
    expect(runs).toBe(0);
  });
});
