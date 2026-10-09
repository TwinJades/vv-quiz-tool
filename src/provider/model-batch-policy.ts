import { DEFAULT_BATCH_LIMITS } from "../core/batch-planner";
import type { BatchLimits } from "../core/batch-planner";
import type { ProviderProfile } from "../core/schema";

export function providerBatchLimits(profile: ProviderProfile): BatchLimits {
  if (profile.provider_batch_limits) return { ...profile.provider_batch_limits };
  const saved = Object.values(profile.model_batch_limits ?? {});
  if (!saved.length) return { ...DEFAULT_BATCH_LIMITS };
  return {
    max_questions: Math.min(...saved.map(limits => limits.max_questions)),
    max_estimated_tokens: Math.min(...saved.map(limits => limits.max_estimated_tokens)),
    max_images: Math.min(...saved.map(limits => limits.max_images)),
  };
}

export function modelBatchLimits(profile: ProviderProfile, modelId: string): BatchLimits {
  const limits = providerBatchLimits(profile);
  const metadata = profile.model_catalog.input_token_limits;
  const inputLimit = metadata && Object.hasOwn(metadata, modelId) ? metadata[modelId] : undefined;
  if (inputLimit !== undefined) {
    limits.max_estimated_tokens = Math.min(limits.max_estimated_tokens, Math.max(1, Math.floor(inputLimit * 0.8) - 1024));
  }
  if (!profile.capabilities.image_input) limits.max_images = 0;
  return limits;
}
