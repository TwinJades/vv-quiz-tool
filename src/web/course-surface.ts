import {z} from 'zod';
import type {SemanticElement} from './initial-snapshot';

const reference=z.string().min(1);
const row=z.object({id:reference,root_id:reference,enter_id:reference,title:reference,chapter_id:reference,prerequisites:z.array(reference),status_id:z.string().nullable(),status:z.enum(['not_started','in_progress','completed','locked','unknown'])}).strict();
export const courseSurfaceSchema=z.object({
  capture_id:reference,stage:z.enum(['directory','lesson','quiz','result','unknown']),
  course_id:reference,context_id:z.string().nullable(),title:reference,current_lesson_id:z.string().nullable(),current_resource_id:z.string().nullable(),
  directory_root_id:z.string().nullable(),lessons:z.array(row),
  expand_ids:z.array(reference),more_id:z.string().nullable(),previous_id:z.string().nullable(),scroll_root_id:z.string().nullable(),busy:z.boolean(),total:z.number().int().nonnegative().nullable(),
  resources_complete:z.boolean(),
  resources_total:z.number().int().nonnegative().nullable(),
  resources:z.array(row.extend({kind:z.enum(['video','lesson_quiz','chapter_quiz','excluded'])})),
  controls:z.array(z.object({id:reference,role:z.enum(['play','pause','mute','back','directory','retry','rewatch','record'])}).strict()),
  video_root_id:z.string().nullable(),quiz_root_id:z.string().nullable(),
  record_ids:z.array(reference),submission_ids:z.array(reference),passed:z.boolean().nullable(),
  quiz_rules:z.object({scored:z.boolean().nullable(),retry_allowed:z.boolean().nullable(),remaining_attempts:z.number().int().nonnegative().nullable(),requires_pass:z.boolean().nullable(),requires_rewatch:z.boolean().nullable()}),
  speed_allowed:z.boolean().nullable(),visibility_required:z.boolean().nullable(),
}).strict();
export type CourseSurfaceReading=z.infer<typeof courseSurfaceSchema>;
export interface CourseSurfaceSnapshot {
  intent?:'directory'|'resources'|'task';
  parent_course?:CourseFrameContext;
  active_task?:Pick<import('../core/course').LearningTask,'id'|'lesson_id'|'kind'|'title'>;
  capture_id:string;url:string;title:string;native:boolean;visible_text:string;
  elements:Array<SemanticElement&{attributes:Record<string,string>}>;
}
export interface CourseFrameContext {course_id:string;context_id:string|null;title:string;current_lesson_id:string;current_resource_id:string;source_url:string;frame_url:string;kind:'video'|'quiz'}
export interface CourseEmbeddedFrame {kind:'video'|'quiz';url:string;context:CourseFrameContext}
export function courseResourceTasks(parent:import('../core/course').LearningTask,resources:CourseSurfaceReading['resources']):import('../core/course').LearningTask[]{
  return resources.map((row,order)=>({...parent,id:`${parent.id}:${row.kind}:${row.id}`,resource_id:row.id,kind:row.kind,title:row.title,status:row.status,order,prerequisites:row.prerequisites.map(id=>{const dependency=resources.find(resource=>resource.id===id);if(!dependency)throw new Error('资源前置条件尚未发现。');return `${parent.id}:${dependency.kind}:${dependency.id}`;})}));
}

export function courseSnapshotHasIdentity(snapshot:CourseSurfaceSnapshot,courseId:string,contextId:string|null):boolean {
  if(snapshot.parent_course)return snapshot.parent_course.course_id===courseId&&snapshot.parent_course.context_id===contextId;
  const url=new URL(snapshot.url),courseKeys=['courseId','courseid','recruitAndCourseId'],contextKeys=['clazzid','classId'];
  const courses=courseKeys.flatMap(key=>url.searchParams.getAll(key)),contexts=contextKeys.flatMap(key=>url.searchParams.getAll(key));
  const attributes=snapshot.elements.map(element=>element.attributes);
  const course= courses.length?courses.every(id=>id===courseId):url.pathname.split('/').includes(courseId)||attributes.some(value=>[value.courseid,value['data-course-id']].includes(courseId));
  const context=contextId===null?contexts.length===0:contexts.length?contexts.every(id=>id===contextId):url.pathname.split('/').includes(contextId)||attributes.some(value=>value.clazzid===contextId);
  return course&&context;
}

export function courseSurfaceFingerprint(snapshot:CourseSurfaceSnapshot):string {
  const timed=new Set<string>();
  const elements=snapshot.elements.map(element=>{
    if(element.parent_id&&timed.has(element.parent_id)||element.classes.some(name=>/vjs-(?:current-time|remaining-time|duration|text-track|progress)/.test(name)))timed.add(element.element_id);
    if(timed.has(element.element_id))return null;
    return {...element,text:element.text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g,'TIME')};
  }).filter(element=>element!==null);
  return JSON.stringify({url:snapshot.url,native:snapshot.native,parent_course:snapshot.parent_course,elements});
}
