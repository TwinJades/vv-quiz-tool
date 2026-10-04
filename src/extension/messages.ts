import type { ExecutionPlan, LocatorMap, ObservationInputMode, PlatformObservation, PlatformState, RunStrategy } from "../core";
import type { ActionResult, QueueSnapshot, SessionRuntimeSnapshot } from "../core";
import type { LocalStructure, SeparationRoles, SeparationSnapshot } from "../web/separation-trial";
import type { InteractionBinding, NativeInputTicket } from "./interaction-guard";
import type { VisualGeometry } from "../core/visual";
import type { CourseCatalog, LearningTask, QuizBoundary } from '../core/course';
import type { CoursePageRequest, CoursePageResult } from '../web/course-adapter';
import type { CourseInspection } from '../web/course-inspection';
import type { InitialSemanticSnapshot, InitialSemanticReading } from "../web/initial-snapshot";
import type { ZhidaoResultReading } from '../web/zhidao-result';

export type ContentRequest =
  | {type:'VV_KNOWLEDGE_PAGE';request:import('../web/knowledge-practice-page').KnowledgePageRequest;session_id?:string;interaction_epoch?:string}
  | { type: 'VV_READ_ZHIDAO_RESULT' }
  | { type: "VV_CAPTURE_INITIAL_SEMANTIC"; binding: InteractionBinding }
  | { type: "VV_APPLY_INITIAL_SEMANTIC"; binding: InteractionBinding; reading: InitialSemanticReading }
  | { type: 'VV_INSPECT_COURSE_PAGE' }
  | { type: 'VV_COURSE'; request: CoursePageRequest; session_id?: string; interaction_epoch?: string }
  | { type: 'VV_COURSE_QUIZ'; course_id: string; task: LearningTask; boundary: QuizBoundary; parent_session_id: string; interaction_epoch: string; request: ContentRequest }
  | { type: "VV_WAIT_READY" }
  | { type: "VV_OBSERVE"; session_id: string; mode: ObservationInputMode }
  | { type: "VV_READ_STATE" }
  | { type: "VV_READ_TIMER" }
  | { type: "VV_EXECUTE"; plan: ExecutionPlan; locator_map: LocatorMap; interaction_epoch?: string }
  | { type: "VV_SET_INTERACTION"; binding: InteractionBinding }
  | { type: "VV_VISUAL_GEOMETRY"; binding?: InteractionBinding; full_viewport?: boolean }
  | { type: "VV_ARM_NATIVE_INPUT"; ticket: NativeInputTicket | null }
  | { type: "VV_RESOLVE_MEDIA"; temporary_handles: string[] }
  | { type: "VV_CAPTURE_SEPARATION" }
  | { type: "VV_APPLY_SEPARATION"; roles: SeparationRoles }
  | { type: "VV_REUSE_SEPARATION"; structure: LocalStructure };

export type ContentResponse =
  | {ok:true;result:import('../web/knowledge-practice-page').KnowledgePageResult}
  | { ok: true; result: ZhidaoResultReading | null }
  | { ok: true; result: InitialSemanticSnapshot }
  | { ok: true; result: CourseInspection }
  | { ok: true; result: CoursePageResult }
  | { ok: true; result: number | null }
  | { ok: true; result: { ready: boolean; reason?: string } }
  | { ok: true; result: PlatformObservation }
  | { ok: true; result: PlatformState }
  | { ok: true; result: ActionResult[] }
  | { ok: true; result: { snapshot: SeparationSnapshot; suggested: boolean } }
  | { ok: true; result: LocalStructure | null }
  | { ok: true; result: boolean }
  | { ok: true; result: VisualGeometry }
  | {
      ok: true;
      result: Array<{ temporary_handle: string; source_url: string; mime_type: string }>;
    }
  | { ok: false; error: string };

export interface StartSessionRequest {
  practice_course?:{catalog:import('../core/knowledge-practice').KnowledgeCatalog;scope:string[]};
  course?: { course_id: string; platform: 'zhidao' | 'chaoxing'; scope: string[]; revision: string };
  type: "VV_START_SESSION";
  tab_id: number;
  provider_profile_id: string;
  model_id: string;
  strategy: RunStrategy;
  model_call_limit: number;
  observation_input_mode: ObservationInputMode;
  allow_native_search?: boolean;
}

export interface ArmSessionStartRequest {
  type: "VV_ARM_SESSION_START";
  start_request: StartSessionRequest;
  required_origins: string[];
}

export interface TaskPanelSnapshot extends QueueSnapshot {
  tasks: Array<{ tab_id: number; title: string; url: string | null; provider_name: string; snapshot: SessionRuntimeSnapshot; resumable: boolean }>;
}

export type ExtensionRequest =
  | {type:'VV_PREVIEW_PRACTICES';tab_id:number}
  | { type: 'VV_INSPECT_COURSE'; tab_id: number }
  | { type: 'VV_PREVIEW_COURSE'; tab_id: number }
  | StartSessionRequest
  | ArmSessionStartRequest
  | { type: "VV_USER_INTERACTION"; session_id: string; epoch: string }
  | { type: "VV_GET_TASKS" }
  | { type: "VV_SET_CONCURRENCY"; limit: number }
  | { type: "VV_COMMIT_SESSION_START"; tab_id: number }
  | { type: "VV_CANCEL_SESSION_START"; tab_id: number }
  | { type: "VV_GET_SESSION"; tab_id: number }
  | { type: "VV_PAUSE_SESSION"; tab_id: number }
  | { type: "VV_RESUME_SESSION"; tab_id: number }
  | { type: "VV_SWITCH_STRATEGY"; tab_id: number; strategy: RunStrategy }
  | { type: "VV_STOP_SESSION"; tab_id: number }
  | { type: "VV_CLEAR_SESSION"; tab_id: number }
  | { type: "VV_DELETE_PROVIDER"; provider_profile_id: string };
