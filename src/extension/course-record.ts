import type {SessionRuntimeSnapshot} from '../core';
import type {CourseCatalog} from '../core/course';
import type {StartSessionRequest} from './messages';
import {publicCourseUrl} from '../web/public-course-url';

export const COURSE_RECORD_PREFIX='vv-course-record:';
export interface SavedCourseRecord {snapshot:SessionRuntimeSnapshot;request:StartSessionRequest;url:string;updated_at:number}

export function courseResumeUrl(value:string):string {
  const url=new URL(value);
  if(url.protocol!=='https:'||!(url.hostname==='chaoxing.com'||url.hostname.endsWith('.chaoxing.com')||url.hostname==='zhihuishu.com'||url.hostname.endsWith('.zhihuishu.com')))throw new Error('课程恢复地址未授权。');
  return publicCourseUrl(value);
}

export function courseCatalogMatchesUrl(value:string,catalog:CourseCatalog):boolean {
  const url=new URL(value),platform=catalog.platform==='chaoxing'?'chaoxing.com':'zhihuishu.com';
  if(url.protocol!=='https:'||!(url.hostname===platform||url.hostname.endsWith('.'+platform)))return false;
  const ids=[...url.searchParams.entries()].filter(([key])=>/^(courseId|courseid|recruitAndCourseId)$/.test(key));
  const contexts=[...url.searchParams.entries()].filter(([key])=>/^(clazzid|classId)$/.test(key));
  if(ids.length)return ids.every(([,id])=>id===catalog.course_id)&&(catalog.context_id?contexts.length>0&&contexts.every(([,id])=>id===catalog.context_id):contexts.length===0);
  const parts=url.pathname.split('/').filter(Boolean);
  return catalog.platform==='zhidao'&&parts.includes(catalog.course_id)&&Boolean(catalog.context_id&&parts.includes(catalog.context_id));
}

export function savedCourseMatches(value:string,record:SavedCourseRecord):boolean {
  const url=new URL(value),saved=new URL(record.url),catalog:CourseCatalog|undefined=record.snapshot.course?.checkpoint?.catalog;
  if(!catalog||url.protocol!=='https:'||url.hostname!==saved.hostname)return false;
  if(courseResumeUrl(value)===record.url)return true;
  return courseCatalogMatchesUrl(value,catalog);
}
