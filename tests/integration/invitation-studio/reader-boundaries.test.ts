import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import { PrismaInvitationAutomationReader } from '../../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';
import { PrismaInvitationReportingReader } from '../../../src/modules/invitation-studio/infrastructure/prisma-reporting.reader.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
const system = {
  requestId: randomUUID(),
  causationId: randomUUID(),
  actorAccountId: null,
  authority: 'SYSTEM' as const,
};
databaseDescribe('Invitation reader and billing transaction boundaries', () => {
  const database = new CatalogTestDatabase('invitation_reader_boundaries');
  beforeAll(() => database.connect(), 60_000);
  afterAll(() => database.disconnect(), 60_000);

  it('returns empty pages for empty sources, malformed cursors and unauthenticated authority', async () => {
    const automation = new PrismaInvitationAutomationReader(database.prisma);
    const reporting = new PrismaInvitationReportingReader(database.prisma);
    const dueBefore = new Date().toISOString();
    expect(
      await automation.listMediaCutoffs({ dueBefore, limit: 20, cursor: 'not-json' }, system),
    ).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      await reporting.readPage({ afterSequence: 0, limit: 100, cursor: 'not-json' }, system),
    ).toEqual({
      rows: [],
      nextCursor: null,
      throughSequence: 0,
    });
    const unauthenticated = { ...system, authority: 'AUTHENTICATED' as const };
    expect(
      (await automation.listMediaCutoffs({ dueBefore, limit: 20 }, unauthenticated)).items,
    ).toEqual([]);
    expect(
      (await reporting.readPage({ afterSequence: 0, limit: 100 }, unauthenticated)).rows,
    ).toEqual([]);
    expect(
      (
        await automation.listMediaCutoffs(
          { dueBefore, limit: 20 },
          { ...system, purpose: 'wrong-purpose' },
        )
      ).items,
    ).toEqual([]);
    expect(
      (
        await reporting.readPage(
          { afterSequence: 0, limit: 100, throughSequence: 7 },
          { ...system, purpose: 'wrong-purpose' },
        )
      ).throughSequence,
    ).toBe(7);
  });

  it('uses stable cutoff cursors while excluding bookings with no current full-access couple', async () => {
    const first = await studioFixture(database.prisma);
    const second = await studioFixture(database.prisma);
    const missingAccess = await studioFixture(database.prisma);
    await database.prisma.consultationAccess.deleteMany({
      where: { bookingId: missingAccess.bookingId },
    });
    const cutoff = new Date(Date.now() - 86_400_000);
    for (const f of [first, second, missingAccess])
      await database.prisma.invitationMediaPolicy.upsert({
        where: { bookingId: f.bookingId },
        create: { bookingId: f.bookingId, revision: 1, cutoffAt: cutoff },
        update: { cutoffAt: cutoff },
      });
    const dueBefore = new Date().toISOString();
    const reader = first.services.automation;
    const page = await reader.listMediaCutoffs(
      { dueBefore, limit: 1 },
      { ...system, purpose: 'automation:media-cutoff' },
    );
    expect(page.nextCursor).not.toBeNull();
    const rest = await reader.listMediaCutoffs(
      { dueBefore, limit: 100, cursor: page.nextCursor! },
      { ...first.contract, purpose: 'notifications:media-cutoff' },
    );
    expect(new Set([...page.items, ...rest.items].map((row) => row.bookingId))).toEqual(
      new Set([first.bookingId, second.bookingId]),
    );
    expect(rest.nextCursor).toBeNull();
  });

  it('writes standalone charges to the canonical ledger and rolls back enlisted charges with the caller', async () => {
    const f = await studioFixture(database.prisma);
    const billing = f.services.billing;
    const sourceRevisionId = randomUUID();
    const input = {
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId,
      amountVnd: 20_000,
      acceptedAt: f.now,
    };
    const charge = await billing.registerAcceptedCharge(input);
    expect(await billing.registerAcceptedCharge(input)).toEqual({ ...charge, replayed: true });
    expect(await billing.getBookingReceivables(f.bookingId)).toEqual({
      acceptedChargesVnd: 20_000,
      paidVnd: 0,
      refundedVnd: 0,
      outstandingVnd: 20_000,
    });
    await expect(
      f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async (scoped) => {
        await billing.registerAcceptedCharge({
          ...input,
          sourceRevisionId: randomUUID(),
          amountVnd: 30_000,
        });
        await billing.registerCredit(
          {
            bookingId: f.bookingId,
            receivableChargeId: charge.receivableChargeId,
            sourceAdjustmentId: randomUUID(),
            amountVnd: 5_000,
            reason: 'PRINT_REPLACED',
            acceptedAt: f.now.toISOString(),
          },
          scoped,
        );
        expect((await billing.getBookingReceivables(f.bookingId)).acceptedChargesVnd).toBe(45_000);
        throw new Error('caller rolls back');
      }),
    ).rejects.toThrow('caller rolls back');
    expect((await billing.getBookingReceivables(f.bookingId)).acceptedChargesVnd).toBe(20_000);
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.bookingId } }),
    ).toBe(1);
    expect(
      await database.prisma.billingOutboxEvent.count({ where: { aggregateId: f.bookingId } }),
    ).toBe(1);
  });
});
