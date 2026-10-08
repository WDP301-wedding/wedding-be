import { z } from 'zod';
import type { ContractContext } from './payments-billing.providers.js';
import type { InvoiceRecord } from './billing-ledger.port.js';

const vnd = z.int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const identity = { bookingId: z.uuid(), commandId: z.uuid() };
const evidence = {
  reason: z.string().trim().min(1).max(500),
  evidenceReference: z.string().trim().min(1).max(120),
};
export const balanceIntentSchema = z.strictObject({
  ...identity,
  expectedBillingRevision: z.int().positive(),
});
export const manualPaymentSchema = z.discriminatedUnion('purpose', [
  z.strictObject({
    ...identity,
    ...evidence,
    purpose: z.literal('DEPOSIT'),
    amountVnd: vnd,
    settledAt: instant,
    timelineRevisionId: z.uuid(),
  }),
  z.strictObject({
    ...identity,
    ...evidence,
    purpose: z.literal('BALANCE'),
    amountVnd: vnd,
    settledAt: instant,
    expectedBillingRevision: z.int().positive(),
  }),
]);
export const refundApprovalSchema = z.strictObject({
  ...identity,
  ...evidence,
  approvedRefundableVnd: vnd,
  basis: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('CREDIT'), sourceEntryId: z.uuid() }),
    z.strictObject({ kind: z.literal('CANCELLATION'), sequence: z.int().positive() }),
  ]),
});
export const refundCommandSchema = z.strictObject({
  ...identity,
  ...evidence,
  sourcePaymentId: z.uuid(),
  decisionId: z.uuid(),
  amountVnd: vnd,
  expectedBillingRevision: z.int().positive(),
  recordedAt: instant,
});
export const invoiceCommandSchema = balanceIntentSchema;
export const billingCommandResultSchema = z
  .strictObject({ resourceId: z.uuid(), paymentAttemptId: z.uuid().optional() })
  .readonly();
export type BillingCommandResult = z.infer<typeof billingCommandResultSchema>;
export type BillingCommandKind =
  'BALANCE_INTENT' | 'MANUAL_PAYMENT' | 'REFUND_APPROVAL' | 'REFUND' | 'INVOICE';
export type BillingCommand = Readonly<{
  commandId: string;
  bookingId: string;
  actorAccountId: string;
  kind: BillingCommandKind;
  bodyHash: string;
  result: BillingCommandResult;
}>;
export type RefundApproval = Readonly<{
  id: string;
  bookingId: string;
  basisKind: 'CREDIT' | 'CANCELLATION';
  basisId: string;
  cancellationSequence: number | null;
  approvedRefundableVnd: number;
  reason: string;
  evidenceReference: string;
  approvedByAccountId: string;
  approvedAt: string;
}>;

// Internal owner operations. Authorization and all writes enlist in the same scope.
export interface BillingOperationsRepository {
  requireManager(bookingId: string, context: ContractContext): Promise<void>;
  requireReadAccess(bookingId: string, context: ContractContext): Promise<{ phase: string }>;
  findCommand(
    bookingId: string,
    commandId: string,
    context: ContractContext,
  ): Promise<BillingCommand | null>;
  saveCommand(command: BillingCommand, context: ContractContext): Promise<void>;
  getApproval(
    bookingId: string,
    decisionId: string,
    context: ContractContext,
  ): Promise<RefundApproval>;
  saveApproval(approval: RefundApproval, context: ContractContext): Promise<void>;
  getInvoice(
    bookingId: string,
    invoiceId: string,
    context: ContractContext,
  ): Promise<InvoiceRecord>;
}
