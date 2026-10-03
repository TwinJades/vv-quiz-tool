import { describe, expect, it } from "vitest";
import { planBatches } from "../../src/core";
import type { QuestionFrame } from "../../src/core";

const question = (id: string): QuestionFrame => ({ schema_version: "1.0", session_id: "s", question_id: id, observation_id: "o", type: "single_choice", stem: { text: "Choose A", format: "plain_text", media: [] }, options: [{ id: "a", text: "A", media: [] }], blanks: [], constraints: { min_selections: 1, max_selections: 1 }, provenance: { text_source: "dom", untrusted_content: true } });
describe("automatic batch planning", () => {
  it("splits by question count without dropping or duplicating identities", () => {
    const frames = Array.from({ length: 7 }, (_, i) => question(`q${i}`));
    const batches = planBatches(frames, undefined, 1, { max_questions: 3, max_estimated_tokens: 10000, max_images: 0 });
    expect(batches.map(batch => batch.questions.length)).toEqual([3, 3, 1]);
    expect(batches.flatMap(batch => batch.question_ids)).toEqual(frames.map(frame => frame.question_id));
    expect(new Set(batches.map(batch => batch.batch_id)).size).toBe(3);
  });
  it("splits by payload estimate and accounts for shared page context", () => {
    const frame = question("q1"); const size = Math.ceil(JSON.stringify(frame).length / 3);
    const batches = planBatches([frame, question("q2")], undefined, 1, { max_questions: 5, max_estimated_tokens: size + 5, max_images: 0 });
    expect(batches).toHaveLength(2);
    expect(() => planBatches([frame], { mode: "semantic_snapshot", visible_text: "x".repeat(1000), controls: [], media: [] }, 1, { max_questions: 5, max_estimated_tokens: size + 5, max_images: 0 })).toThrow("exceeds");
  });
  it("keeps image payloads within configured limits and rejects duplicate question IDs", () => {
    const frames = [question("q1"), question("q2")];
    frames.forEach(frame => frame.stem.media.push({ id: frame.question_id, kind: "image", purpose: "diagram", source: "dom_image", mime_type: "image/png", width: 10, height: 10, temporary_handle: frame.question_id }));
    const batches = planBatches(frames, undefined, 1, { max_questions: 5, max_estimated_tokens: 10000, max_images: 1 });
    expect(batches).toHaveLength(2); expect(batches.every(batch => batch.capability_requirements.image_input)).toBe(true);
    expect(() => planBatches([question("same"), question("same")], undefined)).toThrow("Duplicate");
  });

  it("counts the shared screenshot against every batch content budget", () => {
    const frame = question("q1");
    const context = { mode: "visual_snapshot" as const, visible_text: "", controls: [], media: [{ id: "snapshot", kind: "image" as const, purpose: "page", source: "region_capture" as const, mime_type: "image/png", width: 10, height: 10, temporary_handle: "snapshot" }] };
    expect(() => planBatches([frame], context, 1, { max_questions: 5, max_estimated_tokens: 1000, max_images: 1 })).toThrow("exceeds");
    expect(planBatches([frame], context, 1, { max_questions: 5, max_estimated_tokens: 4000, max_images: 1 })).toHaveLength(1);
  });
  it("accounts for multibyte question text rather than only JavaScript character count", () => {
    const frame = question("q1"); frame.stem.text = "中文".repeat(400);
    expect(() => planBatches([frame], undefined, 1, { max_questions: 5, max_estimated_tokens: 700, max_images: 0 })).toThrow("exceeds");
  });
});
