import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, ValidationError } from '../../../core/errors/app-error.js';
import { fullCaseFold } from './unicode-case-fold.js';

export const id = z.uuid().transform((value) => value.toLowerCase());
export const revision = z.int().positive();
export const status = z.enum(['ACTIVE', 'ARCHIVED']);
const text = (max: number) => z.string().trim().normalize('NFC').min(1).max(max);
export const groupWriteSchema = z.strictObject({
  name: text(80),
  color: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/u)
    .transform((v) => v.toUpperCase()),
});
export const groupPatchSchema = groupWriteSchema
  .partial()
  .extend({ expectedRevision: revision, status: status.optional() })
  .refine((v) => Object.keys(v).length > 1);
export const guestWriteSchema = z.strictObject({
  name: text(120),
  guestGroupId: id,
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/u)
    .nullable()
    .optional(),
  operationalNote: z.string().trim().normalize('NFC').max(500).nullable().optional(),
});
export const guestPatchSchema = guestWriteSchema
  .partial()
  .extend({ expectedRevision: revision, status: status.optional() })
  .refine((v) => Object.keys(v).length > 1);
export const planWriteSchema = z.strictObject({
  expectedRevision: revision,
  planningHeadcount: z.int().min(0).max(10000),
});
const safeCell = (value: string | null | undefined) =>
  value == null || !/^[=+@-]/u.test(value.trim());
export const importRowSchema = guestWriteSchema
  .extend({ externalRowKey: text(120).refine(safeCell) })
  .refine(
    (row) => safeCell(row.name) && safeCell(row.operationalNote),
    'Formula cells are unavailable.',
  );
export const importRowsSchema = z
  .array(importRowSchema)
  .min(1)
  .max(1000)
  .refine(
    (rows) => new Set(rows.map((row) => row.externalRowKey)).size === rows.length,
    'Row keys must be unique.',
  )
  .refine(
    (rows) => Buffer.byteLength(JSON.stringify(rows)) <= 5 * 1024 * 1024,
    'Import exceeds 5 MiB.',
  );
export const importPreviewSchema = z.strictObject({
  rows: importRowsSchema,
  allowUpdates: z.boolean().default(false),
});
export const importCommitSchema = z.strictObject({
  previewId: id,
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const linkIssueSchema = z.strictObject({ expectedRevision: z.int().nonnegative() });
export const tokenSchema = z.string().regex(/^wg[cs]_[A-Za-z0-9_-]{43}$/u);
export function normalizeGroupName(value: string) {
  return fullCaseFold(value.trim().normalize('NFKC'));
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function tokenHash(value: string): string {
  return createHash('sha256').update(`guest-invitation-v1:${value}`).digest('hex');
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    );
  return result.data;
}
export function conflict(code: string) {
  return new AppError({
    status: 409,
    code,
    message: 'The Guest workspace changed or this operation conflicts with its current state.',
  });
}
export function unavailable() {
  return new AppError({
    status: 404,
    code: 'INVITATION_LINK_UNAVAILABLE',
    message: 'The invitation link is unavailable.',
  });
}
export const defaultGroups = [
  { name: 'Parents', color: '#D97706' },
  { name: 'Groom Side', color: '#2563EB' },
  { name: 'Bride Side', color: '#DB2777' },
  { name: 'Friends', color: '#059669' },
] as const;
