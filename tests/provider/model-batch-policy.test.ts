import { describe, expect, it } from "vitest";
import { ModelCallBudget, planBatches, providerProfileSchema } from "../../src/core";
import type { ProviderProfile, QuestionFrame } from "../../src/core";
import { VercelAiSolverProvider } from "../../src/provider/solver-provider";

const profile: ProviderProfile = {
  schema_version: "1.0", provider_profile_id: "p", display_name: "Provider", provider_type: "google",
  base_url: "https://provider.example/v1", secret_ref: "secret",
  model_catalog: { source: "manual", models: ["small", "large"], refreshed_at: null },
  capabilities: { image_input: true, structured_output: true, native_web_search: false }, image_upload_authorized: true,
};
const limits = (p: ProviderProfile, id = "small") => new VercelAiSolverProvider(providerProfileSchema.parse(p), id, undefined, new ModelCallBudget()).batchLimits();
const question = (id: string): QuestionFrame => ({ schema_version: "1.0", session_id: "s", question_id: id, observation_id: "o", type: "single_choice", stem: { text: "Choose A", format: "plain_text", media: [] }, options: [{ id: "a", text: "A", media: [] }], blanks: [], constraints: { min_selections: 1, max_selections: 1 }, provenance: { text_source: "dom", untrusted_content: true } });

describe("selected model batch policy", () => {
  it("retains conservative limits for existing profiles without model metadata", () => {
    expect(limits(profile)).toEqual({ max_questions: 5, max_estimated_tokens: 12000, max_images: 4 });
  });
  it("does not mistake inherited object properties for an explicit model policy", () => {
    const p = { ...profile, model_batch_limits: {}, model_catalog: { ...profile.model_catalog, input_token_limits: {} } };
    expect(limits(p, "constructor")).toEqual({ max_questions: 5, max_estimated_tokens: 12000, max_images: 4 });
  });
  it("uses only the selected model override and actually splits its page inventory", () => {
    const p = { ...profile, model_batch_limits: { small: { max_questions: 2, max_estimated_tokens: 6000, max_images: 1 } } };
    const questions = Array.from({ length: 6 }, (_, i) => question(`q${i}`));
    expect(planBatches(questions, undefined, 1, limits(p, "small")).map(b => b.question_ids)).toEqual([["q0", "q1"], ["q2", "q3"], ["q4", "q5"]]);
    expect(planBatches(questions, undefined, 1, limits(p, "large")).map(b => b.questions.length)).toEqual([5, 1]);
  });
  it("reserves context room from actual input metadata without enlarging a stricter override", () => {
    const p = { ...profile, model_catalog: { ...profile.model_catalog, input_token_limits: { small: 4096, large: 1000000 } } };
    expect(limits(p).max_estimated_tokens).toBe(2252);
    expect(limits(p, "large").max_estimated_tokens).toBe(12000);
    expect(limits({ ...p, model_batch_limits: { small: { max_questions: 1, max_estimated_tokens: 1000, max_images: 0 } } }).max_estimated_tokens).toBe(1000);
  });
  it("does not allow a configured image count to grant missing image capability", () => {
    expect(limits({ ...profile, capabilities: { ...profile.capabilities, image_input: false }, model_batch_limits: { small: { max_questions: 2, max_estimated_tokens: 6000, max_images: 8 } } }).max_images).toBe(0);
  });
  it("rejects malformed persisted limits before a session can use them", () => {
    for (const invalid of [{ max_questions: 0, max_estimated_tokens: 6000, max_images: 1 }, { max_questions: 2, max_estimated_tokens: 6000, max_images: -1 }, { max_questions: 2.5, max_estimated_tokens: 6000, max_images: 1 }]) {
      expect(() => providerProfileSchema.parse({ ...profile, model_batch_limits: { small: invalid } })).toThrow();
    }
  });
});
