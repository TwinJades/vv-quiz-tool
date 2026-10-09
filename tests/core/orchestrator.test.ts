import { describe, expect, it, vi } from "vitest";

import {
  QuizOrchestrator,
  SCHEMA_VERSION,
  type ActionResult,
  type ExecutionPlan,
  type LocatorMap,
  type PlatformCapabilities,
  type PlatformObservation,
  type PlatformState,
  type QuestionFrame,
  type RuntimeMediaPayload,
} from "../../src/core";
import type { BatchAnswerResult, QuestionBatch } from "../../src/core";
import { WebVerifier } from "../../src/web/verifier";

const question: QuestionFrame = {
  schema_version: SCHEMA_VERSION,
  session_id: "s1",
  question_id: "q1",
  observation_id: "o1",
  type: "single_choice",
  stem: { text: "Choose B", format: "plain_text", media: [] },
  options: [
    { id: "a", text: "A", media: [] },
    { id: "b", text: "B", media: [] },
  ],
  blanks: [],
  constraints: { min_selections: 1, max_selections: 1 },
  provenance: { text_source: "dom", untrusted_content: true },
};

const locatorMap: LocatorMap = {
  schema_version: SCHEMA_VERSION,
  session_id: "s1",
  question_id: "q1",
  observation_id: "o1",
  platform: "web",
  question_fingerprint: "fp1",
  targets: {
    a: { kind: "semantic", local_ref: "a", role: "radio" },
    b: { kind: "semantic", local_ref: "b", role: "radio" },
    control_submit: { kind: "semantic", local_ref: "submit", role: "button" },
  },
};

class FakePlatform {
  state: PlatformState = {
    observation_id: "o1",
    fingerprint: "fp1",
    selected_target_ids: [],
    field_values: {},
    feedback: null,
    can_retry: true,
    has_next: false,
    completed: false,
  };
  submissions = 0;
  failFirstSubmission = false;
  delayedNavigationReads = 0;
  delayedSelectionReads = 0;
  unknownSubmission = false;
  pendingNavigation = false;
  pendingSelectedTargetIds: string[] | undefined;
  recoverablePageChanges = 0;
  pageLevelSubmit = false;
  retryBeforeObserve = false;
  retryClicked = false;

  capabilities(): PlatformCapabilities {
    return {
      question_types: ["single_choice", "multiple_choice", "fill_blank"],
      multi_question_page: false,
      text_input: true,
      image_input: true,
      semantic_targeting: true,
      coordinate_targeting: false,
      submit: true,
      advance: true,
      grading_feedback: true,
      timer_observation: true,
    };
  }

  async waitUntilReady() {
    return { ready: true };
  }

  async observeSession(): Promise<PlatformObservation> {
    if (this.retryBeforeObserve && this.state.feedback === "incorrect" && !this.retryClicked) {
      throw new Error("No supported question was found.");
    }
    const activeLocatorMap = this.pageLevelSubmit
      ? {
          ...locatorMap,
          targets: {
            a: locatorMap.targets.a!,
            b: locatorMap.targets.b!,
            control_submit_session: { kind: "semantic" as const, local_ref: "finish", role: "button" },
          },
        }
      : this.retryBeforeObserve
        ? { ...locatorMap, targets: {
          ...locatorMap.targets,
          control_retry: { kind: "semantic" as const, local_ref: "retry", role: "button" },
        } }
        : locatorMap;
    return {
      session_id: "s1",
      observation_id: "o1",
      captured_at: new Date().toISOString(),
      surface_id: "tab1",
      surface_origin: "https://quiz.example",
      surface_title: "Quiz",
      layout: "sequential",
      questions: [{ question, locator_map: activeLocatorMap }],
      question_total: 1,
      timer_remaining_seconds: null,
      fingerprint: "fp1",
      stable_for_ms: 500,
    };
  }

