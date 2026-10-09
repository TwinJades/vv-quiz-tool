import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, ToolSet } from "ai";
import type { ProviderProfile } from "../core/schema";
import { supportsNativeSearch } from "./provider-capabilities";

export function providerRuntime(profile: ProviderProfile, modelId: string, apiKey?: string, fetcher?: typeof fetch, nativeSearch = false): {
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
  if (nativeSearch && supportsNativeSearch(profile, modelId)) {
    const provider = createOpenAI(settings);
    return { model: provider.responses(modelId), searchTools: { web_search: provider.tools.webSearch({}) } };
  }
  return { model: createOpenAICompatible({ ...settings, name: "vv-openai-compatible", supportsStructuredOutputs: profile.capabilities.structured_output })(modelId) };
}
