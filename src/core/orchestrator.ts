import { validateBatchAnswer } from "./batch-answer-validator";
import { answerRetryAllowed, ModelCallBudget } from "./call-budget";
import { buildAnswerExecutionPlan } from "./execution-planner";
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
import { shouldEnterCloseOut } from "./session-machine";

export interface RuntimeMediaPayload {
  temporary_handle: string;
  mime_type: string;
  data: Uint8Array;
}

export interface RuntimePlatform extends PlatformAdapter {
  resolveMedia(handles: string[], signal: AbortSignal): Promise<RuntimeMediaPayload[]>;
}

export interface RuntimeSolver {
  solve(
    batch: QuestionBatch,
    policy: {
      strategy: RunStrategy;
      allow_images: boolean;
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
}

export interface SessionRuntimeSnapshot {
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
  timings?: Array<{ stage: SessionState; visits: number; total_ms: number; max_ms: number }>;
  steps?: Array<{ step: string; calls: number; total_ms: number; max_ms: number }>;
}

export interface OrchestratorOptions {
  session_id: string;
  strategy: RunStrategy;
  observation_input_mode: ObservationInputMode;
  provider_profile_id: string;
  model_id: string;
  model_call_limit?: number;
  model_call_budget?: ModelCallBudget;
  image_upload_authorized: boolean;
  on_update?: (snapshot: SessionRuntimeSnapshot) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Cancelled.", "AbortError"));
      },
      { once: true },
    );
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
  #visibleScore: string | null = null;
  #pageRecoveryAttempts = 0;
  #pageRecoveryKey: string | null = null;
  #controlHints = new Map<"next" | "submit" | "session_submit" | "retry", string>();
  #verifiedNextControl: { origin: string; text: string } | null = null;
  #stageStartedAt: number | null = null;
  #stageTimings = new Map<SessionState, { visits: number; total_ms: number; max_ms: number }>();
  #stepTimings = new Map<string, { calls: number; total_ms: number; max_ms: number }>();
  readonly #wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly platform: RuntimePlatform,
    private readonly solver: RuntimeSolver,
    private readonly verifier: RuntimeVerifier,
    private readonly options: OrchestratorOptions,
  ) {
    this.budget = options.model_call_budget ?? new ModelCallBudget(options.model_call_limit ?? 300);
    this.#wait = options.wait ?? defaultWait;
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

  stop(reason = "Stopped by user."): void {
    if (["COMPLETE", "CANCELLED"].includes(this.#state)) return;
    this.#cancelled = true;
    this.#notice = reason;
    this.#controller?.abort();
    this.#setState("CANCELLED");
    this.#finish("cancelled", reason);
  }

  #setState(state: SessionState, notice?: string): void {
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
    try { return await action(); }
    finally { this.#recordStep(step, performance.now() - started); }
  }

  #timeSync<T>(step: string, action: () => T): T {
    const started = performance.now();
    try { return action(); }
    finally { this.#recordStep(step, performance.now() - started); }
  }

  #finish(status: SessionSummary["status"], reason: string | null): void {
    this.#summary = {
      session_id: this.options.session_id,
      status,
      ...this.#progress,
      model_calls: this.budget.used,
      visible_score: this.#visibleScore,
      stop_reason: reason,
    };
    this.options.on_update?.(this.snapshot());
  }

  async #waitForControlOutcome(before: PlatformState, signal: AbortSignal, requireNavigation = false): Promise<PlatformState> {
    let latest = before;
    let successfulRead = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < (requireNavigation ? 200 : 80) && !signal.aborted; attempt += 1) {
      try {
        latest = await this.platform.readState(signal);
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

  async #waitForAnswerApplication(plan: ExecutionPlan, signal: AbortSignal): Promise<PlatformState> {
    let latest = await this.platform.readState(signal);
    for (let attempt = 0; attempt < 30 && !signal.aborted; attempt += 1) {
      if (answerApplicationMatches(plan, latest)) return latest;
      await this.#wait(100, signal);
      latest = await this.platform.readState(signal);
    }
    return latest;
  }

  async #waitForPostAnswerState(initial: PlatformState, signal: AbortSignal): Promise<PlatformState> {
    let latest = initial;
    for (let attempt = 0; attempt < 20 && !signal.aborted; attempt += 1) {
      if (
        latest.completed ||
        latest.has_next ||
        latest.has_session_submit ||
        (latest.fingerprint !== "missing" &&
          (latest.fingerprint !== initial.fingerprint || latest.observation_id !== initial.observation_id))
      ) return latest;
      await this.#wait(150, signal);
      latest = await this.platform.readState(signal);
    }
    return latest;
  }

  async #runLoop(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        this.#notice = null;
        this.#setState("WAIT_READY");
        const readiness = await this.#timeStep("wait_ready", () => this.platform.waitUntilReady(signal));
        if (!readiness.ready) {
          this.pause(`Page is not ready: ${readiness.reason ?? "unknown reason"}.`);
          return;
        }

        this.#setState("OBSERVE_SESSION");
        let observation = await this.#timeStep("observe_session", () => this.platform.observeSession(this.options.session_id, signal));
        if (observation.layout !== "sequential" || observation.questions.length !== 1) {
          this.pause("Version 1.0.0 only executes one active DOM question at a time.");
          return;
        }
        if (shouldEnterCloseOut(observation.timer_remaining_seconds)) this.#setState("CLOSE_OUT");

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
          observation.question_total ?? this.#progress.answered + this.#progress.skipped + 1,
        );
        let retriesAfterInitial = 0;
        const previousAnswers: string[][] = [];
        let feedback = "";

        while (!signal.aborted) {
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
            ? await this.#timeStep("resolve_media", () => this.platform.resolveMedia(handles, signal))
            : [];

          this.#setState("SOLVE");
          const rawAnswer = await this.#timeStep("solve_model", () => this.solver.solve(
            batch,
            {
              strategy: this.options.strategy,
              allow_images: this.options.image_upload_authorized,
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
            signal,
          ));
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
          const before = await this.#timeStep("read_before_action", () => this.platform.readState(signal));
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
          if (submitTarget) {
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
          } else {
            finalState = await this.#timeStep("wait_post_answer", () => this.#waitForPostAnswerState(finalState, signal));
          }
          this.#visibleScore = finalState.visible_score ?? this.#visibleScore;

          if (finalState.feedback === "incorrect") {
            feedback = finalState.feedback_text ?? "The site marked the previous answer incorrect.";
            if (answerRetryAllowed(retriesAfterInitial) && finalState.can_retry) {
              retriesAfterInitial += 1;
              this.#progress.retried += 1;
              observation = await this.#timeStep("observe_session", () => this.platform.observeSession(this.options.session_id, signal));
              this.#controlHints.clear();
              parsed = observation.questions[0]!;
              question = questionFrameSchema.parse(parsed.question);
              locatorMap = locatorMapSchema.parse(parsed.locator_map);
              const retryTarget = locatorMap.targets.control_retry ? "control_retry" : this.#controlHints.get("retry");
              if (retryTarget) {
                const retryPlan = controlPlan(locatorMap, this.options.strategy, "retry_question", retryTarget);
                await this.#timeStep("execute_retry", () => this.platform.execute(retryPlan, locatorMap, signal));
                await this.#wait(250, signal);
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
            this.#progress.failed += 1;
          } else {
            this.#progress.answered += 1;
            if (guessed) this.#progress.guessed += 1;
          }
          this.#pageRecoveryAttempts = 0;

          if (finalState.completed) {
            this.#pageRecoveryAttempts = 0;
            this.#setState("COMPLETE");
            this.#finish("completed", null);
            return;
          }

          const accounted = this.#progress.answered + this.#progress.failed + this.#progress.skipped;
          const sessionSubmitTarget = locatorMap.targets.control_submit_session
            ? "control_submit_session"
            : this.#controlHints.get("session_submit");
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
              (!finishAfter.completed && !finishAfter.visible_score)
            ) {
              this.pause(
                `stage=VERIFY page_changed=${finishBefore.fingerprint !== finishAfter.fingerprint} old_fingerprint=${finishBefore.fingerprint} new_fingerprint=${finishAfter.fingerprint} expected=[session_result_or_score] actual=[${finishAfter.visible_score ?? "none"}] target_status=page_level_submit_executed automatic_reobserve=false`,
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

          this.pause(
            `stage=ADVANCE page_changed=false old_fingerprint=${before.fingerprint} new_fingerprint=${finalState.fingerprint} expected=[next_or_session_submit] actual=[none] target_status=semantic_match_failed automatic_reobserve=false`,
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
          /HARD_BLOCKER|separation_uncertain|permission|Cannot access|authentication|captcha|proctor|login|Provider|model call limit/i.test(message));
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
