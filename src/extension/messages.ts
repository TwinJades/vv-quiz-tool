import type { ExecutionPlan, LocatorMap, ObservationInputMode, PlatformObservation, PlatformState, RunStrategy } from "../core";
import type { ActionResult } from "../core";
import type { LocalStructure, SeparationRoles, SeparationSnapshot } from "../web/separation-trial";

export type ContentRequest =
  | { type: "VV_WAIT_READY" }
  | { type: "VV_OBSERVE"; session_id: string; mode: ObservationInputMode }
  | { type: "VV_READ_STATE" }
  | { type: "VV_EXECUTE"; plan: ExecutionPlan; locator_map: LocatorMap }
  | { type: "VV_RESOLVE_MEDIA"; temporary_handles: string[] }
  | { type: "VV_CAPTURE_SEPARATION" }
  | { type: "VV_APPLY_SEPARATION"; roles: SeparationRoles }
  | { type: "VV_REUSE_SEPARATION"; structure: LocalStructure };

export type ContentResponse =
  | { ok: true; result: { ready: boolean; reason?: string } }
  | { ok: true; result: PlatformObservation }
  | { ok: true; result: PlatformState }
  | { ok: true; result: ActionResult[] }
  | { ok: true; result: { snapshot: SeparationSnapshot; suggested: boolean } }
  | { ok: true; result: LocalStructure | null }
  | { ok: true; result: boolean }
  | {
      ok: true;
      result: Array<{ temporary_handle: string; source_url: string; mime_type: string }>;
    }
  | { ok: false; error: string };

export interface StartSessionRequest {
  type: "VV_START_SESSION";
  tab_id: number;
  provider_profile_id: string;
  model_id: string;
  strategy: RunStrategy;
  model_call_limit: number;
  observation_input_mode: ObservationInputMode;
}

export interface ArmSessionStartRequest {
  type: "VV_ARM_SESSION_START";
  start_request: StartSessionRequest;
  required_origins: string[];
}

export type ExtensionRequest =
  | StartSessionRequest
  | ArmSessionStartRequest
  | { type: "VV_COMMIT_SESSION_START"; tab_id: number }
  | { type: "VV_CANCEL_SESSION_START"; tab_id: number }
  | { type: "VV_GET_SESSION"; tab_id: number }
  | { type: "VV_PAUSE_SESSION"; tab_id: number }
  | { type: "VV_RESUME_SESSION"; tab_id: number }
  | { type: "VV_SWITCH_STRATEGY"; tab_id: number; strategy: RunStrategy }
  | { type: "VV_STOP_SESSION"; tab_id: number }
  | { type: "VV_CLEAR_SESSION"; tab_id: number }
  | { type: "VV_DELETE_PROVIDER"; provider_profile_id: string };
