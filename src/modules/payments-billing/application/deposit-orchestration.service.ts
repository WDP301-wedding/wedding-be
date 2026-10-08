import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { BookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { BookingCommercialSnapshotReader } from '../../booking-lifecycle/application/booking-snapshots.js';
import type { BillingLedgerRepository, NewLedgerFact } from './billing-ledger.port.js';
import type {
  BookingLifecycleReader,
  BookingDepositIntentCoordinator,
  BookingDepositRecorder,
  ContractContext,
} from './payments-billing.providers.js';

const createDepositSchema = z.strictObject({
  bookingId: z.uuid(),
  timelineRevisionId: z.uuid(),
  commandId: z.uuid(),
});
const applyDepositSchema = z.strictObject({
  bookingId: z.uuid(),
  paymentAttemptId: z.uuid(),
  settledAt: z.iso.datetime({ offset: true }),
});
type CreateDeposit = Readonly<z.infer<typeof createDepositSchema>>;
type ApplyDeposit = Readonly<z.infer<typeof applyDepositSchema>>;

function conflict(code = 'PAYMENT_EVIDENCE_CONFLICT') {
  return new AppError({
    status: 409,
    code,
    message: 'The deposit conflicts with its authoritative evidence.',
  });
}

export function createDepositOrchestrationService(
  options: Readonly<{
    ledger: Pick<
      BillingLedgerRepository,
      | 'findAttemptByCommand'
      | 'getAttempt'
      | 'getLedger'
      | 'createAttempt'
      | 'append'
      | 'isDepositApplied'
      | 'markDepositApplied'
    >;
    booking: BookingLifecycleReader;
    commercial: BookingCommercialSnapshotReader;
    coordinator: BookingDepositIntentCoordinator;
    recorder: BookingDepositRecorder;
    boundary: BookingBoundaryUnitOfWork;
    now?: () => Date;
  }>,
) {
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async createDeposit(input: CreateDeposit, context: ContractContext) {
      const command = createDepositSchema.parse(input);
      if (context.authority !== 'AUTHENTICATED' || context.actorAccountId === null)
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'The request is forbidden.',
        });
      const accountId = context.actorAccountId;
      return options.boundary.run({ bookingId: command.bookingId, context }, async (scoped) => {
        await options.booking.requireBookingAccess({
          bookingId: command.bookingId,
          accountId,
          minimum: 'RESTRICTED',
        });
        const existing = await options.ledger.findAttemptByCommand(
          command.bookingId,
          command.commandId,
          scoped,
        );
        if (existing !== null) {
          if (
            existing.timelineRevisionId !== command.timelineRevisionId ||
            existing.purpose !== 'DEPOSIT' ||
            existing.provider !== 'VNPAY'
          )
            throw new AppError({
              status: 422,
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'The command identity was reused with a different intent.',
            });
          return Object.freeze({ attempt: existing, replayed: true });
        }
        const eligibility = await options.booking.requireDepositEligibility(command);
        if (!eligibility.eligible) throw conflict('DEPOSIT_NOT_ELIGIBLE');
        if (eligibility.coupleAccountId !== accountId) throw conflict('DEPOSIT_NOT_ELIGIBLE');
        const commercial = await options.commercial.getAccepted(command, scoped);
        if (
          commercial.bookingId !== command.bookingId ||
          commercial.bookingRevision !== eligibility.bookingRevision ||
          commercial.depositAmountVnd !== eligibility.depositAmountVnd
        )
          throw conflict();
        const createdAt = now();
        // VNPay 2.1.0 accepts at most 12 digits after scaling VND by 100.
        if (eligibility.depositAmountVnd > 9_999_999_999)
          throw new AppError({
            status: 422,
            code: 'PAYMENT_PROVIDER_AMOUNT_UNSUPPORTED',
            message: 'The deposit exceeds the payment provider amount range.',
          });
        const result = await options.ledger.createAttempt(
          {
            id: randomUUID(),
            bookingId: command.bookingId,
            commandId: command.commandId,
            purpose: 'DEPOSIT',
            provider: 'VNPAY',
            amountVnd: eligibility.depositAmountVnd,
            timelineRevisionId: command.timelineRevisionId,
            createdAt: createdAt.toISOString(),
            expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
          },
          scoped,
        );
        await options.coordinator.reserve(
          {
            bookingId: command.bookingId,
            timelineRevisionId: command.timelineRevisionId,
            paymentAttemptId: result.attempt.id,
            expectedBookingRevision: eligibility.bookingRevision,
            amountVnd: result.attempt.amountVnd,
            expiresAt: result.attempt.expiresAt,
          },
          scoped,
        );
        const priorBase = (await options.ledger.getLedger(command.bookingId, scoped)).entries.find(
          (entry) =>
            entry.sourceType === 'BASE_BOOKING' &&
            entry.sourceRevisionId === commercial.commercialRevisionId,
        );
        if (priorBase !== undefined && priorBase.amountVnd !== commercial.baseChargeVnd)
          throw conflict();
        // A newly approved timeline may retain the same immutable commercial
        // revision. Preserve the first acceptance date of that base charge.
        if (priorBase === undefined)
          await options.ledger.append(
            fact({
              bookingId: command.bookingId,
              kind: 'CHARGE',
              sourceType: 'BASE_BOOKING',
              sourceRevisionId: commercial.commercialRevisionId,
              amountVnd: commercial.baseChargeVnd,
              occurredAt: commercial.acceptedAt,
            }),
            scoped,
          );
        // No provider interaction or checkout URL can precede the boundary commit.
        return Object.freeze(result);
      });
    },

    // Internal worker port: W4 durably verifies/correlates provider evidence before
    // setting SUCCEEDED. A redirect or client assertion cannot invoke this port.
    async applySettledDeposit(input: ApplyDeposit, context: ContractContext) {
      const command = applyDepositSchema.parse(input);
      if (context.authority !== 'SYSTEM' || context.actorAccountId !== null)
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'The request is forbidden.',
        });
      const money = await options.boundary.run(
        { bookingId: command.bookingId, context },
        async (scoped) => {
          const attempt = await options.ledger.getAttempt(
            command.bookingId,
            command.paymentAttemptId,
            scoped,
          );
          if (
            attempt.state !== 'SUCCEEDED' ||
            attempt.terminalEvidenceId === null ||
            attempt.purpose !== 'DEPOSIT' ||
            attempt.provider !== 'VNPAY' ||
            attempt.timelineRevisionId === null
          )
            throw conflict();
          const ledger = await options.ledger.getLedger(command.bookingId, scoped);
          const previous = ledger.entries.find(
            (entry) => entry.kind === 'PAYMENT' && entry.paymentAttemptId === attempt.id,
          );
          if (
            previous !== undefined &&
            previous.occurredAt !== new Date(command.settledAt).toISOString()
          )
            throw conflict();
          // Recheck before the money effect; retain proven late money even if the
          // current booking cannot apply it. No provider dependency erases settlement.
          if (previous === undefined)
            await options.booking.requireDepositEligibility({
              bookingId: command.bookingId,
              timelineRevisionId: attempt.timelineRevisionId,
            });
          const result = await options.ledger.append(
            fact({
              bookingId: command.bookingId,
              kind: 'PAYMENT',
              sourceType: 'PAYMENT_ATTEMPT',
              sourceRevisionId: attempt.id,
              amountVnd: attempt.amountVnd,
              occurredAt: command.settledAt,
              paymentAttemptId: attempt.id,
            }),
            scoped,
          );
          return { ...result, timelineRevisionId: attempt.timelineRevisionId };
        },
      );
      try {
        await options.boundary.run({ bookingId: command.bookingId, context }, async (scoped) => {
          if (await options.ledger.isDepositApplied(command.bookingId, money.entry.id, scoped))
            return;
          const eligibility = await options.booking.requireDepositEligibility({
            bookingId: command.bookingId,
            timelineRevisionId: money.timelineRevisionId,
          });
          if (!eligibility.eligible || eligibility.depositAmountVnd !== money.entry.amountVnd)
            throw conflict('DEPOSIT_NOT_ELIGIBLE');
          // The Booking recorder promotes the reserved account through Identity.
          // All owner writes and this completion marker commit or roll back together.
          await options.recorder.recordSuccessfulDeposit({
            bookingId: command.bookingId,
            timelineRevisionId: money.timelineRevisionId,
            paymentId: money.entry.id,
            amountVnd: money.entry.amountVnd,
            settledAt: new Date(money.entry.occurredAt),
          });
          await options.ledger.markDepositApplied(
            command.bookingId,
            money.entry.id,
            now().toISOString(),
            scoped,
          );
        });
        return Object.freeze({
          paymentId: money.entry.id,
          replayed: money.replayed,
          applicationStatus: 'SUCCEEDED' as const,
        });
      } catch {
        // Reconciliation retries this same durable payment after owner failure.
        return Object.freeze({
          paymentId: money.entry.id,
          replayed: money.replayed,
          applicationStatus: 'PENDING' as const,
        });
      }
    },
  });
}

function fact(
  input: Pick<
    NewLedgerFact,
    'bookingId' | 'kind' | 'sourceType' | 'sourceRevisionId' | 'amountVnd' | 'occurredAt'
  > &
    Partial<Pick<NewLedgerFact, 'paymentAttemptId'>>,
): NewLedgerFact {
  return {
    id: randomUUID(),
    sourceEntryId: null,
    paymentAttemptId: null,
    decisionId: null,
    approvedRefundableVnd: null,
    reason: null,
    evidenceReference: null,
    ...input,
  };
}