  async execute(plan: ExecutionPlan): Promise<ActionResult[]> {
    if (this.recoverablePageChanges > 0) {
      this.recoverablePageChanges -= 1;
      throw new Error("PAGE_CHANGED stage=ACT page_changed=true old_fingerprint=fp1 new_fingerprint=fp2 target=none reason=question_changed");
    }
    for (const action of plan.actions) {
      if (action.kind === "set_selected") {
        const currentSelectedTargetIds = this.pendingSelectedTargetIds ?? this.state.selected_target_ids;
        const selectedTargetIds = action.value
          ? [...new Set([...currentSelectedTargetIds, action.target_id])]
          : currentSelectedTargetIds.filter((id) => id !== action.target_id);
        if (this.delayedSelectionReads > 0) this.pendingSelectedTargetIds = selectedTargetIds;
        else this.state.selected_target_ids = selectedTargetIds;
      }
      if (action.kind === "submit_question") {
        this.submissions += 1;
        if (this.delayedNavigationReads > 0) {
          this.pendingNavigation = true;
        } else if (this.failFirstSubmission && this.submissions === 1) {
          this.state.feedback = "incorrect";
        } else {
          this.state.feedback = "correct";
          this.state.completed = true;
        }
      }
      if (action.kind === "submit_session") {
        this.state.completed = true;
        this.state.fingerprint = "results";
        this.state.visible_score = "15/15";
      }
      if (action.kind === "retry_question") {
        this.retryClicked = true;
        this.state.feedback = null;
        this.state.selected_target_ids = [];
      }
    }
    return plan.actions.map((action) => ({
      action_id: action.action_id,
      status: this.unknownSubmission && action.kind === "submit_question" ? "unknown" : "succeeded",
    }));
  }

  async readState(): Promise<PlatformState> {
    if (this.pendingSelectedTargetIds) {
      if (this.delayedSelectionReads > 0) this.delayedSelectionReads -= 1;
      else {
        this.state.selected_target_ids = this.pendingSelectedTargetIds;
        this.pendingSelectedTargetIds = undefined;
      }
    }
    if (this.pendingNavigation) {
      if (this.delayedNavigationReads > 0) this.delayedNavigationReads -= 1;
      else {
        this.pendingNavigation = false;
        this.state.fingerprint = "fp2";
        this.state.completed = true;
      }
    }
    return structuredClone(this.state);
  }

  async resolveMedia(): Promise<RuntimeMediaPayload[]> {
    return [];
  }
}

function result(batch: QuestionBatch, selected: string[], status: "answered" | "uncertain" = "answered"): BatchAnswerResult {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: batch.session_id,
    batch_id: batch.batch_id,
    answers: [
      {
        schema_version: SCHEMA_VERSION,
        session_id: batch.session_id,
        question_id: "q1",
        observation_id: "o1",
        answer_type: "single_choice",
        status,
        selected_option_ids: selected,
        blank_answers: [],
        confidence: 0.8,
        warnings: [],
      },
    ],
    errors: [],
  };
}

function options(strategy: "unattended") {
  return {
    session_id: "s1",
    strategy,
    observation_input_mode: "structured",
    provider_profile_id: "p1",
    model_id: "m1",
    image_upload_authorized: false,
    wait: async () => {},
  } as const;
}

