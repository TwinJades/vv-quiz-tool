import { describe, expect, it, vi } from "vitest";
import { ModelCallBudget } from "../../src/core";
import type { ProviderProfile, QuestionBatch } from "../../src/core";
import { VercelAiSolverProvider } from "../../src/provider/solver-provider";
import { capture } from "../fixtures/visual";

const profile: ProviderProfile = {
  schema_version: "1.0", provider_profile_id: "p", display_name: "Timeout transport",
  provider_type: "openai_compatible", base_url: "https://owned.test/v1", secret_ref: "local",
  model_catalog: { source: "manual", models: ["test"], refreshed_at: null },
  capabilities: { image_input: true, structured_output: true, native_web_search: false },
  image_upload_authorized: true,
};
const batch: QuestionBatch = {
  schema_version: "1.0", session_id: "s", batch_id: "b", attempt: 1, question_ids: ["q"],
  capability_requirements: { image_input: false, native_web_search: false },
  questions: [{ schema_version: "1.0", session_id: "s", question_id: "q", observation_id: "o", type: "single_choice",
    stem: { text: "Choose A", format: "plain_text", media: [] }, options: [{ id: "a", text: "A", media: [] }], blanks: [],
    constraints: { min_selections: 1, max_selections: 1 }, provenance: { text_source: "dom", untrusted_content: true } }],
};

describe("actual SDK pending transport deadlines", () => {
  it.each(["solve", "structure", "visual"] as const)("ends a never-responding %s transport after three bounded attempts", async kind => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const signal = init!.signal!;
      signals.push(signal);
      return await new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const budget = new ModelCallBudget(3);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget, fetcher, 15);
    const parent = new AbortController();
    const operation = kind === "solve" ? solver.solve(batch, { strategy: "unattended", allow_images: false }, [], parent.signal)
      : kind === "structure" ? solver.calibrateSeparation({ visible_text: "Question", candidates: [] }, parent.signal)
      : solver.recognizeVisual(capture(), parent.signal);
    await expect(operation).rejects.toMatchObject({ code: "NETWORK", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(signals.every(signal => signal.aborted && signal.reason?.name === "TimeoutError")).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(budget.used).toBe(3);
  }, 6000);
});
