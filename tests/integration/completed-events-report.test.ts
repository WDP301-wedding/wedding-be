import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { createCompletedEventsReader } from '../../src/modules/analytics-dashboard/infrastructure/completed-events.reader.js';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createAnalyticsRouter } from '../../src/modules/analytics-dashboard/http/analytics.router.js';
import type { AuthenticatedActor } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('completed invoice dashboard SQL', () => {
  const database = new CatalogTestDatabase('completed_dashboard');
  const hallA = randomUUID(),
    hallB = randomUUID(),
    menu = randomUUID(),
    service = randomUUID();
  const date = '2026-11-08';
  const query = { dateFrom: date, dateTo: date };
  beforeAll(async () => database.connect(), 60000);
  afterAll(async () => database.disconnect());
  async function publish(owner: string, id: string, value: object) {
    await database.prisma
      .$executeRaw`SELECT reporting_publish(${owner},${id},${JSON.stringify(value)}::jsonb)`;
  }
  async function event(
    hallId: string,
    phase: string,
    invoice: number | null,
    paid: number,
    total: number,
    customerName = 'Lan',
  ) {
    const id = randomUUID();
    const lines = [
      {
        category: 'MENU',
        sourceId: menu,
        sourceRevisionId: randomUUID(),
        name: 'Gói Sen',
        unit: 'bàn',
        quantity: 10,
        lineTotalVnd: total - 20,
      },
      {
        category: 'SERVICE',
        sourceId: service,
        sourceRevisionId: randomUUID(),
        name: 'MC tiệc cưới',
        unit: 'buổi',
        quantity: 1,
        lineTotalVnd: 20,
      },
    ];
    await publish('booking', id, {
      bookingId: id,
      bookingCode: 'HY-000001',
      customerName,
      eventDate: date,
      hallId,
      hallNameSnapshot: hallId === hallA ? 'Sảnh A' : 'Sảnh B',
      phase,
      effectiveAgreedTotalVnd: total,
      originalContractTotalVnd: 100,
      baseChargeVnd: 100,
      commercialLines: lines,
    });
    await publish('billing', id, {
      bookingId: id,
      acceptedChargesVnd: invoice ?? total,
      paidVnd: paid,
      refundedVnd: 0,
      outstandingVnd: Math.max((invoice ?? total) - paid, 0),
      creditVnd: Math.max(paid - (invoice ?? total), 0),
      finalInvoiceRevisionId: invoice === null ? null : randomUUID(),
      finalInvoiceTotalVnd: invoice,
      finalCommercialLines: invoice === null ? [] : lines,
      ledger: [],
    });
    return id;
  }
  it('counts only completed events, separates provisional money, groups revisions and filters debt before paging', async () => {
    const paid = await event(hallA, 'COMPLETED', 80, 80, 80);
    await event(hallA, 'COMPLETED', null, 15, 50);
    await event(hallB, 'COMPLETED', 110, 30, 100);
    await event(hallB, 'CONFIRMED', 999, 999, 999);
    await event(hallB, 'CANCELLED', 999, 999, 999);
    const reader = createCompletedEventsReader(database.prisma);
    const all = await reader(query);
    expect(all.summary).toMatchObject({
      completedCount: 3,
      finalizedCount: 2,
      provisionalCount: 1,
      revenueVnd: 190,
      provisionalTotalVnd: 50,
      netPaidVnd: 125,
      outstandingVnd: 115,
      unallocatedRevenueVnd: 10,
    });
    expect(all.halls.find((h) => h.hallId === hallA)).toMatchObject({
      bookingCount: 2,
      revenueVnd: 80,
    });
    expect(all.halls.find((h) => h.hallId === hallB)).toMatchObject({
      bookingCount: 1,
      revenueVnd: 110,
    });
    expect(all.offerings.filter((o) => o.sourceId === menu)).toHaveLength(1);
    expect(all.offerings.find((o) => o.sourceId === menu)).toMatchObject({
      bookingCount: 3,
      quantity: 30,
      revenueVnd: 140,
    });
    expect(
      (await reader({ ...query, paymentStatus: 'PAID', pageSize: 1 })).items.map(
        (i) => i.bookingId,
      ),
    ).toEqual([paid]);
    const debt = await reader({ ...query, paymentStatus: 'DEBT', pageSize: 1 });
    expect(debt.total).toBe(2);
    expect(debt.totalPages).toBe(2);
    expect(debt.items).toHaveLength(1);
    expect((await reader({ ...query, paymentStatus: 'DEBT', pageSize: 1, page: 99 })).page).toBe(2);
  });
  it('keeps missing financial sources unknown and refuses to call an unfinalized paid event PAID', async () => {
    await event(hallA, 'COMPLETED', null, 100, 100);
    const id = randomUUID();
    await publish('booking', id, {
      bookingId: id,
      bookingCode: 'HY-000099',
      customerName: 'Chưa đồng bộ',
      eventDate: date,
      hallId: hallB,
      hallNameSnapshot: 'Sảnh B',
      phase: 'COMPLETED',
      baseChargeVnd: 50,
      commercialLines: [],
    });
    const all = await createCompletedEventsReader(database.prisma)(query);
    expect(all.meta.status).toBe('SOURCE_NOT_READY');
    expect(all.summary.netPaidVnd).toBeNull();
    expect(all.items.find((i) => i.bookingId === id)).toMatchObject({
      invoiceState: 'SOURCE_NOT_READY',
      paymentStatus: 'UNKNOWN',
      netPaidVnd: null,
      outstandingVnd: null,
    });
    expect(all.items.some((i) => i.paymentStatus === 'PENDING_INVOICE')).toBe(true);
  });
  it('uses current invoice adjustments and net refunds without counting historical revisions twice', async () => {
    const id = await event(hallB, 'COMPLETED', 100, 100, 100, 'Điều chỉnh');
    const line = {
      category: 'MENU',
      sourceId: menu,
      sourceRevisionId: randomUUID(),
      name: 'Menu đã giảm',
      unit: 'bàn',
      quantity: 10,
      lineTotalVnd: 80,
    };
    await publish('billing', id, {
      bookingId: id,
      acceptedChargesVnd: 80,
      paidVnd: 100,
      refundedVnd: 20,
      outstandingVnd: 0,
      creditVnd: 0,
      finalInvoiceRevisionId: randomUUID(),
      finalInvoiceTotalVnd: 80,
      finalCommercialLines: [line],
      ledger: [],
    });
    const result = await createCompletedEventsReader(database.prisma)({
      ...query,
      q: 'Điều chỉnh',
      paymentStatus: 'PAID',
    });
    expect(result.total).toBe(1);
    expect(result.summary).toMatchObject({
      revenueVnd: 80,
      netPaidVnd: 80,
      outstandingVnd: 0,
      creditVnd: 0,
      unallocatedRevenueVnd: 0,
    });
    expect(result.offerings[0]).toMatchObject({ bookingCount: 1, revenueVnd: 80 });
  });
  it('requires Manager authority, rejects broad dates and rechecks revoked roles before returning', async () => {
    let revoked = false;
    const resolver = {
      resolve: (token: string): Promise<AuthenticatedActor> =>
        Promise.resolve({
          accountId: randomUUID(),
          sessionId: randomUUID(),
          displayEmail: 'manager@example.test',
          roles: token === 'manager' && !revoked ? ['MANAGER'] : ['STAFF'],
        }),
    };
    const read = createCompletedEventsReader(database.prisma);
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes(server) {
        server.use(
          '/api/v1',
          createAnalyticsRouter(
            {} as never,
            resolver,
            () => Promise.resolve(),
            async (value) => {
              const data = await read(value);
              if ((value as { q?: string }).q === 'revoke') revoked = true;
              return data;
            },
          ),
        );
      },
    });
    const path = `/api/v1/management/analytics/completed-events?dateFrom=${date}&dateTo=${date}`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).auth('staff', { type: 'bearer' })).status).toBe(403);
    const result = await request(app).get(path).auth('manager', { type: 'bearer' });
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(
      (
        await request(app)
          .get(
            '/api/v1/management/analytics/completed-events?dateFrom=2026-01-01&dateTo=2027-12-31',
          )
          .auth('manager', { type: 'bearer' })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .get(path + '&q=revoke')
          .auth('manager', { type: 'bearer' })
      ).status,
    ).toBe(403);
  });
  it('does not let a retained legacy invoice override later ledger credits', async () => {
    const id = await event(hallA, 'COMPLETED', 100, 80, 100, 'Legacy credit');
    await publish('billing', id, {
      bookingId: id,
      acceptedChargesVnd: 80,
      paidVnd: 80,
      refundedVnd: 0,
      outstandingVnd: 0,
      creditVnd: 0,
      finalInvoiceRevisionId: randomUUID(),
      finalInvoiceTotalVnd: 100,
      finalCommercialLines: [],
      ledger: [],
    });
    const result = await createCompletedEventsReader(database.prisma)({
      ...query,
      q: 'Legacy credit',
      paymentStatus: 'PAID',
    });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      totalVnd: 80,
      netPaidVnd: 80,
      outstandingVnd: 0,
      paymentStatus: 'PAID',
    });
    expect(result.summary.revenueVnd).toBe(100);
  });
});
