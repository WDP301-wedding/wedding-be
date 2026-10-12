import { z } from 'zod';
import { AppError, ValidationError } from '../../../core/errors/app-error.js';
import { hashCanonicalRequest } from '../../../core/idempotency/request-hash.js';
import { containsAuthenticationMaterial } from '../../../core/security/authentication-material.js';

export const id = z.uuid().overwrite((value) => value.toLowerCase());
export const revision = z.int().positive();
const safeText = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(
      (value) =>
        !containsAuthenticationMaterial(value) &&
        !/<\/?[a-z!]|(?:https?|data|javascript):|\b(?:accessToken|refreshToken)\b/iu.test(value),
    );
export const textFieldsSchema = z.strictObject({
  brideName: safeText(2000).optional(),
  groomName: safeText(2000).optional(),
  greeting: safeText(2000).optional(),
  message: safeText(2000).optional(),
  footer: safeText(2000).optional(),
});
export const sectionSchema = z.strictObject({
  kind: z.enum(['HERO', 'MESSAGE', 'EVENT', 'TIMELINE', 'SEATING', 'FOOTER']),
  textKey: z.enum(['brideName', 'groomName', 'greeting', 'message', 'footer']).nullable(),
  derivedAssetId: id.nullable(),
});
export const designContentSchema = z
  .strictObject({
    title: safeText(120, 1),
    textFields: textFieldsSchema,
    sections: z.array(sectionSchema).max(20),
    derivedAssetIds: z.array(id).max(100),
    includesSeating: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.derivedAssetIds).size !== value.derivedAssetIds.length ||
      value.sections.some(
        (section) =>
          section.derivedAssetId !== null &&
          !value.derivedAssetIds.includes(section.derivedAssetId),
      ) ||
      value.sections.some((section) => section.kind === 'SEATING') !== value.includesSeating
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid section/asset/seating references.' });
  });
export type DesignContent = z.infer<typeof designContentSchema>;
export const designViewSchema = designContentSchema.safeExtend({
  designId: id,
  revisionId: id,
  revisionNumber: revision,
  updatedAt: z.iso.datetime(),
});
export type DesignView = z.infer<typeof designViewSchema>;
export const validityProofSchema = z
  .strictObject({
    bookingRevision: revision,
    expectedAttendees: z.int().min(1).max(10000),
    minGuests: z.int().min(1).max(10000),
    maxGuests: z.int().min(1).max(10000),
    totalSeatCapacity: z.int().min(1).max(10000),
    managerException: z
      .strictObject({
        approvalId: id,
        approvedBookingRevision: revision,
        approvedHeadcount: z.int().min(1).max(10000),
      })
      .nullable(),
  })
  .refine((value) => value.minGuests <= value.maxGuests);
export const seatingRenderSchema = z
  .array(
    z
      .strictObject({
        layoutTableId: id,
        tableLabel: safeText(50, 1),
        shape: z.enum(['ROUND', 'RECTANGLE']),
        x: z.int().min(0).max(10000),
        y: z.int().min(0).max(10000),
        width: z.int().min(1).max(10000),
        height: z.int().min(1).max(10000),
        rotationDegrees: z.int().min(0).max(359),
        guestGroupId: id.nullable(),
        guestGroupName: safeText(80, 1).nullable(),
        color: z
          .string()
          .regex(/^#[A-F0-9]{6}$/u)
          .nullable(),
      })
      .refine(
        (table) =>
          (table.guestGroupId === null) === (table.guestGroupName === null) &&
          (table.guestGroupId === null) === (table.color === null),
      ),
  )
  .min(1)
  .max(500)
  .refine((tables) => new Set(tables.map((table) => table.layoutTableId)).size === tables.length);
export const registerSeatingSchema = z.strictObject({
  bookingId: id,
  seatingPlanRevisionId: id,
  seatingPlanRevisionNumber: revision,
  layoutTemplateVersionId: id,
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  validityProof: validityProofSchema.optional(),
  renderSnapshot: seatingRenderSchema,
});
export const invalidateSeatingSchema = z.strictObject({
  bookingId: id,
  seatingPlanRevisionId: id,
  seatingPlanRevisionNumber: revision,
  reasonCode: z.enum(['HEADCOUNT_OUTSIDE_LAYOUT_RANGE', 'LAYOUT_RETIRED', 'SEATING_PLAN_REPLACED']),
});
export function parseStudio<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError();
  return result.data;
}
export function studioConflict(code: string): AppError {
  return new AppError({
    status: 409,
    code,
    message: 'The invitation state conflicts with this command.',
  });
}
export function digest(value: unknown): string {
  return hashCanonicalRequest(value);
}
export function escapeText(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
