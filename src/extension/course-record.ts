import type {SessionRuntimeSnapshot} from '../core';
import type {CourseCatalog} from '../core/course';
import type {StartSessionRequest} from './messages';
import {publicCourseUrl} from '../web/public-course-url';

export const COURSE_RECORD_PREFIX='vv-course-record:';
export interface SavedCourseRecord {snapshot:SessionRuntimeSnapshot;request:StartSessionRequest;url:string;updated_at:number}

export async function persistCourseRecord(tabId:number,snapshot:SessionRuntimeSnapshot,preferredUrl?:string):Promise<void>{
  const checkpoint=snapshot.course?.checkpoint;if(!checkpoint)throw new Error('课程保存缺少断点。');
  if(!Number.isInteger(snapshot.model_calls.used)||snapshot.model_calls.used<0||snapshot.model_calls.used>snapshot.model_calls.limit)throw new Error('课程保存预算计数无效。');
  const stored=await chrome.storage.session.get('vv-start-request:'+tabId),request=stored['vv-start-request:'+tabId] as StartSessionRequest|undefined;
  if(!request||request.provider_profile_id!==snapshot.provider_profile_id)throw new Error('课程保存缺少原始任务配置。');
  const key=COURSE_RECORD_PREFIX+snapshot.session_id,previous=await chrome.storage.local.get(key),record=previous[key] as SavedCourseRecord|undefined;
  const catalog=checkpoint.catalog;
  const url=validCourseResumeUrl(preferredUrl,catalog)??validCourseResumeUrl(record?.url,catalog)??validCourseResumeUrl((await chrome.webNavigation.getFrame({tabId,frameId:0}))?.url,catalog);
  if(!url)throw new Error('课程保存缺少可恢复的匹配地址。');
  await chrome.storage.local.set({[key]:{snapshot:structuredClone(snapshot),request,url,updated_at:Date.now()} satisfies SavedCourseRecord});
}

export function courseResumeUrl(value:string):string {
  const url=new URL(value);
  if(url.protocol!=='https:'||!(url.hostname==='chaoxing.com'||url.hostname.endsWith('.chaoxing.com')||url.hostname==='zhihuishu.com'||url.hostname.endsWith('.zhihuishu.com')))throw new Error('课程恢复地址未授权。');
  return publicCourseUrl(value);
}

export function validCourseResumeUrl(value:string|undefined,catalog:CourseCatalog):string|null {
  if(!value)return null;
  try {
    const url=courseResumeUrl(value);
    return courseCatalogMatchesUrl(url,catalog)?url:null;
  } catch { return null; }
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
