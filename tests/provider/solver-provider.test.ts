import { describe, expect, it } from "vitest";

import { ModelCallBudget, SCHEMA_VERSION } from "../../src/core";
import type { ProviderProfile, QuestionBatch } from "../../src/core";
import { VercelAiSolverProvider } from "../../src/provider/solver-provider";

const profile: ProviderProfile = {
  schema_version: SCHEMA_VERSION,
  provider_profile_id: "p1",
  display_name: "Provider",
  provider_type: "openai_compatible",
  base_url: "https://provider.example/v1",
  secret_ref: "secret",
  model_catalog: { source: "manual", models: ["m1"], refreshed_at: null },
  capabilities: { image_input: true, structured_output: true, native_web_search: false },
  image_upload_authorized: false,
};

const imageBatch: QuestionBatch = {
  schema_version: SCHEMA_VERSION,
  session_id: "s1",
  batch_id: "b1",
  question_ids: ["q1"],
  questions: [
    {
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: "q1",
      observation_id: "o1",
      type: "single_choice",
      stem: {
        text: "What is shown?",
        format: "plain_text",
        media: [
          {
            id: "image1",
            kind: "image",
            purpose: "question_diagram",
            source: "dom_image",
            mime_type: "image/png",
            width: 10,
            height: 10,
            temporary_handle: "temporary1",
          },
        ],
      },
      options: [
        { id: "a", text: "A", media: [] },
        { id: "b", text: "B", media: [] },
      ],
      blanks: [],
      constraints: { min_selections: 1, max_selections: 1 },
      provenance: { text_source: "dom", untrusted_content: true },
    },
  ],
  capability_requirements: { image_input: true, native_web_search: false },
  attempt: 1,
};

describe("VercelAiSolverProvider capability gates", () => {
  it("does not upload an image before local authorization", async () => {
    const budget = new ModelCallBudget();
    const solver = new VercelAiSolverProvider(profile, "m1", "key", budget);

    await expect(
      solver.solve(
        imageBatch,
        { strategy: "unattended", allow_images: true },
        [{ temporary_handle: "temporary1", mime_type: "image/png", data: new Uint8Array([1]) }],
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_MISMATCH" });
    expect(budget.used).toBe(0);
  });

  it("refuses a model without declared structured-output capability", async () => {
    const budget = new ModelCallBudget();
    const solver = new VercelAiSolverProvider(
      { ...profile, capabilities: { ...profile.capabilities, structured_output: false } },
      "m1",
      "key",
      budget,
    );

    await expect(
      solver.solve(imageBatch, { strategy: "supervised", allow_images: false }, []),
    ).rejects.toMatchObject({ code: "CAPABILITY_MISMATCH" });
    expect(budget.used).toBe(0);
  });
});
