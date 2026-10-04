import { expect, it, vi } from 'vitest';
import { ModelCallBudget } from '../../src/core';
import type { ProviderProfile } from '../../src/core';
import { VercelAiSolverProvider } from '../../src/provider/solver-provider';
import { capture } from '../fixtures/visual';

it('sends initial viewport context before the independent coordinate image through the actual SDK',async()=>{
  const profile: ProviderProfile={schema_version:'1.0',provider_profile_id:'p',display_name:'Owned test',
    provider_type:'openai_compatible',base_url:'https://owned.test/v1',secret_ref:'local',
    model_catalog:{source:'manual',models:['test'],refreshed_at:null},
    capabilities:{image_input:true,structured_output:true,native_web_search:false},image_upload_authorized:true};
  let body: {messages:Array<{role:string;content:Array<{type:string;text?:string;image_url?:{url:string}}>}>}|undefined;
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
    body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({error:{message:'Controlled test rejection'}}),{status:400,headers:{'content-type':'application/json'}});
  });
  const solver=new VercelAiSolverProvider(profile,'test','unused',new ModelCallBudget(2),fetcher);
  const shot=capture();shot.data=new Uint8Array([3,4]);
  shot.viewport_context={data:new Uint8Array([1,2]),width:1200,height:720};
  await expect(solver.recognizeVisual(shot,new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const content=body!.messages.find(message=>message.role==='user')!.content;
  expect(content.filter(part=>part.type==='image_url').map(part=>part.image_url!.url)).toEqual([
    'data:image/png;base64,AQI=','data:image/png;base64,AwQ=',
  ]);
  const metadata=JSON.parse(content.filter(part=>part.type==='text').at(-1)!.text!);
  expect(metadata).toMatchObject({width:shot.frame.width,height:shot.frame.height,visual_frame_id:shot.frame.visual_frame_id});
});
