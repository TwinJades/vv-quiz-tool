import { describe, expect, it, vi } from "vitest";

import { SCHEMA_VERSION } from "../../src/core";
import type { ProviderProfile } from "../../src/core";
import { listProviderModels } from "../../src/provider/model-catalog";

const profile: ProviderProfile = {
  schema_version: SCHEMA_VERSION,
  provider_profile_id: "p1",
  display_name: "Provider",
  provider_type: "openai_compatible",
  base_url: "https://provider.example/v1",
  secret_ref: "secret",
  model_catalog: { source: "manual", models: ["manual-model"], refreshed_at: null },
  capabilities: { image_input: false, structured_output: true, native_web_search: false },
  image_upload_authorized: false,
};

describe("listProviderModels", () => {
  it("reads native Google catalogs across pages and excludes embedding-only models", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ models: [{ name: "models/gemini-3.8-flash", inputTokenLimit: 32768, supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding", inputTokenLimit: 1000, supportedGenerationMethods: ["embedContent"] }], nextPageToken: "next" }))
      .mockResolvedValueOnce(Response.json({ models: [{ name: "models/gemini-3.1-pro", inputTokenLimit: 65536 }] }));
    expect(await listProviderModels({ ...profile, provider_type: "google" }, "key", undefined, fetcher)).toMatchObject({
      source: "provider_api", models: ["gemini-3.1-pro", "gemini-3.8-flash"],
      input_token_limits: { "gemini-3.1-pro": 65536, "gemini-3.8-flash": 32768 },
    });
    expect(fetcher.mock.calls[1]![0]).toBe("https://provider.example/v1/models?pageToken=next");
    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({ "x-goog-api-key": "key" });
  });

  it("uses native Anthropic authentication and bounded pagination", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "a" }], has_more: true, last_id: "a" }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "b" }], has_more: false }));
    expect(await listProviderModels({ ...profile, provider_type: "anthropic" }, "key", undefined, fetcher)).toMatchObject({ models: ["a", "b"] });
    expect(fetcher.mock.calls[1]![0]).toBe("https://provider.example/v1/models?after_id=a");
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ "x-api-key": "key", "anthropic-version": "2023-06-01" });
  });

  it("reads and deduplicates an OpenAI-compatible model list", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] }), {
        status: 200,
      }),
    );
    const result = await listProviderModels(profile, "key", undefined, fetcher);
    expect(result).toMatchObject({ source: "provider_api", models: ["a", "b"] });
    expect(fetcher).toHaveBeenCalledWith(
      "https://provider.example/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer key" } }),
    );
  });

  it("falls back to manually configured model ids", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    const result = await listProviderModels(profile, undefined, undefined, fetcher);
    expect(result).toMatchObject({ source: "manual", models: ["manual-model"], error: "network down" });
  });

  it("ignores malformed Google limits and retains verified metadata on refresh failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [
      { name: "models/a", inputTokenLimit: "1000" }, { name: "models/b", inputTokenLimit: -1 }, { name: "models/c", inputTokenLimit: 1.5 },
    ] }));
    const result = await listProviderModels({ ...profile, provider_type: "google" }, undefined, undefined, fetcher);
    expect(result.input_token_limits).toBeUndefined();
    const failure = await listProviderModels({ ...profile, model_catalog: { ...profile.model_catalog, input_token_limits: { "manual-model": 4096 } } }, undefined, undefined, vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    expect(failure.input_token_limits).toEqual({ "manual-model": 4096 });
  });
});
