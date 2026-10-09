import { SCHEMA_VERSION } from "../core";
import type { ActionResult, ExecutionPlan, PlatformState, VerificationResult, Verifier } from "../core";

export class WebVerifier implements Verifier {
  verify(
    before: PlatformState,
    plan: ExecutionPlan,
    actions: ActionResult[],
    after: PlatformState,
  ): VerificationResult {
    const completeReport = actions.length === plan.actions.length && new Set(actions.map(action=>action.action_id)).size===actions.length && plan.actions.every(action=>actions.some(result=>result.action_id===action.action_id));
    const failedAction = !completeReport || actions.some((action) => action.status === "failed");
    const unknownAction = actions.some((action) => action.status === "unknown");
    const expectedSelections = new Map(
      plan.actions
        .filter((action) => action.kind === "set_selected")
        .map((action) => [action.target_id, action.value]),
    );
    const selectionMatches = [...expectedSelections].every(
      ([targetId, value]) => after.selected_target_ids.includes(targetId) === value,
    );
    const valuesMatch = plan.actions
      .filter((action) => action.kind === "set_value")
      .every((action) => after.field_values[action.target_id] === action.value);
    const questionChanged = after.fingerprint !== "missing" && before.fingerprint !== after.fingerprint;
    const documentChanged = before.observation_id !== after.observation_id;
    const contextChanged = after.fingerprint !== "missing" && (questionChanged || documentChanged);
    const submitted = plan.actions.some((action) =>
      action.kind === "submit_question" || action.kind === "submit_session",
    );
    const advanced = plan.actions.some((action) => action.kind === "advance");
    const freshFeedback = after.feedback !== null && (before.feedback !== after.feedback || before.feedback_text !== after.feedback_text || before.question_graded !== after.question_graded);
    const strongControlSignal = contextChanged || after.completed && !before.completed || freshFeedback;
    const submissionSignal =
      strongControlSignal || before.has_next !== after.has_next || before.can_retry !== after.can_retry;

    let status: VerificationResult["status"] = "verified";
    let stage: VerificationResult["stage"] = "answer_applied";
    let outcome: VerificationResult["outcome"] = "unknown";
    let nextAction: VerificationResult["next_action"] = "continue";

    if (
      failedAction ||
      (unknownAction && !strongControlSignal) ||
      (!after.completed && !selectionMatches && !contextChanged) ||
      (!after.completed && !valuesMatch && !contextChanged) ||
      (submitted && !submissionSignal) ||
      (advanced && !contextChanged && !after.completed)
    ) {
      status = unknownAction || (submitted && !submissionSignal) ? "uncertain" : "failed";
      nextAction = "pause";
    } else if (after.completed) {
      stage = "session_completed";
      nextAction = "complete";
    } else if (after.feedback) {
      stage = "graded";
      outcome = after.feedback;
      nextAction = after.feedback === "incorrect" && after.can_retry ? "resolve_again" : "advance";
    } else if (advanced && contextChanged) {
      stage = "advanced";
      nextAction = "continue";
    } else if (submitted) {
      stage = "submitted";
      nextAction = after.has_next ? "advance" : "continue";
    }

    return {
      schema_version: SCHEMA_VERSION,
      session_id: plan.session_id,
      question_id: plan.question_id,
      status,
      stage,
      outcome,
      signals: [
        ...(selectionMatches ? ["selection_state_matches"] : []),
        ...(valuesMatch ? ["field_values_match"] : []),
        ...(questionChanged ? ["question_fingerprint_changed"] : []),
        ...(documentChanged ? ["observation_context_changed"] : []),
        ...(after.feedback ? [`feedback:${after.feedback}`] : []),
      ],
      can_retry: after.can_retry,
      next_action: nextAction,
    };
  }
}
