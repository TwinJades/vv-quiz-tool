import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelCallBudget } from '../../src/core/call-budget';
import { CourseQuizService } from '../../src/extension/course-platform';
import type { CourseTabPlatform } from '../../src/extension/course-platform';
import type { LearningTask, QuizBoundary } from '../../src/core/course';
import type { ProviderProfile } from '../../src/core/schema';

const fakes=vi.hoisted(()=>({outcomes:[] as string[],models:[] as string[],replacements:[] as string[],budgets:[] as unknown[]}));
vi.mock('../../src/provider/solver-provider',()=>({VercelAiSolverProvider:class {
  constructor(_profile:unknown,model:string,_key:unknown,budget:unknown){fakes.models.push(model);fakes.budgets.push(budget);}
}}));
vi.mock('../../src/core/orchestrator',()=>({QuizOrchestrator:class {
  state='CREATED';notice:string|null=null;
  constructor(_platform:unknown,_solver:unknown,_verifier:unknown,private options:{model_call_budget:ModelCallBudget}){}
  async run(){this.options.model_call_budget.consume();const result=fakes.outcomes.shift()??'COMPLETE';this.state=result==='COMPLETE'?'COMPLETE':'PAUSED';this.notice=this.state==='PAUSED'?result:null;}
  async resume(){await this.run();}
  snapshot(){return {state:this.state,notice:this.notice,progress:{retried:0},summary:{visible_score:'46%'}};}
  pause(){this.state='PAUSED';} switchStrategy(){}
  replaceSolver(_solver:unknown,id:string){fakes.replacements.push(id);}
}}));

const task:LearningTask={id:'v',lesson_id:'l',chapter_id:'c',title:'fixture',kind:'video',order:0,status:'in_progress',prerequisites:[]};
const boundary:QuizBoundary={id:'popup',course_id:'course',task_id:'v',kind:'video_popup',rules:{scored:false,retry_allowed:true,remaining_attempts:3,requires_pass:false,requires_rewatch:false}};
const profile:ProviderProfile={schema_version:'1.0',provider_profile_id:'p',display_name:'Fixture',provider_type:'openai_compatible',base_url:'https://fixture.invalid/v1',secret_ref:'unused',model_catalog:{source:'manual',models:['gemini-3.1-pro','other-model','gemini-3.8-flash','gemini-3.7-flash'],refreshed_at:null},capabilities:{image_input:false,structured_output:true,native_web_search:false},image_upload_authorized:false};
function setup(limit=10){
  const state={completed:false,feedback:null,visible_score:null};
  const parent={quizRequest:vi.fn(async()=>state),rewatch:vi.fn(async()=>true)};
  const budget=new ModelCallBudget(limit);
  return {parent,state,budget,service:new CourseQuizService(parent as unknown as CourseTabPlatform,profile,undefined,budget,[task])};
}
afterEach(()=>{fakes.outcomes=[];fakes.models=[];fakes.replacements=[];fakes.budgets=[];});
describe('course quiz reconciliation, retries and authorized model fallback',()=>{
  it('reconciles a completed submission without another solver or action',async()=>{
    const f=setup();f.state.completed=true;
    expect(await f.service.run(boundary,'unattended',new AbortController().signal)).toMatchObject({status:'completed',submission_confirmed:true});
    expect(fakes.models).toEqual([]);expect(f.budget.used).toBe(0);
  });
  it('falls back through only configured authorized models while preserving one budget',async()=>{
    const f=setup();fakes.outcomes=['Provider is temporarily unavailable. HTTP 503.','The configured model is unavailable.','COMPLETE'];
    const notice=vi.fn();f.service.onModelChange(notice);
    expect(await f.service.run(boundary,'unattended',new AbortController().signal)).toMatchObject({status:'completed'});
    expect(fakes.models).toEqual(['gemini-3.8-flash','gemini-3.7-flash','gemini-3.1-pro']);
    expect(fakes.budgets.every(b=>b===f.budget)).toBe(true);expect(f.budget.used).toBe(3);expect(notice).toHaveBeenCalledTimes(2);
  });
  it.each(['Provider is temporarily unavailable. HTTP 429.','Provider rejected the local configuration.','permission denied','invalid structured answer'])('does not switch models for %s',async reason=>{
    const f=setup();fakes.outcomes=[reason];expect(await f.service.run(boundary,'supervised',new AbortController().signal)).toMatchObject({status:'paused'});
    expect(fakes.models).toEqual(['gemini-3.8-flash']);expect(f.budget.used).toBe(1);
  });
  it('does not switch when the shared budget is exhausted',async()=>{
    const f=setup(1);fakes.outcomes=['Provider is temporarily unavailable. HTTP 503.'];
    expect(await f.service.run(boundary,'unattended',new AbortController().signal)).toMatchObject({status:'paused'});expect(fakes.models).toHaveLength(1);
  });
  it('does not act when cancelled or attempts are exhausted',async()=>{
    const f=setup();const controller=new AbortController();controller.abort();
    await expect(f.service.run(boundary,'unattended',controller.signal)).rejects.toMatchObject({name:'AbortError'});
    await expect(f.service.run({...boundary,rules:{...boundary.rules,remaining_attempts:0}},'unattended',new AbortController().signal)).rejects.toThrow(/剩余/);
    expect(fakes.models).toEqual([]);expect(f.parent.rewatch).not.toHaveBeenCalled();
  });
});
