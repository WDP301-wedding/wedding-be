import { z } from 'zod';
import type { BookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { AppError } from '../../../core/errors/app-error.js';
import {
  readBalancePaymentEligibility,
  type BalancePaymentDependencies,
} from './balance-payment-eligibility.js';
import type { BillingLedgerRepository, LedgerEntry } from './billing-ledger.port.js';
import type { BillingOperationsRepository } from './billing-operations.port.js';
import type { BillingReader, ContractContext } from './payments-billing.providers.js';

export const billingHistoryQuerySchema = z.strictObject({
  bookingId: z.uuid(),
  limit: z.int().min(1).max(100),
  throughBillingRevision: z.int().nonnegative().optional(),
  cursor: z.string().min(1).max(512).optional(),
});
const cursorSchema = z.strictObject({
  bookingId: z.uuid(),
  throughBillingRevision: z.int().nonnegative(),
  revision: z.int().nonnegative(),
});

export function createBillingViewsService(
  options: Readonly<{
    ledger: BillingLedgerRepository;
    operations: BillingOperationsRepository;
    boundary: BookingBoundaryUnitOfWork;
    providerEnabled: boolean;
    invoice: NonNullable<BalancePaymentDependencies['invoice']>;
  }>,
) {
  async function authorized<T>(
    bookingId: string,
    context: ContractContext,
    work: (scoped: ContractContext, phase: string) => Promise<T>,
  ) {
    z.uuid().parse(bookingId);
    return options.boundary.run({ bookingId, context }, async (scoped) => {
      const access = await options.operations.requireReadAccess(bookingId, scoped);
      return work(scoped, access.phase);
    });
  }
  return Object.freeze({
    async read(input: z.input<typeof billingHistoryQuerySchema>, context: ContractContext) {
      const query = billingHistoryQuerySchema.parse(input);
      return authorized(query.bookingId, context, async (scoped, phase) => {
        let cursor: z.infer<typeof cursorSchema> | undefined;
        if (query.cursor !== undefined) {
          try {
            cursor = cursorSchema.parse(
              JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
            );
          } catch {
            throw invalidCursor();
          }
        }
        if (
          cursor !== undefined &&
          (cursor.bookingId !== query.bookingId ||
            (query.throughBillingRevision !== undefined &&
              cursor.throughBillingRevision !== query.throughBillingRevision) ||
            cursor.revision > (query.throughBillingRevision ?? cursor.throughBillingRevision))
        )
          throw invalidCursor();

        const requestedFence = query.throughBillingRevision ?? cursor?.throughBillingRevision;
        const cursorRevision = cursor?.revision ?? 0;

        const { headRevision, billingRevision, totals, page, hasMore } =
          await options.ledger.readLedgerPage(
            query.bookingId,
            {
              cursorRevision,
              throughBillingRevision: requestedFence,
              limit: query.limit,
            },
            scoped,
          );

        if (
          (requestedFence !== undefined && requestedFence > headRevision) ||
          cursorRevision > billingRevision
        )
          throw invalidCursor();

        const balancePaymentEligibility = await readBalancePaymentEligibility(
          {
            bookingId: query.bookingId,
            phase,
            ledger: {
              revision: headRevision,
              totals,
              entries: [],
            },
            throughBillingRevision: billingRevision,
          },
          options,
          scoped,
        );

        return Object.freeze({
          bookingId: query.bookingId,
          billingRevision,
          totals,
          balancePaymentEligibility,
          history: Object.freeze(page.map(safeEntry)),
          nextCursor: !hasMore
            ? null
            : Buffer.from(
                JSON.stringify({
                  bookingId: query.bookingId,
                  throughBillingRevision: billingRevision,
                  revision: page.at(-1)!.revision,
                }),
              ).toString('base64url'),
        });
      });
    },
    async getInvoice(bookingId: string, invoiceId: string, context: ContractContext) {
      z.uuid().parse(invoiceId);
      return authorized(bookingId, context, async (scoped) => {
        const invoice = await options.operations.getInvoice(bookingId, invoiceId, scoped);
        return Object.freeze({
          invoiceId: invoice.id,
          bookingId: invoice.bookingId,
          invoiceNumber: invoice.invoiceNumber,
          sourceBillingRevision: invoice.sourceBillingRevision,
          issuedAt: invoice.issuedAt,
          totals: invoice.snapshot.totals,
          history: Object.freeze(invoice.snapshot.entries.map(safeEntry)),
        });
      });
    },
    // Baseline signatures stay unchanged; trusted authority is bound at composition.
    reader(context: ContractContext): BillingReader {
      return Object.freeze<BillingReader>({
        getBookingReceivables(bookingId) {
          return authorized(bookingId, context, async (scoped) => {
            const totals = await options.ledger.getReceivables(bookingId, scoped);
            return Object.freeze({
              acceptedChargesVnd: totals.acceptedChargesVnd,
              paidVnd: totals.paidVnd,
              refundedVnd: totals.refundedVnd,
              outstandingVnd: totals.outstandingVnd,
            });
          });
        },
        requireDepositSettlement(bookingId) {
          return authorized(bookingId, context, async (scoped) => {
            const ledger = await options.ledger.getLedger(bookingId, scoped);
            for (const entry of ledger.entries) {
              if (entry.kind !== 'PAYMENT' || entry.paymentAttemptId === null) continue;
              const attempt = await options.ledger.getAttempt(
                bookingId,
                entry.paymentAttemptId,
                scoped,
              );
              if (
                attempt.purpose === 'DEPOSIT' &&
                attempt.state === 'SUCCEEDED' &&
                (await options.ledger.isDepositApplied(bookingId, entry.id, scoped))
              )
                return Object.freeze({
                  paymentId: entry.id,
                  amountVnd: entry.amountVnd,
                  settledAt: new Date(entry.occurredAt),
                });
            }
            throw new AppError({
              status: 409,
              code: 'DEPOSIT_NOT_SETTLED',
              message: 'A completed deposit settlement is required.',
            });
          });
        },
      });
    },
  });
}
function safeEntry(entry: LedgerEntry) {
  return Object.freeze({
    ledgerEntryId: entry.id,
    kind: entry.kind,
    amountVnd: entry.amountVnd,
    occurredAt: entry.occurredAt,
    sourceType: entry.sourceType,
    sourceRevisionId: entry.sourceRevisionId,
    sourceEntryId: entry.sourceEntryId,
    paymentAttemptId: entry.paymentAttemptId,
    revision: entry.revision,
  });
}
function invalidCursor() {
  return new AppError({
    status: 422,
    code: 'VALIDATION_ERROR',
    message: 'The billing cursor does not match its booking and revision fence.',
  });
}
