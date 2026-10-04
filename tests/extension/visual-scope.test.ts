import { afterEach, expect, it, vi } from 'vitest';
import type { VisualGeometry } from '../../src/core/visual';
import { capture, reading } from '../fixtures/visual';
import { TabPlatformProxy } from '../../src/extension/tab-platform';

vi.mock('../../src/extension/visual-transport',()=>({VisualTransport:class {
  constructor(_tabId:number,private geometry:()=>Promise<VisualGeometry>){}
  async capture(sessionId:string,observationId:string){
    const shot=capture();shot.frame.geometry=await this.geometry();
    shot.frame.session_id=sessionId;shot.frame.observation_id=observationId;
    return shot;
  }
  async close(){}
}}));
afterEach(()=>vi.unstubAllGlobals());

it.each(['isolated','outside','frames','lost_isolation'] as const)(
  'uses a protected crop only when local single-frame isolation survives: %s',async scenario=>{
    const geometry:VisualGeometry={...capture().frame.geometry,isolated_canvas:scenario!=='outside'};
    const requests:Array<{type:string;full_viewport?:boolean;frameId:number}>=[];
    let protection:VisualGeometry['region']|undefined;
    const sendMessage=vi.fn(async(_tab:number,request:{type:string;full_viewport?:boolean},options:{frameId:number})=>{
      requests.push({...request,frameId:options.frameId});
      if(request.type!=='VV_VISUAL_GEOMETRY')return {ok:true,result:true};
      const result=structuredClone(geometry);
      if(scenario==='lost_isolation'&&request.full_viewport===false)result.isolated_canvas=false;
      if(request.full_viewport)result.region={x:0,y:0,width:geometry.viewport.width,height:geometry.viewport.height};
      protection=result.region;
      return {ok:true,result};
    });
    vi.stubGlobal('chrome',{
      tabs:{sendMessage,get:vi.fn(async()=>({url:geometry.url}))},
      permissions:{contains:vi.fn(async()=>true)},webNavigation:{getFrame:vi.fn(async()=>({url:geometry.url}))},
      scripting:{executeScript:vi.fn(async()=>scenario==='frames'?[{frameId:0},{frameId:8}]:[{frameId:0}])},
    });
    const recognition=vi.fn(async(shot:ReturnType<typeof capture>)=>{
      expect(shot.frame.geometry.region).toEqual(protection);
      expect(shot.frame.geometry.region).toEqual(scenario==='isolated'?geometry.region:
        {x:0,y:0,width:geometry.viewport.width,height:geometry.viewport.height});
      return reading();
    });
    const platform=new TabPlatformProxy(1,'visual_snapshot',undefined,recognition);
    await platform.enableInteraction('s1');
    await platform.waitUntilReady(new AbortController().signal);
    await platform.observeSession('s1',new AbortController().signal);
    expect(recognition).toHaveBeenCalledTimes(1);
    expect(requests.some(request=>request.full_viewport===false)).toBe(scenario==='isolated'||scenario==='lost_isolation');
    await platform.disableInteraction();
  });
