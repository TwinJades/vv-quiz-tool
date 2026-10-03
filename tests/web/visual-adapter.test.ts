import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualWebAdapter } from "../../src/web/visual-adapter";
import { buildAnswerExecutionPlan } from "../../src/core/execution-planner";
import { capture, reading } from "../fixtures/visual";

describe("visual execution and independent verification", () => {
  afterEach(()=>vi.useRealTimers());
  function setup() {
    let current = reading();
    const base = capture();
    base.frame.width = 300; base.frame.height = 180;
    base.frame.geometry.region = { x: 0, y: 0, width: 300, height: 180 };
    current.questions[0]!.region = { x: 0, y: 0, width: 300, height: 180 };
    const events: string[] = [];
    const driver = {
      capture: vi.fn(async (sessionId: string, observationId: string) => {
        events.push("capture");
        return { ...base, frame: { ...structuredClone(base.frame), visual_frame_id: crypto.randomUUID(), session_id: sessionId,
          observation_id: observationId, captured_at: Date.now(), fingerprint: JSON.stringify(current) } };
      }),
      click: vi.fn(async (point: { x: number; y: number }) => {
        events.push("click");
        if (point.y === 120) current = { ...current, questions: [], status: "completed", visible_score: "1/1", controls: [] };
        else current.questions[0]!.options.forEach(option => { option.selected = option.point.x === point.x; });
      }),
      replaceText: vi.fn(async () => {}), close: vi.fn(async () => {}),
    };
    const recognize = vi.fn(async (_capture: import('../../src/core/visual').VisualCapture, _signal: AbortSignal,
      _context?: import('../../src/core/visual').VisualRecognitionContext) => { events.push("recognize"); return structuredClone(current); });
    const platform = new VisualWebAdapter(driver, recognize);
    return { platform, driver, recognize, events, change: () => { current.questions[0]!.stem = "A different question"; },
      controlRole: (role: 'submit'|'session_submit') => { current.controls[0]!.role=role; },
      limits: (min: number, max: number) => { current.questions[0]!.type='multiple_choice';current.questions[0]!.min_selections=min;current.questions[0]!.max_selections=max; },
      timer: (countdown: boolean | null, seconds: number) => { current.timer_is_countdown = countdown; current.timer_remaining_seconds = seconds; } };
  }
  const signal = () => new AbortController().signal;
  it('stops when the same visible control is reclassified during answer verification',async()=>{
    const {platform,driver,controlRole}=setup();
    controlRole('submit');
    const click=driver.click.getMockImplementation()!;
    driver.click.mockImplementation(async point=>{await click(point);controlRole('session_submit');});
    const observed=await platform.observeSession('s1',signal()),item=observed.questions[0]!;
    await expect(platform.execute({schema_version:'1.0',session_id:'s1',question_id:item.question.question_id,
      observation_id:observed.observation_id,strategy:'supervised',preconditions:[],
      actions:[{action_id:'select',kind:'set_selected',target_id:item.question.options[0]!.id,value:true},
        {action_id:'submit',kind:'submit_question',target_id:'control_submit'}]},item.locator_map,signal())).rejects.toThrow('control role changed');
    expect(driver.click).toHaveBeenCalledOnce();
    expect(platform.visualMetrics().verification_failures).toBe(1);
  });
  it('offers previous structure without selected states or answers and clears it between sessions', async()=>{
    const {platform,driver,recognize}=setup();
    const observed=await platform.observeSession('s1',signal()),item=observed.questions[0]!;
    expect(recognize.mock.calls[0]?.[2]).toBeUndefined();
    await platform.execute({schema_version:'1.0',session_id:'s1',question_id:item.question.question_id,
      observation_id:observed.observation_id,strategy:'supervised',preconditions:[],
      actions:[{action_id:'select',kind:'set_selected',target_id:item.question.options[0]!.id,value:true}]},item.locator_map,signal());
    const hint=recognize.mock.calls.at(-1)?.[2];
    expect(hint).toEqual({previous_structure:[{type:'single_choice',stem:item.question.stem.text,
      option_labels:['Alpha','Beta'],blank_labels:[],min_selections:1,max_selections:1}]});
    expect(driver.click).toHaveBeenCalledOnce();
    expect((await platform.readState(signal())).selected_target_ids).toContain(item.question.options[0]!.id);
    await platform.close();
    await platform.observeSession('s2',signal());
    expect(recognize.mock.calls.at(-1)?.[2]).toBeUndefined();
  });
  it('stops before a second click when the reader changes limits after selecting the first choice', async()=>{
    const {platform,driver,limits}=setup();limits(2,2);
    const observed=await platform.observeSession('s1',signal()),item=observed.questions[0]!;
    const apply=driver.click.getMockImplementation()!;
    driver.click.mockImplementation(async point=>{await apply(point);limits(1,2);});
    await expect(platform.execute({schema_version:'1.0',session_id:'s1',question_id:item.question.question_id,
      observation_id:observed.observation_id,strategy:'unattended',preconditions:[],actions:item.question.options.map((option,index)=>({action_id:String(index),kind:'set_selected' as const,target_id:option.id,value:true}))},item.locator_map,signal())).rejects.toThrow('selection limits changed');
    expect(driver.click).toHaveBeenCalledOnce();
    expect(platform.visualMetrics().verification_failures).toBe(1);
  });
  it("waits for delayed visible selection without sending a second click", async () => {
    vi.useFakeTimers();
    const {platform,driver}=setup();
    const apply=driver.click.getMockImplementation()!;
    driver.click.mockImplementation(async point=>{setTimeout(()=>void apply(point),150);});
    const observed=await platform.observeSession("s1",signal()),item=observed.questions[0]!;
    const executed=platform.execute({schema_version:"1.0",session_id:"s1",question_id:item.question.question_id,
      observation_id:observed.observation_id,strategy:"unattended",preconditions:[],
      actions:[{action_id:"pick",kind:"set_selected",target_id:item.question.options[0]!.id,value:true}]},item.locator_map,signal());
    await vi.advanceTimersByTimeAsync(250);
    await executed;
    expect(driver.click).toHaveBeenCalledOnce();
    expect((await platform.readState(signal())).selected_target_ids).toContain(item.question.options[0]!.id);
  });
  it("cancels an input verification wait and clears its polling timer", async () => {
    vi.useFakeTimers();
    const {platform,driver}=setup();driver.click.mockImplementation(async()=>{});
    const observed=await platform.observeSession("s1",signal()),item=observed.questions[0]!;
    const abort=new AbortController();
    const executed=platform.execute({schema_version:"1.0",session_id:"s1",question_id:item.question.question_id,
      observation_id:observed.observation_id,strategy:"unattended",preconditions:[],
      actions:[{action_id:"pick",kind:"set_selected",target_id:item.question.options[0]!.id,value:true}]},item.locator_map,abort.signal);
    const rejected=expect(executed).rejects.toThrow("Cancelled");
    await vi.advanceTimersByTimeAsync(50);abort.abort(new Error("Cancelled"));await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(driver.click).toHaveBeenCalledOnce();
  });
  it.each([false, null])("does not close out for an elapsed or ambiguous clock (%s)", async (countdown) => {
    const { platform, timer } = setup();
    timer(countdown, 0);
    expect((await platform.observeSession("s1", signal())).timer_remaining_seconds).toBeNull();
    expect((await platform.readState(signal())).timer_remaining_seconds).toBeNull();
  });
  it("preserves an explicitly recognized countdown including expiration", async () => {
    const { platform, timer } = setup();
    timer(true, 45);
    expect((await platform.observeSession("s1", signal())).timer_remaining_seconds).toBe(45);
    timer(true, 0);
    expect((await platform.readState(signal())).timer_remaining_seconds).toBe(0);
  });
  it("clicks a valid visual answer, verifies actual pixels before the next action and completes", async () => {
    const { platform, driver, events } = setup();
    const observation = await platform.observeSession("s1", signal());
    const item = observation.questions[0]!;
    const answer = { schema_version: "1.0" as const, session_id: "s1", question_id: item.question.question_id, observation_id: observation.observation_id,
      answer_type: "single_choice" as const, status: "answered" as const, selected_option_ids: [item.question.options[0]!.id], blank_answers: [], confidence: 1, warnings: [] };
    const plan = buildAnswerExecutionPlan(item.question, answer, item.locator_map, "unattended");
    await platform.readState(signal());
    await platform.execute(plan, item.locator_map, signal());
    expect(driver.click).toHaveBeenCalledTimes(1);
    expect((await platform.readState(signal())).selected_target_ids).toEqual(answer.selected_option_ids);
    const clickIndex = events.indexOf("click");
    expect(events.slice(clickIndex, clickIndex + 3)).toEqual(["click", "capture", "recognize"]);
    await platform.execute({ ...plan, actions: [{ action_id: "submit", kind: "submit_session", target_id: "control_submit_session" }] }, item.locator_map, signal());
    expect(await platform.readState(signal())).toMatchObject({ completed: true, visible_score: "1/1" });
    expect(platform.visualMetrics()).toMatchObject({ coordinate_attempts: 2, coordinate_clicks: 2,
      verification_reads: 2, verification_failures: 0, stale_frame_rejections: 0 });
  });
  it("rejects a changed screenshot even if a state read has seen the changed question", async () => {
    const { platform, driver, change } = setup();
    const observation = await platform.observeSession("s1", signal());
    const item = observation.questions[0]!;
    change();
    await platform.readState(signal());
    await expect(platform.execute({ schema_version: "1.0", session_id: "s1", question_id: item.question.question_id,
      observation_id: observation.observation_id, strategy: "unattended", preconditions: [],
      actions: [{ action_id: "pick", kind: "set_selected", target_id: item.question.options[0]!.id, value: true }] }, item.locator_map, signal())).rejects.toThrow("PAGE_CHANGED");
    expect(driver.click).not.toHaveBeenCalled();
    expect(platform.visualMetrics()).toMatchObject({ coordinate_attempts: 0, stale_frame_rejections: 1 });
  });
  it("records a sent click whose requested selection was not actually applied", async () => {
    vi.useFakeTimers();
    const { platform, driver } = setup();
    driver.click.mockImplementation(async () => {});
    const observation = await platform.observeSession("s1", signal());
    const item = observation.questions[0]!;
    const result=expect(platform.execute({ schema_version: "1.0", session_id: "s1", question_id: item.question.question_id,
      observation_id: observation.observation_id, strategy: "unattended", preconditions: [],
      actions: [{ action_id: "pick", kind: "set_selected", target_id: item.question.options[0]!.id, value: true }] }, item.locator_map, signal())).rejects.toThrow("not verified");
    await vi.advanceTimersByTimeAsync(3100);
    await result;
    vi.useRealTimers();
    expect(platform.visualMetrics()).toMatchObject({ coordinate_attempts: 1, coordinate_clicks: 1,
      verification_failures: 1 });
  });
  it("closes the transport and releases old screenshot media", async () => {
    const { platform, driver } = setup();
    const observed = await platform.observeSession("s1", signal());
    const handle = observed.page_context!.media[0]!.temporary_handle;
    expect(await platform.resolveMedia([handle], signal())).toHaveLength(1);
    await platform.close();
    await expect(platform.resolveMedia([handle], signal())).rejects.toThrow("expired");
    const captures = driver.capture.mock.calls.length;
    await expect(platform.readState(signal())).rejects.toThrow("no visual session");
    expect(driver.capture.mock.calls.length).toBe(captures);
    expect(driver.close).toHaveBeenCalledOnce();
  });
});
