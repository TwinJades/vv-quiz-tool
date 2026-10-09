import type {CourseCatalog,LearningTask} from '../core/course';

export function expectedCourseLocation(value:string,catalog:CourseCatalog,task:LearningTask|null):boolean {
  const url=new URL(value);
  if(url.protocol!=='https:'||!catalog.context_id)return false;
  if(catalog.platform==='chaoxing'){
    const unique=(key:string,id:string)=>url.searchParams.getAll(key).length===1&&url.searchParams.get(key)===id;
    return Boolean(task)&&url.origin==='https://mooc1.chaoxing.com'&&url.pathname==='/mycourse/studentstudy'&&unique('courseId',catalog.course_id)&&unique('clazzid',catalog.context_id)&&unique('chapterId',task!.lesson_id);
  }
  if(url.origin!=='https://ai-smart-course-student-pro.zhihuishu.com')return false;
  return url.pathname.replace(/\/$/,'')===(task?`/learnPage/${catalog.course_id}/${task.lesson_id}/${catalog.context_id}`:`/singleCourse/knowledgeStudy/${catalog.course_id}/${catalog.context_id}`);
}
