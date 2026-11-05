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
export function checkInWindow(eventDate: string, start: string, end: string) {
  return {
    opensAt: new Date(Date.parse(`${eventDate}T${start}:00+07:00`) - 2 * 3600000).toISOString(),
    closesAt: new Date(Date.parse(`${eventDate}T${end}:00+07:00`) + 12 * 3600000).toISOString(),
  };
}
export function isWindowOpen(now: Date, eventDate: string, start: string, end: string) {
  const window = checkInWindow(eventDate, start, end);
  return (
    now.getTime() >= Date.parse(window.opensAt) && now.getTime() <= Date.parse(window.closesAt)
  );
}

export const staffDirectoryQuery = z.strictObject({
  q: z.string().trim().max(120).default(''),
  afterId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const staffDirectorySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        accountId: z.uuid(),
        email: z.string(),
        credentialSetupRequired: z.boolean(),
      }),
    )
    .max(50),
  nextAfterId: z.uuid().nullable(),
});
