import { answerResultSchema } from "./schema";
import type { AnswerResult, QuestionFrame } from "./schema";

export type AnswerValidationIssueCode =
  | "INVALID_STRUCTURE"
  | "SESSION_MISMATCH"
  | "QUESTION_MISMATCH"
  | "OBSERVATION_MISMATCH"
  | "ANSWER_TYPE_MISMATCH"
  | "DUPLICATE_OPTION"
  | "UNKNOWN_OPTION"
  | "SELECTION_COUNT"
  | "UNEXPECTED_BLANK_ANSWER"
  | "DUPLICATE_BLANK"
  | "UNKNOWN_BLANK"
  | "MISSING_BLANK"
  | "BLANK_LENGTH"
  | "UNEXPECTED_OPTION_SELECTION";

export interface AnswerValidationIssue {
  code: AnswerValidationIssueCode;
  message: string;
}

export type AnswerValidationResult =
  | {
      valid: true;
      executable: boolean;
      answer: AnswerResult;
      issues: [];
    }
  | {
      valid: false;
      executable: false;
      issues: AnswerValidationIssue[];
    };

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateAnswer(
  question: QuestionFrame,
  candidate: unknown,
): AnswerValidationResult {
  const parsed = answerResultSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      valid: false,
      executable: false,
      issues: [
        {
          code: "INVALID_STRUCTURE",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
        },
      ],
    };
  }

  const answer = parsed.data;
  const issues: AnswerValidationIssue[] = [];

  if (answer.session_id !== question.session_id) {
    issues.push({ code: "SESSION_MISMATCH", message: "Answer belongs to another session." });
  }
  if (answer.question_id !== question.question_id) {
    issues.push({ code: "QUESTION_MISMATCH", message: "Answer belongs to another question." });
  }
  if (answer.observation_id !== question.observation_id) {
    issues.push({
      code: "OBSERVATION_MISMATCH",
      message: "Answer was produced from a stale observation.",
    });
  }
  if (answer.answer_type !== question.type) {
    issues.push({ code: "ANSWER_TYPE_MISMATCH", message: "Answer type does not match the question." });
  }

  if (question.type === "single_choice" || question.type === "multiple_choice") {
    const allowedOptions = new Set(question.options.map((option) => option.id));
    if (hasDuplicates(answer.selected_option_ids)) {
      issues.push({ code: "DUPLICATE_OPTION", message: "An option may only be selected once." });
    }
    if (answer.selected_option_ids.some((id) => !allowedOptions.has(id))) {
      issues.push({ code: "UNKNOWN_OPTION", message: "Answer references an option outside this question." });
    }
    if (answer.blank_answers.length > 0) {
      issues.push({
        code: "UNEXPECTED_BLANK_ANSWER",
        message: "Choice answers cannot contain blank values.",
      });
    }
    if (
      answer.status === "answered" &&
      (answer.selected_option_ids.length < question.constraints.min_selections ||
        answer.selected_option_ids.length > question.constraints.max_selections)
    ) {
      issues.push({
        code: "SELECTION_COUNT",
        message: "Selected option count violates the question constraints.",
      });
    }
  } else {
    if (answer.selected_option_ids.length > 0) {
      issues.push({
        code: "UNEXPECTED_OPTION_SELECTION",
        message: "Fill-blank answers cannot contain option selections.",
      });
    }

    const answerBlankIds = answer.blank_answers.map((item) => item.blank_id);
    const expectedBlankIds = new Set(question.blanks.map((blank) => blank.id));
    if (hasDuplicates(answerBlankIds)) {
      issues.push({ code: "DUPLICATE_BLANK", message: "A blank may only be answered once." });
    }
    if (answerBlankIds.some((id) => !expectedBlankIds.has(id))) {
      issues.push({ code: "UNKNOWN_BLANK", message: "Answer references a blank outside this question." });
    }
    if (
      answer.status === "answered" &&
      question.blanks.some((blank) => blank.required && !answer.blank_answers.find(item => item.blank_id === blank.id)?.value.trim())
    ) {
      issues.push({ code: "MISSING_BLANK", message: "A required blank has no answer." });
    }
    if (answer.blank_answers.some(item => {
      const blank = question.blanks.find(blank => blank.id === item.blank_id);
      return blank?.max_length !== undefined && item.value.length > blank.max_length;
    })) issues.push({ code: "BLANK_LENGTH", message: "A blank exceeds its maximum length." });
  }

  if (issues.length > 0) {
    return { valid: false, executable: false, issues };
  }

  return {
    valid: true,
    executable: answer.status === "answered",
    answer,
    issues: [],
  };
}
