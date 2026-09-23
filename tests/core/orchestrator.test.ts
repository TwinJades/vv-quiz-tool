import { describe, expect, it } from "vitest";

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
    const activeLocatorMap = this.pageLevelSubmit
      ? {
          ...locatorMap,
          targets: {
            a: locatorMap.targets.a!,
            b: locatorMap.targets.b!,
            control_submit_session: { kind: "semantic" as const, local_ref: "finish", role: "button" },
          },
        }
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

function options(strategy: "supervised" | "unattended") {
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

  it("pauses supervised mode for an uncertain answer", async () => {
    const platform = new FakePlatform();
    const solver = { solve: async (batch: QuestionBatch) => result(batch, ["b"], "uncertain") };
    const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), options("supervised"));

    await orchestrator.run();
    expect(orchestrator.snapshot()).toMatchObject({ state: "PAUSED" });
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

  it("re-solves after explicit incorrect feedback", async () => {
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
    expect(calls).toBe(2);
    expect(orchestrator.snapshot()).toMatchObject({
      state: "COMPLETE",
      progress: { answered: 1, retried: 1 },
    });
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

  it.each(["supervised", "unattended"] as const)(
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
