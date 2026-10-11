import { z } from 'zod';

import type { ContractContext } from './payments-billing.providers.js';
import type {
  BillingTotals,
  PaymentAttemptEvidence,
  PaymentAttemptState,
} from '../domain/billing-policy.js';

const positiveVnd = z.int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });

export const ledgerFactSchema = z
  .strictObject({
    id: z.uuid(),
    bookingId: z.uuid(),
    kind: z.enum(['CHARGE', 'PAYMENT', 'REFUND', 'CREDIT_ADJUSTMENT']),
    sourceType: z.enum([
      'BASE_BOOKING',
      'CONTRACT',
      'CONTRACT_APPENDIX',
      'INCIDENTAL_FINALIZATION',
      'INVOICE_ADJUSTMENT',
      'PRINT_ORDER',
      'PAYMENT_ATTEMPT',
      'PRINT_CREDIT',
      'MANUAL_REFUND',
    ]),
    sourceRevisionId: z.uuid(),
    amountVnd: positiveVnd,
    occurredAt: instant,
    sourceEntryId: z.uuid().nullable(),
    paymentAttemptId: z.uuid().nullable(),
    decisionId: z.uuid().nullable(),
    approvedRefundableVnd: positiveVnd.nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
    evidenceReference: z.string().trim().min(1).max(120).nullable(),
  })
  .superRefine((fact, ctx) => {
    const noDecision = fact.decisionId === null && fact.approvedRefundableVnd === null;
    const valid =
      (fact.kind === 'CHARGE' &&
        [
          'BASE_BOOKING',
          'PRINT_ORDER',
          'CONTRACT',
          'CONTRACT_APPENDIX',
          'INCIDENTAL_FINALIZATION',
          'INVOICE_ADJUSTMENT',
        ].includes(fact.sourceType) &&
        (!['CONTRACT_APPENDIX', 'INVOICE_ADJUSTMENT'].includes(fact.sourceType) ||
          fact.reason !== null) &&
        fact.sourceEntryId === null &&
        fact.paymentAttemptId === null &&
        noDecision) ||
      (fact.kind === 'CREDIT_ADJUSTMENT' &&
        ['CONTRACT_APPENDIX', 'INVOICE_ADJUSTMENT'].includes(fact.sourceType) &&
        fact.sourceEntryId === null &&
        fact.paymentAttemptId === null &&
        noDecision &&
        fact.reason !== null) ||
      (fact.kind === 'PAYMENT' &&
        fact.sourceType === 'PAYMENT_ATTEMPT' &&
        fact.paymentAttemptId !== null &&
        fact.sourceRevisionId === fact.paymentAttemptId &&
        fact.sourceEntryId === null &&
        noDecision) ||
      (fact.kind === 'CREDIT_ADJUSTMENT' &&
        fact.sourceType === 'PRINT_CREDIT' &&
        fact.sourceEntryId !== null &&
        fact.paymentAttemptId === null &&
        noDecision &&
        (fact.reason === 'PRINT_CANCELLED' || fact.reason === 'PRINT_REPLACED')) ||
      (fact.kind === 'REFUND' &&
        fact.sourceType === 'MANUAL_REFUND' &&
        fact.sourceEntryId !== null &&
        fact.paymentAttemptId === null &&
        !noDecision &&
        fact.decisionId !== null &&
        fact.approvedRefundableVnd !== null &&
        fact.reason !== null &&
        fact.evidenceReference !== null);
    if (!valid)
      ctx.addIssue({ code: 'custom', message: 'Ledger kind, source and evidence must agree.' });
  });

