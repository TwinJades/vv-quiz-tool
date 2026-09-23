import { describe, expect, it } from "vitest";

import {
  buildAnswerExecutionPlan,
  ExecutionPlanError,
  SCHEMA_VERSION,
} from "../../src/core";
import type { AnswerResult, LocatorMap, QuestionFrame } from "../../src/core";

const question: QuestionFrame = {
  schema_version: SCHEMA_VERSION,
  session_id: "s1",
  question_id: "q1",
  observation_id: "o1",
  type: "multiple_choice",
  stem: { text: "Pick", format: "plain_text", media: [] },
  options: [
    { id: "a", text: "A", media: [] },
    { id: "b", text: "B", media: [] },
  ],
  blanks: [],
  constraints: { min_selections: 1, max_selections: 2 },
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
    a: { kind: "semantic", local_ref: "node-a", role: "checkbox" },
    b: { kind: "semantic", local_ref: "node-b", role: "checkbox" },
  },
};

const answer: AnswerResult = {
  schema_version: SCHEMA_VERSION,
  session_id: "s1",
  question_id: "q1",
  observation_id: "o1",
  answer_type: "multiple_choice",
  status: "answered",
  selected_option_ids: ["b"],
  blank_answers: [],
  confidence: 0.9,
  warnings: [],
};

describe("buildAnswerExecutionPlan", () => {
  it("sets the complete final selection state instead of blindly toggling", () => {
    const plan = buildAnswerExecutionPlan(question, answer, locatorMap, "unattended");
    expect(plan.actions).toEqual([
      { action_id: "select_a", kind: "set_selected", target_id: "a", value: false },
      { action_id: "select_b", kind: "set_selected", target_id: "b", value: true },
    ]);
  });

  it("rejects stale or cross-question locator maps", () => {
    expect(() =>
      buildAnswerExecutionPlan(question, answer, { ...locatorMap, observation_id: "old" }, "supervised"),
    ).toThrow(ExecutionPlanError);
  });

  it("rejects uncertain answers", () => {
    expect(() =>
      buildAnswerExecutionPlan(question, { ...answer, status: "uncertain" }, locatorMap, "supervised"),
    ).toThrow("Only validated answered results");
  });
});
