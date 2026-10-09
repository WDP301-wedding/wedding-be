import { randomUUID } from 'node:crypto';
import { CATALOG_SEED_IDS, seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import type { VnpayStatusGateway } from '../../../src/modules/payments-billing/application/vnpay.port.js';
import { createPayableBooking } from './deposit-fixture.js';
import { controlledVnpay } from './vnpay-fixture.js';

export async function seedBillingManager(prisma: PrismaClient) {
  await seedVenueCatalog(prisma);
  await prisma.account.create({
    data: {
      id: CATALOG_SEED_IDS.actor,
      emailNormalized: 'billing-manager@example.com',
      displayEmail: 'billing-manager@example.com',
      roles: { create: { role: 'MANAGER' } },
    },
  });
}
export async function createManualBillingFixture(
  prisma: PrismaClient,
  gateway: VnpayStatusGateway = { query: () => Promise.reject(new Error('controlled timeout')) },
) {
  const f = await createPayableBooking(prisma);
  const providers = createPaymentsBillingProviders(prisma, { vnpay: controlledVnpay, gateway });
  const manager = { ...f.context, actorAccountId: CATALOG_SEED_IDS.actor };
  const deposit = {
    bookingId: f.bookingId,
    commandId: randomUUID(),
    purpose: 'DEPOSIT' as const,
    timelineRevisionId: f.timelineRevisionId,
    amountVnd: 15_000_000,
    settledAt: '2026-10-08T16:00:00Z',
    reason: 'Sensitive deposit receipt',
    evidenceReference: 'PRIVATE-DEPOSIT-RECEIPT',
  };
  return {
    ...f,
    providers,
    manager,
    deposit,
    operations: providers.operations,
    vnpay: providers.vnpay!,
    balance: { bookingId: f.bookingId, commandId: randomUUID(), expectedBillingRevision: 2 },
  };
}
