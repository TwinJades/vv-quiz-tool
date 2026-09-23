import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION, validateBatchAnswer } from "../../src/core";
import type { AnswerResult, QuestionBatch, QuestionFrame } from "../../src/core";

function question(questionId: string): QuestionFrame {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: "session_1",
    question_id: questionId,
    observation_id: `observation_${questionId}`,
    type: "single_choice",
    stem: { text: `${questionId}?`, format: "plain_text", media: [] },
    options: [
      { id: `${questionId}_a`, text: "A", media: [] },
      { id: `${questionId}_b`, text: "B", media: [] },
    ],
    blanks: [],
    constraints: { min_selections: 1, max_selections: 1 },
    provenance: { text_source: "dom", untrusted_content: true },
  };
}

const questions = [question("q1"), question("q2")];
const batch: QuestionBatch = {
  schema_version: SCHEMA_VERSION,
  session_id: "session_1",
  batch_id: "batch_1",
  question_ids: questions.map((item) => item.question_id),
  questions,
  capability_requirements: { image_input: false, native_web_search: false },
  attempt: 1,
};

function answer(questionFrame: QuestionFrame, optionSuffix = "a"): AnswerResult {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: questionFrame.session_id,
    question_id: questionFrame.question_id,
    observation_id: questionFrame.observation_id,
    answer_type: questionFrame.type,
    status: "answered",
    selected_option_ids: [`${questionFrame.question_id}_${optionSuffix}`],
    blank_answers: [],
    confidence: 0.9,
    warnings: [],
  };
}

function response(answers: AnswerResult[]) {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: "session_1",
    batch_id: "batch_1",
    answers,
    errors: [],
  };
}

describe("validateBatchAnswer", () => {
  it("associates answers by question_id rather than array order", () => {
    const result = validateBatchAnswer(batch, response([answer(questions[1]!), answer(questions[0]!) ]));

    expect(result.executable_answers.map((item) => item.question_id).sort()).toEqual(["q1", "q2"]);
    expect(result.failed_question_ids).toEqual([]);
  });

  it("isolates one invalid question without discarding valid siblings", () => {
    const result = validateBatchAnswer(
      batch,
      response([answer(questions[0]!), answer(questions[1]!, "outside")]),
    );

    expect(result.executable_answers.map((item) => item.question_id)).toEqual(["q1"]);
    expect(result.failed_question_ids).toEqual(["q2"]);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ANSWER_INVALID", question_id: "q2" })]),
    );
  });

  it("rejects duplicate answers for a question", () => {
    const result = validateBatchAnswer(batch, response([answer(questions[0]!), answer(questions[0]!) ]));

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_QUESTION_RESULT", question_id: "q1" }),
      ]),
    );
    expect(result.missing_question_ids).toEqual(["q2"]);
  });

  it("does not accept otherwise valid answers from the wrong batch", () => {
    const result = validateBatchAnswer(batch, { ...response([answer(questions[0]!)]), batch_id: "late_batch" });

    expect(result.executable_answers).toEqual([]);
    expect(result.failed_question_ids).toEqual(["q1", "q2"]);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "BATCH_MISMATCH" })]));
  });
});
