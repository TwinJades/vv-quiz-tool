import { describe, expect, it, vi } from "vitest";
import { ModelCallBudget, providerProfileSchema } from "../../src/core";
import type { ProviderProfile, QuestionBatch } from "../../src/core";
import { VercelAiSolverProvider } from "../../src/provider/solver-provider";

const profile: ProviderProfile = {
  schema_version: "1.0", provider_profile_id: "native", display_name: "Native test",
  provider_type: "anthropic", base_url: "https://native.test/v1", secret_ref: "test-key",
  model_catalog: { source: "manual", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], refreshed_at: null },
  capabilities: { image_input: false, structured_output: true, native_web_search: true },
  image_upload_authorized: false, native_web_search_model_ids: ["claude-sonnet-4-5"],
};
const batch: QuestionBatch = {
  schema_version: "1.0", session_id: "s", batch_id: "b", attempt: 1, question_ids: ["q"],
  capability_requirements: { image_input: false, native_web_search: false },
  questions: [{ schema_version: "1.0", session_id: "s", question_id: "q", observation_id: "o", type: "single_choice",
    stem: { text: "Choose A", format: "plain_text", media: [] }, options: [{ id: "a", text: "A", media: [] }], blanks: [],
    constraints: { min_selections: 1, max_selections: 1 }, provenance: { text_source: "dom", untrusted_content: true } }],
};
const answer = { schema_version: "1.0", session_id: "s", batch_id: "b", errors: [], answers: [{
  schema_version: "1.0", session_id: "s", question_id: "q", observation_id: "o", answer_type: "single_choice",
  status: "answered", selected_option_ids: ["a"], blank_answers: [], confidence: 1, warnings: [],
}] };

function anthropicResponse(searched = false): Response {
  return Response.json({ id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [
    ...(searched ? [{ type: "server_tool_use", id: "search_1", name: "web_search", input: { query: "public fact" } },
      { type: "web_search_tool_result", tool_use_id: "search_1", content: [] }] : []),
    { type: "text", text: JSON.stringify(answer) },
  ], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
}

describe("native provider request and search boundaries", () => {
  it.each([false, true])("exposes only a bounded provider search with session permission=%s", async allowed => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => anthropicResponse(allowed));
    const budget = new ModelCallBudget(2);
    const solver = new VercelAiSolverProvider(profile, "claude-sonnet-4-5", "local-key", budget, fetcher);
    expect(await solver.solve(batch, { strategy: "unattended", allow_images: false, allow_native_search: allowed }, [])).toEqual(answer);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://native.test/v1/messages");
    const body = JSON.parse(String(init?.body));
    if (allowed) expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 1 }]);
    else expect(body.tools ?? []).toEqual([]);
    expect(budget.used).toBe(allowed ? 2 : 1);
    expect(budget.remaining).toBe(allowed ? 0 : 1);
  });

  it("shares the configured provider search capability with every configured model", () => {
    const solver = new VercelAiSolverProvider(profile, "claude-haiku-4-5", undefined, new ModelCallBudget(2));
    expect(solver.capabilities().native_web_search).toBe(true);
  });

  it("does not start a search-capable request without room for its model and search calls", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const solver = new VercelAiSolverProvider(profile, "claude-sonnet-4-5", "local-key", new ModelCallBudget(1), fetcher);
    await expect(solver.solve(batch, { strategy: "unattended", allow_images: false, allow_native_search: true }, [])).rejects.toThrow("limit");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends Gemini through the native Google transport without inventing search support", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    }));
    const google: ProviderProfile = { ...profile, provider_type: "google", base_url: "https://native.test/v1beta",
      capabilities: { ...profile.capabilities, native_web_search: false }, native_web_search_model_ids: [] };
    const solver = new VercelAiSolverProvider(google, "gemini-3.8-flash", "local-key", new ModelCallBudget(2), fetcher);
    expect(await solver.solve(batch, { strategy: "unattended", allow_images: false, allow_native_search: true }, [])).toEqual(answer);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://native.test/v1beta/models/gemini-3.8-flash:generateContent");
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get("x-goog-api-key")).toBe("local-key");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).tools ?? []).toEqual([]);
  });

  it("rejects incompatible search claims and catalog mismatches before configuration is saved", () => {
    expect(providerProfileSchema.safeParse({ ...profile, provider_type: "openai_compatible" }).success).toBe(true);
    expect(providerProfileSchema.safeParse({ ...profile, provider_type: "google" }).success).toBe(false);
    expect(providerProfileSchema.safeParse({ ...profile, native_web_search_model_ids: [] }).success).toBe(true);
    expect(providerProfileSchema.safeParse({ ...profile, native_web_search_model_ids: ["missing"] }).success).toBe(true);
  });
  it("restricts insecure provider URLs to actual loopback hosts", () => {
    expect(providerProfileSchema.safeParse({ ...profile, base_url: "http://localhost:8317/v1" }).success).toBe(true);
    expect(providerProfileSchema.safeParse({ ...profile, base_url: "http://[::1]:8317/v1" }).success).toBe(true);
    expect(providerProfileSchema.safeParse({ ...profile, base_url: "http://localhost.example/v1" }).success).toBe(false);
    expect(providerProfileSchema.safeParse({ ...profile, base_url: "http://127.0.0.1.example/v1" }).success).toBe(false);
  });
});