export const newPaymentAttemptSchema = z
  .strictObject({
    id: z.uuid(),
    bookingId: z.uuid(),
    commandId: z.uuid(),
    purpose: z.enum(['DEPOSIT', 'BALANCE']),
    provider: z.enum(['VNPAY', 'MANUAL']),
    amountVnd: positiveVnd,
    timelineRevisionId: z.uuid().nullable(),
    contractRevisionId: z.uuid().nullable().optional(),
    documentDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
    createdAt: instant,
    expiresAt: instant,
  })
  .refine(
    (value) =>
      new Date(value.expiresAt).getTime() > new Date(value.createdAt).getTime() &&
      ((value.contractRevisionId ?? null) === null
        ? (value.documentDigest ?? null) === null
        : value.purpose === 'DEPOSIT' && value.documentDigest != null) &&
      ((value.purpose === 'DEPOSIT' && value.timelineRevisionId !== null) ||
        (value.purpose === 'BALANCE' && value.timelineRevisionId === null)),
    { message: 'Attempt expiry and timeline snapshot must agree with its purpose.' },
  );

export const issueInvoiceSchema = z.strictObject({
  id: z.uuid(),
  bookingId: z.uuid(),
  invoiceNumber: z.string().trim().min(1).max(120),
  expectedBillingRevision: z.int().positive(),
  issuedAt: instant,
});

const nonnegativeVnd = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const invoiceSnapshotSchema = z
  .strictObject({
    revision: z.int().positive(),
    entries: z
      .array(ledgerFactSchema.safeExtend({ revision: z.int().positive() }).readonly())
      .min(1)
      .readonly(),
    totals: z
      .strictObject({
        acceptedChargesVnd: nonnegativeVnd,
        paidVnd: nonnegativeVnd,
        refundedVnd: nonnegativeVnd,
        netPaidVnd: nonnegativeVnd,
        outstandingVnd: nonnegativeVnd,
        creditVnd: nonnegativeVnd,
      })
      .readonly(),
  })
  .readonly();

export type NewLedgerFact = Readonly<z.infer<typeof ledgerFactSchema>>;
export type LedgerEntry = NewLedgerFact & Readonly<{ revision: number }>;
export type NewPaymentAttempt = Readonly<z.infer<typeof newPaymentAttemptSchema>>;
export type PaymentAttempt = NewPaymentAttempt &
  Readonly<{ state: PaymentAttemptState; terminalEvidenceId: string | null }>;
export type LedgerSnapshot = Readonly<{
  revision: number;
  entries: readonly LedgerEntry[];
  totals: BillingTotals;
}>;
export type InvoiceRecord = Readonly<{
  id: string;
  bookingId: string;
  invoiceNumber: string;
  sourceBillingRevision: number;
  issuedAt: string;
  snapshot: LedgerSnapshot;
}>;

// Internal persistence port: callers must authorize and supply owner-approved facts.
// The opaque context enlists owner work; no ORM client crosses this boundary.
export interface BillingLedgerRepository {
  isDepositApplied(
    bookingId: string,
    paymentId: string,
    context: ContractContext,
  ): Promise<boolean>;
  markDepositApplied(
    bookingId: string,
    paymentId: string,
    appliedAt: string,
    context: ContractContext,
  ): Promise<void>;
  findAttemptByCommand(
    bookingId: string,
    commandId: string,
    context: ContractContext,
  ): Promise<PaymentAttempt | null>;
  getAttempt(
    bookingId: string,
    paymentAttemptId: string,
    context?: ContractContext,
  ): Promise<PaymentAttempt>;
  getLedger(bookingId: string, context?: ContractContext): Promise<LedgerSnapshot>;
  append(
    input: NewLedgerFact,
    context: ContractContext,
  ): Promise<Readonly<{ entry: LedgerEntry; replayed: boolean }>>;
  createAttempt(
    input: NewPaymentAttempt,
    context: ContractContext,
  ): Promise<Readonly<{ attempt: PaymentAttempt; replayed: boolean }>>;
  transitionAttempt(
    input: Readonly<{
      bookingId: string;
      paymentAttemptId: string;
      evidence: PaymentAttemptEvidence;
      providerEvidenceId: string | null;
    }>,
    context: ContractContext,
  ): Promise<PaymentAttempt>;
  issueInvoice(
    input: Readonly<z.infer<typeof issueInvoiceSchema>>,
    context: ContractContext,
  ): Promise<InvoiceRecord>;
}
