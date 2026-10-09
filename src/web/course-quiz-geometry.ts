import type {VisualGeometry,VisualRect} from '../core/visual';
import {captureVisualGeometry} from './visual-geometry';
import {isExplicitlyHidden,isElementType} from './dom-utils';

export function scrollCourseQuizIntoView(document:Document,root:HTMLElement):void {
  root.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  let current=root.ownerDocument;
  const initial=root.getBoundingClientRect();
  let region:VisualRect={x:initial.x,y:initial.y,width:initial.width,height:initial.height};
  while(current!==document){
    const frame=current.defaultView?.frameElement;
    if(!frame||!isElementType(frame,'iframe')||!frame.offsetWidth||!frame.offsetHeight)throw new Error('测验正常滚动所属框架无法确认。');
    const project=()=>{const bounds=frame.getBoundingClientRect(),sx=bounds.width/frame.offsetWidth,sy=bounds.height/frame.offsetHeight;
      return {x:bounds.x+(frame.clientLeft+region.x)*sx,y:bounds.y+(frame.clientTop+region.y)*sy,width:region.width*sx,height:region.height*sy};};
    const view=frame.ownerDocument.defaultView;if(!view)throw new Error('测验所属页面没有活动窗口。');
    for(let container=frame.parentElement;container;container=container.parentElement){
      const style=view.getComputedStyle(container);
      if(/auto|scroll/.test(style.overflowY)&&container.scrollHeight>container.clientHeight){const target=project(),bounds=container.getBoundingClientRect();container.scrollBy({top:target.y+target.height/2-bounds.y-container.clientHeight/2,behavior:'instant'});}
    }
    const target=project();view.scrollBy({top:target.y+target.height/2-view.innerHeight/2,left:target.x+target.width/2-view.innerWidth/2,behavior:'instant'});
    region=project();current=frame.ownerDocument;
  }
}

export function courseQuizGeometry(document:Document,root:HTMLElement,blocker:string|null):VisualGeometry {
  if(!root.isConnected||isExplicitlyHidden(root))throw new Error('测验截图范围不可用。');
  const bounds=root.getBoundingClientRect();
  let region:VisualRect={x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
  let current=root.ownerDocument;
  while(current!==document){
    const frame=current.defaultView?.frameElement;
    if(!frame||!isElementType(frame,'iframe')||isExplicitlyHidden(frame))throw new Error('测验截图所属框架无法确认。');
    const view=current.defaultView;
    if(!view||region.x<0||region.y<0||region.x+region.width>view.innerWidth||region.y+region.height>view.innerHeight)throw new Error('请通过页面正常滚动完整显示测验范围。');
    const rect=frame.getBoundingClientRect();
    if(!frame.offsetWidth||!frame.offsetHeight)throw new Error('测验框架没有实际尺寸。');
    const sx=rect.width/frame.offsetWidth,sy=rect.height/frame.offsetHeight;
    if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=0||sy<=0)throw new Error('测验框架坐标无效。');
    region={x:rect.x+(frame.clientLeft+region.x)*sx,y:rect.y+(frame.clientTop+region.y)*sy,width:region.width*sx,height:region.height*sy};
    current=frame.ownerDocument;
  }
  const geometry=captureVisualGeometry(document,blocker);
  if(region.width<=0||region.height<=0||region.x<0||region.y<0||region.x+region.width>geometry.viewport.width||region.y+region.height>geometry.viewport.height)throw new Error('请通过页面正常滚动完整显示测验范围。');
  return {...geometry,region,canvas_surface:false,isolated_canvas:false};
}
