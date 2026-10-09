import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedVenueCatalog, CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createBookingBoundaryUnitOfWork } from '../../../src/core/database/booking-unit-of-work.js';
import { createBillingOperationsRepository } from '../../../src/modules/payments-billing/infrastructure/billing-operations.repository.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import { controlledVnpay, ipnFixture } from './vnpay-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('W5 immutable command storage and current account authorization', () => {
  const database = new CatalogTestDatabase('billing_operations_storage');
  beforeAll(async () => {
    await database.connect();
    await seedVenueCatalog(database.prisma);
    await database.prisma.account.create({
      data: {
        id: CATALOG_SEED_IDS.actor,
        emailNormalized: 'billing-manager@example.com',
        displayEmail: 'billing-manager@example.com',
        roles: { create: { role: 'MANAGER' } },
      },
    });
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  it('persists a command once, rejects unscoped access and rolls all evidence back together', async () => {
    const f = await createPayableBooking(database.prisma);
    const scope = createBookingBoundaryUnitOfWork(database.prisma);
    const repo = createBillingOperationsRepository(database.prisma, scope);
    const context = { ...f.context, actorAccountId: CATALOG_SEED_IDS.actor };
    const command = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      actorAccountId: context.actorAccountId,
      kind: 'INVOICE' as const,
      bodyHash: 'a'.repeat(64),
      result: { resourceId: randomUUID() },
    };
    await expect(async () => repo.saveCommand(command, context)).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION_SCOPE',
    });
    await scope.boundary.run({ bookingId: f.bookingId, context }, async (scoped) => {
      await repo.requireManager(f.bookingId, scoped);
      await repo.saveCommand(command, scoped);
      expect(await repo.findCommand(f.bookingId, command.commandId, scoped)).toEqual(command);
    });
    const other = await createPayableBooking(database.prisma);
    await expect(
      scope.boundary.run({ bookingId: other.bookingId, context }, async (scoped) => {
        await repo.requireManager(other.bookingId, scoped);
        return repo.findCommand(other.bookingId, command.commandId, scoped);
      }),
    ).rejects.toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    for (const operation of [
      database.prisma.billingOperationCommand.update({
        where: { commandId: command.commandId },
        data: { bodyHash: 'b'.repeat(64) },
      }),
      database.prisma.billingOperationCommand.delete({ where: { commandId: command.commandId } }),
    ])
      await expect(operation).rejects.toThrow();
    const rejected = { ...command, commandId: randomUUID() };
    await expect(
      scope.boundary.run({ bookingId: f.bookingId, context }, async (scoped) => {
        await repo.saveCommand(rejected, scoped);
        throw new Error('controlled rollback');
      }),
    ).rejects.toThrow('controlled rollback');
    expect(
      await database.prisma.billingOperationCommand.count({
        where: { commandId: rejected.commandId },
      }),
    ).toBe(0);
  });
  it('requires a current active Manager or own FULL grant; conceals unowned books', async () => {
    const f = await createPayableBooking(database.prisma);
    const scope = createBookingBoundaryUnitOfWork(database.prisma);
    const repo = createBillingOperationsRepository(database.prisma, scope);
    await expect(
      scope.boundary.run({ bookingId: f.bookingId, context: f.context }, (ctx) =>
        repo.requireManager(f.bookingId, ctx),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      scope.boundary.run({ bookingId: f.bookingId, context: f.context }, (ctx) =>
        repo.requireReadAccess(f.bookingId, ctx),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const providers = createPaymentsBillingProviders(database.prisma, { vnpay: controlledVnpay });
    const checkout = await providers.vnpay!.startCheckout(f.command, '127.0.0.1', f.context);
    expect((await providers.vnpay!.processIpn(ipnFixture(checkout.attempt.id))).RspCode).toBe('00');
    expect(
      await scope.boundary.run({ bookingId: f.bookingId, context: f.context }, (ctx) =>
        repo.requireReadAccess(f.bookingId, ctx),
      ),
    ).toEqual({ phase: 'CONFIRMED' });
    const other = await createPayableBooking(database.prisma);
    await expect(
      scope.boundary.run({ bookingId: other.bookingId, context: f.context }, (ctx) =>
        repo.requireReadAccess(other.bookingId, ctx),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      scope.boundary.run({ bookingId: f.bookingId, context: f.system }, (ctx) =>
        repo.requireReadAccess(f.bookingId, ctx),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
