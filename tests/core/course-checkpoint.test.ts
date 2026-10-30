import {describe,it,expect} from 'vitest';
import {migrateCourseCheckpoint} from '../../src/core/course-checkpoint';
import {chaoxingLessonTasks,chaoxingResourceTasks} from '../../src/web/chaoxing-course-tasks';
import type {ChaoxingLearningReading} from '../../src/web/chaoxing-learning-page';
import type {CourseCatalog,LearningTask} from '../../src/core/course';
import type {SessionRuntimeSnapshot} from '../../src/core/orchestrator';
import {validateCourseResources} from '../../src/core/course';

const parent=chaoxingLessonTasks('11','33',[{id:'22',title:'课时',locked:false}])[0]!;
const catalog:CourseCatalog={course_id:'11',context_id:'33',platform:'chaoxing',title:'课程',revision:'directory',complete:true,tasks:[parent],rules:{visibility_required:null,speed_allowed:null},diagnostics:[]};
const video:LearningTask={...parent,id:'resource-a',resource_id:'video:77',resource_fingerprint:'source-a',kind:'video'};
const second:LearningTask={...video,id:'resource-b',resource_id:'video:78',resource_fingerprint:'source-b',order:1};
function saved():SessionRuntimeSnapshot{
  const old={...video,id:'old-position-id'};delete old.resource_id;
  return {session_id:'session',state:'PAUSED',strategy:'unattended',observation_input_mode:'structured',provider_profile_id:'provider',model_id:'model',model_calls:{used:73,limit:300},progress:{total:1,answered:0,guessed:0,retried:2,skipped:0,failed:0},notice:null,summary:null,
    course:{phase:'PAUSED',course_id:'11',title:'课程',scope:[parent.id],current_task_id:old.id,estimate_seconds:null,estimate_frozen:true,video:{ended:false,progress_recorded:false},results:[],tasks:[parent],excluded:[],checkpoint:{catalog,completed:[old.id],children:[old],pending_quiz:null,quiz_retries:[[old.id,2]],quiz_retry_pending:old.id}}};
}
describe('课程断点身份迁移',()=>{
  it('采用唯一资源证据，保留预算、结果和重试次数，原记录保持完整',()=>{
    const original=saved(),before=structuredClone(original),next=migrateCourseCheckpoint(original,[second,video],catalog),checkpoint=next.course!.checkpoint!;
    expect(original).toEqual(before);expect(next.model_calls).toEqual({used:73,limit:300});
    expect(checkpoint.format_version).toBe(2);expect(checkpoint.completed).toEqual([video.id]);
    expect(checkpoint.quiz_retries).toEqual([[video.id,2]]);expect(checkpoint.quiz_retry_pending).toBe(video.id);
    expect(next.course!.current_task_id).toBe(video.id);
  });
  it('证据缺失、重复或课程身份改变时拒绝迁移',()=>{
    expect(()=>migrateCourseCheckpoint(saved(),[],catalog)).toThrow(/无法唯一/);
    expect(()=>migrateCourseCheckpoint(saved(),[video,{...second,resource_fingerprint:video.resource_fingerprint!}],catalog)).toThrow(/无法唯一/);
    expect(()=>migrateCourseCheckpoint(saved(),[video],{...catalog,context_id:'44'})).toThrow(/班级/);
  });
  it('迁移弹题未知提交边界时保持内容身份，不生成再次提交动作',()=>{
    const original=saved(),checkpoint=original.course!.checkpoint!,old=checkpoint.children[0]!;
    checkpoint.pending_quiz={id:`popup:${old.id}:content`,task_id:old.id,course_id:'11',kind:'video_popup',rules:{scored:false,retry_allowed:false,remaining_attempts:1,requires_pass:false,requires_rewatch:false}};
    const child=saved();delete child.course;child.checkpoint={last_outcome:null,answers:[],submission_pending:true,answer_retry_counts:[['question',2]]};
    checkpoint.quiz_child={boundary_id:checkpoint.pending_quiz.id,task_id:old.id,snapshot:child,retries:2,retry_pending:false};
    checkpoint.popup_retries=[[`${old.id}:video_popup:${checkpoint.pending_quiz.id}`,2]];
    const next=migrateCourseCheckpoint(original,[video],catalog);
    expect(next.course!.checkpoint!.pending_quiz).toMatchObject({id:`popup:${video.id}:content`,task_id:video.id});
    expect(next.course!.checkpoint!.quiz_child).toMatchObject({task_id:video.id,retries:2,snapshot:{checkpoint:{submission_pending:true,answer_retry_counts:[['question',2]]}}});
    expect(next.course!.checkpoint!.popup_retries).toEqual([[`${video.id}:video_popup:popup:${video.id}:content`,2]]);
    expect(original.course!.checkpoint!.pending_quiz!.task_id).toBe(old.id);
  });
  it('缺少过往资源证据时保留未确认操作，未知版本明确拒绝',()=>{
    const original=saved();original.course!.checkpoint!.completed.push('unidentified-old-resource');
    expect(()=>migrateCourseCheckpoint(original,[video],catalog)).toThrow(/缺少资源对应证据/);
    original.course!.checkpoint!.format_version=9;
    expect(()=>migrateCourseCheckpoint(original,[video],catalog)).toThrow(/版本/);
  });
});
describe('资源身份转换',()=>{
  function reading():ChaoxingLearningReading{return {course_id:'11',class_id:'33',lesson_id:'22',lesson_title:'课时',observed_at:0,visibility_required:null,seek_forbidden:null,required_watch_percent:null,resources_ready:true,resource_count:2,videos:[{index:0,resource_id:'video:77',title:'相同标题',task_recorded:false,media:null},{index:1,resource_id:'video:78',title:'相同标题',task_recorded:false,media:null}],quizzes:[],diagnostics:[]};}
  it('资源重排和重名标题保持资源身份，位置只改变显示顺序',()=>{
    const original=reading(),before=chaoxingResourceTasks(parent,original);
    original.videos.reverse();original.videos.forEach((video,index)=>{video.index=index;});
    const after=chaoxingResourceTasks(parent,original);
    expect(before.map(task=>task.id).sort()).toEqual(after.map(task=>task.id).sort());expect(after[0]!.resource_id).toBe('video:78');
    validateCourseResources(parent,after);
  });
  it('公开编号缺失和重复产生明确错误',()=>{
    const missing=reading();missing.videos[0]!.resource_id=null;
    expect(()=>chaoxingResourceTasks(parent,missing)).toThrow(/缺少公开编号/);
    const duplicate=reading();duplicate.videos[1]!.resource_id=duplicate.videos[0]!.resource_id;
    expect(()=>chaoxingResourceTasks(parent,duplicate)).toThrow(/重复/);
    const invalid={...video};delete invalid.resource_id;
    expect(()=>validateCourseResources(parent,[invalid])).toThrow(/缺失/);
  });
});
