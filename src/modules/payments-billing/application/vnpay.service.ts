import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { BookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { BillingLedgerRepository, PaymentAttempt } from './billing-ledger.port.js';
import type { createDepositOrchestrationService } from './deposit-orchestration.service.js';
import type { createBillingOperationsService } from './billing-operations.service.js';
import type {
  BookingDepositIntentCoordinator,
  ContractContext,
} from './payments-billing.providers.js';
import {
  VnpayProtocolError,
  type ProviderEvidence,
  type VnpayEvidenceRepository,
  type VnpayProtocol,
  type VnpayStatusGateway,
} from './vnpay.port.js';

type Deposits = ReturnType<typeof createDepositOrchestrationService>;
type Balances = Pick<
  ReturnType<typeof createBillingOperationsService>,
  'createBalance' | 'applySettledBalance'
>;
const EXPIRY_GRACE_MS = 15 * 60_000;
const acknowledgements = {
  '00': 'Confirm success',
  '02': 'Order already confirmed',
  '01': 'Order not found',
  '04': 'Invalid amount',
  '97': 'Invalid signature',
  '99': 'Processing failure',
} as const;
function acknowledge(code: keyof typeof acknowledgements) {
  return Object.freeze({ RspCode: code, Message: acknowledgements[code] });
}
function systemContext(): ContractContext {
  return {
    requestId: randomUUID(),
    causationId: randomUUID(),
    actorAccountId: null,
    authority: 'SYSTEM',
  };
}

export function createVnpayService(
  options: Readonly<{
    deposits: Deposits;
    balances?: Balances;
    ledger: BillingLedgerRepository;
    coordinator: BookingDepositIntentCoordinator;
    evidence: VnpayEvidenceRepository;
    protocol: VnpayProtocol;
    gateway: VnpayStatusGateway;
    boundary: BookingBoundaryUnitOfWork;
    now?: () => Date;
  }>,
) {
  const now = options.now ?? (() => new Date());
  async function applyMoney(bookingId: string, attempt: PaymentAttempt, context: ContractContext) {
    if (attempt.state !== 'SUCCEEDED') return null;
    const proof = await options.boundary.run({ bookingId, context }, (scoped) =>
      options.evidence.getTerminalEvidence(bookingId, attempt.id, scoped),
    );
    if (proof === null) {
      // Preserve a completed historical application without fabricating VNPay proof.
      return options.boundary.run({ bookingId, context }, async (scoped) => {
        const ledger = await options.ledger.getLedger(bookingId, scoped);
        const payment = ledger.entries.find(
          (entry) => entry.kind === 'PAYMENT' && entry.paymentAttemptId === attempt.id,
        );
        return payment !== undefined &&
          (attempt.purpose === 'BALANCE' ||
            (await options.ledger.isDepositApplied(bookingId, payment.id, scoped)))
          ? ('SUCCEEDED' as const)
          : ('PENDING' as const);
      });
    }
    if (proof.decision !== 'ACCEPTED' || proof.outcome !== 'SUCCEEDED' || proof.settledAt === null)
      return 'PENDING' as const;
    try {
      const input = { bookingId, paymentAttemptId: attempt.id, settledAt: proof.settledAt };
      if (attempt.purpose === 'BALANCE')
        return options.balances === undefined
          ? ('PENDING' as const)
          : (await options.balances.applySettledBalance(input, context)).applicationStatus;
      return (await options.deposits.applySettledDeposit(input, context)).applicationStatus;
    } catch {
      return 'PENDING' as const;
    }
  }
  async function acceptEvidence(
    bookingId: string,
    proof: ProviderEvidence,
    context: ContractContext,
  ) {
    return options.boundary.run({ bookingId, context }, async (scoped) => {
      const attempt = await options.ledger.getAttempt(bookingId, proof.paymentAttemptId, scoped);
      const stored = await options.evidence.recordEvidence(bookingId, proof, scoped);
      if (stored.evidence.decision !== 'ACCEPTED')
        return { ...stored, attempt, repeated: stored.replayed };
      if (attempt.state === 'SUCCEEDED' || attempt.state === 'FAILED')
        return { ...stored, attempt, repeated: true };
      const resolved = await options.ledger.transitionAttempt(
        {
          bookingId,
          paymentAttemptId: attempt.id,
          evidence:
            proof.outcome === 'SUCCEEDED'
              ? 'VERIFIED_SUCCESS'
              : proof.outcome === 'FAILED'
                ? 'VERIFIED_FAILURE'
                : 'OUTCOME_UNKNOWN',
          providerEvidenceId: proof.outcome === 'UNKNOWN' ? null : stored.evidence.id,
        },
        scoped,
      );
      if (attempt.purpose === 'DEPOSIT' && proof.outcome === 'FAILED')
        await options.coordinator.releaseVerifiedFailure(
          { bookingId, paymentAttemptId: attempt.id, providerEvidenceId: stored.evidence.id },
          scoped,
        );
      if (attempt.purpose === 'DEPOSIT' && proof.outcome === 'UNKNOWN')
        await options.coordinator.recordUnknown(
          { bookingId, paymentAttemptId: attempt.id },
          scoped,
        );
      return { ...stored, attempt: resolved, repeated: stored.replayed };
    });
  }
  async function markUnknown(
    bookingId: string,
    paymentAttemptId: string,
    context: ContractContext,
  ) {
    return options.boundary.run({ bookingId, context }, async (scoped) => {
      const attempt = await options.ledger.getAttempt(bookingId, paymentAttemptId, scoped);
      // An IPN may have resolved the attempt while querydr was in flight.
      if (attempt.state === 'SUCCEEDED' || attempt.state === 'FAILED') return attempt;
      const unknown = await options.ledger.transitionAttempt(
        { bookingId, paymentAttemptId, evidence: 'OUTCOME_UNKNOWN', providerEvidenceId: null },
        scoped,
      );
      if (attempt.purpose === 'DEPOSIT')
        await options.coordinator.recordUnknown({ bookingId, paymentAttemptId }, scoped);
      return unknown;
    });
  }
  async function prepareCheckout(
    bookingId: string,
    created: Readonly<{ attempt: PaymentAttempt; replayed: boolean }>,
    ip: string,
    context: ContractContext,
  ) {
    return options.boundary.run({ bookingId, context }, async (scoped) => {
      let attempt = await options.ledger.getAttempt(bookingId, created.attempt.id, scoped);
      const previous = await options.evidence.getCheckout(bookingId, attempt.id, scoped);
      const checkout =
        previous ??
        (await options.evidence.saveCheckout(
          bookingId,
          {
            paymentAttemptId: attempt.id,
            parameters: options.protocol.createCheckout(attempt, ip).parameters,
          },
          scoped,
        ));
      if (attempt.state === 'CREATED')
        attempt = await options.ledger.transitionAttempt(
          {
            bookingId,
            paymentAttemptId: attempt.id,
            evidence: 'PROVIDER_REQUESTED',
            providerEvidenceId: null,
          },
          scoped,
        );
      // Checkout is durable before its locally signed URL is exposed.
      return Object.freeze({
        attempt,
        replayed: created.replayed,
        checkoutUrl: options.protocol.checkoutUrl(checkout.parameters),
      });
    });
  }
  return Object.freeze({
    async inspectCheckout(bookingId: string, paymentAttemptId: string, context: ContractContext) {
      if (context.authority !== 'SYSTEM' || context.actorAccountId !== null)
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'The request is forbidden.',
        });
      return options.boundary.run({ bookingId, context }, async (scoped) => {
        const attempt = await options.ledger.getAttempt(bookingId, paymentAttemptId, scoped);
        const checkout = await options.evidence.getCheckout(bookingId, paymentAttemptId, scoped);
        return {
          status: attempt.state,
          applicationStatus: null,
          ...(!['SUCCEEDED', 'FAILED'].includes(attempt.state) &&
          checkout !== null &&
          now().getTime() < Date.parse(attempt.expiresAt)
            ? { checkoutUrl: options.protocol.checkoutUrl(checkout.parameters) }
            : {}),
        };
      });
    },
    // A relay transports this read-only signed request; it cannot choose another
    // merchant, amount, order or original provider transaction date.
    async prepareQuery(bookingId: string, paymentAttemptId: string, context: ContractContext) {
      if (context.authority !== 'SYSTEM' || context.actorAccountId !== null)
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'The request is forbidden.',
        });
      const snapshot = await options.boundary.run({ bookingId, context }, async (scoped) => ({
        attempt: await options.ledger.getAttempt(bookingId, paymentAttemptId, scoped),
        checkout: await options.evidence.getCheckout(bookingId, paymentAttemptId, scoped),
      }));
      if (snapshot.attempt.state === 'SUCCEEDED' || snapshot.attempt.state === 'FAILED')
        return null;
      if (snapshot.attempt.provider !== 'VNPAY' || snapshot.checkout === null)
        throw new AppError({
          status: 503,
          code: 'PAYMENT_PROVIDER_UNAVAILABLE',
          message: 'The payment checkout has not been prepared.',
        });
      return options.protocol.createQuery({
        paymentAttemptId,
        transactionDate: snapshot.checkout.parameters.vnp_CreateDate!,
        requestId: randomUUID().replaceAll('-', ''),
        createdAt: now().toISOString(),
      });
    },
    async startCheckout(
      input: Parameters<Deposits['createDeposit']>[0],
      ip: string,
      context: ContractContext,
    ) {
      z.union([z.ipv4(), z.ipv6()]).parse(ip);
      const created = await options.deposits.createDeposit(input, context);
      return prepareCheckout(input.bookingId, created, ip, context);
    },
    async startBalanceCheckout(
      input: Parameters<Balances['createBalance']>[0],
      ip: string,
      context: ContractContext,
    ) {
      z.union([z.ipv4(), z.ipv6()]).parse(ip);
      if (options.balances === undefined)
        throw new AppError({
          status: 503,
          code: 'PAYMENT_PROVIDER_UNAVAILABLE',
          message: 'Balance collection is unavailable.',
        });
      const created = await options.balances.createBalance(input, context);
      return prepareCheckout(input.bookingId, created, ip, context);
    },
    async processIpn(rawQuery: string) {
      let proof: ProviderEvidence;
      try {
        proof = options.protocol.verifyIpn(rawQuery);
      } catch (error) {
        return acknowledge(
          error instanceof VnpayProtocolError && error.reason === 'SIGNATURE' ? '97' : '99',
        );
      }
      try {
        const bookingId = await options.evidence.findAttemptBooking(proof.paymentAttemptId);
        if (bookingId === null) return acknowledge('01');
        const context = systemContext();
        const result = await acceptEvidence(bookingId, proof, context);
        if (result.evidence.decision === 'AMOUNT_MISMATCH') return acknowledge('04');
        if (result.evidence.decision === 'CONFLICT') return acknowledge('99');
        // Evidence and transition are durable even if applying owners needs recovery.
        try {
          await applyMoney(bookingId, result.attempt, context);
        } catch {
          /* Retry through reconciliation. */
        }
        return acknowledge(result.repeated ? '02' : '00');
      } catch {
        return acknowledge('99');
      }
    },
    // Internal SYSTEM worker port. W6 authorizes any user-triggered status read separately.
    async reconcile(
      bookingId: string,
      paymentAttemptId: string,
      context: ContractContext,
      queryReply?: Readonly<{ raw: unknown }>,
    ) {
      if (context.authority !== 'SYSTEM' || context.actorAccountId !== null)
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'The request is forbidden.',
        });
      const snapshot = await options.boundary.run({ bookingId, context }, async (scoped) => ({
        attempt: await options.ledger.getAttempt(bookingId, paymentAttemptId, scoped),
        checkout: await options.evidence.getCheckout(bookingId, paymentAttemptId, scoped),
      }));
      let attempt = snapshot.attempt;
      if (attempt.state !== 'SUCCEEDED' && attempt.state !== 'FAILED') {
        if (snapshot.checkout === null)
          throw new AppError({
            status: 503,
            code: 'PAYMENT_PROVIDER_UNAVAILABLE',
            message: 'The payment checkout has not been prepared.',
          });
        let proof: ProviderEvidence | null = null;
        try {
          proof = options.protocol.verifyQuery(
            queryReply !== undefined
              ? queryReply.raw
              : await options.gateway.query(
                  options.protocol.createQuery({
                    paymentAttemptId,
                    transactionDate: snapshot.checkout.parameters.vnp_CreateDate!,
                    requestId: randomUUID().replaceAll('-', ''),
                    createdAt: now().toISOString(),
                  }),
                ),
            snapshot.attempt,
          );
          if (proof.paymentAttemptId !== paymentAttemptId) proof = null;
          if (
            proof?.outcome === 'UNKNOWN' &&
            proof.nonPaymentReason !== undefined &&
            now().getTime() > Date.parse(attempt.expiresAt) + EXPIRY_GRACE_MS
          ) {
            proof = {
              ...proof,
              outcome: 'FAILED',
              resolutionReason: 'EXPIRED_UNPAID',
              sourcePayloadHash: proof.payloadHash,
              // Distinguish this policy decision from the same signed reply stored
              // as UNKNOWN before grace. Never overwrite immutable provider facts.
              payloadHash: createHash('sha256')
                .update(`vnpay-expired-unpaid-v1|${proof.payloadHash}|${attempt.expiresAt}`)
                .digest('hex'),
            };
          }
        } catch {
          /* Timeout, malformed or unverified responses never prove expiry failure. */
        }
        if (proof === null) attempt = await markUnknown(bookingId, paymentAttemptId, context);
        else {
          const result = await acceptEvidence(bookingId, proof, context);
          attempt =
            result.evidence.decision === 'ACCEPTED'
              ? result.attempt
              : await markUnknown(bookingId, paymentAttemptId, context);
        }
      }
      return Object.freeze({
        status: attempt.state,
        applicationStatus: await applyMoney(bookingId, attempt, context),
        ...(attempt.provider === 'VNPAY' &&
        ['CREATED', 'PENDING', 'UNKNOWN'].includes(attempt.state) &&
        now().getTime() < Date.parse(attempt.expiresAt) &&
        snapshot.checkout !== null
          ? { checkoutUrl: options.protocol.checkoutUrl(snapshot.checkout.parameters) }
          : {}),
      });
    },
    // ReturnURL is a display hint only: verification has no persistence side effects.
    verifyReturnHint(rawQuery: string) {
      const hint = options.protocol.verifyIpn(rawQuery);
      if (hint.correlationConflict !== undefined) throw new VnpayProtocolError('CORRELATION');
      return hint;
    },
  });
}
