import {describe,it,expect,vi} from 'vitest';
import {QuizOrchestrator,type RuntimePlatform,type RuntimeSolver} from '../../src/core/orchestrator';
import {WebVerifier} from '../../src/web/verifier';

describe('resume with a previously dispatched submit',()=>{
  it.each([false,true])('reads only the pending result (confirmed=%s)',async confirmed=>{
    const platform={hasPendingSubmission:()=>true,readState:vi.fn(async()=>({observation_id:'o',fingerprint:'result',
      selected_target_ids:[],field_values:{},feedback:null,can_retry:false,has_next:false,completed:confirmed,visible_score:confirmed?'答对 1/3':null})),
      waitUntilReady:vi.fn(),observeSession:vi.fn(),execute:vi.fn(),resolveMedia:vi.fn()} as unknown as RuntimePlatform;
    const solver={solve:vi.fn()} as RuntimeSolver;
    const run=new QuizOrchestrator(platform,solver,new WebVerifier(),{session_id:'s',strategy:'supervised',observation_input_mode:'structured',provider_profile_id:'p',model_id:'gemini-3.8-flash',image_upload_authorized:false});
    await run.run();
    expect(run.snapshot().state).toBe(confirmed?'COMPLETE':'PAUSED');
    expect(platform.readState).toHaveBeenCalledTimes(1);
    expect(platform.waitUntilReady).not.toHaveBeenCalled();
    expect(platform.observeSession).not.toHaveBeenCalled();
    expect(platform.execute).not.toHaveBeenCalled();expect(solver.solve).not.toHaveBeenCalled();
    if(!confirmed){await run.resume();expect(platform.readState).toHaveBeenCalledTimes(2);expect(solver.solve).not.toHaveBeenCalled();}
  });
});
