// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {captureVisualGeometry} from '../../src/web/visual-geometry';
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();});
const rect=(x:number,y:number,width:number,height:number)=>({x,y,width,height,left:x,top:y,right:x+width,bottom:y+height,toJSON(){return {};}});
it('selects a unique standalone game canvas instead of surrounding game settings',()=>{
  document.body.innerHTML='<canvas></canvas><form><p>TIMER</p><label><input type="radio" name="timer">None</label><label><input type="radio" name="timer">Count down</label></form>';
  vi.spyOn(document.querySelector('canvas')!,'getBoundingClientRect').mockReturnValue(rect(20,30,500,300));
  expect(captureVisualGeometry(document,null)).toMatchObject({canvas_surface:true,region:{x:20,y:30,width:500,height:300}});
});
it('keeps a canvas diagram inside a marked DOM question on the semantic path',()=>{
  document.body.innerHTML='<fieldset><legend>Which chart is increasing?</legend><canvas></canvas><label><input type="radio">A</label><label><input type="radio">B</label></fieldset>';
  vi.spyOn(document.querySelector('canvas')!,'getBoundingClientRect').mockReturnValue(rect(20,30,500,300));
  vi.spyOn(document.querySelector('fieldset')!,'getBoundingClientRect').mockReturnValue(rect(10,10,550,400));
  expect(captureVisualGeometry(document,null).canvas_surface).toBe(false);
});
it('does not activate a hidden, tiny or ambiguous set of canvases',()=>{
  document.body.innerHTML='<canvas style="visibility:hidden"></canvas><canvas></canvas>';
  for(const canvas of document.querySelectorAll('canvas'))vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue(rect(20,30,500,300));
  expect(captureVisualGeometry(document,null).canvas_surface).toBe(true);
  document.querySelector('canvas')!.style.visibility='visible';
  expect(captureVisualGeometry(document,null).canvas_surface).toBe(false);
  document.querySelector('canvas')!.style.visibility='hidden';
  vi.mocked(document.querySelectorAll('canvas')[1]!.getBoundingClientRect).mockReturnValue(rect(20,30,50,50));
  expect(captureVisualGeometry(document,null).canvas_surface).toBe(false);
});
