import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION } from "../../src/core";
import type { ActionResult, ExecutionPlan, PlatformState } from "../../src/core";
import { WebVerifier } from "../../src/web/verifier";

const baseState: PlatformState = {
  observation_id: "o1",
  fingerprint: "fp1",
  selected_target_ids: ["opt_1"],
  field_values: {},
  feedback: null,
  can_retry: false,
  has_next: false,
  completed: false,
};

function plan(kind: "submit_question" | "advance"): ExecutionPlan {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: "s1",
    question_id: "q1",
    observation_id: "o1",
    strategy: "unattended",
    actions: [{ action_id: "control", kind, target_id: "control" }],
    preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
  };
}

const succeeded: ActionResult[] = [{ action_id: "control", status: "succeeded" }];

describe("WebVerifier", () => {
  it("does not treat a successful click alone as verified submission", () => {
    const result = new WebVerifier().verify(baseState, plan("submit_question"), succeeded, baseState);
    expect(result).toMatchObject({ status: "uncertain", next_action: "pause" });
  });

  it("verifies submission when independent feedback appears", () => {
    const result = new WebVerifier().verify(baseState, plan("submit_question"), succeeded, {
      ...baseState,
      feedback: "correct",
    });
    expect(result).toMatchObject({ status: "verified", stage: "graded", outcome: "correct" });
  });

  it("can verify an unknown navigation action from a changed question fingerprint", () => {
    const result = new WebVerifier().verify(
      baseState,
      plan("advance"),
      [{ action_id: "control", status: "unknown" }],
      { ...baseState, fingerprint: "fp2" },
    );
    expect(result).toMatchObject({ status: "verified", stage: "advanced" });
  });

  it("does not count a temporarily missing question as a successful advance", () => {
    const result = new WebVerifier().verify(
      baseState,
      plan("advance"),
      succeeded,
      { ...baseState, observation_id: "none", fingerprint: "missing" },
    );
    expect(result).toMatchObject({ status: "failed", next_action: "pause" });
  });

  it("can verify an unknown submission when navigation changed the question", () => {
    const result = new WebVerifier().verify(
      baseState,
      plan("submit_question"),
      [{ action_id: "control", status: "unknown" }],
      { ...baseState, fingerprint: "fp2" },
    );
    expect(result).toMatchObject({ status: "verified", stage: "submitted" });
  });

  it("can verify cross-document submission even when the next fingerprint repeats", () => {
    const result = new WebVerifier().verify(
      baseState,
      plan("submit_question"),
      [{ action_id: "control", status: "unknown" }],
      { ...baseState, observation_id: "none" },
    );
    expect(result).toMatchObject({ status: "verified", stage: "submitted" });
    expect(result.signals).toContain("observation_context_changed");
  });
});
