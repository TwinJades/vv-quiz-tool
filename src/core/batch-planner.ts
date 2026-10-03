import { questionBatchSchema, SCHEMA_VERSION } from "./schema";
import type { PlatformObservation } from "./platform";
import type { QuestionBatch, QuestionFrame } from "./schema";

export interface BatchLimits {
  max_questions: number;
  max_estimated_tokens: number;
  max_images: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = { max_questions: 5, max_estimated_tokens: 12000, max_images: 4 };

/** A conservative payload estimate, not a claim about a model's tokenizer. */
export function planBatches(
  questions: QuestionFrame[],
  context: PlatformObservation["page_context"],
  attempt = 1,
  limits: BatchLimits = DEFAULT_BATCH_LIMITS,
): QuestionBatch[] {
  if (!Number.isInteger(limits.max_questions) || limits.max_questions < 1 || !Number.isFinite(limits.max_estimated_tokens) || limits.max_estimated_tokens < 1 || !Number.isInteger(limits.max_images) || limits.max_images < 0) throw new Error("Invalid batch limits.");
  if (new Set(questions.map(question => question.question_id)).size !== questions.length) throw new Error("Duplicate question ids cannot be batched.");
  const result: QuestionBatch[] = [];
  let current: QuestionFrame[] = [];
  const contextImages = context?.media.length ?? 0;
  const contextTokens = context ? Math.ceil(new TextEncoder().encode(JSON.stringify(context)).length / 3) + contextImages * 1536 : 0;
  let tokens = contextTokens;
  let images = contextImages;
  const flush = () => {
    if (!current.length) return;
    result.push(questionBatchSchema.parse({ schema_version: SCHEMA_VERSION, session_id: current[0]!.session_id, batch_id: `batch_${crypto.randomUUID()}`, questions: current, question_ids: current.map(question => question.question_id), ...(context ? { page_context: context } : {}), capability_requirements: { image_input: images > 0, native_web_search: false }, attempt }));
    current = []; tokens = contextTokens; images = contextImages;
  };
  for (const question of questions) {
    const questionImages = question.stem.media.length + question.options.reduce((count, option) => count + option.media.length, 0);
    const questionTokens = Math.ceil(new TextEncoder().encode(JSON.stringify(question)).length / 3) + questionImages * 1536;
    if (contextTokens + questionTokens > limits.max_estimated_tokens || contextImages + questionImages > limits.max_images) throw new Error(`Question ${question.question_id} exceeds configured batch payload limits.`);
    if (current.length >= limits.max_questions || tokens + questionTokens > limits.max_estimated_tokens || images + questionImages > limits.max_images) flush();
    current.push(question); tokens += questionTokens; images += questionImages;
  }
  flush();
  return result;
}
