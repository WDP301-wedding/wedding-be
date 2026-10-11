import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  commercialConflict,
  checkedSum,
  contractDocumentSchema,
} from '../../booking-lifecycle/domain/commercial-contract.js';
import { appendixDocumentSchema } from '../../booking-lifecycle/domain/commercial-appendix.js';
const text = (max: number) =>
  z
    .string()
    .overwrite((s) => s.trim().normalize('NFC'))
    .min(1)
    .max(max);
const vnd = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ offset: true });
export const expenseLineSchema = z.strictObject({
  name: text(120),
  quantity: z.int().positive().max(2147483647),
  unit: text(80),
  unitPriceVnd: vnd,
  note: text(2000).nullable().optional(),
});
export const expenseSnapshotSchema = expenseLineSchema.extend({ id: z.uuid(), totalVnd: vnd });
export const createExpenseSchema = expenseLineSchema.extend({
  expectedRevision: z.int().nonnegative(),
});
export const updateExpenseSchema = expenseLineSchema
  .partial()
  .extend({ expectedRevision: z.int().nonnegative() })
  .refine((v) => Object.keys(v).some((k) => k !== 'expectedRevision'));
export const deleteExpenseSchema = z.strictObject({ expectedRevision: z.int().nonnegative() });
export const expenseDraftResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: z.uuid(),
    revision: z.int().nonnegative(),
    finalized: z.boolean(),
    lines: z.array(expenseSnapshotSchema),
    totalVnd: vnd,
  }),
});
export const finalizeInvoiceSchema = z.strictObject({
  expectedDraftRevision: z.int().nonnegative(),
  expectedCommercialRevisionId: z.uuid(),
  expectedBillingRevision: z.int().positive(),
});
export const adjustmentLineSchema = expenseLineSchema.extend({ kind: z.enum(['DEBIT', 'CREDIT']) });
export const invoiceAdjustmentSchema = z.strictObject({
  expectedInvoiceRevisionId: z.uuid(),
  expectedBillingRevision: z.int().positive(),
  reason: text(500),
  lines: z.array(adjustmentLineSchema).min(1).max(50),
});
export const adjustmentSnapshotSchema = z.strictObject({
  id: z.uuid(),
  predecessorRevisionId: z.uuid(),
  reason: text(500),
  actorAccountId: z.uuid(),
  occurredAt: instant,
  lines: z
    .array(expenseSnapshotSchema.extend({ kind: z.enum(['DEBIT', 'CREDIT']) }))
    .min(1)
    .max(50),
  deltaVnd: z.int(),
});
export const finalInvoiceDocumentSchema = z.strictObject({
  modelVersion: z.literal('FINAL_INVOICE_V1'),
  bookingId: z.uuid(),
  contract: z.strictObject({
    revisionId: z.uuid(),
    documentDigest: digest,
    document: contractDocumentSchema,
  }),
  appendices: z.array(
    z.strictObject({
      revisionId: z.uuid(),
      documentDigest: digest,
      document: appendixDocumentSchema,
    }),
  ),
  effectiveCommercialRevisionId: z.uuid(),
  commercialTotalVnd: vnd,
  expenseDraftRevision: z.int().nonnegative(),
  incidentalLines: z.array(expenseSnapshotSchema),
  incidentalTotalVnd: vnd,
  adjustments: z.array(adjustmentSnapshotSchema),
  totalVnd: vnd,
});
export const finalInvoiceViewSchema = z.strictObject({
  invoiceRevisionId: z.uuid(),
  bookingId: z.uuid(),
  revisionNumber: z.int().positive(),
  predecessorRevisionId: z.uuid().nullable(),
  invoiceNumber: text(120),
  documentDigest: digest,
  document: finalInvoiceDocumentSchema,
  sourceBillingRevision: z.int().positive(),
  issuedAt: instant,
  issuedByAccountId: z.uuid(),
});
export const finalInvoiceResponseSchema = z.strictObject({ data: finalInvoiceViewSchema });
export type ExpenseLineInput = z.infer<typeof expenseLineSchema>;
export type FinalInvoiceDocument = z.infer<typeof finalInvoiceDocumentSchema>;
export function calculateExpenseLine(raw: ExpenseLineInput) {
  const input = expenseLineSchema.parse(raw);
  const totalVnd = input.quantity * input.unitPriceVnd;
  if (!Number.isSafeInteger(totalVnd)) throw commercialConflict('COMMERCIAL_AMOUNT_OVERFLOW');
  return { ...input, note: input.note ?? null, totalVnd };
}
export function signedAdjustmentTotal(lines: readonly z.infer<typeof adjustmentLineSchema>[]) {
  const totals = lines.map((l) => ({
    kind: l.kind,
    amount: calculateExpenseLine(
      expenseLineSchema.parse({
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceVnd: l.unitPriceVnd,
        note: l.note ?? null,
      }),
    ).totalVnd,
  }));
  return (
    checkedSum(totals.filter((l) => l.kind === 'DEBIT').map((l) => l.amount)) -
    checkedSum(totals.filter((l) => l.kind === 'CREDIT').map((l) => l.amount))
  );
}
export function finalInvoiceDigest(document: FinalInvoiceDocument) {
  return createHash('sha256')
    .update(JSON.stringify(finalInvoiceDocumentSchema.parse(document)))
    .digest('hex');
}
