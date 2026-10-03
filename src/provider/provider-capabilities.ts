import type { ProviderProfile } from "../core/schema";

export function supportsNativeSearch(profile: ProviderProfile, modelId: string): boolean {
  return profile.provider_type === "anthropic" && profile.capabilities.native_web_search &&
    Boolean(profile.native_web_search_model_ids?.includes(modelId));
}
