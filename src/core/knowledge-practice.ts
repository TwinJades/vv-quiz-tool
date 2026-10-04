import {ModelCallBudget} from './call-budget';
import type {RunStrategy} from './schema';
import type {SessionRuntimeSnapshot} from './orchestrator';

export interface KnowledgePoint {id:string;title:string;order:number;}
export interface KnowledgeCatalog {course_id:string;context_id:string;title:string;revision:string;points:KnowledgePoint[];}
export type KnowledgeOutcome={id:string;title:string;status:'submitted'|'existing_record'|'no_practice';score:string|null};
export interface KnowledgeRuntime {title:string;phase:string;scope:string[];current_point:string|null;results:KnowledgeOutcome[];model_notice?:string|null;checkpoint?:{catalog:KnowledgeCatalog;index:number;child_active:boolean};}
export interface PracticeChild {
  run(signal:AbortSignal):Promise<void>;resume(signal:AbortSignal):Promise<void>;pause(reason?:string):void;switchStrategy(strategy:RunStrategy):void;
  snapshot():SessionRuntimeSnapshot;
}
export interface KnowledgeAdapter {
  catalog(signal:AbortSignal):Promise<KnowledgeCatalog>;
  prepare(point:KnowledgePoint,signal:AbortSignal):Promise<'practice'|'existing_record'|'no_practice'>;
  returnToDirectory(point:KnowledgePoint,signal:AbortSignal):Promise<void>;
  pausePlayback(point:KnowledgePoint):Promise<void>;
}
export function validateKnowledgeScope(catalog:KnowledgeCatalog,scope:string[]):void {
  if(!catalog.course_id||!catalog.context_id||!scope.length||new Set(scope).size!==scope.length||
    new Set(catalog.points.map(p=>p.id)).size!==catalog.points.length||scope.some(id=>!catalog.points.some(p=>p.id===id)))
    throw new Error('请选择已读取且不重复的知到知识点范围。');
}

/** One initial attempt per selected knowledge point. Existing records are kept;
 * unknown retry/pass rules never authorize another attempt or video completion. */
