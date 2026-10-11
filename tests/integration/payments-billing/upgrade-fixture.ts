import { basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import type { createPayableBooking } from './deposit-fixture.js';
import { createVnpayProtocol } from '../../../src/modules/payments-billing/infrastructure/vnpay.protocol.js';
import { controlledVnpay, ipnFixture } from './vnpay-fixture.js';

// Explicit historical columns: the latest generated client otherwise selects
// commercial columns which do not exist before the migrations under rehearsal.
export const legacyAttemptSelect = {
  id: true,
  bookingId: true,
  commandId: true,
  purpose: true,
  provider: true,
  amountVnd: true,
  timelineRevisionId: true,
  state: true,
  terminalEvidenceId: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
export const legacyOutboxSelect = {
  id: true,
  ledgerEntryId: true,
  eventType: true,
  eventVersion: true,
  correlationId: true,
  causationId: true,
  aggregateId: true,
  aggregateRevision: true,
  occurredAt: true,
  payload: true,
  publishedAt: true,
  attemptCount: true,
} as const;

// Seed the historical schema directly, without running today's application on
// yesterday's schema. Actual PostgreSQL constraints/triggers remain enabled.
export async function seedLegacyBillingHistory(
  prisma: PrismaClient,
  f: Awaited<ReturnType<typeof createPayableBooking>>,
  stage: 'W2' | 'W3' | 'W4',
) {
  const attemptId = randomUUID(),
    paymentId = randomUUID(),
    evidenceId = randomUUID();
  const createdAt = new Date(),
    expiresAt = new Date(createdAt.getTime() + 900_000);
  const settledAt = stage === 'W4' ? new Date('2026-10-08T14:00:00Z') : createdAt;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "BillingPaymentAttempt" ("id","bookingId","commandId","purpose","provider","amountVnd","timelineRevisionId","createdAt","updatedAt","expiresAt")
      VALUES (${attemptId}::uuid,${f.bookingId}::uuid,${randomUUID()}::uuid,'DEPOSIT','VNPAY',15000000,${f.timelineRevisionId}::uuid,${createdAt},${createdAt},${expiresAt})`;
    await tx.$executeRaw`UPDATE "BillingPaymentAttempt" SET "state"='PENDING' WHERE "id"=${attemptId}::uuid`;
    if (stage === 'W4') {
      const protocol = createVnpayProtocol(controlledVnpay);
      const { parameters } = protocol.createCheckout(
        {
          id: attemptId,
          bookingId: f.bookingId,
          commandId: randomUUID(),
          purpose: 'DEPOSIT',
          provider: 'VNPAY',
          amountVnd: 15000000,
          timelineRevisionId: f.timelineRevisionId,
          state: 'PENDING',
          terminalEvidenceId: null,
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
        '127.0.0.1',
      );
      await tx.billingVnpayCheckout.create({ data: { paymentAttemptId: attemptId, parameters } });
      const proof = protocol.verifyIpn(ipnFixture(attemptId));
      await tx.billingProviderEvidence.create({
        data: {
          id: evidenceId,
          paymentAttemptId: attemptId,
          merchantCode: proof.merchantCode,
          transactionId: proof.transactionId,
          channel: 'IPN',
          payloadHash: proof.payloadHash,
          amountVnd: proof.amountVnd,
          outcome: 'SUCCEEDED',
          settledAt,
          decision: 'ACCEPTED',
        },
      });
      await tx.billingProviderTransaction.create({
        data: {
          merchantCode: proof.merchantCode,
          transactionId: proof.transactionId,
          paymentAttemptId: attemptId,
          evidenceId,
        },
      });
    }
    await tx.$executeRaw`UPDATE "BillingPaymentAttempt" SET "state"='SUCCEEDED',"terminalEvidenceId"=${evidenceId}::uuid WHERE "id"=${attemptId}::uuid`;
    if (stage !== 'W2') {
      const original = await tx.bookingProposalSnapshot.findUniqueOrThrow({
        where: { bookingId: f.bookingId },
        select: { commercialAcceptedAt: true },
      });
      await tx.$executeRaw`INSERT INTO "BillingLedgerEntry" ("id","bookingId","revision","kind","sourceType","sourceRevisionId","amountVnd","occurredAt")
        VALUES (${randomUUID()}::uuid,${f.bookingId}::uuid,1,'CHARGE','BASE_BOOKING',${f.commercialRevisionId}::uuid,50000000,${original.commercialAcceptedAt})`;
    }
    await tx.$executeRaw`INSERT INTO "BillingLedgerEntry" ("id","bookingId","revision","kind","sourceType","sourceRevisionId","paymentAttemptId","amountVnd","occurredAt")
      VALUES (${paymentId}::uuid,${f.bookingId}::uuid,1,'PAYMENT','PAYMENT_ATTEMPT',${attemptId}::uuid,${attemptId}::uuid,15000000,${settledAt})`;
    const ledger = await tx.billingLedgerEntry.findMany({
      where: { bookingId: f.bookingId },
      orderBy: { revision: 'asc' },
    });
    for (const entry of ledger) {
      await tx.auditLog.create({
        data: {
          requestId: randomUUID(),
          actorType: 'SYSTEM',
          action: 'billing.ledger-appended',
          entityType: 'billing-ledger',
          entityId: entry.id,
          metadata: {
            bookingId: f.bookingId,
            ledgerEntryId: entry.id,
            billingRevision: entry.revision,
          },
        },
      });
      await tx.billingOutboxEvent.create({
        select: { id: true },
        data: {
          id: randomUUID(),
          ledgerEntryId: entry.id,
          eventType:
            entry.kind === 'PAYMENT'
              ? 'billing.payment-succeeded'
              : 'billing.receivable-charge-accepted',
          correlationId: randomUUID(),
          aggregateId: f.bookingId,
          aggregateRevision: entry.revision,
          occurredAt: entry.occurredAt,
          payload: { bookingId: f.bookingId, ledgerEntryId: entry.id },
        },
      });
    }
    if (stage !== 'W2') {
      await tx.$executeRaw`UPDATE "Booking" SET "phase"='AWAITING_DEPOSIT',"revision"="revision"+1 WHERE "id"=${f.bookingId}::uuid`;
      await tx.$executeRaw`INSERT INTO "BookingDepositIntent" ("id","bookingId","timelineRevisionId","amountVnd","bookingRevisionReserved","coupleAccountId","requestId","expiresAt","updatedAt")
        VALUES (${attemptId}::uuid,${f.bookingId}::uuid,${f.timelineRevisionId}::uuid,15000000,2,${f.accountId}::uuid,${randomUUID()}::uuid,${expiresAt},${createdAt})`;
      await tx.$executeRaw`UPDATE "BookingDepositIntent" SET "status"='SETTLED',"settledAt"=${settledAt} WHERE "id"=${attemptId}::uuid`;
      await tx.$executeRaw`INSERT INTO "BookingDepositSettlement" ("paymentId","bookingId","timelineRevisionId","amountVnd","settledAt","promotionStatus","promotedAt")
        VALUES (${paymentId}::uuid,${f.bookingId}::uuid,${f.timelineRevisionId}::uuid,15000000,${settledAt},'SUCCEEDED',${createdAt})`;
      await tx.bookingSlotHold.updateMany({
        where: { bookingId: f.bookingId },
        data: { status: 'CONSUMED', depositIntentPin: 'SETTLED', terminalAt: settledAt },
      });
      await tx.bookingTimelineRevision.update({
        where: { id: f.timelineRevisionId },
        data: { state: 'EFFECTIVE' },
      });
      await tx.booking.update({
        where: { id: f.bookingId },
        data: {
          phase: 'CONFIRMED',
          effectiveTimelineRevisionId: f.timelineRevisionId,
          revision: { increment: 1 },
        },
      });
      await tx.consultationAccess.updateMany({
        where: { consultationId: f.consultationId, accountId: f.accountId },
        data: { level: 'FULL', sourcePaymentId: paymentId, promotedAt: createdAt },
      });
      await tx.accountRole.create({ data: { accountId: f.accountId, role: 'COUPLE' } });
      await tx.billingDepositApplication.create({ data: { paymentId, appliedAt: createdAt } });
      await tx.bookingOutboxEvent.create({
        data: {
          id: randomUUID(),
          eventType: 'booking.confirmed',
          correlationId: randomUUID(),
          aggregateId: f.bookingId,
          aggregateRevision: 3,
          occurredAt: settledAt,
          payload: { bookingId: f.bookingId },
        },
      });
    }
  });
  return { paymentId, attemptId };
}

// Production already has main's account/OTP/commercial migrations. Applying
// older, unapplied billing migrations must preserve that existing history too.
export function mainBeforeBillingMigrations(paths: readonly string[]): readonly string[] {
  const billing = (path: string) =>
    /_(?:payments_billing_ledger|billing_deposit_application|vnpay_provider_evidence|billing_operations_reporting)$/u.test(
      basename(dirname(path)),
    );
  // SPEC-05 print reporting depends on the accepted Billing ledger. These new
  // migrations were not part of the pre-Billing production history.
  const invitationPrint = (path: string) =>
    /_(?:invitation_design_publication_printable|invitation_print_order_and_billing|invitation_reporting_snapshots|print_commercial_offerings|billing_contract_source|commercial_contracts)$/u.test(
      basename(dirname(path)),
    );
  // Commercial extensions and all later migrations build on the Billing/print
  // schema; they cannot be moved into this synthetic pre-Billing checkpoint.
  const afterBilling = (path: string) =>
    invitationPrint(path) || basename(dirname(path)) >= '20261011019000';
  return [
    ...paths.filter((path) => !billing(path) && !afterBilling(path)),
    ...paths.filter(billing),
    ...paths.filter(afterBilling),
  ];
}
