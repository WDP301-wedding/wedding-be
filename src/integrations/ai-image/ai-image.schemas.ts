import { z } from 'zod';

import { ValidationError } from '../../core/errors/app-error.js';
import { containsAuthenticationMaterial } from '../../core/security/authentication-material.js';

export const MAX_AI_IMAGE_PROMPT_CHARACTERS = 2_000;
export const MAX_AI_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AI_IMAGE_DIMENSION = 4_096;
export const MAX_AI_IMAGE_PIXELS = 16_777_216;

export const aiImageAspectRatioSchema = z.enum([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);

export const generateAiImageCommandSchema = z.strictObject({
  aspectRatio: aiImageAspectRatioSchema,
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AI_IMAGE_PROMPT_CHARACTERS)
    .superRefine((value, context) => {
      if (containsProhibitedSensitiveData(value)) {
        context.addIssue({
          code: 'custom',
          message: 'Image prompts must not contain contact, payment, auth, or entity identifiers.',
        });
      }
    }),
});

export const geminiGenerateContentResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.unknown()),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z
    .object({
      blockReason: z.string().optional(),
    })
    .optional(),
});

export const geminiInlineImagePartSchema = z.object({
  inlineData: z.object({
    data: z.string(),
    mimeType: z.string(),
  }),
  thought: z.boolean().optional(),
});

export type AiImageAspectRatio = z.infer<typeof aiImageAspectRatioSchema>;

export function parseAiImageInput<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.join('.'),
    })),
  );
}

function containsProhibitedSensitiveData(value: string): boolean {
  if (containsAuthenticationMaterial(value)) return true;
  const sensitivePatterns = [
    /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/iu,
    /(?:\+?\d[\d .()-]{7,}\d)/u,
    /(?:\d[ -]?){13,19}/u,
    /\b(?:password|passcode|one[- ]time password|otp|access token|refresh token|api key|bearer)\b/iu,
    /\beyJ[A-Za-z\d_-]{2,}\.[A-Za-z\d_-]{2,}\.[A-Za-z\d_-]{2,}\b/u,
    /\b[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\b/iu,
  ];
  return sensitivePatterns.some((pattern) => pattern.test(value));
}
