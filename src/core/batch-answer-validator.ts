import { batchAnswerResultSchema } from "./schema";
import { validateAnswer } from "./answer-validator";
import type {
  AnswerResult,
  BatchAnswerResult,
  QuestionBatch,
  QuestionFrame,
} from "./schema";
import type { AnswerValidationIssue } from "./answer-validator";

export type BatchValidationIssueCode =
  | "INVALID_BATCH_STRUCTURE"
  | "SESSION_MISMATCH"
  | "BATCH_MISMATCH"
  | "DUPLICATE_QUESTION_RESULT"
  | "UNKNOWN_QUESTION_RESULT"
  | "ANSWER_INVALID";

export interface BatchValidationIssue {
  code: BatchValidationIssueCode;
  message: string;
  question_id?: string;
  answer_issues?: AnswerValidationIssue[];
}

export interface BatchAnswerValidationResult {
  valid_answers: AnswerResult[];
  executable_answers: AnswerResult[];
  failed_question_ids: string[];
  missing_question_ids: string[];
  issues: BatchValidationIssue[];
}

function indexQuestions(batch: QuestionBatch): Map<string, QuestionFrame> {
  return new Map(batch.questions.map((question) => [question.question_id, question]));
}

export function validateBatchAnswer(
  batch: QuestionBatch,
  candidate: unknown,
): BatchAnswerValidationResult {
  const parsed = batchAnswerResultSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      valid_answers: [],
      executable_answers: [],
      failed_question_ids: [...batch.question_ids],
      missing_question_ids: [...batch.question_ids],
      issues: [
        {
          code: "INVALID_BATCH_STRUCTURE",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
        },
      ],
    };
  }

  const result: BatchAnswerResult = parsed.data;
  const issues: BatchValidationIssue[] = [];
  const questions = indexQuestions(batch);
  const acceptedIds = new Set<string>();
  const seenIds = new Set<string>();
  const validAnswers: AnswerResult[] = [];
  const executableAnswers: AnswerResult[] = [];

  if (result.session_id !== batch.session_id) {
    issues.push({ code: "SESSION_MISMATCH", message: "Batch answer belongs to another session." });
  }
  if (result.batch_id !== batch.batch_id) {
    issues.push({ code: "BATCH_MISMATCH", message: "Batch answer has an unexpected batch id." });
  }

  const batchIdentityValid = result.session_id === batch.session_id && result.batch_id === batch.batch_id;
  for (const answer of result.answers) {
    if (seenIds.has(answer.question_id)) {
      issues.push({
        code: "DUPLICATE_QUESTION_RESULT",
        question_id: answer.question_id,
        message: "A batch may contain only one answer per question.",
      });
      continue;
    }
    seenIds.add(answer.question_id);

    const question = questions.get(answer.question_id);
    if (!question) {
      issues.push({
        code: "UNKNOWN_QUESTION_RESULT",
        question_id: answer.question_id,
        message: "Batch answer references a question outside the request.",
      });
      continue;
    }

    const validation = validateAnswer(question, answer);
    if (!validation.valid) {
      issues.push({
        code: "ANSWER_INVALID",
        question_id: answer.question_id,
        message: "Question answer failed semantic validation.",
        answer_issues: validation.issues,
      });
      continue;
    }

    if (batchIdentityValid) {
      validAnswers.push(validation.answer);
      acceptedIds.add(answer.question_id);
      if (validation.executable) {
        executableAnswers.push(validation.answer);
      }
    }
  }

  const explicitErrorIds = new Set(
    result.errors
      .map((error) => error.question_id)
      .filter((questionId) => questions.has(questionId)),
  );
  const missingQuestionIds = batch.question_ids.filter(
    (questionId) => !seenIds.has(questionId) && !explicitErrorIds.has(questionId),
  );
  const failedQuestionIds = batch.question_ids.filter((questionId) => !acceptedIds.has(questionId));

  return {
    valid_answers: validAnswers,
    executable_answers: executableAnswers,
    failed_question_ids: failedQuestionIds,
    missing_question_ids: missingQuestionIds,
    issues,
  };
}
