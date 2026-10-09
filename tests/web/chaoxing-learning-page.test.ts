import { describe, expect, it } from 'vitest';
import {chaoxingLessonTasks,chaoxingResourceTasks} from '../../src/web/chaoxing-course-tasks';
import {nextCourseTask,validateCourseScope,validateCourseResources,nextCourseResource} from '../../src/core/course';

describe('Chaoxing task conversion',()=>{
  it('produces selectable lesson tasks with course and class ownership',()=>{
    const tasks=chaoxingLessonTasks('11','33',[{id:'22',title:'当前课时',locked:false}]);
    expect(tasks[0]).toMatchObject({id:'cx:11:33:22',lesson_id:'22',chapter_id:'22',kind:'lesson',status:'not_started'});
    const catalog={course_id:'11',context_id:'33',platform:'chaoxing' as const,title:'课程',revision:'r',complete:true,tasks,rules:{visibility_required:true,speed_allowed:true},diagnostics:[]};
    expect(()=>validateCourseScope(catalog,['cx:11:33:22'])).not.toThrow();
    expect(nextCourseTask(catalog,['cx:11:33:22'])?.id).toBe('cx:11:33:22');
  });
  it('rejects an empty or duplicated directory',()=>{
    expect(()=>chaoxingLessonTasks('11','33',[])).toThrow();
    expect(()=>chaoxingLessonTasks('11','33',[{id:'22',title:'课时',locked:false},{id:'22',title:'重复课时',locked:false}])).toThrow();
  });
  it('retains locked lesson state so it cannot become a ready task',()=>{
    const tasks=chaoxingLessonTasks('11','33',[{id:'22',title:'课时',locked:true}]);
    const catalog={course_id:'11',platform:'chaoxing' as const,title:'课程',revision:'r',complete:true,tasks,rules:{visibility_required:true,speed_allowed:true},diagnostics:[]};
    expect(()=>nextCourseTask(catalog,[tasks[0]!.id])).toThrow();
  });
  it('separates task identity for different classes',()=>{
    const lessons=[{id:'22',title:'课时',locked:false}];
    expect(chaoxingLessonTasks('11','33',lessons)[0]!.id).not.toBe(chaoxingLessonTasks('11','44',lessons)[0]!.id);
  });
  it('文档课时保留实际范围外资源，不生成视频完成记录',()=>{
    const parent=chaoxingLessonTasks('11','33',[{id:'22',title:'文档课时',locked:false}])[0]!;
    const children=chaoxingResourceTasks(parent,{course_id:'11',class_id:'33',lesson_id:'22',lesson_title:parent.title,observed_at:0,visibility_required:null,seek_forbidden:null,required_watch_percent:null,resources_ready:true,resource_count:1,videos:[],quizzes:[],excluded_resources:[{index:0,title:'文档资源'}],diagnostics:[]});
    expect(()=>validateCourseResources(parent,children)).not.toThrow();
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({kind:'excluded',status:'not_started'});
    expect(nextCourseResource(children,new Set(),new Set())).toBeNull();
  });
  it('单个播放器尚未加载时仍能发现其他独立视频',()=>{
    const parent=chaoxingLessonTasks('11','33',[{id:'22',title:'视频课时',locked:false}])[0]!;
    const children=chaoxingResourceTasks(parent,{course_id:'11',class_id:'33',lesson_id:'22',lesson_title:parent.title,observed_at:0,visibility_required:null,seek_forbidden:null,required_watch_percent:null,resources_ready:true,resource_count:2,videos:[{index:0,task_recorded:false,media:null},{index:1,task_recorded:false,media:{source_fingerprint:'public-resource',position:0,duration:60,rate:1,paused:true,ended:false,seeking:false,ready_state:4,muted:true,volume:0}}],quizzes:[],diagnostics:[]});
    expect(()=>validateCourseResources(parent,children)).not.toThrow();
    expect(children).toHaveLength(2);
    expect(nextCourseResource(children,new Set(),new Set([children[0]!.id]))?.id).toBe(children[1]!.id);
  });
});
