import { z } from "zod";

export const SCHEMA_VERSION = "1.0" as const;

const idSchema = z.string().trim().min(1);
const isoDateSchema = z.string().datetime({ offset: true });

export const runStrategySchema = z.enum(["supervised", "unattended"]);
export type RunStrategy = z.infer<typeof runStrategySchema>;

export const observationInputModeSchema = z.enum(["structured", "semantic_snapshot", "visual_snapshot"]);
export type ObservationInputMode = z.infer<typeof observationInputModeSchema>;

export const questionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "fill_blank",
]);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const mediaRefSchema = z
  .object({
    id: idSchema,
    kind: z.literal("image"),
    purpose: z.string().trim().min(1),
    source: z.enum(["dom_image", "region_capture"]),
    mime_type: z.string().regex(/^image\//),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    temporary_handle: idSchema,
  })
  .strict();
export type MediaRef = z.infer<typeof mediaRefSchema>;

export const optionSchema = z
  .object({
    id: idSchema,
    text: z.string(),
    media: z.array(mediaRefSchema),
  })
  .strict();

export const blankSchema = z
  .object({
    id: idSchema,
    label: z.string(),
    required: z.boolean(),
    max_length: z.number().int().positive().optional(),
  })
  .strict();

export const questionFrameSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    question_id: idSchema,
    observation_id: idSchema,
    type: questionTypeSchema,
    stem: z
      .object({
        text: z.string(),
        format: z.enum(["plain_text", "math_text"]),
        media: z.array(mediaRefSchema),
      })
      .strict(),
    options: z.array(optionSchema),
    blanks: z.array(blankSchema),
    constraints: z
      .object({
        min_selections: z.number().int().nonnegative(),
        max_selections: z.number().int().nonnegative(),
      })
      .strict(),
    provenance: z
      .object({
        text_source: z.enum(["dom", "accessibility", "site_adapter", "visual"]),
        untrusted_content: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((question, context) => {
    const optionIds = question.options.map((option) => option.id);
    const blankIds = question.blanks.map((blank) => blank.id);

    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({ code: "custom", path: ["options"], message: "Option ids must be unique." });
    }
    if (new Set(blankIds).size !== blankIds.length) {
      context.addIssue({ code: "custom", path: ["blanks"], message: "Blank ids must be unique." });
    }
    if (question.constraints.min_selections > question.constraints.max_selections) {
      context.addIssue({
        code: "custom",
        path: ["constraints"],
        message: "Minimum selections cannot exceed maximum selections.",
      });
    }

    if (question.type === "fill_blank") {
      if (question.options.length > 0 || question.blanks.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Fill-blank questions require blanks and cannot expose choice options.",
        });
      }
      if (
        question.constraints.min_selections !== 0 ||
        question.constraints.max_selections !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["constraints"],
          message: "Fill-blank questions cannot require option selections.",
        });
      }
    } else {
      if (question.options.length === 0 || question.blanks.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Choice questions require options and cannot expose blanks.",
        });
      }
      if (question.type === "single_choice" && question.constraints.max_selections !== 1) {
        context.addIssue({
          code: "custom",
          path: ["constraints", "max_selections"],
          message: "Single-choice questions must allow exactly one selection.",
        });
      }
    }
  });
export type QuestionFrame = z.infer<typeof questionFrameSchema>;

export const blankAnswerSchema = z
  .object({
    blank_id: idSchema,
    value: z.string(),
  })
  .strict();

export const answerResultSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    question_id: idSchema,
    observation_id: idSchema,
    answer_type: questionTypeSchema,
    status: z.enum(["answered", "uncertain", "cannot_answer"]),
    selected_option_ids: z.array(idSchema),
    blank_answers: z.array(blankAnswerSchema),
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string()),
  })
  .strict();
export type AnswerResult = z.infer<typeof answerResultSchema>;

export const batchAnswerResultSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    batch_id: idSchema,
    answers: z.array(answerResultSchema),
    errors: z.array(
      z
        .object({
          question_id: idSchema,
          code: idSchema,
          retryable: z.boolean(),
        })
        .strict(),
    ),
    observed_controls: z.array(
      z
        .object({
          semantic_id: idSchema,
          role: z.enum(["next", "submit", "session_submit", "retry"]),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    ).optional(),
  })
  .strict();
export type BatchAnswerResult = z.infer<typeof batchAnswerResultSchema>;

export const locatorTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("semantic"),
      local_ref: idSchema,
      role: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("coordinate"),
      visual_frame_id: idSchema,
      point: z.object({ x: z.number(), y: z.number() }).strict(),
      expected_label: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
]);
export type LocatorTarget = z.infer<typeof locatorTargetSchema>;

export const locatorMapSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    question_id: idSchema,
    observation_id: idSchema,
    platform: z.literal("web"),
    question_fingerprint: idSchema,
    targets: z.record(idSchema, locatorTargetSchema),
  })
  .strict();
export type LocatorMap = z.infer<typeof locatorMapSchema>;

