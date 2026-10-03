import { validateBatchAnswer } from "./batch-answer-validator";
import { answerRetryAllowed, ModelCallBudget } from "./call-budget";
import { buildAnswerExecutionPlan } from "./execution-planner";
import { planBatches } from "./batch-planner";
import type { BatchLimits } from "./batch-planner";
import type { PlatformAdapter, PlatformObservation, PlatformState } from "./platform";
import {
  SCHEMA_VERSION,
  locatorMapSchema,
  questionBatchSchema,
  questionFrameSchema,
} from "./schema";
import type {
  AnswerResult,
  BatchAnswerResult,
  ExecutionPlan,
  LocatorMap,
  ObservationInputMode,
  QuestionBatch,
  RunStrategy,
  VerificationResult,
} from "./schema";
import type { SessionState } from "./session-machine";
import { SessionTimer } from "./session-timer";
import type { VisualSessionMetrics } from "./visual";

export interface RuntimeMediaPayload {
  temporary_handle: string;
  mime_type: string;
  data: Uint8Array;
}

export interface RuntimePlatform extends PlatformAdapter {
  resolveMedia(handles: string[], signal: AbortSignal): Promise<RuntimeMediaPayload[]>;
  visualMetrics?(): VisualSessionMetrics;
}

export interface RuntimeSolver {
  batchLimits?(): BatchLimits;
  solve(
    batch: QuestionBatch,
    policy: {
      strategy: RunStrategy;
      allow_images: boolean;
      allow_native_search?: boolean;
      retry_context?: {
        attempt: number;
        previous_answers: string[][];
        site_feedback: string;
        remaining_option_ids: string[];
        can_resubmit: boolean;
      };
    },
    media: RuntimeMediaPayload[],
    signal?: AbortSignal,
  ): Promise<BatchAnswerResult>;
}

export interface RuntimeVerifier {
  verify(
    before: PlatformState,
    plan: ExecutionPlan,
    actions: Awaited<ReturnType<PlatformAdapter["execute"]>>,
    after: PlatformState,
  ): VerificationResult;
}

export interface SessionSummary {
  session_id: string;
  status: "completed" | "paused" | "cancelled" | "failed";
  total: number;
  answered: number;
  guessed: number;
  retried: number;
  skipped: number;
  failed: number;
  model_calls: number;
  visible_score: string | null;
  stop_reason: string | null;
  visual_metrics?: VisualSessionMetrics;
}

export interface SessionRuntimeSnapshot {
  course?: import('./course').CourseRuntime;
  session_id: string;
  state: SessionState;
  strategy: RunStrategy;
  observation_input_mode: ObservationInputMode;
  provider_profile_id: string;
  model_id: string;
  model_calls: { used: number; limit: number };
  progress: Pick<SessionSummary, "total" | "answered" | "guessed" | "retried" | "skipped" | "failed">;
  notice: string | null;
  summary: SessionSummary | null;
  timer_remaining_seconds?: number | null;
  visual_metrics?: VisualSessionMetrics;
  timings?: Array<{ stage: SessionState; visits: number; total_ms: number; max_ms: number }>;
  steps?: Array<{ step: string; calls: number; total_ms: number; max_ms: number }>;
}

