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
});
