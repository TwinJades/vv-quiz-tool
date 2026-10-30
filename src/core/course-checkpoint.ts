import type {CourseCatalog,LearningTask,QuizBoundary} from './course';
import type {SessionRuntimeSnapshot} from './orchestrator';

export const COURSE_CHECKPOINT_VERSION=2;

export function migrateCourseCheckpoint(saved:SessionRuntimeSnapshot,fresh:LearningTask[],catalog:CourseCatalog):SessionRuntimeSnapshot {
  const result=structuredClone(saved),course=result.course,checkpoint=course?.checkpoint;
  if(!course||!checkpoint)throw new Error('恢复缺少课程断点。');
  if(checkpoint.format_version===COURSE_CHECKPOINT_VERSION)return result;
  if(checkpoint.format_version!==undefined&&checkpoint.format_version!==1)throw new Error('课程断点格式版本不支持，保留原始记录。');
  if(checkpoint.catalog.course_id!==catalog.course_id||checkpoint.catalog.context_id!==catalog.context_id||checkpoint.catalog.platform!==catalog.platform)throw new Error('旧断点课程或班级身份改变。');
  const mapping=new Map<string,string>(catalog.tasks.map(task=>[task.id,task.id]));
  const migrated:LearningTask[]=[];
  for(const old of checkpoint.children){
    if(old.kind==='excluded'){migrated.push(old);mapping.set(old.id,old.id);continue;}
    const candidates=fresh.filter(task=>task.kind===old.kind&&task.lesson_id===old.lesson_id&&task.chapter_id===old.chapter_id&&Boolean(task.resource_id)&&
      (old.resource_id?old.resource_id===task.resource_id:Boolean(old.resource_fingerprint&&old.resource_fingerprint===task.resource_fingerprint)));
    if(candidates.length!==1)throw new Error(`旧断点资源无法唯一对应：${old.title}（找到 ${candidates.length} 个）。原记录保留，提交状态需要核验。`);
    const task=candidates[0]!;if([...mapping.values()].includes(task.id))throw new Error('旧断点多个资源对应同一资源，原记录保留。');
    mapping.set(old.id,task.id);migrated.push({...task});
  }
  const identity=(id:string):string=>{
    const found=mapping.get(id);if(found)return found;
    const match=[...mapping].find(([old])=>id.startsWith(`popup:${old}:`));
    if(match)return `popup:${match[1]}:${id.slice(`popup:${match[0]}:`.length)}`;
    throw new Error(`旧断点缺少资源对应证据：${id}。保留原始记录并暂停恢复。`);
  };
  const boundary=(value:QuizBoundary|null):QuizBoundary|null=>value?{...value,id:identity(value.id),task_id:identity(value.task_id)}:null;
  checkpoint.completed=checkpoint.completed.map(identity);
  checkpoint.children=migrated;checkpoint.pending_quiz=boundary(checkpoint.pending_quiz);
  if(checkpoint.quiz_child){checkpoint.quiz_child.task_id=identity(checkpoint.quiz_child.task_id);checkpoint.quiz_child.boundary_id=identity(checkpoint.quiz_child.boundary_id);}
  checkpoint.quiz_retries=checkpoint.quiz_retries?.map(([id,count])=>[identity(id),count])??[];
  checkpoint.quiz_retry_pending=checkpoint.quiz_retry_pending?identity(checkpoint.quiz_retry_pending):null;
  checkpoint.popup_retries=checkpoint.popup_retries?.map(([key,count])=>{
    const matches=[...mapping].filter(([old])=>key.startsWith(`${old}:video_popup:`));
    if(matches.length!==1)throw new Error('旧弹题重试记录缺少唯一资源证据。');
    const [old,current]=matches[0]!;return [`${current}:video_popup:${identity(key.slice(`${old}:video_popup:`.length))}`,count];
  })??[];
  checkpoint.issues=checkpoint.issues?.map(issue=>({...issue,task_id:identity(issue.task_id),...(issue.parent_id?{parent_id:identity(issue.parent_id)}:{})}))??[];
  checkpoint.excluded_tasks=checkpoint.excluded_tasks?.map(identity)??[];
  course.results=course.results.map(entry=>({...entry,id:identity(entry.id)}));
  course.current_task_id=course.current_task_id?identity(course.current_task_id):null;
  course.tasks=course.tasks.map(task=>migrated.find(fresh=>fresh.id===mapping.get(task.id))??task);
  course.issues=checkpoint.issues;
  checkpoint.format_version=COURSE_CHECKPOINT_VERSION;
  return result;
}
