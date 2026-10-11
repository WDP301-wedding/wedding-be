import { createHash } from 'node:crypto';
import { z } from 'zod';
import { checkedLineTotal } from '../../venue-catalog/domain/commercial-offering.js';
import {
  checkedSum,
  commercialConflict,
  commercialSelectionSchema,
  contractLineSchema,
  contractApprovalSchema,
  contractDecisionSchema,
  deepFreeze,
} from './commercial-contract.js';

export const appendixDraftSchema = z
  .strictObject({
    expectedRevision: z.int().positive(),
    predecessorRevisionId: z.uuid(),
    reason: z
      .string()
      .overwrite((s) => s.trim().normalize('NFC'))
      .min(1)
      .max(500),
    lines: z.array(commercialSelectionSchema).min(1).max(50),
  })
  .refine(
    (v) =>
      v.lines.some((l) => l.category === 'MENU') &&
      new Set(v.lines.map((l) => l.category + '/' + l.sourceId)).size === v.lines.length,
    { message: 'At least one menu and distinct source selections are required.' },
  );
export const appendixDecisionSchema = contractDecisionSchema;
export const appendixDocumentSchema = z.strictObject({
  bookingId: z.uuid(),
  contractRevisionId: z.uuid(),
  predecessorRevisionId: z.uuid(),
  brideName: z.string().min(1).max(120),
  groomName: z.string().min(1).max(120),
  reason: appendixDraftSchema.shape.reason,
  beforeLines: z.array(contractLineSchema).min(1).max(50),
  afterLines: z.array(contractLineSchema).min(1).max(50),
  beforeTotalVnd: z.int().nonnegative(),
  afterTotalVnd: z.int().nonnegative(),
  deltaVnd: z.int(),
  tableCount: z.int().positive().max(500),
});
export const appendixViewSchema = z.strictObject({
  revisionId: z.uuid(),
  revisionNumber: z.int().positive(),
  state: z.enum(['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED']),
  document: appendixDocumentSchema,
  documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime({ offset: true }),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  approvals: z.array(contractApprovalSchema).max(2),
});
export const appendixResponseSchema = z.strictObject({
  data: z.strictObject({ bookingRevision: z.int().positive(), appendix: appendixViewSchema }),
});
export const appendicesResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: z.uuid(),
    bookingRevision: z.int().positive(),
    currentRevisionId: z.uuid().nullable(),
    effectiveRevisionId: z.uuid(),
    effectiveTotalVnd: z.int().nonnegative(),
    revisions: z.array(appendixViewSchema).max(50),
    nextCursor: z.uuid().nullable(),
  }),
});
export type AppendixDocument = z.infer<typeof appendixDocumentSchema>;

export function calculateAppendixChange(before: readonly unknown[], after: readonly unknown[]) {
  function total(value: readonly unknown[]) {
    const lines = z.array(contractLineSchema).min(1).max(50).parse(value);
    if (
      !lines.some((l) => l.category === 'MENU') ||
      new Set(lines.map((l) => l.category + '/' + l.sourceId)).size !== lines.length
    )
      throw commercialConflict('COMMERCIAL_SELECTION_INVALID');
    for (const line of lines) {
      if (checkedLineTotal(line.unitPriceVnd, line.quantity) !== line.lineTotalVnd)
        throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
    }
    const tableCount = checkedSum(
      lines.filter((l) => l.category === 'MENU').map((l) => l.quantity),
    );
    if (tableCount > 500) throw commercialConflict('CONTRACT_CAPACITY_EXCEEDED');
    return { amount: checkedSum(lines.map((l) => l.lineTotalVnd)), tableCount };
  }
  const old = total(before),
    next = total(after);
  return deepFreeze({
    beforeTotalVnd: old.amount,
    afterTotalVnd: next.amount,
    deltaVnd: next.amount - old.amount,
    tableCount: next.tableCount,
  });
}
export function appendixDigest(value: AppendixDocument) {
  return createHash('sha256')
    .update(JSON.stringify(appendixDocumentSchema.parse(value)))
    .digest('hex');
}
