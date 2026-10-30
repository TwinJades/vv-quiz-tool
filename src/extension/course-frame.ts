import type {CourseSpeedTarget} from '../web/course-adapter';
import {projectCourseFrame} from '../web/frame-projection';
import type {CourseFrameRect} from '../web/frame-projection';
import type {VisualGeometry} from '../core/visual';
import type {ContentRequest,ContentResponse} from './messages';

export async function sendCourseMessage<T>(tab:number,frame:number,request:ContentRequest,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const response=await chrome.tabs.sendMessage(tab,request,{frameId:frame}) as ContentResponse;
  signal?.throwIfAborted();if(!response?.ok)throw new Error(response?.error??'课程页面连接中断。');return response.result as T;
}
export async function projectCourseTarget(tabId:number,frameId:number,target:CourseSpeedTarget,signal:AbortSignal):Promise<CourseSpeedTarget>{
  if(frameId===0)return target;
  const frames=await chrome.webNavigation.getAllFrames({tabId});signal.throwIfAborted();
  let current=frameId,point=target.point,region=target.geometry.region;const visited=new Set<number>();
  while(current!==0){
    if(visited.has(current))throw new Error('课程播放器框架所属关系循环。');visited.add(current);
    const child=frames?.find(frame=>frame.frameId===current);if(!child||child.parentFrameId<0)throw new Error('课程播放器框架链已经改变。');
    const before=await chrome.webNavigation.getFrame({tabId,frameId:child.parentFrameId});signal.throwIfAborted();
    const rect=await sendCourseMessage<CourseFrameRect>(tabId,child.parentFrameId,{type:'VV_COURSE_FRAME_RECT',child_url:child.url},signal);
    const after=await chrome.webNavigation.getFrame({tabId,frameId:current});signal.throwIfAborted();
    const parent=await chrome.webNavigation.getFrame({tabId,frameId:child.parentFrameId});signal.throwIfAborted();
    if(!after||after.documentId!==child.documentId||after.url!==child.url||!before||parent?.documentId!==before.documentId)throw new Error('播放器坐标读取期间框架文档已经改变。');
    ({point,region}=projectCourseFrame(point,region,rect));current=child.parentFrameId;
  }
  const geometry=await sendCourseMessage<VisualGeometry>(tabId,0,{type:'VV_VISUAL_GEOMETRY',full_viewport:true},signal);
  return {...target,point,geometry:{...geometry,region},captured_at:Date.now()};
}
