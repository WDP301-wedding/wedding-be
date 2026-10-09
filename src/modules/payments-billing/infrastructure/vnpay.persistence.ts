import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import type { PrismaClient, BillingProviderEvidence } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import type {
  VnpayEvidenceRepository,
  ProviderEvidence,
  StoredProviderEvidence,
} from '../application/vnpay.port.js';
import { BillingPersistenceConflict } from './billing.persistence.js';

const evidenceSchema = z
  .strictObject({
    paymentAttemptId: z.uuid(),
    merchantCode: z.string().regex(/^[A-Za-z0-9]{8}$/u),
    transactionId: z.string().regex(/^(0|[1-9]\d{0,14})$/u),
    amountVnd: z.int().positive().max(9_999_999_999),
    outcome: z.enum(['SUCCEEDED', 'FAILED', 'UNKNOWN']),
    settledAt: z.iso.datetime({ offset: true }).nullable(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
    channel: z.enum(['IPN', 'QUERY']),
    correlationConflict: z.literal('CURRENCY').optional(),
  })
  .refine((input) => (input.outcome === 'SUCCEEDED') === (input.settledAt !== null));
const checkoutSchema = z
  .strictObject({
    vnp_Version: z.literal('2.1.0'),
    vnp_Command: z.literal('pay'),
    vnp_TmnCode: z.string().regex(/^[A-Za-z0-9]{8}$/u),
    vnp_Amount: z.string().regex(/^[1-9]\d{0,11}$/u),
    vnp_CurrCode: z.literal('VND'),
    vnp_TxnRef: z.uuid(),
    vnp_OrderInfo: z.string().min(1).max(255),
    vnp_OrderType: z.literal('other'),
    vnp_Locale: z.literal('vn'),
    vnp_IpAddr: z.string().max(45),
    vnp_ReturnUrl: z.url(),
    vnp_CreateDate: z.string().regex(/^\d{14}$/u),
    vnp_ExpireDate: z.string().regex(/^\d{14}$/u),
  })
  .readonly();

export function createVnpayEvidenceRepository(
  prisma: PrismaClient,
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>,
): VnpayEvidenceRepository {
  async function enlisted<T>(
    bookingId: string,
    context: ContractContext,
    work: (client: PrismaClient) => Promise<T>,
  ) {
    if (context.transactionScopeId === undefined)
      throw new BillingPersistenceConflict('INVALID_TRANSACTION_SCOPE');
    return scope.withClient(bookingId, context, work);
  }
  async function requireAttempt(client: PrismaClient, bookingId: string, id: string) {
    const attempt = await client.billingPaymentAttempt.findUnique({ where: { id } });
    if (attempt === null || attempt.bookingId !== bookingId || attempt.provider !== 'VNPAY')
      throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
    return attempt;
  }
  return Object.freeze<VnpayEvidenceRepository>({
    async findAttemptBooking(paymentAttemptId: string) {
      if (!z.uuid().safeParse(paymentAttemptId).success) return null;
      return (
        (
          await prisma.billingPaymentAttempt.findUnique({
            where: { id: paymentAttemptId },
            select: { bookingId: true },
          })
        )?.bookingId ?? null
      );
    },
    saveCheckout(bookingId, input, context) {
      const parameters = checkoutSchema.parse(input.parameters);
      return enlisted(bookingId, context, async (client) => {
        const attempt = await requireAttempt(client, bookingId, input.paymentAttemptId);
        if (
          parameters.vnp_TxnRef !== attempt.id ||
          BigInt(parameters.vnp_Amount) !== BigInt(attempt.amountVnd.toString()) * 100n
        )
          throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
        const existing = await client.billingVnpayCheckout.findUnique({
          where: { paymentAttemptId: attempt.id },
        });
        // Retry preserves the original IP, return URL and provider transaction date.
        if (existing !== null)
          return Object.freeze({
            paymentAttemptId: attempt.id,
            parameters: checkoutSchema.parse(existing.parameters),
          });
        await client.billingVnpayCheckout.create({
          data: { paymentAttemptId: attempt.id, parameters },
        });
        return Object.freeze({ paymentAttemptId: attempt.id, parameters });
      });
    },
    getCheckout(bookingId, paymentAttemptId, context) {
      return enlisted(bookingId, context, async (client) => {
        await requireAttempt(client, bookingId, paymentAttemptId);
        const stored = await client.billingVnpayCheckout.findUnique({
          where: { paymentAttemptId },
        });
        return stored === null
          ? null
          : Object.freeze({
              paymentAttemptId,
              parameters: checkoutSchema.parse(stored.parameters),
            });
      });
    },
    recordEvidence(bookingId, input, context) {
      const proof = evidenceSchema.parse(input);
      return enlisted(bookingId, context, async (client) => {
        const attempt = await requireAttempt(client, bookingId, proof.paymentAttemptId);
        const checkout = await client.billingVnpayCheckout.findUniqueOrThrow({
          where: { paymentAttemptId: attempt.id },
        });
        const parameters = checkoutSchema.parse(checkout.parameters);
        if (parameters.vnp_TmnCode !== proof.merchantCode)
          throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
        const existing = await client.billingProviderEvidence.findUnique({
          where: {
            paymentAttemptId_channel_payloadHash: {
              paymentAttemptId: attempt.id,
              channel: proof.channel,
              payloadHash: proof.payloadHash,
            },
          },
        });
        if (existing !== null)
          return Object.freeze({ evidence: toEvidence(existing), replayed: true });
        const terminal =
          attempt.terminalEvidenceId === null
            ? null
            : await client.billingProviderEvidence.findUnique({
                where: { id: attempt.terminalEvidenceId },
              });
        const claim =
          proof.transactionId === '0'
            ? null
            : await client.billingProviderTransaction.findUnique({
                where: {
                  merchantCode_transactionId: {
                    merchantCode: proof.merchantCode,
                    transactionId: proof.transactionId,
                  },
                },
                include: { evidence: true },
              });
        const priorIpn =
          proof.channel === 'IPN' && proof.transactionId !== '0'
            ? await client.billingProviderEvidence.findFirst({
                where: {
                  paymentAttemptId: attempt.id,
                  channel: 'IPN',
                  transactionId: proof.transactionId,
                  decision: 'ACCEPTED',
                },
              })
            : null;
        const decision =
          Number(attempt.amountVnd) !== proof.amountVnd
            ? 'AMOUNT_MISMATCH'
            : proof.correlationConflict !== undefined ||
                (claim !== null && claim.paymentAttemptId !== attempt.id) ||
                (priorIpn !== null &&
                  !(priorIpn.outcome === 'UNKNOWN' && proof.outcome !== 'UNKNOWN')) ||
                (terminal !== null && !sameSettlement(terminal, proof)) ||
                (['SUCCEEDED', 'FAILED'].includes(attempt.state) && terminal === null)
              ? 'CONFLICT'
              : 'ACCEPTED';
        const { correlationConflict, ...normalizedProof } = proof;
        const stored = await client.billingProviderEvidence.create({
          data: {
            ...normalizedProof,
            id: randomUUID(),
            decision,
            settledAt: proof.settledAt === null ? null : new Date(proof.settledAt),
          },
        });
        if (decision === 'ACCEPTED' && proof.transactionId !== '0' && claim === null)
          await client.billingProviderTransaction.create({
            data: {
              merchantCode: proof.merchantCode,
              transactionId: proof.transactionId,
              paymentAttemptId: attempt.id,
              evidenceId: stored.id,
            },
          });
        await client.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'SYSTEM',
            actorId: null,
            action: 'billing.provider-evidence',
            entityType: 'billing',
            entityId: stored.id,
            metadata: {
              bookingId,
              paymentAttemptId: attempt.id,
              channel: proof.channel,
              decision,
              outcome: proof.outcome,
              amountVnd: proof.amountVnd,
              ...(correlationConflict === undefined ? {} : { conflictReason: correlationConflict }),
            },
          },
        });
        return Object.freeze({ evidence: toEvidence(stored), replayed: false });
      });
    },
    getTerminalEvidence(bookingId, paymentAttemptId, context) {
      return enlisted(bookingId, context, async (client) => {
        const attempt = await requireAttempt(client, bookingId, paymentAttemptId);
        if (attempt.terminalEvidenceId === null) return null;
        const stored = await client.billingProviderEvidence.findUnique({
          where: { id: attempt.terminalEvidenceId },
        });
        // Forward migration never fabricates proof for historical attempts.
        return stored === null ? null : toEvidence(stored);
      });
    },
  });
}
function sameSettlement(stored: BillingProviderEvidence, proof: ProviderEvidence) {
  return (
    stored.outcome === proof.outcome &&
    stored.transactionId === proof.transactionId &&
    Number(stored.amountVnd) === proof.amountVnd &&
    (stored.settledAt?.toISOString() ?? null) === proof.settledAt
  );
}
function toEvidence(stored: BillingProviderEvidence): StoredProviderEvidence {
  const proof = evidenceSchema.parse({
    paymentAttemptId: stored.paymentAttemptId,
    merchantCode: stored.merchantCode,
    transactionId: stored.transactionId,
    channel: stored.channel,
    payloadHash: stored.payloadHash,
    amountVnd: Number(stored.amountVnd),
    outcome: stored.outcome,
    settledAt: stored.settledAt?.toISOString() ?? null,
  });
  return Object.freeze({
    ...proof,
    id: stored.id,
    decision: z.enum(['ACCEPTED', 'CONFLICT', 'AMOUNT_MISMATCH']).parse(stored.decision),
  });
}
