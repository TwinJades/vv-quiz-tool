import {describe,expect,it} from 'vitest';
import {assertInteractionActive,AutomationExecution} from '../../src/extension/interaction-guard';

describe('取消和异步操作的纯逻辑',()=>{
  it('取消之后到达的异步结果不能执行动作',async()=>{
    const controller=new AbortController(),binding={session_id:'course',epoch:'epoch',enabled:true};
    let actions=0;
    const delayed=Promise.resolve().then(()=>{assertInteractionActive(binding,controller.signal,'course','epoch');actions++;});
    controller.abort();await expect(delayed).rejects.toThrow(/cancelled/);expect(actions).toBe(0);
  });
  it('已经停用或属于其他会话和恢复时期的动作被拒绝',()=>{
    const signal=new AbortController().signal,binding={session_id:'course',epoch:'new',enabled:true};
    expect(()=>assertInteractionActive(binding,signal,'course','new')).not.toThrow();
    expect(()=>assertInteractionActive(binding,signal,'course','old')).toThrow();
    expect(()=>assertInteractionActive(binding,signal,'other','new')).toThrow();
    expect(()=>assertInteractionActive({...binding,enabled:false},signal,'course','new')).toThrow();
  });
  it('异步操作完成之前保留操作状态，多个操作分别结束',async()=>{
    const execution=new AutomationExecution();let finish!:()=>void;
    const pending=execution.run(()=>new Promise<void>(resolve=>{finish=resolve;}));
    expect(execution.depth).toBe(1);
    expect(execution.run(()=>42)).toBe(42);expect(execution.depth).toBe(1);
    finish();await pending;expect(execution.depth).toBe(0);
  });
  it('异常操作结束后释放操作状态并保留原异常',async()=>{
    const execution=new AutomationExecution(),error=new Error('operation failed');
    expect(()=>execution.run(()=>{throw error;})).toThrow(error);expect(execution.depth).toBe(0);
    const pending=execution.run(async()=>{throw error;});await expect(pending).rejects.toThrow(error);expect(execution.depth).toBe(0);
  });
});