describe("QuizOrchestrator", () => {
  it("does not count the same verified answer again after a failed next action is reobserved", async () => {
    const platform=new FakePlatform();
    const observe=platform.observeSession.bind(platform),execute=platform.execute.bind(platform);
    platform.observeSession=async()=>{
      const observed=await observe();
      observed.question_total=null;
      observed.questions[0]!.locator_map={...observed.questions[0]!.locator_map,targets:{...locatorMap.targets,
        control_next:{kind:"semantic",local_ref:"next",role:"button"}}};
      return observed;
    };
    let advances=0;
    platform.execute=async plan=>{
      if(plan.actions.some(action=>action.kind === "advance")) {
        if(++advances===1) throw new Error("PAGE_CHANGED: next target expired");
        platform.state.completed=true;platform.state.visible_score="1/1";
        return plan.actions.map(action=>({action_id:action.action_id,status:"succeeded"}));
      }
      const actions=await execute(plan);
      if(plan.actions.some(action=>action.kind === "submit_question")) {
        platform.state.completed=false;platform.state.has_next=true;
      }
      return actions;
    };
    const solver={solve:async(batch:QuestionBatch)=>result(batch,["b"])};
    const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),options("unattended"));
    await orchestrator.run();
    expect(advances).toBe(2);
    expect(orchestrator.snapshot()).toMatchObject({state:"COMPLETE",progress:{total:1,answered:1,failed:0},summary:{total:1,visible_score:"1/1"}});
  });
  it("retains PAUSED when a solver ignores cancellation and returns a stale answer", async () => {
    const platform = new FakePlatform();
    let release!: (answer: BatchAnswerResult) => void;
    let solving!: () => void;
    const ready = new Promise<void>(resolve => { solving = resolve; });
    let oldBatch!: QuestionBatch;
    const orchestrator = new QuizOrchestrator(platform, { solve: batch => {
      oldBatch = batch;
      solving();
      return new Promise(resolve => { release = resolve; });
    } }, new WebVerifier(), options("unattended"));
    const run = orchestrator.run();
    await ready;
    orchestrator.pause("manual input");
    release(result(oldBatch, ["b"]));
    await run;
    expect(orchestrator.snapshot()).toMatchObject({ state: "PAUSED", notice: "manual input", progress: { answered: 0, failed: 0 } });
    expect(platform.state.selected_target_ids).toEqual([]);
    expect(platform.submissions).toBe(0);
  });
  it("recognizes a delayed terminal score when automatic navigation leaves no ready question", async () => {
    const platform = new FakePlatform();
    const observe = platform.observeSession.bind(platform);
    platform.observeSession = async () => {
      const observation = await observe();
      observation.questions[0]!.locator_map = { ...locatorMap, targets: { a: locatorMap.targets.a!, b: locatorMap.targets.b! } };
      return observation;
    };
    const execute = platform.execute.bind(platform);
    let readinessChecks = 0;
    platform.waitUntilReady = async () => {
      readinessChecks += 1;
      if (readinessChecks > 1) {
        platform.state = { ...platform.state, fingerprint: "missing", completed: true, visible_score: "3/3" };
        return { ready: false, reason: "readiness_timeout" };
      }
      return { ready: true };
    };
    platform.execute = async plan => {
      const actions = await execute(plan);
      platform.state.fingerprint = "auto-advanced";
      return actions;
    };
    const orchestrator = new QuizOrchestrator(platform, { solve: async batch => result(batch, ["b"]) },
      new WebVerifier(), options("unattended"));
    await orchestrator.run();
    expect(orchestrator.snapshot()).toMatchObject({ state: "COMPLETE", progress: { answered: 1 }, summary: { visible_score: "3/3" } });
  });

  it("completes when the last next action opens a scored result with no question", async () => {
    const platform = new FakePlatform();
    const observe = platform.observeSession.bind(platform);
    platform.observeSession = async () => {
      const observation = await observe();
      observation.questions[0]!.locator_map = { ...locatorMap, targets: {
        a: locatorMap.targets.a!, b: locatorMap.targets.b!,
        control_next: { kind: "semantic", local_ref: "next", role: "button" },
      } };
      return observation;
    };
    const execute = platform.execute.bind(platform);
    platform.state.has_next = true;
    platform.execute = async (plan) => {
      if (plan.actions.some(action => action.kind === "advance")) {
        platform.state = { ...platform.state, fingerprint: "missing", observation_id: "none",
          completed: true, has_next: false, selected_target_ids: [], visible_score: "24/25" };
        return plan.actions.map(action => ({ action_id: action.action_id, status: "succeeded" }));
      }
      return execute(plan);
    };
    const orchestrator = new QuizOrchestrator(platform, { solve: async batch => result(batch, ["b"]) },
      new WebVerifier(), options("unattended"));
    await orchestrator.run();
    expect(orchestrator.snapshot()).toMatchObject({ state: "COMPLETE", progress: { answered: 1 },
      summary: { status: "completed", visible_score: "24/25" } });
  });

  it("completes a verified sequential question", async () => {
    const platform = new FakePlatform();
    const solver = { solve: async (batch: QuestionBatch) => result(batch, ["b"]) };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();

    expect(orchestrator.snapshot()).toMatchObject({
      state: "COMPLETE",
      progress: { answered: 1, guessed: 0, failed: 0 },
      summary: { status: "completed", answered: 1 },
    });
  });

  it("submits the existing sequential result at the reserve without applying a late model answer", async () => {
    const platform = new FakePlatform(); platform.pageLevelSubmit = true;
    platform.state.timer_remaining_seconds = 6;
    let now = 0; let calls = 0;
    const solver = { solve: async (batch: QuestionBatch) => { calls++; now = 2000; return result(batch, ["b"]); } };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), { ...options("unattended"), now: () => now });
    await orchestrator.run();
    expect(calls).toBe(1); expect(platform.state.selected_target_ids).toEqual([]);
    expect(orchestrator.snapshot()).toMatchObject({ state: "COMPLETE", progress: { answered: 0, skipped: 1 } });
  });

  it("does not retry a graded wrong answer in the closing window", async () => {
    const platform = new FakePlatform(); platform.failFirstSubmission = true;
    platform.state.timer_remaining_seconds = 45;
    let calls = 0;
    const orchestrator = new QuizOrchestrator(platform, { solve: async (batch: QuestionBatch) => { calls++; return result(batch, ["a"]); } }, new WebVerifier(), options("unattended"));
    await orchestrator.run();
    expect(calls).toBe(1); expect(platform.submissions).toBe(1);
    expect(orchestrator.snapshot()).toMatchObject({ state: "PAUSED", progress: { retried: 0 } });
  });

  it("attributes model waiting time to SOLVE without retaining question content", async () => {
    const platform = new FakePlatform();
    const solver = { solve: async (batch: QuestionBatch) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return result(batch, ["b"]);
    } };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();

    const solve = orchestrator.snapshot().timings?.find((item) => item.stage === "SOLVE");
    expect(solve).toMatchObject({ visits: 1 });
    expect(solve?.total_ms).toBeGreaterThanOrEqual(20);
    expect(orchestrator.snapshot().timings?.find((item) => item.stage === "OBSERVE_SESSION")?.visits).toBe(1);
  });

  it("uses a best candidate in unattended mode and records a guess", async () => {
    const platform = new FakePlatform();
    const solver = { solve: async (batch: QuestionBatch) => result(batch, ["b"], "uncertain") };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();
    expect(orchestrator.snapshot()).toMatchObject({
      state: "COMPLETE",
      progress: { answered: 1, guessed: 1 },
    });
  });

  it("does not re-solve a graded question without a current retry control", async () => {
    const platform = new FakePlatform();
    platform.failFirstSubmission = true;
    let calls = 0;
    const solver = {
      solve: async (batch: QuestionBatch) => {
        calls += 1;
        return result(batch, [calls === 1 ? "a" : "b"]);
      },
    };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();
    expect(calls).toBe(1);
    expect(orchestrator.snapshot()).toMatchObject({
      state: "PAUSED",
      progress: { answered: 0, retried: 0 },
    });
    expect(orchestrator.snapshot().notice).toContain("no available retry control");
  });

  it("clicks a mapped retry control before observing a graded question again", async () => {
    const platform = new FakePlatform();
    platform.failFirstSubmission = true;
    platform.retryBeforeObserve = true;
    let calls = 0;
    const solver = { solve: async (batch: QuestionBatch) => result(batch, [++calls === 1 ? "a" : "b"]) };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();
    expect(platform.retryClicked).toBe(true);
    expect(orchestrator.snapshot()).toMatchObject({ state: "COMPLETE", progress: { retried: 1, answered: 1 } });
  });

  it.each(['unique','disabled','ambiguous','unmapped','wrong_role'] as const)(
    'resets a locked graded question only through a unique enabled local retry candidate (%s)',async mode=>{
      const platform=new FakePlatform();platform.failFirstSubmission=true;
      const observe=platform.observeSession.bind(platform),execute=platform.execute.bind(platform);
      platform.observeSession=async()=>{
        const observation=await observe();
        if(platform.state.feedback!=='incorrect')return observation;
        const ids=mode==='ambiguous'?['candidate_control_7','candidate_control_8']:['candidate_control_7'];
        return {...observation,local_control_candidates:ids.map(semantic_id=>({semantic_id,text:'Retry',disabled:mode==='disabled'})),
          questions:[{question,locator_map:{...locatorMap,targets:{...locatorMap.targets,...Object.fromEntries(mode==='unmapped'?[]:ids.map(id=>[id,{kind:'semantic' as const,local_ref:id,role:mode==='wrong_role'?'textbox':'button_candidate'}]))}}}]};
      };
      platform.execute=async plan=>{
        if(platform.state.feedback==='incorrect'&&plan.actions.some(a=>a.kind==='set_selected'))
          return plan.actions.map(a=>({action_id:a.action_id,status:'failed' as const,message:'Graded answer is locked'}));
        return execute(plan);
      };
      let calls=0;
      const solver={solve:async(batch:QuestionBatch)=>{
        if(++calls>1&&mode==='unique')expect(platform.state.feedback).toBeNull();
        return result(batch,[calls===1?'a':'b']);
      }};
      const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),options('unattended'));
      await orchestrator.run();
      expect(platform.retryClicked).toBe(mode==='unique');
      expect(orchestrator.snapshot().state).toBe(mode==='unique'?'COMPLETE':'PAUSED');
      expect(calls).toBe(mode==='unique'?2:1);
      expect(orchestrator.snapshot().progress.retried).toBe(mode==='unique'?1:0);
    });

  it.each(['failed','unknown'] as const)('does not solve again after a retry action returns %s',async status=>{
    const platform=new FakePlatform();platform.failFirstSubmission=true;platform.retryBeforeObserve=true;
    const execute=platform.execute.bind(platform);
    platform.execute=async plan=>plan.actions.some(a=>a.kind==='retry_question')
      ? plan.actions.map(a=>({action_id:a.action_id,status})) : execute(plan);
    let calls=0;
    const solver={solve:async(batch:QuestionBatch)=>{calls++;return result(batch,['a']);}};
    const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),options('unattended'));
    await orchestrator.run();
    expect(calls).toBe(1);
    expect(orchestrator.snapshot()).toMatchObject({state:'PAUSED',progress:{answered:0,retried:0}});
  });
  it('waits for the previous grade to clear after a successful delayed retry',async()=>{
    const platform=new FakePlatform();platform.failFirstSubmission=true;platform.retryBeforeObserve=true;
    const execute=platform.execute.bind(platform),read=platform.readState.bind(platform);
    let pendingReset=0;
    platform.execute=async plan=>{
      const rows=await execute(plan);
      if(plan.actions.some(a=>a.kind==='retry_question')){platform.state.feedback='incorrect';pendingReset=5;}
      return rows;
    };
    platform.readState=async()=>{
      if(pendingReset>0&&--pendingReset===0)platform.state.feedback=null;
      return read();
    };
    let calls=0;
    const solver={solve:async(batch:QuestionBatch)=>{
      if(++calls>1)expect(platform.state.feedback).toBeNull();
      return result(batch,[calls===1?'a':'b']);
    }};
    const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),options('unattended'));
    await orchestrator.run();
    expect(calls).toBe(2);
    expect(orchestrator.snapshot()).toMatchObject({state:'COMPLETE',progress:{answered:1,retried:1}});
  });
  it.each(['same','changed','stalled'])('binds a new final control and requires an actual completed session (%s)',async mode=>{
    const changed=mode==='changed',stalled=mode==='stalled';
    const platform=new FakePlatform();
    const observe=platform.observeSession.bind(platform),execute=platform.execute.bind(platform);
    let observations=0,finishes=0,calls=0;
    platform.observeSession=async()=>{
      const snapshot=await observe();
      if(++observations>1){
        platform.state.observation_id='o2';
        const fingerprint=changed?'fp2':'fp1';
        return {...snapshot,observation_id:'o2',fingerprint,questions:[{question:{...question,observation_id:'o2',question_id:changed?'q2':'q1'},locator_map:{...locatorMap,observation_id:'o2',question_id:changed?'q2':'q1',question_fingerprint:fingerprint,targets:{...locatorMap.targets,control_submit_session:{kind:'semantic',local_ref:'new-finish',role:'button'}}}}]};
      }
      return snapshot;
    };
    platform.execute=async plan=>{
      const rows=await execute(plan);
      if(plan.actions.some(a=>a.kind==='submit_question')){platform.state.completed=false;platform.state.has_session_submit=true;platform.state.at_last_question=true;platform.state.visible_score='1/1';}
      if(plan.actions.some(a=>a.kind==='submit_session')){finishes++;expect(plan.observation_id).toBe('o2');platform.state.visible_score='1/1';if(stalled){platform.state.completed=false;platform.state.fingerprint='fp1';}}
      return rows;
    };
    const solver={solve:async(batch:QuestionBatch)=>{calls++;return result(batch,['b']);}};
    const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),options('unattended'));
    await orchestrator.run();
    expect(calls).toBe(1);
    expect(finishes).toBe(changed?0:1);
    expect(orchestrator.snapshot()).toMatchObject({state:changed||stalled?'PAUSED':'COMPLETE',progress:{answered:1}});
  });
  it("waits for a framework-delayed answer state before verifying", async () => {
    const platform = new FakePlatform();
    platform.delayedSelectionReads = 5;
    const solver = { solve: async (batch: QuestionBatch) => result(batch, ["b"]) };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();

    expect(orchestrator.snapshot()).toMatchObject({
      state: "COMPLETE",
      progress: { answered: 1, failed: 0 },
    });
  });

  it.each([false,true])("releases native polling abort listeners after completion or cancellation (cancel=%s)", async cancel => {
    const listeners=new Map<AbortSignal,Set<EventListenerOrEventListenerObject>>();
    const add=AbortSignal.prototype.addEventListener, remove=AbortSignal.prototype.removeEventListener;
    let observeWait!:()=>void;
    const waiting=new Promise<void>(resolve=>{observeWait=resolve;});
    const addSpy=vi.spyOn(AbortSignal.prototype,'addEventListener').mockImplementation(function(this:AbortSignal,type,listener,opts){
      if(type==='abort'&&listener){const active=listeners.get(this)??new Set();active.add(listener);listeners.set(this,active);if(typeof listener==='function'&&listener.name==='cancelled')observeWait();}
      return add.call(this,type,listener,opts);
    });
    const removeSpy=vi.spyOn(AbortSignal.prototype,'removeEventListener').mockImplementation(function(this:AbortSignal,type,listener,opts){
      if(type==='abort'&&listener)listeners.get(this)?.delete(listener);
      return remove.call(this,type,listener,opts);
    });
    const platform=new FakePlatform();platform.delayedSelectionReads=12;
    const solver={solve:async(batch:QuestionBatch)=>result(batch,['b'])};
    const {wait: _wait,...nativeOptions}=options('unattended');
    const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),nativeOptions);
    let running:Promise<void>|undefined;
    try{
      running=orchestrator.run();
      if(cancel){await waiting;orchestrator.stop();}
      await running;
      expect(orchestrator.snapshot().state).toBe(cancel?'CANCELLED':'COMPLETE');
      expect([...listeners.values()].reduce((total,active)=>total+active.size,0)).toBe(0);
      if(!cancel)expect(orchestrator.snapshot().progress.answered).toBe(1);
    }finally{
      orchestrator.stop();await running;
      addSpy.mockRestore();removeSpy.mockRestore();
    }
  });

  it("finishes an auto-graded final answer without polling removed controls or submitting again", async () => {
    class AutoCompletePlatform extends FakePlatform {
      finalReads=0;
      override async execute(plan: ExecutionPlan): Promise<ActionResult[]> {
        if(plan.actions.some(action=>action.kind==='submit_question'))throw new Error('Old submit control was reused after completion');
        const actions=await super.execute(plan);
        this.state={...this.state,completed:true,fingerprint:'final-score',visible_score:'1/1',selected_target_ids:[]};
        return actions;
      }
      override async readState(): Promise<PlatformState> {
        if(this.state.completed && ++this.finalReads>1)throw new Error('Polled a later transition after verified completion');
        return super.readState();
      }
    }
    const platform=new AutoCompletePlatform();
    const solver={solve:async(batch:QuestionBatch)=>result(batch,['b'])};
    const orchestrator=new QuizOrchestrator(platform,solver,new WebVerifier(),options('unattended'));
    await orchestrator.run();
    expect(orchestrator.snapshot()).toMatchObject({state:'COMPLETE',progress:{answered:1,failed:0},summary:{visible_score:'1/1'}});
    expect(platform.finalReads).toBe(1);
    expect(platform.submissions).toBe(0);
  });

  it("recovers from a stale page plan by observing and solving again", async () => {
    const platform = new FakePlatform();
    platform.recoverablePageChanges = 1;
    let calls = 0;
    const solver = {
      solve: async (batch: QuestionBatch) => {
        calls += 1;
        return result(batch, ["b"]);
      },
    };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();

    expect(calls).toBe(2);
    expect(orchestrator.snapshot()).toMatchObject({
      state: "COMPLETE",
      progress: { answered: 1, failed: 0 },
    });
  });

  it("submits a page-level final action only after the last answer", async () => {
    const platform = new FakePlatform();
    platform.pageLevelSubmit = true;
    platform.state.has_session_submit = true;
    platform.state.at_last_question = true;
    const solver = { solve: async (batch: QuestionBatch) => result(batch, ["b"]) };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("unattended"));

    await orchestrator.run();

    expect(orchestrator.snapshot()).toMatchObject({
      state: "COMPLETE",
      progress: { answered: 1, failed: 0 },
      summary: { visible_score: "15/15" },
    });
  });

  it.each(["unattended"] as const)(
    "waits for a cross-page submission to expose the next fingerprint in %s mode",
    async (strategy) => {
      const platform = new FakePlatform();
      platform.delayedNavigationReads = 50;
      platform.unknownSubmission = true;
      const solver = { solve: async (batch: QuestionBatch) => result(batch, ["b"]) };
      const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options(strategy));

      await orchestrator.run();

      expect(orchestrator.snapshot()).toMatchObject({
        state: "COMPLETE",
        progress: { answered: 1 },
      });
    },
  );
});
