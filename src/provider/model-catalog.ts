import type { ProviderProfile } from "../core/schema";

export interface ModelCatalogResult {
  source: "provider_api" | "manual";
  models: string[];
  refreshed_at: string | null;
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
      ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
      ...(signal ? { signal } : {}),
    };
    const response = await fetcher(modelsEndpoint(profile.base_url), requestInit);
    if (!response.ok) {
      throw new Error(`Provider returned HTTP ${response.status}.`);
    }
    const body: unknown = await response.json();
    const data =
      typeof body === "object" && body !== null && "data" in body
        ? (body as { data?: unknown }).data
        : undefined;
    if (!Array.isArray(data)) {
      throw new Error("Provider model response does not contain a data array.");
    }
    const models = data
      .map((item) =>
        typeof item === "object" && item !== null && "id" in item && typeof item.id === "string"
          ? item.id
          : null,
      )
      .filter((id): id is string => Boolean(id));
    if (models.length === 0) {
      throw new Error("Provider returned no model ids.");
    }
    return {
      source: "provider_api",
      models: [...new Set(models)].sort(),
      refreshed_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      source: "manual",
      models: profile.model_catalog.models,
      refreshed_at: profile.model_catalog.refreshed_at,
      error: error instanceof Error ? error.message : "Unable to read provider models.",
    };
  }
}
