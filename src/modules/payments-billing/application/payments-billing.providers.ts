import { z } from 'zod';

import type { ContractContext } from '../../booking-lifecycle/application/deposit.service.js';

export type { BookingLifecycleReader } from '../../booking-lifecycle/application/booking-readers.js';
export type {
  BookingDepositIntentCoordinator,
  BookingDepositRecorder,
  ContractContext,
} from '../../booking-lifecycle/application/deposit.service.js';
export type { CoupleAccessPromoter } from '../../identity-access/authorization/couple-access-promotion.js';
export interface BookingReceivables {
  readonly acceptedChargesVnd: number;
  readonly paidVnd: number;
  readonly refundedVnd: number;
  readonly outstandingVnd: number;
}

export interface BillingReader {
  requireDepositSettlement(bookingId: string): Promise<
    Readonly<{
      paymentId: string;
      amountVnd: number;
      settledAt: Date;
    }>
  >;
  getBookingReceivables(bookingId: string): Promise<BookingReceivables>;
}

export interface BookingChargeRegistrar {
  registerAcceptedCharge(
    input: Readonly<{
      bookingId: string;
      sourceType: 'PRINT_ORDER';
      sourceRevisionId: string;
      amountVnd: number;
      acceptedAt: Date;
    }>,
  ): Promise<Readonly<{ receivableChargeId: string; replayed: boolean }>>;
}

export interface BookingChargeAdjustmentRegistrar {
  registerCredit(
    input: Readonly<{
      bookingId: string;
      receivableChargeId: string;
      sourceAdjustmentId: string;
      amountVnd: number;
      reason: 'PRINT_CANCELLED' | 'PRINT_REPLACED';
      acceptedAt: string;
    }>,
    context: ContractContext,
  ): Promise<Readonly<{ adjustmentId: string; replayed: boolean }>>;
}

export interface SourceQuery {
  readonly afterSequence: number;
  readonly throughSequence?: number;
  readonly cursor?: string;
  readonly limit: number;
}

export interface SourceRow<T> {
  readonly recordId: string;
  readonly sequence: number;
  readonly changedAt: string;
  readonly value: T;
}

export interface SourcePage<T> {
  readonly throughSequence: number;
  readonly nextCursor: string | null;
  readonly rows: readonly SourceRow<T>[];
}

const nonnegativeVnd = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const billingLedgerEntrySchema = z
  .strictObject({
    ledgerEntryId: z.uuid(),
    kind: z.enum(['CHARGE', 'PAYMENT', 'REFUND', 'CREDIT_ADJUSTMENT']),
    amountVnd: z.int().positive().max(Number.MAX_SAFE_INTEGER),
    occurredAt: z.iso.datetime({ offset: true }),
    sourceRevisionId: z.uuid().nullable(),
  })
  .readonly();

export const billingReportRowSchema = z
  .strictObject({
    bookingId: z.uuid(),
    acceptedChargesVnd: nonnegativeVnd,
    paidVnd: nonnegativeVnd,
    refundedVnd: nonnegativeVnd,
    outstandingVnd: nonnegativeVnd,
    creditVnd: nonnegativeVnd,
    ledger: z.array(billingLedgerEntrySchema).readonly(),
  })
  .readonly();

export const sourceQuerySchema = z.strictObject({
  afterSequence: z.int().nonnegative(),
  throughSequence: z.int().nonnegative().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.int().min(1).max(500),
});

export type BillingLedgerEntry = z.infer<typeof billingLedgerEntrySchema>;
export type BillingReportRow = z.infer<typeof billingReportRowSchema>;

export interface BillingReportingReader {
  readPage(query: SourceQuery, context: ContractContext): Promise<SourcePage<BillingReportRow>>;
}
