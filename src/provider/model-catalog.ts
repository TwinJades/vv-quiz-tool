import type { ProviderProfile } from "../core/schema";

export interface ModelCatalogResult {
  source: "provider_api" | "manual";
  models: string[];
  refreshed_at: string | null;
  input_token_limits?: Record<string, number>;
  error?: string;
}

function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/models`;
}

export async function listProviderModels(
  profile: ProviderProfile,
  apiKey: string | undefined,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ModelCatalogResult> {
  try {
    const requestInit: RequestInit = {
      method: "GET",
      headers: profile.provider_type === "google"
        ? (apiKey ? { "x-goog-api-key": apiKey } : {})
        : profile.provider_type === "anthropic"
          ? { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", ...(apiKey ? { "x-api-key": apiKey } : {}) }
          : (apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(signal ? { signal } : {}),
    };
    const models: string[] = [];
    const inputTokenLimits: Record<string, number> = Object.create(null);
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const url = new URL(modelsEndpoint(profile.base_url));
      if (cursor) url.searchParams.set(profile.provider_type === "google" ? "pageToken" : "after_id", cursor);
      const response = await fetcher(url.href, requestInit);
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null) throw new Error("Invalid model catalog response.");
      const payload = body as { data?: unknown; models?: unknown; nextPageToken?: unknown; has_more?: unknown; last_id?: unknown };
      const data = profile.provider_type === "google" ? payload.models : payload.data;
      if (!Array.isArray(data)) throw new Error("Provider model response does not contain a model array.");
      for (const item of data) {
        if (typeof item !== "object" || item === null) continue;
        if (profile.provider_type === "google") {
          if (typeof item.name === "string" && (!Array.isArray(item.supportedGenerationMethods) || item.supportedGenerationMethods.includes("generateContent"))) {
            const id = item.name.replace(/^models\//, "");
            models.push(id);
            if (typeof item.inputTokenLimit === "number" && Number.isSafeInteger(item.inputTokenLimit) && item.inputTokenLimit > 0) {
              inputTokenLimits[id] = Math.min(inputTokenLimits[id] ?? item.inputTokenLimit, item.inputTokenLimit);
            }
          }
        } else if (typeof item.id === "string") models.push(item.id);
      }
      const next = profile.provider_type === "google" ? payload.nextPageToken
        : profile.provider_type === "anthropic" && payload.has_more === true ? payload.last_id : null;
      if (!next) break;
      if (typeof next !== "string" || seen.has(next) || page === 99) throw new Error("Invalid model catalog pagination.");
      seen.add(next);
      cursor = next;
    }
    if (models.length === 0) {
      throw new Error("Provider returned no model ids.");
    }
    return {
      source: "provider_api",
      models: [...new Set(models)].sort(),
      refreshed_at: new Date().toISOString(),
      ...(Object.keys(inputTokenLimits).length ? { input_token_limits: inputTokenLimits } : {}),
    };
  } catch (error) {
    return {
      source: "manual",
      models: profile.model_catalog.models,
      refreshed_at: profile.model_catalog.refreshed_at,
      ...(profile.model_catalog.input_token_limits ? { input_token_limits: profile.model_catalog.input_token_limits } : {}),
      error: error instanceof Error ? error.message : "Unable to read provider models.",
    };
  }
}
