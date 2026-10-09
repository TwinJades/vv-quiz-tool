import {describe,expect,it} from 'vitest';
import {courseRecordConfirms,courseScopeForSelection,courseScopeConfirmed,nextCourseResource,validateCourseResources,validateCourseScope,VideoEstimate} from '../../src/core/course';
import type {CourseCatalog,LearningTask,CourseVerification,VideoSnapshot} from '../../src/core/course';
import {ModelCallBudget} from '../../src/core/call-budget';
import {projectCourseFrame} from '../../src/web/frame-projection';

const parent:LearningTask={id:'lesson',lesson_id:'lesson',chapter_id:'chapter',title:'lesson',kind:'lesson',status:'not_started',order:0,prerequisites:[]};
const first:LearningTask={...parent,id:'video-a',kind:'video',order:0};
const second:LearningTask={...parent,id:'video-b',kind:'video',order:1};
const quiz:LearningTask={...parent,id:'quiz',kind:'lesson_quiz',order:2,prerequisites:[first.id]};
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
