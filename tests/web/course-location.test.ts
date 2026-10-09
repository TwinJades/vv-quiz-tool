import {describe,it,expect} from 'vitest';
import {expectedCourseLocation} from '../../src/web/course-location';
import {chaoxingLessonTasks} from '../../src/web/chaoxing-course-tasks';
import type {CourseCatalog} from '../../src/core/course';

const task=chaoxingLessonTasks('11','33',[{id:'22',title:'课时',locked:false}])[0]!;
const catalog:CourseCatalog={course_id:'11',context_id:'33',platform:'chaoxing',title:'课程',revision:'r',complete:true,tasks:[task],rules:{speed_allowed:true,visibility_required:true},diagnostics:[]};
describe('public course navigation identity',()=>{
  it('accepts only the requested course, class and lesson',()=>{
    expect(expectedCourseLocation('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&clazzid=33&chapterId=22',catalog,task)).toBe(true);
    expect(expectedCourseLocation('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&clazzid=44&chapterId=22',catalog,task)).toBe(false);
    expect(expectedCourseLocation('https://mooc1.chaoxing.com.evil.test/mycourse/studentstudy?courseId=11&clazzid=33&chapterId=22',catalog,task)).toBe(false);
  });
  it('rejects repeated public identity parameters',()=>{
    expect(expectedCourseLocation('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&courseId=11&clazzid=33&chapterId=22',catalog,task)).toBe(false);
  });
  it('keeps Zhidao learner and directory routes distinct',()=>{
    const zhidao={...catalog,platform:'zhidao' as const};
    expect(expectedCourseLocation('https://ai-smart-course-student-pro.zhihuishu.com/learnPage/11/22/33',zhidao,task)).toBe(true);
    expect(expectedCourseLocation('https://ai-smart-course-student-pro.zhihuishu.com/learnPage/11/22/33/',zhidao,task)).toBe(true);
    expect(expectedCourseLocation('https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/11/33',zhidao,null)).toBe(true);
    expect(expectedCourseLocation('https://ai-smart-course-student-pro.zhihuishu.com/learnPage/11/99/33',zhidao,task)).toBe(false);
  });
});
