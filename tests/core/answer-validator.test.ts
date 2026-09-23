import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION, validateAnswer } from "../../src/core";
import type { AnswerResult, QuestionFrame } from "../../src/core";

const singleChoiceQuestion: QuestionFrame = {
  schema_version: SCHEMA_VERSION,
  session_id: "session_1",
  question_id: "question_1",
  observation_id: "observation_1",
  type: "single_choice",
  stem: { text: "2 + 2 = ?", format: "plain_text", media: [] },
  options: [
    { id: "option_1", text: "3", media: [] },
    { id: "option_2", text: "4", media: [] },
  ],
  blanks: [],
  constraints: { min_selections: 1, max_selections: 1 },
  provenance: { text_source: "dom", untrusted_content: true },
};

function answer(overrides: Partial<AnswerResult> = {}): AnswerResult {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: "session_1",
    question_id: "question_1",
    observation_id: "observation_1",
    answer_type: "single_choice",
    status: "answered",
    selected_option_ids: ["option_2"],
    blank_answers: [],
    confidence: 0.98,
    warnings: [],
    ...overrides,
  };
}

describe("validateAnswer", () => {
  it("accepts an answer that references the current question and option", () => {
    expect(validateAnswer(singleChoiceQuestion, answer())).toMatchObject({
      valid: true,
      executable: true,
    });
  });

  it("rejects option ids outside the current QuestionFrame", () => {
    const result = validateAnswer(
      singleChoiceQuestion,
      answer({ selected_option_ids: ["option_from_another_question"] }),
    );

    expect(result).toMatchObject({ valid: false, executable: false });
    expect(result.issues.map((issue) => issue.code)).toContain("UNKNOWN_OPTION");
  });

  it("rejects stale answers after the page observation changes", () => {
    const result = validateAnswer(
      singleChoiceQuestion,
      answer({ observation_id: "old_observation" }),
    );

    expect(result.issues.map((issue) => issue.code)).toContain("OBSERVATION_MISMATCH");
  });

  it("does not make uncertain answers executable", () => {
    expect(validateAnswer(singleChoiceQuestion, answer({ status: "uncertain" }))).toMatchObject({
      valid: true,
      executable: false,
    });
  });

  it("rejects explanatory or action fields not in the answer protocol", () => {
    const candidate = {
      ...answer(),
      script: "document.querySelector('button').click()",
    };

    const result = validateAnswer(singleChoiceQuestion, candidate);
    expect(result).toMatchObject({ valid: false, executable: false });
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_STRUCTURE");
  });

  it("requires every required blank and rejects choice ids on fill-blank questions", () => {
    const fillQuestion: QuestionFrame = {
      ...singleChoiceQuestion,
      question_id: "question_2",
      type: "fill_blank",
      options: [],
      blanks: [
        { id: "blank_1", label: "First", required: true },
        { id: "blank_2", label: "Second", required: true },
      ],
      constraints: { min_selections: 0, max_selections: 0 },
    };

    const result = validateAnswer(fillQuestion, {
      ...answer({
        question_id: "question_2",
        answer_type: "fill_blank",
        selected_option_ids: ["option_2"],
      }),
      blank_answers: [{ blank_id: "blank_1", value: "A" }],
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["UNEXPECTED_OPTION_SELECTION", "MISSING_BLANK"]),
    );
  });
});
