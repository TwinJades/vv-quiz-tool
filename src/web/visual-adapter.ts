import { SCHEMA_VERSION } from "../core/schema";
import type { ExecutionPlan, LocatorMap } from "../core/schema";
import type { PlatformCapabilities, PlatformObservation, PlatformState } from "../core/platform";
import type { RuntimeMediaPayload, RuntimePlatform } from "../core/orchestrator";
import { assertVisualFreshness, assertVisualReading, visualTargetPoint, emptyVisualMetrics } from "../core/visual";
import type { VisualCapture, VisualFrame, VisualReading, VisualRect, VisualRecognitionContext } from "../core/visual";

export interface VisualDriver {
  capture(sessionId: string, observationId: string, signal: AbortSignal): Promise<VisualCapture>;
  click(point: { x: number; y: number }, signal: AbortSignal, expectedFrame: VisualFrame): Promise<void>;
  replaceText(value: string, signal: AbortSignal, expectedFrame: VisualFrame): Promise<void>;
  captureCount?(): number;
  close(): Promise<void>;
}
function digest(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16);
}
function identity(q: VisualReading["questions"][number]): string {
  return digest(JSON.stringify([q.type, q.stem, q.options.map(item => item.text), q.blanks.map(item => item.text), q.min_selections, q.max_selections]));
}
function contentIdentity(q: VisualReading["questions"][number]): string {
  return JSON.stringify([q.stem, q.options.map(item => item.text), q.blanks.map(item => item.text)]);
}

// Recognition reads actual pixels, separately from the solver's answer and plan.
export class VisualWebAdapter implements RuntimePlatform {
  #sessionId = "";
  #observation: PlatformObservation | null = null;
  #observedCapture: VisualCapture | null = null;
  #current: VisualCapture | null = null;
  #reading: VisualReading | null = null;
  #actedSinceObservation = false;
  #observedReading: VisualReading | null = null;
  #metrics = emptyVisualMetrics();

  visualMetrics() { return { ...this.#metrics, screenshots: this.driver.captureCount?.() ?? this.#metrics.screenshots }; }

  async #sendInput(operation: () => Promise<void>): Promise<void> {
    try { await operation(); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("PAGE_CHANGED")) this.#metrics.stale_frame_rejections++;
      throw error;
    }
  }

  #capture(observationId: string, signal: AbortSignal): Promise<VisualCapture> {
    this.#metrics.screenshots++;
    return this.driver.capture(this.#sessionId, observationId, signal);
  }

