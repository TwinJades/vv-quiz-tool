import type {LearningTask} from '../core/course';
import type {ChaoxingLearningReading} from './chaoxing-learning-page';

export function chaoxingLessonTasks(course:string,context:string,lessons:Array<{id:string;title:string;locked:boolean}>):LearningTask[]{
  if(!/^\d+$/.test(course)||!/^\d+$/.test(context)||!lessons.length||new Set(lessons.map(lesson=>lesson.id)).size!==lessons.length||lessons.some(lesson=>!/^\d+$/.test(lesson.id)||!lesson.title.trim()))throw new Error('学习通课时目录身份不完整。');
  return lessons.map((lesson,order)=>({id:`cx:${course}:${context}:${lesson.id}`,lesson_id:lesson.id,chapter_id:lesson.id,title:lesson.title,kind:'lesson',status:lesson.locked?'locked':'not_started',order,prerequisites:[]}));
}

export function chaoxingResourceTasks(parent:LearningTask,reading:ChaoxingLearningReading):LearningTask[]{
  if(parent.kind!=='lesson'||parent.id!==`cx:${reading.course_id}:${reading.class_id}:${reading.lesson_id}`||!reading.resources_ready)throw new Error('学习通课时资源身份或加载状态不完整。');
  const videos=reading.videos.map((video):LearningTask=>({...parent,id:`${parent.id}:video:${video.index}`,kind:'video',...(video.media?.source_fingerprint?{resource_fingerprint:video.media.source_fingerprint}:{}),title:`${parent.title} · 视频 ${video.index+1}`,order:video.index,
    status:video.task_recorded===true?'completed':video.media&&video.media.position>0?'in_progress':'not_started',prerequisites:[]}));
  return [...videos,...reading.quizzes.map((quiz):LearningTask=>({...parent,id:`${parent.id}:quiz:${quiz.index}`,kind:'chapter_quiz',title:`${parent.title} · 章节测验 ${quiz.index+1}`,order:videos.length+quiz.index,
    status:quiz.submission_confirmed&&quiz.task_recorded?'completed':'not_started',prerequisites:videos.map(video=>video.id)})),...(reading.excluded_resources??[]).map((resource):LearningTask=>({...parent,id:`${parent.id}:excluded:${resource.index}`,kind:'excluded',title:resource.title,order:videos.length+reading.quizzes.length+resource.index,status:'not_started',prerequisites:[]}))];
}
