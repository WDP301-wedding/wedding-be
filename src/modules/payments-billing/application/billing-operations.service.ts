import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { AppError } from '../../../core/errors/app-error.js';
import type {
  BookingCommercialSnapshotReader,
  BookingReportingReader,
} from '../../booking-lifecycle/application/booking-snapshots.js';
import { validateRefund, BillingPolicyError } from '../domain/billing-policy.js';
import type { BillingLedgerRepository, NewLedgerFact } from './billing-ledger.port.js';
import {
  balanceIntentSchema,
  manualPaymentSchema,
  refundApprovalSchema,
  refundCommandSchema,
  invoiceCommandSchema,
  type BillingCommandKind,
  type BillingCommandResult,
  type BillingOperationsRepository,
} from './billing-operations.port.js';
import type {
  ContractContext,
  BookingLifecycleReader,
  BookingDepositIntentCoordinator,
  BookingDepositRecorder,
} from './payments-billing.providers.js';

export function createBillingOperationsService(
  options: Readonly<{
    ledger: BillingLedgerRepository;
    operations: BillingOperationsRepository;
    boundary: BookingBoundaryUnitOfWork;
    booking: BookingLifecycleReader;
    commercial: BookingCommercialSnapshotReader;
    reporting: BookingReportingReader;
    coordinator: BookingDepositIntentCoordinator;
    recorder: BookingDepositRecorder;
    now?: () => Date;
  }>,
) {
  const now = options.now ?? (() => new Date());
  async function execute(
    command: { bookingId: string; commandId: string },
    kind: BillingCommandKind,
    context: ContractContext,
    work: (scoped: ContractContext) => Promise<BillingCommandResult>,
    manager = true,
  ) {
    return options.boundary.run({ bookingId: command.bookingId, context }, async (scoped) => {
      if (manager) await options.operations.requireManager(command.bookingId, scoped);
      else await options.operations.requireReadAccess(command.bookingId, scoped);
      const bodyHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
      const old = await options.operations.findCommand(
        command.bookingId,
        command.commandId,
        scoped,
      );
      if (old !== null) {
        if (
          old.kind !== kind ||
          old.bodyHash !== bodyHash ||
          old.actorAccountId !== context.actorAccountId
        )
          throw error('IDEMPOTENCY_KEY_REUSED', 422);
        return Object.freeze({ ...old.result, replayed: true });
      }
      const result = await work(scoped);
      await options.operations.saveCommand(
        {
          bookingId: command.bookingId,
          commandId: command.commandId,
          kind,
          bodyHash,
          actorAccountId: context.actorAccountId!,
          result,
        },
        scoped,
      );
      return Object.freeze({ ...result, replayed: false });
    });
  }
  async function balance(
    command: { bookingId: string; expectedBillingRevision: number },
    context: ContractContext,
  ) {
    const access = await options.operations.requireReadAccess(command.bookingId, context);
    if (!['CONFIRMED', 'COMPLETED'].includes(access.phase)) throw error('BALANCE_NOT_ELIGIBLE');
    const ledger = await options.ledger.getLedger(command.bookingId, context);
    if (ledger.revision !== command.expectedBillingRevision) throw error('STALE_BILLING_REVISION');
    await options.operations.requireBalanceAvailable(command.bookingId, context);
    if (ledger.totals.outstandingVnd === 0) throw error('BILLING_BALANCE_LIMIT_EXCEEDED');
    return ledger.totals.outstandingVnd;
  }
  async function createAttempt(
    command: { bookingId: string; commandId: string },
    purpose: 'DEPOSIT' | 'BALANCE',
    provider: 'MANUAL' | 'VNPAY',
    amountVnd: number,
    timelineRevisionId: string | null,
    scoped: ContractContext,
  ) {
    const createdAt = now();
    return options.ledger.createAttempt(
      {
        bookingId: command.bookingId,
        commandId: command.commandId,
        id: randomUUID(),
        purpose,
        provider,
        amountVnd,
        timelineRevisionId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
      },
      scoped,
    );
  }
  return Object.freeze({
    async createBalance(input: z.input<typeof balanceIntentSchema>, context: ContractContext) {
      const command = balanceIntentSchema.parse(input);
      const result = await execute(
        command,
        'BALANCE_INTENT',
        context,
        async (scoped) => {
          const amountVnd = await balance(command, scoped);
          if (amountVnd > 9_999_999_999) throw error('PAYMENT_PROVIDER_AMOUNT_UNSUPPORTED', 422);
          const { attempt } = await createAttempt(
            command,
            'BALANCE',
            'VNPAY',
            amountVnd,
            null,
            scoped,
          );
          return { resourceId: attempt.id };
        },
        false,
      );
      const attempt = await options.ledger.getAttempt(command.bookingId, result.resourceId);
      return Object.freeze({ attempt, replayed: result.replayed });
    },
    async recordManualPayment(
      input: z.input<typeof manualPaymentSchema>,
      context: ContractContext,
    ) {
      const command = manualPaymentSchema.parse(input);
      return execute(command, 'MANUAL_PAYMENT', context, async (scoped) => {
        let timelineRevisionId: string | null = null;
        let eligibility: Awaited<
          ReturnType<BookingLifecycleReader['requireDepositEligibility']>
        > | null = null;
        if (command.purpose === 'BALANCE') {
          if (command.amountVnd > (await balance(command, scoped)))
            throw error('BILLING_BALANCE_LIMIT_EXCEEDED');
        } else {
          timelineRevisionId = command.timelineRevisionId;
          eligibility = await options.booking.requireDepositEligibility(command);
          if (!eligibility.eligible || command.amountVnd !== eligibility.depositAmountVnd)
            throw error('DEPOSIT_NOT_ELIGIBLE');
          const commercial = await options.commercial.getAccepted(command, scoped);
          if (
            commercial.bookingId !== command.bookingId ||
            commercial.bookingRevision !== eligibility.bookingRevision ||
            commercial.depositAmountVnd !== command.amountVnd
          )
            throw error('PAYMENT_EVIDENCE_CONFLICT');
          const previous = (await options.ledger.getLedger(command.bookingId, scoped)).entries.find(
            (entry) =>
              entry.sourceType === 'BASE_BOOKING' &&
              entry.sourceRevisionId === commercial.commercialRevisionId,
          );
          if (previous !== undefined && previous.amountVnd !== commercial.baseChargeVnd)
            throw error('PAYMENT_EVIDENCE_CONFLICT');
          if (previous === undefined)
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
        }
        const { attempt } = await createAttempt(
          command,
          command.purpose,
          'MANUAL',
          command.amountVnd,
          timelineRevisionId,
          scoped,
        );
        if (eligibility !== null)
          await options.coordinator.reserve(
            {
              bookingId: command.bookingId,
              timelineRevisionId: timelineRevisionId!,
              paymentAttemptId: attempt.id,
              expectedBookingRevision: eligibility.bookingRevision,
              amountVnd: attempt.amountVnd,
              expiresAt: attempt.expiresAt,
            },
            scoped,
          );
        await options.ledger.transitionAttempt(
          {
            bookingId: command.bookingId,
            paymentAttemptId: attempt.id,
            evidence: 'PROVIDER_REQUESTED',
            providerEvidenceId: null,
          },
          scoped,
        );
        await options.ledger.transitionAttempt(
          {
            bookingId: command.bookingId,
            paymentAttemptId: attempt.id,
            evidence: 'VERIFIED_SUCCESS',
            providerEvidenceId: command.commandId,
          },
          scoped,
        );
        if (timelineRevisionId !== null) {
          const current = await options.booking.requireDepositEligibility({
            bookingId: command.bookingId,
            timelineRevisionId,
          });
          if (!current.eligible || current.depositAmountVnd !== command.amountVnd)
            throw error('DEPOSIT_NOT_ELIGIBLE');
        }
        const payment = await options.ledger.append(
          fact({
            bookingId: command.bookingId,
            kind: 'PAYMENT',
            sourceType: 'PAYMENT_ATTEMPT',
            sourceRevisionId: attempt.id,
            paymentAttemptId: attempt.id,
            amountVnd: attempt.amountVnd,
            occurredAt: command.settledAt,
            reason: command.reason,
            evidenceReference: command.evidenceReference,
          }),
          scoped,
        );
        if (timelineRevisionId !== null) {
          await options.recorder.recordSuccessfulDeposit({
            bookingId: command.bookingId,
            timelineRevisionId,
            paymentId: payment.entry.id,
            amountVnd: payment.entry.amountVnd,
            settledAt: new Date(payment.entry.occurredAt),
          });
          await options.ledger.markDepositApplied(
            command.bookingId,
            payment.entry.id,
            now().toISOString(),
            scoped,
          );
        }
        return { resourceId: payment.entry.id, paymentAttemptId: attempt.id };
      });
    },
    async applySettledBalance(
      input: { bookingId: string; paymentAttemptId: string; settledAt: string },
      context: ContractContext,
    ) {
      const command = z
        .strictObject({
          bookingId: z.uuid(),
          paymentAttemptId: z.uuid(),
          settledAt: z.iso.datetime({ offset: true }),
        })
        .parse(input);
      if (context.authority !== 'SYSTEM' || context.actorAccountId !== null)
        throw error('FORBIDDEN', 403);
      return options.boundary.run({ bookingId: command.bookingId, context }, async (scoped) => {
        const attempt = await options.ledger.getAttempt(
          command.bookingId,
          command.paymentAttemptId,
          scoped,
        );
        if (
          attempt.purpose !== 'BALANCE' ||
          attempt.provider !== 'VNPAY' ||
          attempt.state !== 'SUCCEEDED' ||
          attempt.terminalEvidenceId === null
        )
          throw error('PAYMENT_EVIDENCE_CONFLICT');
        // Frozen proven money survives a later charge/credit/phase change as explicit credit.
        const payment = await options.ledger.append(
          fact({
            bookingId: command.bookingId,
            kind: 'PAYMENT',
            sourceType: 'PAYMENT_ATTEMPT',
            sourceRevisionId: attempt.id,
            paymentAttemptId: attempt.id,
            amountVnd: attempt.amountVnd,
            occurredAt: command.settledAt,
          }),
          scoped,
        );
        return Object.freeze({
          paymentId: payment.entry.id,
          replayed: payment.replayed,
          applicationStatus: 'SUCCEEDED' as const,
        });
      });
    },
    async approveRefund(input: z.input<typeof refundApprovalSchema>, context: ContractContext) {
      const command = refundApprovalSchema.parse(input);
      return execute(command, 'REFUND_APPROVAL', context, async (scoped) => {
        const ledger = await options.ledger.getLedger(command.bookingId, scoped);
        if (
          command.expectedBillingRevision !== undefined &&
          ledger.revision !== command.expectedBillingRevision
        )
          throw error('STALE_BILLING_REVISION');
        let limit: number;
        let basisId: string;
        let cancellationSequence: number | null = null;
        if (command.basis.kind === 'CREDIT') {
          const sourceEntryId = command.basis.sourceEntryId;
          const credit = ledger.entries.find(
            (entry) => entry.id === sourceEntryId && entry.kind === 'CREDIT_ADJUSTMENT',
          );
          if (credit === undefined) throw error('PAYMENT_EVIDENCE_CONFLICT');
          limit = credit.amountVnd;
          basisId = credit.id;
        } else {
          const sequence = command.basis.sequence;
          const page = await options.reporting.readPage(
            { afterSequence: sequence - 1, throughSequence: sequence, limit: 1 },
            context,
          );
          const proof = page.rows[0];
          if (proof?.recordId !== command.bookingId || proof.value.phase !== 'CANCELLED')
            throw error('PAYMENT_EVIDENCE_CONFLICT');
          limit = ledger.totals.paidVnd;
          basisId = command.bookingId;
          cancellationSequence = sequence;
        }
        const approved = await options.operations.getApprovedTotal(
          command.bookingId,
          command.basis.kind,
          basisId,
          scoped,
        );
        if (
          command.approvedRefundableVnd > limit - approved ||
          command.approvedRefundableVnd > ledger.totals.netPaidVnd
        )
          throw error('BILLING_REFUND_LIMIT_EXCEEDED');
        await options.operations.saveApproval(
          {
            id: command.commandId,
            bookingId: command.bookingId,
            basisKind: command.basis.kind,
            basisId,
            cancellationSequence,
            approvedRefundableVnd: command.approvedRefundableVnd,
            reason: command.reason,
            evidenceReference: command.evidenceReference,
            approvedByAccountId: context.actorAccountId!,
            approvedAt: now().toISOString(),
          },
          scoped,
        );
        return { resourceId: command.commandId };
      });
    },
    async recordRefund(input: z.input<typeof refundCommandSchema>, context: ContractContext) {
      const command = refundCommandSchema.parse(input);
      return execute(command, 'REFUND', context, async (scoped) => {
        const ledger = await options.ledger.getLedger(command.bookingId, scoped);
        if (ledger.revision !== command.expectedBillingRevision)
          throw error('STALE_BILLING_REVISION');
        const decision = await options.operations.getApproval(
          command.bookingId,
          command.decisionId,
          scoped,
        );
        const source = ledger.entries.find(
          (entry) => entry.id === command.sourcePaymentId && entry.kind === 'PAYMENT',
        );
        if (source === undefined) throw error('PAYMENT_EVIDENCE_CONFLICT');
        const refunds = ledger.entries.filter((entry) => entry.kind === 'REFUND');
        try {
          validateRefund({
            amountVnd: command.amountVnd,
            sourceSettledVnd: source.amountVnd,
            alreadyRefundedFromSourceVnd: refunds
              .filter((entry) => entry.sourceEntryId === source.id)
              .reduce((sum, entry) => sum + entry.amountVnd, 0),
            approvedRefundableVnd: decision.approvedRefundableVnd,
            alreadyRefundedForDecisionVnd: refunds
              .filter((entry) => entry.decisionId === decision.id)
              .reduce((sum, entry) => sum + entry.amountVnd, 0),
          });
        } catch (cause) {
          if (cause instanceof BillingPolicyError) throw error(cause.code);
          throw cause;
        }
        const refund = await options.ledger.append(
          fact({
            bookingId: command.bookingId,
            kind: 'REFUND',
            sourceType: 'MANUAL_REFUND',
            sourceRevisionId: command.commandId,
            sourceEntryId: source.id,
            decisionId: decision.id,
            approvedRefundableVnd: decision.approvedRefundableVnd,
            amountVnd: command.amountVnd,
            reason: command.reason,
            evidenceReference: command.evidenceReference,
            occurredAt: command.recordedAt,
          }),
          scoped,
        );
        return { resourceId: refund.entry.id };
      });
    },
    async issueInvoice(input: z.input<typeof invoiceCommandSchema>, context: ContractContext) {
      const command = invoiceCommandSchema.parse(input);
      return execute(command, 'INVOICE', context, async (scoped) => {
        const invoice = await options.ledger.issueInvoice(
          {
            id: command.commandId,
            bookingId: command.bookingId,
            invoiceNumber: `INV-${command.commandId}`,
            expectedBillingRevision: command.expectedBillingRevision,
            issuedAt: now().toISOString(),
          },
          scoped,
        );
        return { resourceId: invoice.id };
      });
    },
  });
}
function fact(
  input: Pick<
    NewLedgerFact,
    'bookingId' | 'kind' | 'sourceType' | 'sourceRevisionId' | 'amountVnd' | 'occurredAt'
  > &
    Partial<NewLedgerFact>,
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
function error(code: string, status = 409) {
  return new AppError({
    status,
    code,
    message: 'The billing command conflicts with its authority or evidence.',
  });
}
