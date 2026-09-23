import { SCHEMA_VERSION } from "./schema";
import type {
  AnswerResult,
  ExecutionAction,
  ExecutionPlan,
  LocatorMap,
  QuestionFrame,
  RunStrategy,
} from "./schema";

export class ExecutionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanError";
  }
}

function assertSameContext(question: QuestionFrame, answer: AnswerResult, locatorMap: LocatorMap): void {
  if (
    question.session_id !== answer.session_id ||
    question.session_id !== locatorMap.session_id ||
    question.question_id !== answer.question_id ||
    question.question_id !== locatorMap.question_id ||
    question.observation_id !== answer.observation_id ||
    question.observation_id !== locatorMap.observation_id
  ) {
    throw new ExecutionPlanError("Question, answer and LocatorMap do not share the same context.");
  }
  if (answer.status !== "answered") {
    throw new ExecutionPlanError("Only validated answered results can become execution plans.");
  }
}

function requireSemanticTarget(locatorMap: LocatorMap, targetId: string): void {
  const target = locatorMap.targets[targetId];
  if (!target || target.kind !== "semantic") {
    throw new ExecutionPlanError(`No semantic target exists for ${targetId}.`);
  }
}

export function buildAnswerExecutionPlan(
  question: QuestionFrame,
  answer: AnswerResult,
  locatorMap: LocatorMap,
  strategy: RunStrategy,
): ExecutionPlan {
  assertSameContext(question, answer, locatorMap);
  const actions: ExecutionAction[] = [];

  if (question.type === "fill_blank") {
    for (const item of answer.blank_answers) {
      requireSemanticTarget(locatorMap, item.blank_id);
      actions.push({
        action_id: `set_${item.blank_id}`,
        kind: "set_value",
        target_id: item.blank_id,
        value: item.value,
      });
    }
  } else {
    const selected = new Set(answer.selected_option_ids);
    for (const option of question.options) {
      requireSemanticTarget(locatorMap, option.id);
      actions.push({
        action_id: `select_${option.id}`,
        kind: "set_selected",
        target_id: option.id,
        value: selected.has(option.id),
      });
    }
  }

  if (actions.length === 0) {
    throw new ExecutionPlanError("An answer execution plan cannot be empty.");
  }

  return {
    schema_version: SCHEMA_VERSION,
    session_id: question.session_id,
    question_id: question.question_id,
    observation_id: question.observation_id,
    strategy,
    actions,
    preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
  };
}