export const executionActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      action_id: idSchema,
      kind: z.literal("set_selected"),
      target_id: idSchema,
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      action_id: idSchema,
      kind: z.literal("set_value"),
      target_id: idSchema,
      value: z.string(),
    })
    .strict(),
  z
    .object({
      action_id: idSchema,
      kind: z.enum(["submit_question", "retry_question", "advance", "submit_session"]),
      target_id: idSchema,
    })
    .strict(),
]);
export type ExecutionAction = z.infer<typeof executionActionSchema>;

export const executionPlanSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    question_id: idSchema,
    observation_id: idSchema,
    strategy: runStrategySchema,
    actions: z.array(executionActionSchema).min(1),
    preconditions: z.array(
      z.enum(["same_question_fingerprint", "target_available", "same_surface"]),
    ),
  })
  .strict();
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export const actionResultSchema = z
  .object({
    action_id: idSchema,
    status: z.enum(["succeeded", "failed", "skipped", "unknown"]),
    message: z.string().optional(),
  })
  .strict();
export type ActionResult = z.infer<typeof actionResultSchema>;

export const verificationResultSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    question_id: idSchema,
    status: z.enum(["verified", "uncertain", "failed"]),
    stage: z.enum([
      "answer_applied",
      "submitted",
      "graded",
      "advanced",
      "session_submitted",
      "session_completed",
    ]),
    outcome: z.enum(["correct", "incorrect", "partial", "unknown"]),
    signals: z.array(z.string()),
    can_retry: z.boolean(),
    next_action: z.enum(["continue", "advance", "resolve_again", "pause", "complete"]),
  })
  .strict();
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const questionBatchSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    batch_id: idSchema,
    question_ids: z.array(idSchema).min(1),
    questions: z.array(questionFrameSchema).min(1),
    page_context: z
      .object({
        mode: observationInputModeSchema,
        visible_text: z.string().max(20_000),
        controls: z.array(
          z
            .object({
              semantic_id: idSchema,
              role: z.string().trim().min(1),
              text: z.string(),
              selected: z.boolean(),
              disabled: z.boolean(),
            })
            .strict(),
        ).max(256),
        media: z.array(mediaRefSchema).max(1),
      })
      .strict()
      .optional(),
    capability_requirements: z
      .object({
        image_input: z.boolean(),
        native_web_search: z.boolean(),
      })
      .strict(),
    attempt: z.number().int().positive(),
  })
  .strict()
  .superRefine((batch, context) => {
    if (new Set(batch.question_ids).size !== batch.question_ids.length) {
      context.addIssue({
        code: "custom",
        path: ["question_ids"],
        message: "Question ids in a batch must be unique.",
      });
    }

    const frameIds = batch.questions.map((question) => question.question_id);
    const declaredIds = new Set(batch.question_ids);
    if (
      frameIds.length !== batch.question_ids.length ||
      frameIds.some((id) => !declaredIds.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Batch question ids must exactly match the included QuestionFrames.",
      });
    }
    if (batch.questions.some((question) => question.session_id !== batch.session_id)) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Every QuestionFrame must belong to the batch session.",
      });
    }
  });
export type QuestionBatch = z.infer<typeof questionBatchSchema>;

export const quizSessionSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    session_id: idSchema,
    run_id: idSchema,
    platform: z.literal("web"),
    layout: z.enum(["sequential", "multi_question_page"]),
    strategy: runStrategySchema,
    status: z.enum([
      "created",
      "waiting_ready",
      "observing",
      "solving",
      "acting",
      "verifying",
      "paused",
      "completed",
      "cancelled",
      "failed",
    ]),
    question_ids: z.array(idSchema),
    progress: z
      .object({
        total: z.number().int().nonnegative(),
        answered: z.number().int().nonnegative(),
        guessed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
    provider_profile_id: idSchema,
    model_id: idSchema,
    model_calls: z
      .object({
        used: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
      })
      .strict(),
    timer: z
      .object({
        remaining_seconds: z.number().int().nonnegative().nullable(),
        closing_window_seconds: z.number().int().positive(),
      })
      .strict(),
    created_at: isoDateSchema,
  })
  .strict();
export type QuizSession = z.infer<typeof quizSessionSchema>;

export const providerProfileSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    provider_profile_id: idSchema,
    display_name: z.string().trim().min(1),
    provider_type: z.literal("openai_compatible"),
    base_url: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://localhost") || value.startsWith("http://127.0.0.1"), {
      message: "Provider URL must use HTTPS unless it is a local development endpoint.",
    }),
    secret_ref: idSchema,
    model_catalog: z
      .object({
        source: z.enum(["provider_api", "manual"]),
        models: z.array(idSchema),
        refreshed_at: isoDateSchema.nullable(),
      })
      .strict(),
    capabilities: z
      .object({
        image_input: z.boolean(),
        structured_output: z.boolean(),
        native_web_search: z.literal(false),
      })
      .strict(),
    image_upload_authorized: z.boolean(),
  })
  .strict();
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
