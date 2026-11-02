import {describe,expect,it,vi} from 'vitest';
import {assertInteractionActive,AutomationExecution} from '../../src/extension/interaction-guard';
import {CourseTabPlatform} from '../../src/extension/course-platform';

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

describe('课程观察恢复的取消边界',()=>{
  it.each(['abort','new epoch'] as const)('恢复等待期间发生 %s 时不再重定位或重新启用旧交互',async cancellation=>{
    vi.useFakeTimers();
    let frameAvailable=true;
    const messages:Array<{type:string;binding?:{enabled:boolean;epoch:string}}>=[];
    const inject=vi.fn(async()=>[{frameId:0}]);
    vi.stubGlobal('chrome',{
      scripting:{executeScript:inject},
      webNavigation:{getFrame:async()=>frameAvailable?{documentId:'document',url:'https://mooc1.chaoxing.com/course?courseId=11&clazzid=33'}:null},
      tabs:{sendMessage:async (_tab:number,request:{type:string;binding?:{enabled:boolean;epoch:string}})=>{messages.push(request);return {ok:true,result:null};}},
    });
    try{
      const platform=new CourseTabPlatform(1,'session','11',undefined,async()=>{throw new Error('不应识别');});
      await platform.enableInteraction();
      const oldEpoch=platform.interactionBinding().epoch;
      frameAvailable=false;
      const controller=new AbortController();
      const task={id:'video',lesson_id:'lesson',kind:'video'} as Parameters<CourseTabPlatform['video']>[0];
      const pending=platform.video(task,controller.signal);
      const rejected=expect(pending).rejects.toThrow(cancellation==='abort'?/cancelled|abort/i:/USER_INTERACTION/);
      await vi.advanceTimersByTimeAsync(0);
      if(cancellation==='abort'){controller.abort(new Error('cancelled'));await platform.disableInteraction();}
      else {frameAvailable=true;await platform.enableInteraction();expect(platform.interactionBinding().epoch).not.toBe(oldEpoch);}
      const injectionCount=inject.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(inject).toHaveBeenCalledTimes(injectionCount);
      expect(messages.filter(message=>message.type==='VV_SET_INTERACTION'&&message.binding?.enabled&&message.binding.epoch===oldEpoch)).toHaveLength(1);
    }finally{vi.useRealTimers();vi.unstubAllGlobals();}
  });
});
