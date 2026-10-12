import { z } from 'zod';
export const mode = z.enum(['NONE', 'BY_GUEST_NAME']);
export const reason = z.string().trim().normalize('NFC').min(10).max(500);
export const configurationInput = z.strictObject({
  checkInMode: mode,
  expectedRevision: z.int().positive(),
});
export const assignmentInput = z.strictObject({
  staffAccountId: z.uuid(),
  expectedRevision: z.int().nonnegative(),
});
export const revokeInput = z.strictObject({ expectedRevision: z.int().positive(), reason });
export const provisionInput = z.strictObject({ email: z.email().max(320) });
export const operationalInput = z.strictObject({ enabled: z.boolean(), reason });
export const checkInInput = z.strictObject({
  eventTime: z.iso.datetime().optional(),
  overrideReason: reason.optional(),
});
export const undoInput = z.strictObject({
  checkInRecordId: z.uuid(),
  expectedLedgerRevision: z.int().positive(),
  reason,
  overrideReason: reason.optional(),
});
export const pageInput = z.strictObject({
  afterRevision: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const searchInput = z.strictObject({
  query: z.string().trim().min(2).max(120),
  cursor: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export function isWindowOpen(now: Date, eventDate: string, start: string, end: string) {
  const startAt = Date.parse(`${eventDate}T${start}:00+07:00`);
  const endAt = Date.parse(`${eventDate}T${end}:00+07:00`);
  return now.getTime() >= startAt - 2 * 3600000 && now.getTime() <= endAt + 12 * 3600000;
}
