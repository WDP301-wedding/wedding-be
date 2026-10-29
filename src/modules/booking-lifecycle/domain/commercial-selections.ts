import { z } from 'zod';
import { commercialSelectionSchema, customerSelectionViewSchema } from './commercial-contract.js';

export const selectionLinesSchema = z
  .array(commercialSelectionSchema)
  .min(1)
  .max(50)
  .refine(
    (lines) =>
      lines.some((line) => line.category === 'MENU') &&
      new Set(lines.map((line) => line.category + '/' + line.sourceId)).size === lines.length,
    { message: 'At least one menu and distinct source selections are required.' },
  );
export const selectionDraftSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  lines: selectionLinesSchema,
});
export const selectionSubmitSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  selectionRevisionId: z.uuid().overwrite((value) => value.toLowerCase()),
});
export const selectionViewSchema = customerSelectionViewSchema;
export const selectionResponseSchema = z.strictObject({
  data: z.strictObject({ bookingRevision: z.int().positive(), selection: selectionViewSchema }),
});
