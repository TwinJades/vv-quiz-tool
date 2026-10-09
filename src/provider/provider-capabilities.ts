import type { ProviderProfile } from "../core/schema";

export function supportsNativeSearch(profile: ProviderProfile, modelId: string): boolean {
  return ['anthropic', 'openai_compatible'].includes(profile.provider_type) && profile.capabilities.native_web_search &&
    profile.model_catalog.models.includes(modelId);
}
