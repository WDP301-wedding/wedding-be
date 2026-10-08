import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../../src/core/errors/app-error.js';
import type {
  BillingReader,
  BillingReportingReader,
  ContractContext,
  SourcePage,
  BillingReportRow,
} from '../../../src/modules/payments-billing/application/payments-billing.providers.js';
import { sourceQuerySchema } from '../../../src/modules/payments-billing/application/payments-billing.providers.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';

type Fixture = {
  bookingId: string;
  emptyBookingId: string;
  paymentId: string;
  full: ContractContext;
  restricted: ContractContext;
  foreign: ContractContext;
  manager: ContractContext;
  reader(context: ContractContext): BillingReader;
  reporting: BillingReportingReader;
  afterSequence: number;
  throughSequence: number;
};
function denial(status: number, code: string) {
  return new AppError({ status, code, message: 'Controlled contract denial.' });
}
function fakeFixture(): Fixture {
  const bookingId = randomUUID(),
    emptyBookingId = randomUUID(),
    paymentId = randomUUID();
  const context = (account: string): ContractContext => ({
    actorAccountId: account,
    authority: 'AUTHENTICATED',
    requestId: randomUUID(),
    causationId: randomUUID(),
  });
  const full = context(randomUUID()),
    restricted = context(randomUUID()),
    foreign = context(randomUUID()),
    manager = context(randomUUID());
  const totals = {
    acceptedChargesVnd: 50_000_000,
    paidVnd: 15_000_000,
    refundedVnd: 0,
    outstandingVnd: 35_000_000,
  };
  const base = {
    ledgerEntryId: randomUUID(),
    kind: 'CHARGE' as const,
    amountVnd: 50_000_000,
    occurredAt: '2026-10-08T16:00:00.000Z',
    sourceRevisionId: randomUUID(),
  };
  const payment = {
    ledgerEntryId: paymentId,
    kind: 'PAYMENT' as const,
    amountVnd: 15_000_000,
    occurredAt: '2026-10-08T16:00:00.000Z',
    sourceRevisionId: randomUUID(),
  };
  const report: BillingReportRow = { bookingId, ...totals, creditVnd: 0, ledger: [base, payment] };
  const rows = [1, 2].map((sequence) => ({
    recordId: bookingId,
    sequence,
    changedAt: '2026-10-08T16:00:00.000Z',
    value:
      sequence === 1
        ? { ...report, paidVnd: 0, outstandingVnd: 50_000_000, ledger: [base] }
        : report,
  }));
  return {
    bookingId,
    emptyBookingId,
    paymentId,
    full,
    restricted,
    foreign,
    manager,
    afterSequence: 0,
    throughSequence: 2,
    reader(actor) {
      function authorize(id: string) {
        if (actor.authority !== 'AUTHENTICATED') throw denial(403, 'FORBIDDEN');
        if (id !== bookingId && id !== emptyBookingId) throw denial(404, 'NOT_FOUND');
        if (actor.actorAccountId === manager.actorAccountId) return;
        if (actor.actorAccountId === restricted.actorAccountId) throw denial(403, 'FORBIDDEN');
        if (actor.actorAccountId !== full.actorAccountId || id !== bookingId)
          throw denial(404, 'NOT_FOUND');
      }
      return Object.freeze<BillingReader>({
        getBookingReceivables(id) {
          return Promise.resolve().then(() => {
            authorize(id);
            return id === bookingId
              ? Object.freeze(totals)
              : Object.freeze({
                  acceptedChargesVnd: 0,
                  paidVnd: 0,
                  refundedVnd: 0,
                  outstandingVnd: 0,
                });
          });
        },
        requireDepositSettlement(id) {
          return Promise.resolve().then(() => {
            authorize(id);
            if (id === emptyBookingId) throw denial(409, 'DEPOSIT_NOT_SETTLED');
            return Object.freeze({
              paymentId,
              amountVnd: 15_000_000,
              settledAt: new Date('2026-10-08T16:00:00Z'),
            });
          });
        },
      });
    },
    reporting: Object.freeze<BillingReportingReader>({
      readPage(query, actor) {
        return Promise.resolve().then(() => {
          if (
            actor.authority !== 'AUTHENTICATED' ||
            actor.actorAccountId !== manager.actorAccountId
          )
            throw denial(403, 'FORBIDDEN');
          const input = sourceQuerySchema.parse(query);
          const throughSequence = input.throughSequence ?? 2;
          let sequence = input.afterSequence;
          if (throughSequence > 2 || input.afterSequence > throughSequence)
            throw denial(422, 'VALIDATION_ERROR');
          if (input.cursor !== undefined) {
            try {
              const cursor = z
                .strictObject({
                  afterSequence: z.int().nonnegative(),
                  throughSequence: z.int().nonnegative(),
                  sequence: z.int().nonnegative(),
                })
                .parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
              if (
                cursor.afterSequence !== input.afterSequence ||
                cursor.throughSequence !== throughSequence ||
                cursor.sequence < sequence ||
                cursor.sequence > throughSequence
              )
                throw new Error('invalid fence');
              sequence = cursor.sequence;
            } catch {
              throw denial(422, 'VALIDATION_ERROR');
            }
          }
          const remaining = rows.filter(
            (row) => row.sequence > sequence && row.sequence <= throughSequence,
          );
          const page = remaining.slice(0, input.limit);
          return Object.freeze<SourcePage<BillingReportRow>>({
            throughSequence,
            nextCursor:
              remaining.length <= input.limit
                ? null
                : Buffer.from(
                    JSON.stringify({
                      afterSequence: input.afterSequence,
                      throughSequence,
                      sequence: page.at(-1)!.sequence,
                    }),
                  ).toString('base64url'),
            rows: Object.freeze(page),
          });
        });
      },
    }),
  };
}
function conformance(get: () => Fixture) {
  it('returns the baseline deposit proof and four receivable totals without internal evidence', async () => {
    const f = get(),
      reader = f.reader(f.full);
    expect(await reader.requireDepositSettlement(f.bookingId)).toEqual({
      paymentId: f.paymentId,
      amountVnd: 15_000_000,
      settledAt: new Date('2026-10-08T16:00:00Z'),
    });
    expect(await reader.getBookingReceivables(f.bookingId)).toEqual({
      acceptedChargesVnd: 50_000_000,
      paidVnd: 15_000_000,
      refundedVnd: 0,
      outstandingVnd: 35_000_000,
    });
    expect(await f.reader(f.manager).getBookingReceivables(f.emptyBookingId)).toEqual({
      acceptedChargesVnd: 0,
      paidVnd: 0,
      refundedVnd: 0,
      outstandingVnd: 0,
    });
    await expect(
      f.reader(f.manager).requireDepositSettlement(f.emptyBookingId),
    ).rejects.toMatchObject({ code: 'DEPOSIT_NOT_SETTLED' });
  });
  it('denies restricted access, conceals foreign resources and rejects unknown bookings', async () => {
    const f = get();
    await expect(
      f.reader(f.restricted).getBookingReceivables(f.emptyBookingId),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(f.reader(f.foreign).requireDepositSettlement(f.bookingId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.reader(f.manager).getBookingReceivables(randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });
  it('returns ordered safe fixed-fence report rows and empty pages, with current Manager authorization', async () => {
    const f = get();
    const page = await f.reporting.readPage(
      { afterSequence: f.afterSequence, throughSequence: f.throughSequence, limit: 500 },
      f.manager,
    );
    expect(page.rows.map((row) => row.sequence)).toEqual([
      f.afterSequence + 1,
      f.afterSequence + 2,
    ]);
    expect(page.rows.at(-1)?.value).toMatchObject({
      bookingId: f.bookingId,
      paidVnd: 15_000_000,
      outstandingVnd: 35_000_000,
    });
    expect(JSON.stringify(page)).not.toMatch(
      /reason|evidenceReference|Sensitive|PRIVATE-|Bank|Card|vnp_/u,
    );
    const first = await f.reporting.readPage(
      { afterSequence: f.afterSequence, throughSequence: f.throughSequence, limit: 1 },
      f.manager,
    );
    expect(first.nextCursor).not.toBeNull();
    const second = await f.reporting.readPage(
      {
        afterSequence: f.afterSequence,
        throughSequence: f.throughSequence,
        cursor: first.nextCursor!,
        limit: 1,
      },
      f.manager,
    );
    expect(second.rows[0]?.sequence).toBe(f.throughSequence);
    expect(second.nextCursor).toBeNull();
    await expect(
      f.reporting.readPage(
        {
          afterSequence: f.afterSequence,
          throughSequence: f.throughSequence,
          cursor: 'invalid',
          limit: 1,
        },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      await f.reporting.readPage({ afterSequence: f.throughSequence, limit: 1 }, f.manager),
    ).toEqual({ throughSequence: f.throughSequence, nextCursor: null, rows: [] });
    await expect(
      f.reporting.readPage({ afterSequence: 0, limit: 1 }, f.full),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.reporting.readPage(
        { afterSequence: 0, throughSequence: f.throughSequence + 100, limit: 1 },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
}
describe('Billing produced readers: conforming controlled fake', () => {
  const f = fakeFixture();
  conformance(() => f);
});
const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('Billing produced readers: real PostgreSQL/Booking/Identity conformance', () => {
  const database = new CatalogTestDatabase('billing_readers_conformance');
  let f: Fixture;
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
    const payable = await createManualBillingFixture(database.prisma);
    const empty = await createManualBillingFixture(database.prisma);
    const counter = await database.prisma.billingReportingSequence.findUniqueOrThrow({
      where: { owner: 'billing' },
    });
    const payment = await payable.operations.recordManualPayment(payable.deposit, payable.manager);
    f = {
      bookingId: payable.bookingId,
      emptyBookingId: empty.bookingId,
      paymentId: payment.resourceId,
      full: payable.context,
      restricted: empty.context,
      foreign: empty.context,
      manager: payable.manager,
      reader: payable.providers.views.reader,
      reporting: payable.providers.reporting,
      afterSequence: counter.value,
      throughSequence: counter.value + 2,
    };
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  conformance(() => f);
});
