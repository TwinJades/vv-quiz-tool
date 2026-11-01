import type {LearningTask} from '../core/course';
import type {CourseSpeedTarget} from '../web/course-adapter';
import {VisualTransport} from './visual-transport';

export class CourseVideoInput {
  #transport:VisualTransport|null=null;
  #task:LearningTask|null=null;
  #signal:AbortSignal|null=null;
  capturedAt=0;
  constructor(private tabId:number,private target:(task:LearningTask,signal:AbortSignal)=>Promise<CourseSpeedTarget|null>,private binding:()=>{session_id:string;epoch:string;enabled:boolean}){}
  async hover(task:LearningTask,signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();this.#task=task;this.#signal=signal;
    this.#transport??=new VisualTransport(this.tabId,async()=>{
      if(!this.#task||!this.#signal)throw new Error('悬停缺少活动视频。');
      this.#signal.throwIfAborted();const fresh=await this.target(this.#task,this.#signal);if(!fresh)throw new Error('课程播放器悬停范围已经改变。');return fresh.geometry;
    },()=>{const binding=this.binding();return binding.enabled?binding:null;},async()=>{},false);
    const binding=this.binding();if(!binding.enabled)throw new Error('课程输入控制已取消。');
    await this.#transport.hoverNormalControl(async()=>{
      const target=await this.target(task,signal);signal.throwIfAborted();if(!target)throw new Error('课程播放器没有正常悬停目标。');
      return {...target,session_id:binding.session_id,interaction_epoch:binding.epoch};
    },signal);
    signal.throwIfAborted();this.capturedAt=Date.now();
  }
  async close():Promise<void>{this.capturedAt=0;this.#task=null;this.#signal=null;await this.#transport?.close();this.#transport=null;}
}
