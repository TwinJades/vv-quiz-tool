import type {VisualRect} from '../core/visual';
type VisualPoint={x:number;y:number};

export interface CourseFrameRect {rect:VisualRect;width:number;height:number;left:number;top:number}
export function projectCourseFrame(point:VisualPoint,region:VisualRect,frame:CourseFrameRect):{point:VisualPoint;region:VisualRect}{
  const values=[point.x,point.y,region.x,region.y,region.width,region.height,frame.rect.x,frame.rect.y,frame.rect.width,frame.rect.height,frame.width,frame.height,frame.left,frame.top];
  if(values.some(value=>!Number.isFinite(value))||frame.width<=0||frame.height<=0||frame.rect.width<=0||frame.rect.height<=0||region.width<=0||region.height<=0||frame.left<0||frame.top<0)throw new Error('课程框架坐标或尺寸无效。');
  const sx=frame.rect.width/frame.width,sy=frame.rect.height/frame.height;
  return {point:{x:frame.rect.x+(frame.left+point.x)*sx,y:frame.rect.y+(frame.top+point.y)*sy},region:{x:frame.rect.x+(frame.left+region.x)*sx,y:frame.rect.y+(frame.top+region.y)*sy,width:region.width*sx,height:region.height*sy}};
}
