import { DEFAULT_BATCH_LIMITS } from "../core/batch-planner";
import type { BatchLimits } from "../core/batch-planner";
import type { ProviderProfile } from "../core/schema";

/** Payload estimates leave room for instructions/schema; no model-name inference. */
export function modelBatchLimits(profile: ProviderProfile, modelId: string): BatchLimits {
  const overrides = profile.model_batch_limits;
  const limits = { ...(overrides && Object.hasOwn(overrides, modelId) ? overrides[modelId]! : DEFAULT_BATCH_LIMITS) };
  const metadata = profile.model_catalog.input_token_limits;
  const inputLimit = metadata && Object.hasOwn(metadata, modelId) ? metadata[modelId] : undefined;
  if (inputLimit !== undefined) {
    limits.max_estimated_tokens = Math.min(limits.max_estimated_tokens, Math.max(1, Math.floor(inputLimit * 0.8) - 1024));
  }
  if (!profile.capabilities.image_input) limits.max_images = 0;
  return limits;
}
