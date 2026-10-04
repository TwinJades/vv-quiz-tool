import {afterEach,describe,expect,it,vi} from 'vitest';
import {TabPlatformProxy} from '../../src/extension/tab-platform';
import type {ExecutionPlan,LocatorMap} from '../../src/core/schema';
const url='https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/40/1/1/21/opaque';
const plan={session_id:'s',observation_id:'o',actions:[{action_id:'submit',kind:'submit_session',target_id:'control_submit_session'}]} as ExecutionPlan;
const map:LocatorMap={schema_version:'1.0',session_id:'s',question_id:'q',observation_id:'o',platform:'web',question_fingerprint:'fp',targets:{control_submit_session:{kind:'semantic',local_ref:'submit',role:'button'}}};
function setup(){
  const permission=vi.fn(async()=>true);
  const send=vi.fn(async(_tab:number,r:{type:string})=>({ok:true,result:r.type==='VV_OBSERVE'?{
    session_id:'s',observation_id:'o',fingerprint:'fp',surface_id:url,question_total:3,layout:'sequential',questions:[]}:
    r.type==='VV_READ_STATE'?{observation_id:'none',fingerprint:'missing',selected_target_ids:[],field_values:{},feedback:null,can_retry:false,completed:false,has_next:false}:
    r.type==='VV_READ_ZHIDAO_RESULT'?{course_id:'21',exercise_id:'40',point_id:'9',context_id:'7',total:3,correct:1,title:'fixture',submission:'unknown',passed:null}:
    r.type==='VV_EXECUTE'?[{action_id:'submit',status:'unknown'}]:true}));
  vi.stubGlobal('chrome',{tabs:{get:vi.fn(async()=>({url})),sendMessage:send},permissions:{contains:permission},
    webNavigation:{getFrame:vi.fn(async()=>({url}))}});
  return {platform:new TabPlatformProxy(1),send,permission};
}
afterEach(()=>vi.unstubAllGlobals());
describe('real-site submission navigation protection',()=>{
  it('retains an uncertain submit and reads the matching result without another action',async()=>{
    const f=setup();await f.platform.observeSession('s',new AbortController().signal);
    await f.platform.execute(plan,map,new AbortController().signal);
    expect(f.platform.hasPendingSubmission()).toBe(true);
    await expect(f.platform.execute(plan,map,new AbortController().signal)).rejects.toThrow(/重复/);
    expect(await f.platform.readState(new AbortController().signal)).toMatchObject({completed:true,visible_score:'答对 1/3',session_passed:null,can_retry:false});
    expect(f.send.mock.calls.filter(c=>c[1].type==='VV_EXECUTE')).toHaveLength(1);
  });
  it('retains the receipt when cancellation arrives after dispatch',async()=>{
    const f=setup();await f.platform.observeSession('s',new AbortController().signal);
    const control=new AbortController();f.send.mockImplementationOnce(async()=>{control.abort();return {ok:true,result:[{action_id:'submit',status:'unknown'}]} as never});
    await expect(f.platform.execute(plan,map,control.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(f.platform.hasPendingSubmission()).toBe(true);
  });
  it('does not dispatch after permission is revoked or cancellation wins the permission await',async()=>{
    const f=setup();f.permission.mockResolvedValue(false);
    await expect(f.platform.execute(plan,map,new AbortController().signal)).rejects.toThrow(/授权/);
    expect(f.send).not.toHaveBeenCalled();
    const control=new AbortController();f.permission.mockImplementation(async()=>{control.abort();return true});
    await expect(f.platform.execute(plan,map,control.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(f.send).not.toHaveBeenCalled();expect(f.platform.hasPendingSubmission()).toBe(false);
  });
});