export class KnowledgePracticeOrchestrator {
  #state:SessionRuntimeSnapshot['state']='CREATED';#notice:string|null=null;#phase='待启动';
  #results=new Map<string,KnowledgeOutcome>();#current:KnowledgePoint|null=null;#child:PracticeChild|null=null;#index=0;
  #abort:AbortController|null=null;#running=false;#cleanup:Promise<void>=Promise.resolve();#stopped=false;
  #modelNotice:string|null=null;
  constructor(private adapter:KnowledgeAdapter,private makeChild:(point:KnowledgePoint,onUpdate:()=>void,signal:AbortSignal)=>Promise<PracticeChild>,
    private options:{session_id:string;catalog:KnowledgeCatalog;scope:string[];strategy:RunStrategy;provider_profile_id:string;model_id:string;budget:ModelCallBudget;on_update?:(snapshot:SessionRuntimeSnapshot)=>void;restore?:SessionRuntimeSnapshot}){
    validateKnowledgeScope(options.catalog,options.scope);
    if(options.restore){
      const old=options.restore,practice=old.practice,checkpoint=practice?.checkpoint;
      if(!checkpoint||checkpoint.child_active||old.state!=='PAUSED'||old.session_id!==options.session_id||
        old.provider_profile_id!==options.provider_profile_id||old.model_calls.used!==options.budget.used||old.model_calls.limit!==options.budget.limit||
        JSON.stringify(practice.scope)!==JSON.stringify(options.scope)||JSON.stringify(checkpoint.catalog)!==JSON.stringify(options.catalog)||
        !Number.isInteger(checkpoint.index)||checkpoint.index<0||checkpoint.index>options.scope.length)throw new Error('知识点恢复断点不安全，禁止重新提交。');
      const selected=options.catalog.points.filter(p=>options.scope.includes(p.id)).sort((a,b)=>a.order-b.order);
      for(const result of practice.results){const at=selected.findIndex(p=>p.id===result.id&&p.title===result.title);
        if(at<0||at>checkpoint.index||this.#results.has(result.id)||!['submitted','existing_record','no_practice'].includes(result.status))throw new Error('知识点结果与恢复断点不一致。');
        this.#results.set(result.id,{...result});
      }
      if(selected.slice(0,checkpoint.index).some(p=>!this.#results.has(p.id)))throw new Error('知识点恢复断点遗漏先前结果。');
      this.options.model_id=old.model_id;this.#modelNotice=practice.model_notice??null;
      this.#index=checkpoint.index;this.#current=selected[this.#index]??null;this.#state='PAUSED';this.#phase=practice.phase;this.#notice='已恢复知识点安全断点；继续前重新核对页面。';
    }
  }
  snapshot():SessionRuntimeSnapshot {
    const results=[...this.#results.values()],submitted=results.filter(r=>r.status==='submitted').length;
    return {session_id:this.options.session_id,state:this.#state,strategy:this.options.strategy,observation_input_mode:'structured',
      provider_profile_id:this.options.provider_profile_id,model_id:this.#child?.snapshot().model_id??this.options.model_id,
      model_calls:{used:this.options.budget.used,limit:this.options.budget.limit},progress:{total:this.options.scope.length,answered:submitted,
        guessed:0,retried:0,skipped:results.length-submitted,failed:0},notice:this.#notice??this.#modelNotice,
      practice:{title:this.options.catalog.title,phase:this.#phase,scope:[...this.options.scope],current_point:this.#current?.id??null,results,model_notice:this.#modelNotice,
        checkpoint:{catalog:structuredClone(this.options.catalog),index:this.#index,child_active:this.#child!==null}},
      summary:this.#state==='COMPLETE'?{session_id:this.options.session_id,status:'completed',total:this.options.scope.length,answered:submitted,
        guessed:0,retried:0,skipped:results.length-submitted,failed:0,model_calls:this.options.budget.used,visible_score:null,
        stop_reason:'本次知识点练习范围已核对；视频、文档和期末考试未纳入。'}:null};
  }
  #emit(state:SessionRuntimeSnapshot['state'],phase:string,notice:string|null=null):void {this.#state=state;this.#phase=phase;this.#notice=notice;this.options.on_update?.(this.snapshot());}
  modelChanged(id:string,reason:string):void {this.options.model_id=id;this.#modelNotice=reason;this.options.on_update?.(this.snapshot());}
  switchStrategy(strategy:RunStrategy):void {this.options.strategy=strategy;this.#child?.switchStrategy(strategy);this.options.on_update?.(this.snapshot());}
  pause(reason='知识点练习已暂停；继续时重新核对当前页面。'):void {
    if(['COMPLETE','CANCELLED'].includes(this.#state))return;
    this.#abort?.abort();this.#child?.pause(reason);
    if(this.#current)this.#cleanup=this.adapter.pausePlayback(this.#current).catch(()=>{this.#notice='暂停后无法确认视频停止，请检查播放器。';this.options.on_update?.(this.snapshot());});
    this.#emit('PAUSED',this.#phase,reason);
  }
  stop(reason='知识点练习已停止。'):void {this.pause(reason);this.#stopped=true;this.#emit('CANCELLED',this.#phase,reason);}
  async resume():Promise<void>{if(this.#state!=='PAUSED')throw new Error('只有暂停的知识点任务可以继续。');await this.run();}
  async run():Promise<void> {
    if(this.#running||this.#stopped||this.#state==='COMPLETE')return;
    this.#running=true;const controller=new AbortController();this.#abort=controller;const signal=controller.signal;
    try {
      await this.#cleanup;signal.throwIfAborted();
      const points=this.options.catalog.points.filter(p=>this.options.scope.includes(p.id)).sort((a,b)=>a.order-b.order);
      for(;this.#index<points.length;this.#index++) {
        const point=points[this.#index]!;
        signal.throwIfAborted();this.#current=point;
        if(!this.#results.has(point.id)){
          if(!this.#child){
            this.#emit('WAIT_READY','核对知识点与历史记录');
            const catalog=await this.adapter.catalog(signal);signal.throwIfAborted();
            if(catalog.course_id!==this.options.catalog.course_id||catalog.context_id!==this.options.catalog.context_id||
              this.options.scope.some(id=>{const old=this.options.catalog.points.find(p=>p.id===id)!;const fresh=catalog.points.find(p=>p.id===id);return !fresh||fresh.title!==old.title;}))
              throw new Error('所选课程或知识点清单已改变。');
            const prepared=await this.adapter.prepare(point,signal);signal.throwIfAborted();
            if(prepared!=='practice')this.#results.set(point.id,{id:point.id,title:point.title,status:prepared,score:null});
            else this.#child=await this.makeChild(point,()=>{if(!signal.aborted)this.options.on_update?.(this.snapshot());},signal);
          }
          if(this.#child){
            signal.throwIfAborted();
            this.#emit('SOLVE','处理 '+point.title);this.#child.switchStrategy(this.options.strategy);
            if(this.#child.snapshot().state==='PAUSED')await this.#child.resume(signal);else await this.#child.run(signal);
            signal.throwIfAborted();const result=this.#child.snapshot();
            if(result.state!=='COMPLETE')throw new Error(result.notice??'本次知识点练习提交尚未确认。');
            this.options.model_id=result.model_id;
            this.#results.set(point.id,{id:point.id,title:point.title,status:'submitted',score:result.summary?.visible_score??null});
            this.#child=null;
          }
        }
        this.#emit('ADVANCE','正常返回目录');await this.adapter.returnToDirectory(point,signal);signal.throwIfAborted();
        // Marking the result precedes navigation. A failed return resumes only
        // navigation, never creates another child or consumes another attempt.
        this.#current=null;
      }
      this.#emit('COMPLETE','本次知识点练习范围已核对','已分别记录新提交、已有记录和免考项；视频与整门课程未验收。');
    }catch(error){if(!signal.aborted)this.pause(error instanceof Error?error.message:String(error));}
    finally{this.#running=false;if(this.#abort===controller)this.#abort=null;}
  }
}
