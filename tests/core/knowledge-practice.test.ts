import {describe,it,expect,vi} from 'vitest';
import {KnowledgePracticeOrchestrator} from '../../src/core/knowledge-practice';
import type {KnowledgeAdapter,KnowledgeCatalog,PracticeChild} from '../../src/core/knowledge-practice';
import {ModelCallBudget} from '../../src/core/call-budget';
import type {SessionRuntimeSnapshot} from '../../src/core/orchestrator';
const catalog:KnowledgeCatalog={course_id:'101',context_id:'201',title:'Local practices',revision:'one',points:[{id:'301',title:'First',order:0},{id:'302',title:'Second',order:1}]};
function fixture(){
  const budget=new ModelCallBudget(4);
  const adapter:KnowledgeAdapter={catalog:vi.fn(async()=>catalog),prepare:vi.fn(async()=> 'practice' as const),returnToDirectory:vi.fn(async()=>{}),pausePlayback:vi.fn(async()=>{})};
  const make=vi.fn(async()=>{
    let state:SessionRuntimeSnapshot['state']='CREATED';
    const child:PracticeChild={run:async(signal)=>{signal.throwIfAborted();budget.consume();state='COMPLETE';},resume:async(signal)=>{signal.throwIfAborted();budget.consume();state='COMPLETE';},pause:()=>{state='PAUSED';},switchStrategy:()=>{},
      snapshot:()=>({session_id:'child',state,strategy:'unattended',provider_profile_id:'p',model_id:'gemini-3.8-flash-high',observation_input_mode:'structured',model_calls:{used:budget.used,limit:budget.limit},progress:{total:1,answered:1,guessed:0,retried:0,skipped:0,failed:0},notice:null,summary:null})};
    return child;
  });
  const run=new KnowledgePracticeOrchestrator(adapter,make,{session_id:'parent',catalog,scope:['301','302'],strategy:'unattended',provider_profile_id:'p',model_id:'gemini-3.8-flash-high',budget});
  return {run,adapter,make,budget};
}
describe('knowledge practice parent cancellation and result boundaries',()=>{
  it('does not leave the startup cleanup wait after a synchronous pause',async()=>{
    const f=fixture();const running=f.run.run();f.run.pause();await running;
    expect(f.run.snapshot().state).toBe('PAUSED');expect(f.adapter.catalog).not.toHaveBeenCalled();expect(f.make).not.toHaveBeenCalled();
  });
  it('shares the budget across points and returns before entering the next',async()=>{
    const f=fixture();await f.run.run();expect(f.run.snapshot().state).toBe('COMPLETE');expect(f.budget.used).toBe(2);
    expect(f.run.snapshot().practice?.results.map(r=>r.status)).toEqual(['submitted','submitted']);
    expect(vi.mocked(f.adapter.returnToDirectory).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.adapter.prepare).mock.invocationCallOrder[1]!);
  });
  it('records existing/explicit no-practice states without requesting a model',async()=>{
    const f=fixture();vi.mocked(f.adapter.prepare).mockResolvedValueOnce('existing_record').mockResolvedValueOnce('no_practice');
    await f.run.run();expect(f.make).not.toHaveBeenCalled();expect(f.budget.used).toBe(0);
    expect(f.run.snapshot().practice?.results.map(r=>r.status)).toEqual(['existing_record','no_practice']);
  });
  it('resumes a failed return without another child or repeat submission',async()=>{
    const f=fixture();vi.mocked(f.adapter.returnToDirectory).mockRejectedValueOnce(new Error('network'));
    await f.run.run();expect(f.run.snapshot().state).toBe('PAUSED');expect(f.make).toHaveBeenCalledTimes(1);
    await f.run.resume();expect(f.run.snapshot().state).toBe('COMPLETE');expect(f.make).toHaveBeenCalledTimes(2);expect(f.budget.used).toBe(2);
  });
  it('restores a safe return boundary with its consumed budget and never resubmits that point',async()=>{
    const f=fixture();vi.mocked(f.adapter.returnToDirectory).mockRejectedValueOnce(new Error('network'));await f.run.run();const saved=f.run.snapshot();
    const restored=new KnowledgePracticeOrchestrator(f.adapter,f.make,{session_id:'parent',catalog,scope:['301','302'],strategy:'unattended',provider_profile_id:'p',model_id:'gemini-3.8-flash-high',budget:f.budget,restore:saved});
    await restored.resume();expect(restored.snapshot().state).toBe('COMPLETE');expect(f.budget.used).toBe(2);expect(f.make).toHaveBeenCalledTimes(2);
    const active=structuredClone(saved);active.practice!.checkpoint!.child_active=true;
    expect(()=>new KnowledgePracticeOrchestrator(f.adapter,f.make,{session_id:'parent',catalog,scope:['301','302'],strategy:'unattended',provider_profile_id:'p',model_id:'gemini-3.8-flash-high',budget:f.budget,restore:active})).toThrow(/不安全/);
  });
  it('does not run a child or move to the next point when paused during child construction',async()=>{
    const f=fixture();const original=f.make.getMockImplementation()!;let child:PracticeChild|undefined;
    f.make.mockImplementationOnce(async()=>{child=await original();f.run.pause();return child;});
    await f.run.run();expect(f.run.snapshot().state).toBe('PAUSED');expect(f.budget.used).toBe(0);
    expect(f.adapter.returnToDirectory).not.toHaveBeenCalled();expect(f.adapter.prepare).toHaveBeenCalledTimes(1);
  });
  it('retains the authorized fallback model and reason across a completed child and safe restore',async()=>{
    const f=fixture(),original=f.make.getMockImplementation()!;
    f.make.mockImplementationOnce(async()=>{const child=await original(),snapshot=child.snapshot,run=child.run;
      child.snapshot=()=>({...snapshot(),model_id:'gemini-3.7-flash-high'});
      child.run=async s=>{f.run.modelChanged('gemini-3.7-flash-high','Primary model unavailable');await run(s);};return child;});
    vi.mocked(f.adapter.returnToDirectory).mockRejectedValueOnce(new Error('network'));await f.run.run();const saved=f.run.snapshot();
    expect(saved.model_id).toBe('gemini-3.7-flash-high');expect(saved.practice?.model_notice).toBe('Primary model unavailable');
    vi.mocked(f.adapter.prepare).mockResolvedValue('no_practice');
    const restored=new KnowledgePracticeOrchestrator(f.adapter,f.make,{session_id:'parent',catalog,scope:['301','302'],strategy:'unattended',provider_profile_id:'p',model_id:'gemini-3.8-flash-high',budget:f.budget,restore:saved});
    await restored.resume();expect(restored.snapshot().state).toBe('COMPLETE');expect(restored.snapshot().model_id).toBe('gemini-3.7-flash-high');expect(f.budget.used).toBe(1);
  });
  it('rejects a changed knowledge identity before navigation or model work',async()=>{
    const f=fixture();vi.mocked(f.adapter.catalog).mockResolvedValue({...catalog,context_id:'other'});
    await f.run.run();expect(f.run.snapshot().state).toBe('PAUSED');expect(f.adapter.prepare).not.toHaveBeenCalled();expect(f.make).not.toHaveBeenCalled();
  });
});