  async #verify(signal: AbortSignal): Promise<PlatformState> {
    try {
      const state = await this.readState(signal);
      this.#metrics.verification_reads++;
      return state;
    } catch (error) {
      if (!signal.aborted) this.#metrics.verification_failures++;
      throw error;
    }
  }

  async #waitForVerifiedInput(predicate: (state: PlatformState) => boolean, signal: AbortSignal): Promise<PlatformState> {
    const deadline=Date.now()+3000;
    while(true) {
      const state=await this.#verify(signal);
      if(predicate(state)||Date.now()>=deadline) return state;
      await new Promise<void>((resolve,reject)=>{
        const finish=()=>{signal.removeEventListener("abort",cancel);resolve();};
        const cancel=()=>{clearTimeout(timer);signal.removeEventListener("abort",cancel);reject(signal.reason??new DOMException("Cancelled","AbortError"));};
        const timer=setTimeout(finish,100);
        signal.addEventListener("abort",cancel,{once:true});
        if(signal.aborted) cancel();
      });
    }
  }

  #verificationFailure(message: string): never {
    this.#metrics.verification_failures++;
    throw new Error(message);
  }

  constructor(private readonly driver: VisualDriver,
    private readonly recognize: (capture: VisualCapture, signal: AbortSignal, context?: VisualRecognitionContext) => Promise<VisualReading>) {}

  capabilities(): PlatformCapabilities {
    return { question_types: ["single_choice", "multiple_choice", "fill_blank"], multi_question_page: true,
      text_input: true, image_input: true, semantic_targeting: false, coordinate_targeting: true,
      submit: true, advance: true, grading_feedback: true, timer_observation: true };
  }

  async #read(observationId: string, signal: AbortSignal): Promise<{ capture: VisualCapture; reading: VisualReading }> {
    const capture = await this.#capture(observationId, signal);
    let reading = this.#reading;
    let sameRegions = false;
    if(reading?.status === "questions" && reading.timer_is_countdown !== true && this.#current) {
      try { assertVisualFreshness({ ...this.#current.frame, validated_regions: this.#regions(reading,this.#current.frame) }, capture.frame); sameRegions=true; }
      catch { /* Changed question/control pixels need a new independent reading. */ }
    }
    if (!reading || !this.#current || (!sameRegions && capture.frame.fingerprint !== this.#current.frame.fingerprint) ||
      JSON.stringify(capture.frame.geometry) !== JSON.stringify(this.#current.frame.geometry) || capture.frame.zoom !== this.#current.frame.zoom) {
      this.#metrics.recognitions++;
      const context: VisualRecognitionContext | undefined = reading?.status === 'questions' ? {
        previous_structure: reading.questions.map(q => ({ type: q.type, stem: q.stem,
          option_labels: q.options.map(option => option.text), blank_labels: q.blanks.map(blank => blank.text),
          min_selections: q.min_selections, max_selections: q.max_selections })),
      } : undefined;
      reading = await this.recognize(capture, signal, context);
      signal.throwIfAborted();
      assertVisualReading(reading, capture);
      if(this.#actedSinceObservation && this.#reading?.status==='questions' && reading.status==='questions') {
        for(const previous of this.#reading.questions) {
          const next=reading.questions.find(q=>contentIdentity(q)===contentIdentity(previous));
          if(next && previous.type!==next.type) throw new Error('VISUAL_UNCERTAIN: question type changed during input without new content; no further input was sent.');
          if(next && (previous.min_selections!==next.min_selections || previous.max_selections!==next.max_selections)) {
            throw new Error('VISUAL_UNCERTAIN: selection limits changed during input without a new question; no further input was sent.');
          }
        }
        const currentQuestions = reading.questions;
        const sameQuestions = this.#reading.questions.length===currentQuestions.length &&
          this.#reading.questions.every(previous=>currentQuestions.some(next=>contentIdentity(next)===contentIdentity(previous)));
        if(sameQuestions) for(const previous of this.#reading.controls) {
          const next=reading.controls.find(control=>control.text===previous.text);
          if(next && previous.role!==next.role) throw new Error('VISUAL_UNCERTAIN: control role changed during input without a new question; no further input was sent.');
        }
      }
    }
    this.#current = capture;
    this.#reading = reading;
    return { capture, reading };
  }

  #regions(reading: VisualReading, frame: VisualFrame): VisualRect[] {
    const regions=reading.questions.map(q=>q.region);
    for(const control of reading.controls) {
      const x=Math.max(0,control.point.x-8),y=Math.max(0,control.point.y-8);
      regions.push({x,y,width:Math.min(frame.width-x,16),height:Math.min(frame.height-y,16)});
    }
    return regions;
  }

  async waitUntilReady(signal: AbortSignal) {
    signal.throwIfAborted();
    return { ready: true };
  }

  #build(capture: VisualCapture, reading: VisualReading): PlatformObservation {
    const multi = reading.questions.length > 1;
    const questionIds = reading.questions.map((q, index) => `visual_q_${index}_${identity(q)}`);
    const questions = reading.questions.map((q, index) => {
      const prefix = multi ? `v${index}_` : "";
      const optionIds = q.options.map(item => `${prefix}option_${digest(item.text)}`);
      const blankIds = q.blanks.map(item => `${prefix}blank_${digest(item.text)}`);
      const targets: LocatorMap["targets"] = {};
      for (const [i, item] of [...q.options, ...q.blanks].entries()) {
        const id = i < q.options.length ? optionIds[i]! : blankIds[i - q.options.length]!;
        targets[id] = { kind: "coordinate", visual_frame_id: capture.frame.visual_frame_id, point: item.point, expected_label: item.text, confidence: item.confidence };
      }
      for (const control of reading.controls.filter(control => control.question_index === index || (control.question_index === null && index === 0))) {
        const id = `${prefix}control_${control.role === "session_submit" ? "submit_session" : control.role}`;
        if (targets[id]) throw new Error("VISUAL_UNCERTAIN: more than one control has the same role.");
        targets[id] = { kind: "coordinate", visual_frame_id: capture.frame.visual_frame_id, point: control.point, expected_label: control.text, confidence: control.confidence };
      }
      return {
        question: { schema_version: SCHEMA_VERSION, session_id: this.#sessionId, question_id: questionIds[index]!, observation_id: capture.frame.observation_id,
          type: q.type, stem: { text: q.stem, format: "plain_text" as const, media: [] },
          options: q.options.map((item, i) => ({ id: optionIds[i]!, text: item.text, media: [] })),
          blanks: q.blanks.map((item, i) => ({ id: blankIds[i]!, label: item.text, required: item.required })),
          constraints: { min_selections: q.min_selections, max_selections: q.max_selections },
          provenance: { text_source: "visual" as const, untrusted_content: true as const } },
        locator_map: { schema_version: SCHEMA_VERSION, session_id: this.#sessionId, question_id: questionIds[index]!, observation_id: capture.frame.observation_id,
          platform: "web" as const, question_fingerprint: identity(q), targets },
      };
    });
    const controls = questions.flatMap((item, index) => Object.entries(item.locator_map.targets).filter(([id]) => id.includes("control_")).map(([id, target]) => ({
      semantic_id: id, role: "button", text: target.kind === "coordinate" ? target.expected_label : "",
      selected: false, disabled: Boolean(reading.controls.find(control => control.text === (target.kind === "coordinate" ? target.expected_label : "") && (control.question_index === index || control.question_index === null))?.disabled),
    })));
    return { session_id: this.#sessionId, observation_id: capture.frame.observation_id, captured_at: new Date(capture.frame.captured_at).toISOString(),
      surface_id: capture.frame.surface_id, surface_origin: new URL(capture.frame.geometry.url).origin, surface_title: "Visual quiz",
      layout: multi ? "multi_question_page" : "sequential", questions, question_total: reading.question_total,
      timer_remaining_seconds: reading.timer_is_countdown === true ? reading.timer_remaining_seconds : null, fingerprint: digest(JSON.stringify(questionIds)), stable_for_ms: 0,
      local_control_candidates: controls.map(({ semantic_id, text, disabled }) => ({ semantic_id, text, disabled })),
      page_context: { mode: "visual_snapshot", visible_text: reading.questions.map(q => q.stem).join("\n"), controls,
        media: [{ id: capture.frame.temporary_handle, kind: "image", purpose: "visual_quiz_observation", source: "region_capture",
          mime_type: "image/png", width: capture.frame.width, height: capture.frame.height, temporary_handle: capture.frame.temporary_handle }] } };
  }

  async observeSession(sessionId: string, signal: AbortSignal): Promise<PlatformObservation> {
    this.#sessionId = sessionId;
    const { capture, reading } = await this.#read(crypto.randomUUID(), signal);
    if (reading.status !== "questions") throw new Error("VISUAL_UNCERTAIN: no active visual quiz remains.");
    this.#observedCapture = capture;
    this.#observedReading = reading;
    this.#actedSinceObservation = false;
    this.#observation = this.#build(capture, reading);
    return this.#observation;
  }

  #state(capture: VisualCapture, reading: VisualReading): PlatformState {
    const parsed = this.#build(capture, reading);
    const selected: string[] = [];
    const values: Record<string, string> = {};
    reading.questions.forEach((q, index) => {
      const item = parsed.questions[index]!;
      q.options.forEach((option, i) => { if (option.selected) selected.push(item.question.options[i]!.id); });
      q.blanks.forEach((blank, i) => { values[item.question.blanks[i]!.id] = blank.value; });
    });
    return { observation_id: this.#observation?.observation_id ?? capture.frame.observation_id,
      timer_remaining_seconds: reading.timer_is_countdown === true ? reading.timer_remaining_seconds : null,
      fingerprint: reading.questions.length === 1 ? identity(reading.questions[0]!) : parsed.fingerprint,
      selected_target_ids: selected, field_values: values, feedback: reading.feedback, feedback_text: reading.feedback_text,
      ...(reading.visible_score ? { visible_score: reading.visible_score } : {}),
      can_retry: reading.controls.some(control => control.role === "retry" && !control.disabled),
      has_next: reading.controls.some(control => control.role === "next" && !control.disabled),
      has_session_submit: reading.controls.some(control => control.role === "session_submit" && !control.disabled),
      completed: reading.status === "completed" };
  }

  async readState(signal: AbortSignal): Promise<PlatformState> {
    if (!this.#sessionId) throw new Error("VISUAL_UNAVAILABLE: no visual session.");
    const { capture, reading } = await this.#read(this.#observation?.observation_id ?? crypto.randomUUID(), signal);
    return this.#state(capture, reading);
  }

  async execute(plan: ExecutionPlan, locatorMap: LocatorMap, signal: AbortSignal) {
    if (!this.#observation || !this.#observedCapture || plan.session_id !== this.#sessionId ||
      plan.observation_id !== this.#observation.observation_id || locatorMap.observation_id !== plan.observation_id || locatorMap.session_id !== plan.session_id || locatorMap.question_id !== plan.question_id) {
      throw new Error("PAGE_CHANGED: visual execution context mismatch.");
    }
    const originalItem = this.#observation.questions.find(item => item.question.question_id === plan.question_id);
    if (!originalItem || locatorMap.question_fingerprint !== originalItem.locator_map.question_fingerprint || JSON.stringify(locatorMap.targets) !== JSON.stringify(originalItem.locator_map.targets)) throw new Error("TARGET_UNAVAILABLE: visual locator map was altered.");
    const results: Array<{ action_id: string; status: "succeeded" | "skipped" }> = [];
    for (const action of plan.actions) {
      signal.throwIfAborted();
      const baseline = this.#actedSinceObservation ? this.#current! : this.#observedCapture;
      const fresh = await this.#capture(plan.observation_id, signal);
      const regions=this.#regions(this.#actedSinceObservation ? this.#reading! : this.#observedReading!, baseline.frame);
      try { assertVisualFreshness({ ...baseline.frame, validated_regions: regions }, fresh.frame); }
      catch (error) { this.#metrics.stale_frame_rejections++; throw error; }
      const reading = this.#reading!;
      const current = this.#build(fresh, reading);
      const index = current.questions.findIndex(item => item.question.question_id === plan.question_id);
      const item = current.questions[index];
      if (!item || item.locator_map.question_fingerprint !== locatorMap.question_fingerprint) throw new Error("PAGE_CHANGED: visual question changed before the action.");
      const q = reading.questions[index]!;
      let region: VisualRect = q.region;
      let disabled = false;
      let matched = true;
      if (action.kind === "set_selected") {
        const optionIndex = item.question.options.findIndex(option => option.id === action.target_id);
        const option = q.options[optionIndex];
        if (!option) throw new Error("TARGET_UNAVAILABLE: visual option missing.");
        if (option.selected === action.value) { results.push({ action_id: action.action_id, status: "skipped" }); continue; }
        // Selecting a different radio clears the old choice. Clicking an already
        // selected radio cannot deselect it, so defer that false action.
        if (q.type === "single_choice" && !action.value) { results.push({ action_id: action.action_id, status: "skipped" }); continue; }
        disabled = option.disabled;
      } else if (action.kind === "set_value") {
        const blank = q.blanks[item.question.blanks.findIndex(blank => blank.id === action.target_id)];
        if (!blank) throw new Error("TARGET_UNAVAILABLE: visual blank missing.");
        disabled = blank.disabled;
      } else {
        const role = action.kind === "advance" ? "next" : action.kind === "submit_question" ? "submit" : action.kind === "submit_session" ? "session_submit" : "retry";
        const control = reading.controls.find(control => control.role === role && (control.question_index === index || (control.question_index === null && index === 0)));
        matched = Boolean(control);
        disabled = Boolean(control?.disabled);
        if (control) region = { x: control.point.x, y: control.point.y, width: 1, height: 1 };
      }
      if (!matched || disabled) throw new Error("TARGET_UNAVAILABLE: visual target missing or disabled.");
      const point = visualTargetPoint(item.locator_map, action.target_id, fresh.frame, region);
      this.#metrics.coordinate_attempts++;
      await this.#sendInput(() => this.driver.click(point, signal, { ...fresh.frame, validated_regions: regions }));
      this.#metrics.coordinate_clicks++;
      this.#actedSinceObservation = true;
      const beforeFingerprint=this.#state(fresh,reading).fingerprint;
      const clicked = action.kind === "set_selected" || action.kind === "set_value" ?
        await this.#waitForVerifiedInput(state=>state.completed||state.fingerprint!==beforeFingerprint||
          (action.kind === "set_selected" ? state.selected_target_ids.includes(action.target_id) === action.value :
            Boolean(this.#reading?.questions[index]?.blanks[item.question.blanks.findIndex(blank=>blank.id===action.target_id)]?.focused)),signal) :
        await this.#verify(signal); // Sending input alone is not evidence of success.
      if (action.kind === "set_value") {
        if (clicked.fingerprint !== this.#state(fresh, reading).fingerprint) this.#verificationFailure("PAGE_CHANGED: visual blank click changed the question.");
        const focused = this.#reading?.questions[index]?.blanks[item.question.blanks.findIndex(blank => blank.id === action.target_id)];
        if (!focused?.focused) this.#verificationFailure("VISUAL_UNCERTAIN: the field focus was not verified after clicking.");
        const focusedFrame = this.#current!.frame;
        await this.#sendInput(() => this.driver.replaceText(action.value, signal, { ...focusedFrame, validated_regions: this.#regions(this.#reading!,focusedFrame) }));
        const after = await this.#waitForVerifiedInput(state=>state.field_values[action.target_id]===action.value,signal);
        if (after.field_values[action.target_id] !== action.value) this.#verificationFailure("VISUAL_UNCERTAIN: typed value was not verified.");
      } else if (action.kind === "set_selected" && !clicked.completed && clicked.fingerprint === this.#state(fresh, reading).fingerprint && clicked.selected_target_ids.includes(action.target_id) !== action.value) {
        this.#verificationFailure("VISUAL_UNCERTAIN: option state was not verified after clicking.");
      }
      results.push({ action_id: action.action_id, status: "succeeded" });
    }
    return results;
  }

  async resolveMedia(handles: string[], signal: AbortSignal): Promise<RuntimeMediaPayload[]> {
    signal.throwIfAborted();
    const capture = this.#observedCapture;
    if (!capture || handles.some(handle => handle !== capture.frame.temporary_handle)) throw new Error("VISUAL_UNAVAILABLE: expired screenshot media.");
    return handles.length ? [{ temporary_handle: capture.frame.temporary_handle, mime_type: "image/png", data: capture.data }] : [];
  }

  async close() {
    this.#sessionId = "";
    this.#observation = null; this.#observedCapture = null; this.#observedReading = null; this.#current = null; this.#reading = null;
    await this.driver.close();
  }
}
