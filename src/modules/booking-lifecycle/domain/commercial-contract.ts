import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import { coupleNameSchema } from './couple-profile.js';

const text = (max: number) =>
  z
    .string()
    .overwrite((s) => s.trim().normalize('NFC'))
    .max(max);
const vnd = z.int().nonnegative();
const selectionId = z.uuid().overwrite((value) => value.toLowerCase());
export const INCIDENTAL_CLAUSE = 'Các chi phí phát sinh sẽ được tính sau';
export const commercialSelectionSchema = z.strictObject({
  category: z.enum(['MENU', 'PRINT', 'SERVICE']),
  sourceId: selectionId,
  sourceRevisionId: selectionId,
  quantity: z.int().positive().max(10_000),
});
export const contractDraftSchema = z
  .strictObject({
    expectedRevision: z.int().positive(),
    predecessorRevisionId: selectionId.nullable(),
    timelineRevisionId: selectionId,
    lines: z.array(commercialSelectionSchema).min(1).max(50),
  })
  .refine(
    (value) =>
      value.lines.some((line) => line.category === 'MENU') &&
      new Set(value.lines.map((line) => line.category + '/' + line.sourceId)).size ===
        value.lines.length,
    { message: 'At least one menu is required; source selections must be distinct.' },
  );
export const contractDecisionSchema = z.strictObject({ expectedRevision: z.int().positive() });
export const contractWithdrawalSchema = contractDecisionSchema.extend({ reason: text(500).min(1) });
export const contractLineSchema = commercialSelectionSchema.extend({
  name: text(120).min(1),
  description: text(2400),
  unit: text(80).min(1),
  unitPriceVnd: vnd,
  lineTotalVnd: vnd,
});
export const contractDocumentSchema = z.strictObject({
  modelVersion: z.literal('FULL_CONTRACT_V1'),
  bookingId: z.uuid(),
  timelineRevisionId: z.uuid(),
  timelineDigest: z.string().regex(/^[a-f0-9]{64}$/),
  timeline: z
    .array(
      z.strictObject({
        order: z.int().nonnegative(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        title: text(120).min(1),
        description: text(2000).nullable(),
      }),
    )
    .max(100),
  brideName: coupleNameSchema.nullable(),
  groomName: coupleNameSchema.nullable(),
  restaurantId: z.uuid(),
  restaurantName: text(120).min(1),
  restaurantAddress: text(500),
  hallId: z.uuid(),
  hallName: text(120).min(1),
  maxGuests: z.int().positive(),
  eventDate: z.iso.date(),
  shiftCode: z.enum(['LUNCH', 'DINNER']),
  shiftStartTime: z.string(),
  shiftEndTime: z.string(),
  planningHeadcount: z.int().nonnegative(),
  tableCount: z.int().positive().max(500),
  lines: z.array(contractLineSchema).min(1).max(50),
  contractTotalVnd: vnd.positive(),
  depositAmountVnd: vnd.positive(),
  incidentalClause: z.literal(INCIDENTAL_CLAUSE),
});
export const contractApprovalSchema = z.strictObject({
  party: z.enum(['MANAGER', 'COUPLE']),
  actorAccountId: z.uuid(),
  documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  occurredAt: z.iso.datetime({ offset: true }),
});
export const contractViewSchema = z.strictObject({
  revisionId: z.uuid(),
  revisionNumber: z.int().positive(),
  predecessorRevisionId: z.uuid().nullable(),
  state: z.enum(['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED']),
  documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  document: contractDocumentSchema,
  createdAt: z.iso.datetime({ offset: true }),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  approvals: z.array(contractApprovalSchema).max(2),
  pdfSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const contractsResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: z.uuid(),
    bookingRevision: z.int().positive(),
    modelVersion: z.enum(['LEGACY_PROPOSAL_V1', 'FULL_CONTRACT_V1']),
    currentRevisionId: z.uuid().nullable(),
    eligibleForDeposit: z.boolean(),
    revisions: z.array(contractViewSchema).max(50),
    nextCursor: z.uuid().nullable(),
  }),
});
export const contractResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingRevision: z.int().positive(),
    contract: contractViewSchema,
  }),
});
export type ContractDocument = Readonly<z.infer<typeof contractDocumentSchema>>;
export type ContractView = z.infer<typeof contractViewSchema>;
export type CommercialSelection = z.infer<typeof commercialSelectionSchema>;
export function commercialConflict(code: string) {
  return new AppError({
    status: 409,
    code,
    message: 'The commercial agreement conflicts with its current revision or eligibility.',
  });
}
export function checkedSum(values: readonly number[]): number {
  const sum = values.reduce((total, value) => total + BigInt(vnd.parse(value)), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw commercialConflict('COMMERCIAL_AMOUNT_OVERFLOW');
  return Number(sum);
}
export function contractDeposit(total: number): number {
  const amount = (BigInt(vnd.positive().parse(total)) * 30n + 99n) / 100n;
  return Number(amount);
}
export function documentDigest(document: ContractDocument): string {
  // Schema field order is the canonical v1 serialization; never hash PostgreSQL JSON order.
  return createHash('sha256')
    .update(JSON.stringify(contractDocumentSchema.parse(document)))
    .digest('hex');
}
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
