import {afterEach,describe,expect,it,vi} from 'vitest';
import {COURSE_RECORD_PREFIX} from '../../src/extension/course-record';

const courseUrl='https://mooc1.chaoxing.com/course?courseId=11&clazzid=33';
const catalog={course_id:'11',context_id:'33',platform:'chaoxing',title:'课程',revision:'',complete:true,tasks:[],rules:{visibility_required:null,speed_allowed:null},diagnostics:[]};
const snapshot={session_id:'session',provider_profile_id:'missing',state:'PAUSED',strategy:'unattended',model_calls:{used:4,limit:10},course:{title:'课程',checkpoint:{catalog,pending_submission:{task_id:'quiz',status:'unknown'}}}};
const request={tab_id:1,provider_profile_id:'missing',model_call_limit:10};
const record={snapshot,request,url:courseUrl,updated_at:1};

function storage(initial:Record<string,unknown>){
  const values={...initial};
  return {values,get:vi.fn(async (key:string|null)=>key===null?{...values}:{[key]:values[key]}),set:vi.fn(async (entries:Record<string,unknown>)=>{Object.assign(values,entries);}),remove:vi.fn(async (keys:string|string[])=>{for(const key of Array.isArray(keys)?keys:[keys])delete values[key];})};
}

async function background(tabUrl:string){
  vi.resetModules();
  vi.useFakeTimers({toFake:['setInterval','clearInterval']});
  const local=storage({[COURSE_RECORD_PREFIX+'session']:record});
  const session=storage({'vv-session-snapshot:1':snapshot,'vv-start-request:1':request});
  const listeners:Array<(request:unknown,sender:unknown,reply:(value:unknown)=>void)=>boolean>=[];
  const event=()=>({addListener:vi.fn()});
  const tabs={get:vi.fn(async(id:number)=>({id,url:tabUrl,title:'原标签',windowId:3})),update:vi.fn(async(id:number,changes:unknown)=>({id,...changes as object})),create:vi.fn(async({url}:{url:string})=>({id:2,url})) ,onRemoved:event()};
  vi.stubGlobal('chrome',{
    storage:{local,session},tabs,windows:{update:vi.fn(async()=>({}))},
    runtime:{onMessage:{addListener:(listener:typeof listeners[number])=>listeners.push(listener)},onConnect:event()},
    permissions:{onAdded:event(),onRemoved:event()},
    webNavigation:{onBeforeNavigate:event(),onCommitted:event(),onHistoryStateUpdated:event()},
    debugger:{onDetach:event()},
  });
  // 后台模块注册监听器时读取全局 chrome；每个案例需要在安装独立模拟后重新加载。
  await import('../../src/extension/background');
  const send=(message:unknown)=>new Promise<{ok:boolean;result:any;error?:string}>(resolve=>listeners[0]!(message,{},value=>resolve(value as {ok:boolean;result:any;error?:string})));
  return {local,session,tabs,send};
}

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('离开课程后的保存任务入口',()=>{
  it('任务面板显示原课程和保存入口，不把离开的标签当成可继续任务',async()=>{
    const {send}=await background('https://mooc1.chaoxing.com/space/index');
    const response=await send({type:'VV_GET_TASKS'});
    expect(response.ok).toBe(true);
    expect(response.result.tasks).toHaveLength(1);
    expect(response.result.tasks[0]).toMatchObject({tab_id:1,saved_session_id:'session',title:'课程',url:courseUrl,resumable:false,snapshot:{notice:expect.stringContaining('原任务标签已离开课程')}});
  });

  it('并发打开同一断点只创建一个新标签，保留预算和待核对提交且不导航旧标签',async()=>{
    const {send,tabs,session,local}=await background('https://mooc1.chaoxing.com/space/index');
    let release!:()=>void;
    tabs.create.mockImplementation(async({url}:{url:string})=>{await new Promise<void>(resolve=>{release=resolve;});return {id:2,url};});
    const first=send({type:'VV_OPEN_SAVED_COURSE',session_id:'session'});
    const second=send({type:'VV_OPEN_SAVED_COURSE',session_id:'session'});
    await vi.waitFor(()=>expect(tabs.create).toHaveBeenCalledTimes(1));
    release();
    const results=await Promise.all([first,second]);
    expect(results.map(result=>result.ok)).toEqual([true,true]);
    expect(tabs.create).toHaveBeenCalledWith({url:courseUrl});
    expect(tabs.update).not.toHaveBeenCalled();
    expect(local.values[COURSE_RECORD_PREFIX+'session']).toEqual(record);
    expect(session.values['vv-session-snapshot:1']).toBeUndefined();
    expect(session.values['vv-session-snapshot:2']).toMatchObject({session_id:'session',model_calls:{used:4,limit:10},course:{checkpoint:{pending_submission:{task_id:'quiz',status:'unknown'}}}});
    expect(session.values['vv-start-request:2']).toEqual({...request,tab_id:2});
  });

  it('原绑定仍在匹配课程时只聚焦原标签',async()=>{
    const {send,tabs}=await background(courseUrl);
    const response=await send({type:'VV_OPEN_SAVED_COURSE',session_id:'session'});
    expect(response.ok).toBe(true);
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(1,{active:true});
  });
});
