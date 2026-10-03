import type {
  ActionResult,
  ExecutionPlan,
  LocatorMap,
  QuestionFrame,
  ObservationInputMode,
  MediaRef,
  VerificationResult,
} from "./schema";

export interface PlatformCapabilities {
  question_types: Array<"single_choice" | "multiple_choice" | "fill_blank">;
  multi_question_page: boolean;
  text_input: boolean;
  image_input: boolean;
  semantic_targeting: boolean;
  coordinate_targeting: boolean;
  submit: boolean;
  advance: boolean;
  grading_feedback: boolean;
  timer_observation: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  reason?: string;
}

export interface ParsedQuestion {
  question: QuestionFrame;
  locator_map: LocatorMap;
}

export interface PlatformObservation {
  session_id: string;
  observation_id: string;
  captured_at: string;
  surface_id: string;
  surface_origin: string;
  surface_title: string;
  layout: "sequential" | "multi_question_page";
  questions: ParsedQuestion[];
  question_total: number | null;
  timer_remaining_seconds: number | null;
  fingerprint: string;
  stable_for_ms: number;
  local_control_candidates?: Array<{ semantic_id: string; text: string; disabled: boolean }>;
  page_context?: {
    mode: ObservationInputMode;
    visible_text: string;
    controls: Array<{
      semantic_id: string;
      role: string;
      text: string;
      selected: boolean;
      disabled: boolean;
    }>;
    media: MediaRef[];
  };
}

export interface PlatformState {
  timer_remaining_seconds?: number | null;
  observation_id: string;
  fingerprint: string;
  selected_target_ids: string[];
  field_values: Record<string, string>;
  feedback: "correct" | "incorrect" | "partial" | null;
  feedback_text?: string;
  visible_score?: string;
  can_retry: boolean;
  has_next: boolean;
  has_session_submit?: boolean;
  at_last_question?: boolean;
  completed: boolean;
}

export interface PlatformAdapter {
  readTimer?(signal: AbortSignal): Promise<number | null>;
  capabilities(): PlatformCapabilities;
  waitUntilReady(signal: AbortSignal): Promise<ReadinessResult>;
  observeSession(sessionId: string, signal: AbortSignal, mode?: ObservationInputMode): Promise<PlatformObservation>;
  execute(plan: ExecutionPlan, locatorMap: LocatorMap, signal: AbortSignal): Promise<ActionResult[]>;
  readState(signal: AbortSignal): Promise<PlatformState>;
}

export interface Verifier {
  verify(
    before: PlatformState,
    plan: ExecutionPlan,
    actions: ActionResult[],
    after: PlatformState,
  ): VerificationResult;
}
