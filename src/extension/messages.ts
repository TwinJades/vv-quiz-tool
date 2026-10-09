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
  | {type:'VV_COURSE_FRAME_RECT';child_url:string}
  | {type:'VV_CAPTURE_COURSE_SURFACE';session_id:string;context?:import('../web/course-surface').CourseFrameContext}
  | {type:'VV_COURSE_EMBEDDED_FRAMES';session_id:string}
  | {type:'VV_PAUSE_COURSE_MEDIA';course_id:string;context_id:string|null;session_id:string;interaction_epoch:string;context?:import('../web/course-surface').CourseFrameContext}
  | {type:'VV_APPLY_COURSE_SURFACE';session_id:string;reading:import('../web/course-surface').CourseSurfaceReading}
  | {type:'VV_EXPAND_COURSE_SURFACE';session_id:string;interaction_epoch:string;direction?:'next'|'previous'}
  | {type:'VV_CHAOXING_QUESTION_GEOMETRY';question_id:string}
  | {type:'VV_COURSE_SUBMISSION';phase:'arm'|'confirm'|'cancel'}
  | {type:'VV_SUBMIT_CHAOXING';course_id:string;lesson_id:string;task_id:string;quiz_index:number;session_id:string;interaction_epoch:string}
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
  | {ok:true;result:import('../web/course-surface').CourseEmbeddedFrame[]}
  | {ok:true;result:import('../web/frame-projection').CourseFrameRect}
  | {ok:true;result:import('../web/course-surface').CourseSurfaceSnapshot}
  | {ok:true;result:import('../web/chaoxing-practice').ChaoxingPracticeReviewReading}
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
  preparation_id?:string;
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
  tasks: Array<{ tab_id: number; saved_session_id?:string; title: string; url: string | null; provider_name: string; snapshot: SessionRuntimeSnapshot; resumable: boolean }>;
}

export type ExtensionRequest =
  | {type:'VV_PREPARE_COURSE';tab_id:number;provider_profile_id:string;model_id:string;model_call_limit:number}
  | {type:'VV_GET_COURSE_PREPARATION';tab_id:number}
  | {type:'VV_CANCEL_COURSE_PREPARATION';tab_id:number}
  | {type:'VV_OPEN_SAVED_COURSE';session_id:string}
  | {type:'VV_CLEAR_SAVED_COURSE';session_id:string}
  | { type: 'VV_GET_BUILD' }
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
  | { type: "VV_STOP_SESSION"; tab_id: number }
  | { type: "VV_CLEAR_SESSION"; tab_id: number }
  | { type: "VV_DELETE_PROVIDER"; provider_profile_id: string };
