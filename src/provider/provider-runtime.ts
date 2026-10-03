import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, ToolSet } from "ai";
import type { ProviderProfile } from "../core/schema";
import { supportsNativeSearch } from "./provider-capabilities";

export function providerRuntime(profile: ProviderProfile, modelId: string, apiKey?: string, fetcher?: typeof fetch): {
  model: LanguageModel;
  searchTools?: ToolSet;
} {
  const settings = { baseURL: profile.base_url.replace(/\/$/, ""), ...(apiKey ? { apiKey } : {}), ...(fetcher ? { fetch: fetcher } : {}) };
  if (profile.provider_type === "google") return { model: createGoogle(settings)(modelId) };
  if (profile.provider_type === "anthropic") {
    const provider = createAnthropic({ ...settings, headers: { "anthropic-dangerous-direct-browser-access": "true" } });
    return { model: provider(modelId), ...(supportsNativeSearch(profile, modelId) ? {
      searchTools: { web_search: provider.tools.webSearch_20250305({ maxUses: 1 }) },
    } : {}) };
  }
  return { model: createOpenAICompatible({ ...settings, name: "vv-openai-compatible", supportsStructuredOutputs: profile.capabilities.structured_output })(modelId) };
}