export interface OrchestratorOptions {
  max_answer_retries?: number;
  require_retry_control?: boolean;
  answer_retry_counts?: Map<string, number>;
  session_id: string;
  strategy: RunStrategy;
  observation_input_mode: ObservationInputMode;
  provider_profile_id: string;
  model_id: string;
  model_call_limit?: number;
  model_call_budget?: ModelCallBudget;
  image_upload_authorized: boolean;
  allow_native_search?: boolean;
  on_update?: (snapshot: SessionRuntimeSnapshot) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled.", "AbortError"));
      return;
    }
    const cancelled = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancelled);
      reject(new DOMException("Cancelled.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

function controlPlan(
  locatorMap: LocatorMap,
  strategy: RunStrategy,
  kind: "submit_question" | "retry_question" | "advance" | "submit_session",
  targetId: string,
): ExecutionPlan {
  if (!locatorMap.targets[targetId]) throw new Error(`Control target ${targetId} is unavailable.`);
  return {
    schema_version: SCHEMA_VERSION,
    session_id: locatorMap.session_id,
    question_id: locatorMap.question_id,
    observation_id: locatorMap.observation_id,
    strategy,
    actions: [{ action_id: `${kind}_${targetId}`, kind, target_id: targetId }],
    preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
  };
}

function answerPayload(answer: AnswerResult): string[] {
  return answer.answer_type === "fill_blank"
    ? answer.blank_answers.map((item) => item.value)
    : answer.selected_option_ids;
}

function answerApplicationMatches(plan: ExecutionPlan, state: PlatformState): boolean {
  const selectionsMatch = plan.actions
    .filter((action) => action.kind === "set_selected")
    .every((action) => state.selected_target_ids.includes(action.target_id) === action.value);
  const valuesMatch = plan.actions
    .filter((action) => action.kind === "set_value")
    .every((action) => state.field_values[action.target_id] === action.value);
  return selectionsMatch && valuesMatch;
}

function diagnosticStage(state: SessionState): "OBSERVE" | "ACT" | "VERIFY" | "ADVANCE" {
  if (state === "ACT") return "ACT";
  if (state === "VERIFY") return "VERIFY";
  if (state === "ADVANCE") return "ADVANCE";
  return "OBSERVE";
}

function recoverablePageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /PAGE_CHANGED|TARGET_UNAVAILABLE|node_detached|semantic_match_(?:failed|ambiguous)/i.test(message);
}

function unattendedFallback(
  question: QuestionBatch["questions"][number],
  answer: AnswerResult | undefined,
  previousAnswers: string[][],
): AnswerResult | undefined {
  if (!question.stem.text || /^(?:question|题目)\s*\d+\s*(?:of|\/|共)\s*\d+\s*[:：]?$/i.test(question.stem.text)) {
    return undefined;
  }
  if (answer && answer.status === "uncertain") {
    const hasCandidate =
      question.type === "fill_blank"
        ? answer.blank_answers.length === question.blanks.length
        : answer.selected_option_ids.length >= question.constraints.min_selections;
    if (hasCandidate) return { ...answer, status: "answered", warnings: [...answer.warnings, "unattended_best_candidate"] };
  }
  if (question.type === "fill_blank") return undefined;
  const previous = new Set(previousAnswers.flat());
  const remaining = question.options.filter((option) => !previous.has(option.id));
  if (remaining.length === 0) return undefined;
  const count = Math.max(1, question.constraints.min_selections);
  return {
    schema_version: SCHEMA_VERSION,
    session_id: question.session_id,
    question_id: question.question_id,
    observation_id: question.observation_id,
    answer_type: question.type,
    status: "answered",
    selected_option_ids: remaining.slice(0, count).map((option) => option.id),
    blank_answers: [],
    confidence: 0,
    warnings: ["unattended_fallback_guess"],
  };
}

export class QuizOrchestrator {
  readonly budget: ModelCallBudget;
  #state: SessionState = "CREATED";
  #notice: string | null = null;
  #summary: SessionSummary | null = null;
  #controller: AbortController | undefined;
  #running: Promise<void> | undefined;
  #requestedPause = false;
  #cancelled = false;
  #progress = { total: 0, answered: 0, guessed: 0, retried: 0, skipped: 0, failed: 0 };
  #lastSequentialOutcome: { fingerprint: string; status: "answered" | "failed"; guessed: boolean } | null = null;
  #visibleScore: string | null = null;
  #pageRecoveryAttempts = 0;
  #pageRecoveryKey: string | null = null;
  #controlHints = new Map<"next" | "submit" | "session_submit" | "retry", string>();
  #verifiedNextControl: { origin: string; text: string } | null = null;
  #stageStartedAt: number | null = null;
  #stageTimings = new Map<SessionState, { visits: number; total_ms: number; max_ms: number }>();
  #stepTimings = new Map<string, { calls: number; total_ms: number; max_ms: number }>();
  #pageAnswers = new Map<string, { answer: AnswerResult; guessed: boolean }>();
  readonly #wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #timer: SessionTimer;

  constructor(
    private readonly platform: RuntimePlatform,
    private solver: RuntimeSolver,
    private readonly verifier: RuntimeVerifier,
    private readonly options: OrchestratorOptions,
  ) {
    this.budget = options.model_call_budget ?? new ModelCallBudget(options.model_call_limit ?? 300);
    this.#wait = options.wait ?? defaultWait;
    this.#timer = new SessionTimer(options.now);
  }

  snapshot(): SessionRuntimeSnapshot {
    const timings = new Map(this.#stageTimings);
    if (this.#stageStartedAt !== null) {
      const elapsed = Math.max(0, performance.now() - this.#stageStartedAt);
      const previous = timings.get(this.#state) ?? { visits: 0, total_ms: 0, max_ms: 0 };
      timings.set(this.#state, {
        visits: previous.visits + 1,
        total_ms: previous.total_ms + elapsed,
        max_ms: Math.max(previous.max_ms, elapsed),
      });
    }
    return {
      session_id: this.options.session_id,
      state: this.#state,
      strategy: this.options.strategy,
      observation_input_mode: this.options.observation_input_mode,
      provider_profile_id: this.options.provider_profile_id,
      model_id: this.options.model_id,
      model_calls: { used: this.budget.used, limit: this.budget.limit },
      progress: { ...this.#progress },
      notice: this.#notice,
      summary: this.#summary,
      timer_remaining_seconds: this.#timer.remaining() === null ? null : Math.ceil(this.#timer.remaining()!),
      ...(this.platform.visualMetrics ? { visual_metrics: this.platform.visualMetrics() } : {}),
      timings: [...timings].map(([stage, value]) => ({
        stage,
        visits: value.visits,
        total_ms: Math.round(value.total_ms),
        max_ms: Math.round(value.max_ms),
      })),
      steps: [...this.#stepTimings].map(([step, value]) => ({
        step,
        calls: value.calls,
        total_ms: Math.round(value.total_ms),
        max_ms: Math.round(value.max_ms),
      })),
    };
  }

  run(): Promise<void> {
    if (this.#running) return this.#running;
    this.#requestedPause = false;
    this.#cancelled = false;
    this.#controller = new AbortController();
    this.#running = this.#runLoop(this.#controller.signal).finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  pause(reason = "Paused by user."): void {
    if (["COMPLETE", "CANCELLED", "FAILED"].includes(this.#state)) return;
    this.#requestedPause = true;
    this.#notice = reason;
    this.#controller?.abort();
    this.#setState("PAUSED");
  }

  async resume(): Promise<void> {
    if (this.#state !== "PAUSED") return;
    if (this.#running) await this.#running;
    if (this.#state === "PAUSED") await this.run();
  }

  switchStrategy(strategy: RunStrategy): void {
    this.options.strategy = strategy;
    this.options.on_update?.(this.snapshot());
  }

  /** Only the authorized course parent may replace a paused child's solver. */
  replaceSolver(solver: RuntimeSolver, modelId: string): void {
    if (this.#state !== 'PAUSED' || this.#running) throw new Error('Solver replacement requires a settled paused child.');
    this.solver = solver; this.options.model_id = modelId;
  }

  stop(reason = "Stopped by user."): void {
    if (["COMPLETE", "CANCELLED"].includes(this.#state)) return;
    this.#cancelled = true;
    this.#notice = reason;
    this.#controller?.abort();
    this.#setState("CANCELLED");
    this.#finish("cancelled", reason);
  }

  #setState(state: SessionState, notice?: string): void {
    if (this.#timer.closing() && ["BUILD_BATCH", "SOLVE", "REPLAN", "ADVANCE"].includes(state)) state = "CLOSE_OUT";
    const now = performance.now();
    if (this.#stageStartedAt !== null) {
      const elapsed = Math.max(0, now - this.#stageStartedAt);
      const previous = this.#stageTimings.get(this.#state) ?? { visits: 0, total_ms: 0, max_ms: 0 };
      this.#stageTimings.set(this.#state, {
        visits: previous.visits + 1,
        total_ms: previous.total_ms + elapsed,
        max_ms: Math.max(previous.max_ms, elapsed),
      });
    }
    this.#state = state;
    this.#stageStartedAt = ["PAUSED", "COMPLETE", "CANCELLED", "FAILED"].includes(state) ? null : now;
    if (notice !== undefined) this.#notice = notice;
    this.options.on_update?.(this.snapshot());
  }

  async #readState(signal: AbortSignal): Promise<PlatformState> {
    const state = await this.platform.readState(signal);
    this.#timer.observe(state.timer_remaining_seconds);
    return state;
  }

  async #beforeDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T | null> {
    signal.throwIfAborted();
    const milliseconds = this.#timer.solveMilliseconds();
    if (milliseconds !== null && milliseconds <= 0) return null;
    const request = new AbortController();
    let rejectCancellation!: (error: DOMException) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    const abort = () => { request.abort(signal.reason); rejectCancellation(new DOMException("Cancelled.", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    let busy = false;
    let finished = false;
    try {
      let expire: () => void;
      const deadline = new Promise<null>(resolve => { expire = () => { resolve(null); request.abort(); }; });
      const schedule = () => {
        if (timer !== undefined) clearTimeout(timer);
        if (closing !== undefined) clearTimeout(closing);
        const remaining = this.#timer.remaining();
        if (remaining === null) return;
        timer = setTimeout(expire!, this.#timer.solveMilliseconds()!);
        if (remaining > 60) closing = setTimeout(() => {
          if (!signal.aborted) this.#setState("CLOSE_OUT", "剩余时间进入 60 秒，停止低优先级重试并预留提交时间。");
        }, Math.min(2147483647, (remaining - 60) * 1000));
      };
      schedule();
      if (this.platform.readTimer) polling = setInterval(() => {
        if (busy || finished || signal.aborted) return;
        busy = true;
        void this.platform.readTimer!(request.signal).then(seconds => {
          if (finished || signal.aborted) return;
          this.#timer.observe(seconds);
          if (this.#timer.closing() && this.#state !== "CLOSE_OUT") this.#setState("CLOSE_OUT", "倒计时已更新，优先收尾。");
          schedule();
        }).catch(() => { /* Keep the conservative monotonic deadline on a failed read. */ }).finally(() => { busy = false; });
      }, 500);
      return await Promise.race([operation(request.signal), deadline, cancelled]);
    } finally {
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      if (closing !== undefined) clearTimeout(closing);
      if (polling !== undefined) clearInterval(polling);
      signal.removeEventListener("abort", abort);
    }
  }

  async #closeSequential(locatorMap: LocatorMap, signal: AbortSignal): Promise<void> {
    this.#setState("CLOSE_OUT", "预留提交时间已到，提交当前已验证结果。");
    const before = await this.#readState(signal);
    if (before.completed) {
      this.#visibleScore = before.visible_score ?? null;
      this.#setState("COMPLETE"); this.#finish("completed", null); return;
    }
    if (this.#timer.remaining() === 0) { this.pause("The observed deadline expired before submission; no late input was sent."); return; }
    const target = locatorMap.targets.control_submit_session ? "control_submit_session" : this.#controlHints.get("session_submit");
    if (!target) { this.pause("Close-out needs an unambiguous whole-session submit control; no new model request was started."); return; }
    const plan = controlPlan(locatorMap, this.options.strategy, "submit_session", target);
    const actions = await this.#timeStep("close_out_submit", () => this.platform.execute(plan, locatorMap, signal));
    const after = await this.#waitForControlOutcome(before, signal, true);
    const verification = this.verifier.verify(before, plan, actions, after);
    if (verification.status !== "verified" || !after.completed) { this.pause("Close-out submission did not reach a verified whole-session result."); return; }
    this.#progress.skipped = Math.max(this.#progress.skipped, this.#progress.total - this.#progress.answered - this.#progress.failed);
    this.#visibleScore = after.visible_score ?? null;
    this.#setState("COMPLETE"); this.#finish("completed", null);
  }

  #recordStep(step: string, elapsed: number): void {
    const previous = this.#stepTimings.get(step) ?? { calls: 0, total_ms: 0, max_ms: 0 };
    this.#stepTimings.set(step, {
      calls: previous.calls + 1,
      total_ms: previous.total_ms + elapsed,
      max_ms: Math.max(previous.max_ms, elapsed),
    });
  }

  async #timeStep<T>(step: string, action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      this.#controller?.signal.throwIfAborted();
      const value = await action();
      this.#controller?.signal.throwIfAborted();
      return value;
    }
    finally { this.#recordStep(step, performance.now() - started); }
  }

  #timeSync<T>(step: string, action: () => T): T {
    const started = performance.now();
    try { return action(); }
    finally { this.#recordStep(step, performance.now() - started); }
  }

  #finish(status: SessionSummary["status"], reason: string | null): void {
    if (status !== "paused") this.#pageAnswers.clear();
    this.#summary = {
      session_id: this.options.session_id,
      status,
      ...this.#progress,
      model_calls: this.budget.used,
      visible_score: this.#visibleScore,
      stop_reason: reason,
      ...(this.platform.visualMetrics ? { visual_metrics: this.platform.visualMetrics() } : {}),
    };
    this.options.on_update?.(this.snapshot());
  }

  async #waitForControlOutcome(before: PlatformState, signal: AbortSignal, requireNavigation = false): Promise<PlatformState> {
    let latest = before;
    let successfulRead = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < (requireNavigation ? 200 : 80) && !signal.aborted; attempt += 1) {
      try {
        latest = await this.#readState(signal);
        successfulRead = true;
        const contextChanged = latest.fingerprint !== "missing" &&
          (latest.observation_id !== before.observation_id || latest.fingerprint !== before.fingerprint);
        if (
          contextChanged || latest.completed ||
          (!requireNavigation && (latest.feedback !== null || latest.has_next !== before.has_next || latest.can_retry !== before.can_retry))
        ) {
          return latest;
        }
      } catch (error) {
        lastError = error;
      }
      await this.#wait(150, signal);
    }
    if (!successfulRead && lastError) throw lastError;
    return latest;
  }

  async #executeQuestionRetry(plan: ExecutionPlan, locatorMap: LocatorMap, signal: AbortSignal): Promise<boolean> {
    const results = await this.#timeStep("execute_retry", () => this.platform.execute(plan, locatorMap, signal));
    if (results.length !== plan.actions.length || results.some(result => result.status !== "succeeded")) {
      this.pause("The site's retry control did not succeed. No new answer was requested.");
      return false;
    }
    // Dispatch success is not a reset: H5P can retain the previous grade during
    // its transition. Observe a cleared grade before asking for another answer.
    for (let attempt = 0; attempt < 80; attempt += 1) {
      signal.throwIfAborted();
      if (this.#timer.closing()) { await this.#closeSequential(locatorMap, signal); return false; }
      const state = await this.#readState(signal);
      if (state.fingerprint !== "missing" && state.fingerprint !== locatorMap.question_fingerprint) {
        throw new Error(`PAGE_CHANGED stage=RETRY old_fingerprint=${locatorMap.question_fingerprint} new_fingerprint=${state.fingerprint}`);
      }
      if (!state.completed && state.fingerprint === locatorMap.question_fingerprint && state.feedback === null) return true;
      await this.#wait(100, signal);
    }
    this.pause("The site's retry did not clear the previous grade. No new answer was requested.");
    return false;
  }

  async #waitForAnswerApplication(plan: ExecutionPlan, signal: AbortSignal): Promise<PlatformState> {
    let latest = await this.#readState(signal);
    for (let attempt = 0; attempt < 30 && !signal.aborted; attempt += 1) {
      // Auto-grading can remove the answered controls and show the final score.
      // Stop waiting for those old controls once the platform verifies completion;
      // the independent verifier below still checks action failures and outcome.
      if (latest.completed || answerApplicationMatches(plan, latest)) return latest;
      await this.#wait(100, signal);
      latest = await this.#readState(signal);
    }
    return latest;
  }

  async #waitForPostAnswerState(initial: PlatformState, originalFingerprint: string, hasMappedControl: boolean, signal: AbortSignal): Promise<PlatformState> {
    let latest = initial;
    for (let attempt = 0; attempt < 80 && !signal.aborted; attempt += 1) {
      if (
        latest.completed ||
        (hasMappedControl && (latest.has_next || latest.has_session_submit)) ||
        (latest.fingerprint !== "missing" && latest.fingerprint !== originalFingerprint)
      ) return latest;
      await this.#wait(150, signal);
      latest = await this.#readState(signal);
    }
    return latest;
  }

  async #runPage(observation: PlatformObservation, signal: AbortSignal): Promise<void> {
    const parsed = observation.questions.map(item => ({ question: questionFrameSchema.parse(item.question), locator_map: locatorMapSchema.parse(item.locator_map) }));
    if (!parsed.length || new Set(parsed.map(item => item.question.question_id)).size !== parsed.length) throw new Error("The page question inventory is empty or ambiguous.");
    this.#progress.total = parsed.length;
    const pending = new Map(parsed.map(item => [item.question.question_id, item]));
    // A resumed run must verify previous applications against the fresh page.
    const current = await this.#readState(signal);
    for (const [id, cached] of this.#pageAnswers) {
      const item = pending.get(id);
      if (!item) { this.#pageAnswers.delete(id); continue; }
      const rebound = { ...cached.answer, observation_id: item.question.observation_id };
      const plan = buildAnswerExecutionPlan(item.question, rebound, item.locator_map, this.options.strategy);
      if (answerApplicationMatches(plan, current)) pending.delete(id);
      else this.#pageAnswers.delete(id);
    }
    this.#progress.answered = this.#pageAnswers.size;
    this.#progress.guessed = [...this.#pageAnswers.values()].filter(item => item.guessed).length;

    attempts: for (let attempt = 1; attempt <= 3 && pending.size > 0 && !signal.aborted; attempt++) {
      if (this.#timer.closing()) {
        this.#setState("CLOSE_OUT", "剩余时间不足 60 秒，优先处理未答题并停止低优先级重试。");
        if (attempt > 1) break;
      }
      this.#setState("BUILD_BATCH");
      const batches = planBatches([...pending.values()].map(item => item.question), observation.page_context, attempt, this.solver.batchLimits?.());
      for (const batch of batches) {
        const live = await this.#readState(signal);
        if (live.completed) {
          this.#visibleScore = live.visible_score ?? null;
          this.#progress.skipped = pending.size;
          this.#setState("COMPLETE"); this.#finish("completed", null); return;
        }
        if (this.#timer.solveMilliseconds() === 0) break attempts;
        const handles = [...new Set([
          ...batch.questions.flatMap(question => [...question.stem.media.map(media => media.temporary_handle), ...question.options.flatMap(option => option.media.map(media => media.temporary_handle))]),
          ...(batch.page_context?.media.map(media => media.temporary_handle) ?? []),
        ])];
        const media = handles.length ? await this.#timeStep("resolve_media", () => this.#beforeDeadline(requestSignal => this.platform.resolveMedia(handles, requestSignal), signal)) : [];
        signal.throwIfAborted();
        if (media === null || this.#timer.solveMilliseconds() === 0) break attempts;
        this.#setState("SOLVE");
        const raw = await this.#timeStep("solve_batch", () => this.#beforeDeadline(requestSignal => this.solver.solve(batch, { strategy: this.options.strategy, allow_images: this.options.image_upload_authorized, allow_native_search: this.options.allow_native_search === true && !this.#timer.closing() }, media, requestSignal), signal));
        if (signal.aborted) return;
        if (!raw || this.#timer.solveMilliseconds() === 0) break attempts;
        this.#setState("VALIDATE_ANSWER");
        const validation = validateBatchAnswer(batch, raw);
        for (const question of batch.questions) {
          const item = pending.get(question.question_id)!;
          let answer = validation.executable_answers.find(answer => answer.question_id === question.question_id);
          let guessed = false;
          if (!answer && attempt === 3 && this.options.strategy === "unattended") {
            const candidate = validation.valid_answers.find(answer => answer.question_id === question.question_id);
            // A malformed/wrong-batch response cannot authorize a guess.
            if (!validation.issues.some(issue => !issue.question_id || issue.question_id === question.question_id)) {
              answer = unattendedFallback(question, candidate, []);
              guessed = Boolean(answer);
            }
          }
          if (!answer) continue;
          const plan = buildAnswerExecutionPlan(question, answer, item.locator_map, this.options.strategy);
          const before = await this.#readState(signal);
          if (before.completed || this.#timer.solveMilliseconds() === 0) break attempts;
          this.#setState("ACT");
          const actions = await this.#timeStep("execute_answer", () => this.platform.execute(plan, item.locator_map, signal));
          const after = await this.#waitForAnswerApplication(plan, signal);
          this.#setState("VERIFY");
          const verified = this.verifier.verify(before, plan, actions, after);
          if (verified.status !== "verified") { this.pause(`Question ${question.question_id}: answer application was not verified.`); return; }
          this.#pageAnswers.set(question.question_id, { answer, guessed });
          pending.delete(question.question_id);
          this.#progress.answered = this.#pageAnswers.size;
          if (guessed) this.#progress.guessed++;
          this.options.on_update?.(this.snapshot());
        }
      }
      if (pending.size > 0 && attempt < 3 && !this.#timer.closing()) this.#progress.retried += pending.size;
    }
    if (signal.aborted) return;
    if (pending.size && !this.#timer.closing()) { this.pause(`${pending.size} page question(s) still have no validated executable answer; successful questions were retained.`); return; }
    if (pending.size) this.#setState("CLOSE_OUT", `收尾时保留 ${this.#pageAnswers.size} 题已验证答案，未获得有效答案的 ${pending.size} 题留空。`);

    const submission = parsed.map(item => ({ item, target: Object.keys(item.locator_map.targets).find(id => id.endsWith("control_submit_session")) })).find(item => item.target);
    if (!submission?.target) { this.pause("No unambiguous whole-page submission control was found."); return; }
    const plan = controlPlan(submission.item.locator_map, this.options.strategy, "submit_session", submission.target);
    const before = await this.#readState(signal);
    this.#setState("ACT");
    if (before.completed) {
      this.#visibleScore = before.visible_score ?? null;
      this.#progress.skipped = pending.size;
      this.#setState("COMPLETE"); this.#finish("completed", null); return;
    }
    if (this.#timer.remaining() === 0) { this.pause("The observed deadline expired before submission; validated answers were retained and no late input was sent."); return; }
    const actions = await this.#timeStep("execute_session_submit", () => this.platform.execute(plan, submission.item.locator_map, signal));
    const after = await this.#waitForControlOutcome(before, signal, true);
    this.#setState("VERIFY");
    const verified = this.verifier.verify(before, plan, actions, after);
    if (verified.status !== "verified" || !after.completed) { this.pause("Whole-page submission did not reach a verified session result."); return; }
    this.#visibleScore = after.visible_score ?? null;
    this.#progress.skipped = pending.size;
    this.#setState("COMPLETE");
    this.#finish("completed", null);
  }

  async #runLoop(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        this.#notice = null;
        this.#setState("WAIT_READY");
        const readiness = await this.#timeStep("wait_ready", () => this.platform.waitUntilReady(signal));
        if (!readiness.ready) {
          if (readiness.reason === "readiness_timeout" && this.#progress.answered + this.#progress.failed > 0) {
            const terminal = await this.#timeStep("read_terminal_result", () => this.#readState(signal));
            if (terminal.completed && terminal.visible_score) {
              this.#visibleScore = terminal.visible_score;
              this.#setState("COMPLETE");
              this.#finish("completed", null);
              return;
            }
          }
          this.pause(`Page is not ready: ${readiness.reason ?? "unknown reason"}.`);
          return;
        }

        this.#setState("OBSERVE_SESSION");
        let observation = await this.#timeStep("observe_session", () => this.platform.observeSession(this.options.session_id, signal));
        this.#timer.observe(observation.timer_remaining_seconds);
        if (observation.layout === "multi_question_page") {
          await this.#runPage(observation, signal);
          return;
        }
        if (observation.questions.length !== 1) {
          this.pause("No unambiguous active question was found.");
          return;
        }
        if (this.#timer.closing()) this.#setState("CLOSE_OUT", "剩余时间进入 60 秒，优先完成当前可执行答案。");

        let parsed = observation.questions[0]!;
        this.#controlHints.clear();
        if (this.#verifiedNextControl?.origin === observation.surface_origin) {
          const matches = observation.local_control_candidates?.filter((candidate) =>
            !candidate.disabled && candidate.text === this.#verifiedNextControl?.text &&
            Boolean(parsed.locator_map.targets[candidate.semantic_id]),
          ) ?? [];
          if (matches.length === 1) this.#controlHints.set("next", matches[0]!.semantic_id);
        }
        let question = questionFrameSchema.parse(parsed.question);
        let locatorMap = locatorMapSchema.parse(parsed.locator_map);
        this.#progress.total = Math.max(
          this.#progress.total,
          observation.question_total ?? this.#progress.answered + this.#progress.skipped + this.#progress.failed +
            (this.#lastSequentialOutcome?.fingerprint === locatorMap.question_fingerprint ? 0 : 1),
        );
        let retriesAfterInitial = this.options.answer_retry_counts?.get(question.question_id) ?? 0;
        const previousAnswers: string[][] = [];
        let feedback = "";

        while (!signal.aborted) {
          const live = await this.#readState(signal);
          if (live.completed) {
            this.#visibleScore = live.visible_score ?? null;
            this.#setState("COMPLETE"); this.#finish("completed", null); return;
          }
          if (this.#timer.solveMilliseconds() === 0) { await this.#closeSequential(locatorMap, signal); return; }
          this.#setState("BUILD_BATCH");
          const batch = this.#timeSync("build_batch", () => questionBatchSchema.parse({
            schema_version: SCHEMA_VERSION,
            session_id: this.options.session_id,
            batch_id: `batch_${crypto.randomUUID()}`,
            question_ids: [question.question_id],
            questions: [question],
            ...(observation.page_context ? { page_context: observation.page_context } : {}),
            capability_requirements: {
              image_input: question.stem.media.length > 0 || question.options.some((option) => option.media.length > 0) || (observation.page_context?.media.length ?? 0) > 0,
              native_web_search: false,
            },
            attempt: retriesAfterInitial + 1,
          }));
          const handles = [
            ...question.stem.media.map((item) => item.temporary_handle),
            ...question.options.flatMap((option) => option.media.map((item) => item.temporary_handle)),
            ...(observation.page_context?.media.map((item) => item.temporary_handle) ?? []),
          ];
          const media = handles.length > 0
            ? await this.#timeStep("resolve_media", () => this.#beforeDeadline(requestSignal => this.platform.resolveMedia(handles, requestSignal), signal))
            : [];
          signal.throwIfAborted();
          if (media === null || this.#timer.solveMilliseconds() === 0) { await this.#closeSequential(locatorMap, signal); return; }

          this.#setState("SOLVE");
          const rawAnswer = await this.#timeStep("solve_model", () => this.#beforeDeadline(requestSignal => this.solver.solve(
            batch,
            {
              strategy: this.options.strategy,
              allow_images: this.options.image_upload_authorized,
              allow_native_search: this.options.allow_native_search === true && !this.#timer.closing(),
              ...(retriesAfterInitial > 0
                ? {
                    retry_context: {
                      attempt: retriesAfterInitial + 1,
                      previous_answers: previousAnswers,
                      site_feedback: feedback,
                      remaining_option_ids: question.options
                        .map((option) => option.id)
                        .filter((id) => !previousAnswers.flat().includes(id)),
                      can_resubmit: true,
                    },
                  }
                : {}),
            },
            media,
            requestSignal,
          ), signal));
          signal.throwIfAborted();
          if (!rawAnswer || this.#timer.solveMilliseconds() === 0) { await this.#closeSequential(locatorMap, signal); return; }
          const allowedControlIds = new Set(observation.page_context?.controls.map((item) => item.semantic_id) ?? []);
          for (const hint of rawAnswer.observed_controls ?? []) {
            if (hint.confidence < 0.8 || !allowedControlIds.has(hint.semantic_id) || !locatorMap.targets[hint.semantic_id]) continue;
            this.#controlHints.set(hint.role, hint.semantic_id);
          }
          this.#setState("VALIDATE_ANSWER");
          const validation = this.#timeSync("validate_answer", () => validateBatchAnswer(batch, rawAnswer));
          let answer = validation.valid_answers.find((item) => item.question_id === question.question_id);
          let guessed = false;
          if (!answer || !validation.executable_answers.some((item) => item.question_id === question.question_id)) {
            if (this.options.strategy === "supervised") {
              this.pause("The solver did not return a certain executable answer.");
              return;
            }
            answer = unattendedFallback(question, answer, previousAnswers);
            guessed = true;
          }
          if (!answer) {
            this.#progress.skipped += 1;
            this.pause("No safe executable target can be formed for this question.");
            return;
          }
          previousAnswers.push(answerPayload(answer));

          const answerPlan = this.#timeSync("plan_answer", () => buildAnswerExecutionPlan(question, answer, locatorMap, this.options.strategy));
          const before = await this.#timeStep("read_before_action", () => this.#readState(signal));
          if (before.completed || this.#timer.solveMilliseconds() === 0) { await this.#closeSequential(locatorMap, signal); return; }
          this.#setState("ACT");
          const actionResults = await this.#timeStep("execute_answer", () => this.platform.execute(answerPlan, locatorMap, signal));
          const after = await this.#timeStep("wait_answer_application", () => this.#waitForAnswerApplication(answerPlan, signal));
          this.#setState("VERIFY");
          const answerVerification = this.#timeSync("verify_answer", () => this.verifier.verify(before, answerPlan, actionResults, after));
          if (answerVerification.status !== "verified") {
            const expectedSelections = answerPlan.actions
              .filter((action) => action.kind === "set_selected" && action.value)
              .map((action) => action.target_id);
            const failedActions = actionResults
              .filter((action) => action.status !== "succeeded")
              .map((action) => `${action.action_id}:${action.status}${action.message ? ` (${action.message})` : ""}`);
            if (failedActions.some((item) => /TARGET_UNAVAILABLE|node_detached|semantic_match/i.test(item))) {
              throw new Error(
                `TARGET_UNAVAILABLE stage=ACT page_changed=${before.fingerprint !== after.fingerprint} old_fingerprint=${before.fingerprint} new_fingerprint=${after.fingerprint} expected=[${expectedSelections.join(", ")}] actual=[${after.selected_target_ids.join(", ")}] details=${failedActions.join("; ")}`,
              );
            }
            this.pause(
              `stage=VERIFY page_changed=${before.fingerprint !== after.fingerprint} old_fingerprint=${before.fingerprint} new_fingerprint=${after.fingerprint} expected=[${expectedSelections.join(", ")}] actual=[${after.selected_target_ids.join(", ")}] target_status=${failedActions.length ? failedActions.join("; ") : "present_but_unverified"} automatic_reobserve=false`,
            );
            return;
          }
          let finalState = after;
          const submitTarget = locatorMap.targets.control_submit
            ? "control_submit"
            : this.#controlHints.get("submit");
          if (!after.completed && submitTarget) {
            const submitPlan = controlPlan(locatorMap, this.options.strategy, "submit_question", submitTarget);
            const submitBefore = finalState;
            this.#setState("ACT");
            const submitActions = await this.#timeStep("execute_submit", () => this.platform.execute(submitPlan, locatorMap, signal));
            finalState = await this.#timeStep("wait_submit_outcome", () => this.#waitForControlOutcome(submitBefore, signal));
            this.#setState("VERIFY");
            const submitVerification = this.#timeSync("verify_submit", () => this.verifier.verify(submitBefore, submitPlan, submitActions, finalState));
            if (submitVerification.status !== "verified") {
              const targetFailure = submitActions.find((action) =>
                action.status !== "succeeded" && /TARGET_UNAVAILABLE|node_detached|semantic_match/i.test(action.message ?? ""),
              );
              if (targetFailure) throw new Error(targetFailure.message);
              this.pause(
                `stage=VERIFY page_changed=${submitBefore.fingerprint !== finalState.fingerprint} old_fingerprint=${submitBefore.fingerprint} new_fingerprint=${finalState.fingerprint} expected=[question_submission] actual=[unverified] target_status=submit_unverified automatic_reobserve=false`,
              );
              return;
            }
          } else if (!after.completed) {
            const hasMappedControl = Boolean(
              locatorMap.targets.control_next || locatorMap.targets.control_submit_session ||
              this.#controlHints.get("next") || this.#controlHints.get("session_submit"),
            );
            finalState = await this.#timeStep("wait_post_answer", () => this.#waitForPostAnswerState(finalState, before.fingerprint, hasMappedControl, signal));
          }
          this.#visibleScore = finalState.visible_score ?? this.#visibleScore;

          if (finalState.feedback === "incorrect") {
            feedback = finalState.feedback_text ?? "The site marked the previous answer incorrect.";
            if (answerRetryAllowed(retriesAfterInitial, this.options.max_answer_retries ?? 2) && finalState.can_retry && !this.#timer.closing()) {
              retriesAfterInitial += 1;
              this.options.answer_retry_counts?.set(question.question_id, retriesAfterInitial);
              this.#progress.retried += 1;
              const mappedRetryTarget = locatorMap.targets.control_retry ? "control_retry" : this.#controlHints.get("retry");
              if (this.options.require_retry_control && !mappedRetryTarget) { this.pause('课程测验未提供明确重试控件，停止重答。'); return; }
              if (mappedRetryTarget) {
                const retryPlan = controlPlan(locatorMap, this.options.strategy, "retry_question", mappedRetryTarget);
                if (!await this.#executeQuestionRetry(retryPlan, locatorMap, signal)) return;
              }
              observation = await this.#timeStep("observe_session", () => this.platform.observeSession(this.options.session_id, signal));
              this.#controlHints.clear();
              parsed = observation.questions[0]!;
              question = questionFrameSchema.parse(parsed.question);
              locatorMap = locatorMapSchema.parse(parsed.locator_map);
              const retryTarget = mappedRetryTarget ? undefined :
                (locatorMap.targets.control_retry ? "control_retry" : this.#controlHints.get("retry"));
              if (retryTarget) {
                const retryPlan = controlPlan(locatorMap, this.options.strategy, "retry_question", retryTarget);
                if (!await this.#executeQuestionRetry(retryPlan, locatorMap, signal)) return;
                observation = await this.#timeStep("observe_session", () => this.platform.observeSession(this.options.session_id, signal));
                this.#controlHints.clear();
                parsed = observation.questions[0]!;
                question = questionFrameSchema.parse(parsed.question);
                locatorMap = locatorMapSchema.parse(parsed.locator_map);
              }
              this.#setState("REPLAN");
              continue;
            }
            if (this.options.strategy === "supervised") {
              this.pause("Answer retries were exhausted.");
              return;
            }
          }
          const outcome=finalState.feedback === "incorrect" ? "failed" : "answered";
          const previousOutcome=this.#lastSequentialOutcome;
          const sameQuestion=previousOutcome?.fingerprint === before.fingerprint;
          if(!sameQuestion) {
            this.#progress[outcome]++;
            if(outcome === "answered" && guessed) this.#progress.guessed++;
            this.#pageRecoveryAttempts=0;
          } else if(previousOutcome.status !== outcome) {
            this.#progress[previousOutcome.status]--;
            this.#progress[outcome]++;
            if(previousOutcome.guessed) this.#progress.guessed--;
            if(outcome === "answered" && guessed) this.#progress.guessed++;
          }
          this.#lastSequentialOutcome={fingerprint:before.fingerprint,status:outcome,
            guessed:outcome === "answered" && (sameQuestion && previousOutcome.status === outcome ? previousOutcome.guessed : guessed)};

          if (finalState.completed) {
            this.#pageRecoveryAttempts = 0;
            this.#setState("COMPLETE");
            this.#finish("completed", null);
            return;
          }

          const accounted = this.#progress.answered + this.#progress.failed + this.#progress.skipped;
          let sessionSubmitTarget = locatorMap.targets.control_submit_session
            ? "control_submit_session"
            : this.#controlHints.get("session_submit");
          if (!sessionSubmitTarget && finalState.has_session_submit && !finalState.has_next &&
            (finalState.at_last_question === true || (this.#progress.total > 0 && accounted >= this.#progress.total))) {
            // Some question sets reveal Finish only after the last answer. Bind
            // that new control after verified grading, without re-solving it.
            const refreshed = await this.#timeStep("observe_session_finish", () => this.platform.observeSession(this.options.session_id, signal));
            const last = refreshed.questions.find(item => item.question.question_id === question.question_id);
            if (refreshed.layout !== "sequential" || refreshed.surface_id !== observation.surface_id ||
              refreshed.surface_origin !== observation.surface_origin || !last ||
              last.locator_map.question_fingerprint !== before.fingerprint) {
              this.pause("The question changed while binding the final submission control.");
              return;
            }
            observation = refreshed;
            question = questionFrameSchema.parse(last.question);
            locatorMap = locatorMapSchema.parse(last.locator_map);
            this.#controlHints.clear();
            sessionSubmitTarget = locatorMap.targets.control_submit_session ? "control_submit_session" : undefined;
            finalState = await this.#readState(signal);
            if (finalState.fingerprint !== before.fingerprint || finalState.has_next) {
              this.pause("The question changed before final submission.");
              return;
            }
          }
          const safeSessionSubmit =
            Boolean(sessionSubmitTarget) &&
            !finalState.has_next &&
            (finalState.at_last_question === true || (this.#progress.total > 0 && accounted >= this.#progress.total));
          if (safeSessionSubmit) {
            const finishPlan = controlPlan(locatorMap, this.options.strategy, "submit_session", sessionSubmitTarget!);
            const finishBefore = finalState;
            this.#setState("ADVANCE");
            const finishActions = await this.#timeStep("execute_session_submit", () => this.platform.execute(finishPlan, locatorMap, signal));
            const targetFailure = finishActions.find((action) =>
              action.status !== "succeeded" && /TARGET_UNAVAILABLE|node_detached|semantic_match/i.test(action.message ?? ""),
            );
            if (targetFailure) throw new Error(targetFailure.message);
            const finishAfter = await this.#timeStep("wait_session_result", () => this.#waitForControlOutcome(finishBefore, signal, true));
            this.#visibleScore = finishAfter.visible_score ?? this.#visibleScore;
            this.#setState("VERIFY");
            const finishVerification = this.#timeSync("verify_session_submit", () => this.verifier.verify(finishBefore, finishPlan, finishActions, finishAfter));
            if (
              finishVerification.status !== "verified" ||
              !finishAfter.completed
            ) {
              this.pause(
                `stage=VERIFY page_changed=${finishBefore.fingerprint !== finishAfter.fingerprint} old_fingerprint=${finishBefore.fingerprint} new_fingerprint=${finishAfter.fingerprint} expected=[session_result] actual=[${finishAfter.visible_score ?? "none"}] target_status=page_level_submit_executed automatic_reobserve=false`,
              );
              return;
            }
            this.#pageRecoveryAttempts = 0;
            this.#setState("COMPLETE");
            this.#finish("completed", null);
            return;
          }

          if (before.fingerprint !== finalState.fingerprint) {
            this.#pageRecoveryAttempts = 0;
            break;
          }

          const nextTarget = locatorMap.targets.control_next ? "control_next" : this.#controlHints.get("next");
          if (nextTarget) {
            const advancePlan = controlPlan(locatorMap, this.options.strategy, "advance", nextTarget);
            const advanceBefore = finalState;
            this.#setState("ADVANCE");
            const advanceActions = await this.#timeStep("execute_advance", () => this.platform.execute(advancePlan, locatorMap, signal));
            const advanceAfter = await this.#timeStep("wait_advance_outcome", () => this.#waitForControlOutcome(advanceBefore, signal, true));
            const advanceVerification = this.#timeSync("verify_advance", () => this.verifier.verify(advanceBefore, advancePlan, advanceActions, advanceAfter));
            if (advanceVerification.status === "verified" && advanceAfter.completed) {
              this.#visibleScore = advanceAfter.visible_score ?? this.#visibleScore;
              this.#pageRecoveryAttempts = 0;
              this.#setState("COMPLETE");
              this.#finish("completed", null);
              return;
            }
            if (advanceVerification.status !== "verified" || advanceBefore.fingerprint === advanceAfter.fingerprint) {
              const targetFailure = advanceActions.find((action) =>
                action.status !== "succeeded" && /TARGET_UNAVAILABLE|node_detached|semantic_match/i.test(action.message ?? ""),
              );
              if (targetFailure) throw new Error(targetFailure.message);
              this.pause(
                `stage=ADVANCE page_changed=${advanceBefore.fingerprint !== advanceAfter.fingerprint} old_fingerprint=${advanceBefore.fingerprint} new_fingerprint=${advanceAfter.fingerprint} answer_before=${before.fingerprint} answer_after=${finalState.fingerprint} old_observation=${advanceBefore.observation_id} new_observation=${advanceAfter.observation_id} action_status=[${advanceActions.map((action) => action.status).join(",")}] expected=[next_question] actual=[${advanceAfter.fingerprint}] target_status=advance_unverified automatic_reobserve=false`,
              );
              return;
            }
            if (nextTarget.startsWith("candidate_control_")) {
              const text = observation.page_context?.controls.find((control) => control.semantic_id === nextTarget)?.text
                ?? observation.local_control_candidates?.find((candidate) => candidate.semantic_id === nextTarget)?.text;
              if (text) this.#verifiedNextControl = { origin: observation.surface_origin, text };
            }
            this.#pageRecoveryAttempts = 0;
            break;
          }

          const automaticAdvance = await this.#timeStep("wait_auto_advance", () => this.#waitForControlOutcome(finalState, signal, true));
          this.#visibleScore = automaticAdvance.visible_score ?? this.#visibleScore;
          if (automaticAdvance.completed) {
            this.#setState("COMPLETE");
            this.#finish("completed", null);
            return;
          }
          if (before.fingerprint !== automaticAdvance.fingerprint) {
            this.#pageRecoveryAttempts = 0;
            break;
          }

          this.pause(
            `stage=ADVANCE page_changed=false old_fingerprint=${before.fingerprint} new_fingerprint=${automaticAdvance.fingerprint} expected=[next_or_session_submit] actual=[none] target_status=semantic_match_failed automatic_reobserve=false`,
          );
          return;
        }
      }
    } catch (error) {
      if (signal.aborted && (this.#requestedPause || this.#cancelled)) return;
      const message = error instanceof Error ? error.message : "Unexpected session failure.";
      if (recoverablePageError(error)) {
        const fingerprints = message.match(/old_fingerprint=([^\s]+)\s+new_fingerprint=([^\s]+)/);
        const recoveryKey = fingerprints ? `${fingerprints[1]}->${fingerprints[2]}` : message;
        if (recoveryKey !== this.#pageRecoveryKey) {
          this.#pageRecoveryKey = recoveryKey;
          this.#pageRecoveryAttempts = 0;
        }
        const willRetry = this.#pageRecoveryAttempts < 3;
        this.#pageRecoveryAttempts += 1;
        const detail = `stage=${diagnosticStage(this.#state)} ${message} automatic_reobserve=${willRetry} recovery_attempt=${this.#pageRecoveryAttempts}/3`;
        if (willRetry) {
          this.#notice = detail;
          this.#setState("WAIT_READY");
          await this.#wait(250, signal);
          return this.#runLoop(signal);
        }
        this.pause(detail);
        return;
      }
      const operational =
        error instanceof Error &&
        (error.name === "SolverProviderError" ||
          error.name === "ModelCallLimitError" ||
          /VISUAL_|USER_INTERACTION|HARD_BLOCKER|separation_uncertain|permission|Cannot access|authentication|captcha|proctor|login|Provider|model call limit/i.test(message));
      if (operational) {
        this.pause(message);
      } else {
        this.#progress.failed += 1;
        this.#notice = message;
        this.#setState("FAILED");
        this.#finish("failed", this.#notice);
      }
    }
  }
}
