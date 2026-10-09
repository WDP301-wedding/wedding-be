import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('Native print order state and list safety', () => {
  const database = new CatalogTestDatabase('print_safety');
  beforeAll(() => database.connect(), 60_000);
  afterAll(() => database.disconnect(), 60_000);

  async function setup() {
    const f = await studioFixture(database.prisma);
    const design = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    await f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: design.designId,
        expectedRevision: 1,
        designRevisionId: design.revisionId,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
    const orders = f.services.printOrders;
    const request = () =>
      orders.requestPrintOrder(
        f.bookingId,
        { lines: [{ designId: design.designId, quantity: 10 }] },
        randomUUID(),
        f.couple,
      );
    const requested = await request();
    const quotation = {
      expectedRevision: requested.revision,
      lines: [{ lineId: requested.lines[0]!.lineId, unitPriceVnd: 1_000 }],
      estimatedHandoverAt: new Date(f.now.getTime() + 86_400_000).toISOString(),
    };
    const quote = () =>
      orders.quotePrintOrder(requested.orderId, quotation, randomUUID(), f.manager);
    const approve = async () => {
      const quoted = await quote();
      return orders.approvePrintOrder(
        f.bookingId,
        quoted.orderId,
        {
          expectedRevision: quoted.revision,
          commercialRevisionId: quoted.currentCommercialRevisionId,
        },
        randomUUID(),
        f.couple,
      );
    };
    return { f, design, orders, request, requested, quotation, quote, approve };
  }

  it('returns not found for absent orders across every command and read', async () => {
    const { f, orders, quotation } = await setup();
    const missing = randomUUID();
    const revision = { expectedRevision: 1 };
    const commands = [
      () => orders.quotePrintOrder(missing, quotation, randomUUID(), f.manager),
      () => orders.startProduction(missing, revision, randomUUID(), f.manager),
      () => orders.markReadyForHandover(missing, revision, randomUUID(), f.manager),
      () =>
        orders.markHandedOver(
          missing,
          { ...revision, evidenceReference: 'receipt-1' },
          randomUUID(),
          f.manager,
        ),
      () =>
        orders.recordCancellationIntent(
          f.bookingId,
          missing,
          { ...revision, reason: 'Changed plans' },
          randomUUID(),
          f.couple,
        ),
      () => orders.cancelPrintOrder(null, missing, revision, randomUUID(), f.manager, 'MANAGER'),
      () => orders.proposeReplacement(missing, quotation, randomUUID(), f.manager),
      () =>
        orders.approvePrintOrder(
          f.bookingId,
          missing,
          { ...revision, commercialRevisionId: randomUUID() },
          randomUUID(),
          f.couple,
        ),
      () =>
        orders.approveReplacement(
          f.bookingId,
          missing,
          { ...revision, commercialRevisionId: randomUUID() },
          randomUUID(),
          f.couple,
        ),
      () => orders.getPrintOrder(f.bookingId, missing, f.couple),
    ];
    for (const command of commands) await expect(command()).rejects.toMatchObject({ status: 404 });
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
  });

  it('rejects stale revisions and premature transitions without changing the order', async () => {
    const { f, orders, requested, quotation } = await setup();
    const commands = [
      (expectedRevision: number) =>
        orders.startProduction(requested.orderId, { expectedRevision }, randomUUID(), f.manager),
      (expectedRevision: number) =>
        orders.markReadyForHandover(
          requested.orderId,
          { expectedRevision },
          randomUUID(),
          f.manager,
        ),
      (expectedRevision: number) =>
        orders.markHandedOver(
          requested.orderId,
          { expectedRevision, evidenceReference: 'receipt-1' },
          randomUUID(),
          f.manager,
        ),
      (expectedRevision: number) =>
        orders.recordCancellationIntent(
          f.bookingId,
          requested.orderId,
          { expectedRevision, reason: 'Changed plans' },
          randomUUID(),
          f.couple,
        ),
      (expectedRevision: number) =>
        orders.proposeReplacement(
          requested.orderId,
          { ...quotation, expectedRevision },
          randomUUID(),
          f.manager,
        ),
      (expectedRevision: number) =>
        orders.approvePrintOrder(
          f.bookingId,
          requested.orderId,
          { expectedRevision, commercialRevisionId: randomUUID() },
          randomUUID(),
          f.couple,
        ),
      (expectedRevision: number) =>
        orders.approveReplacement(
          f.bookingId,
          requested.orderId,
          { expectedRevision, commercialRevisionId: randomUUID() },
          randomUUID(),
          f.couple,
        ),
    ];
    for (const command of commands) {
      await expect(command(2)).rejects.toMatchObject({ code: 'PRINT_QUOTE_STALE' });
      await expect(command(1)).rejects.toMatchObject({ code: 'PRINT_ORDER_STATE_INVALID' });
    }
    await expect(
      orders.quotePrintOrder(
        requested.orderId,
        { ...quotation, expectedRevision: 2 },
        randomUUID(),
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'PRINT_QUOTE_STALE' });
    await expect(
      orders.cancelPrintOrder(
        f.bookingId,
        requested.orderId,
        { expectedRevision: 2 },
        randomUUID(),
        f.couple,
        'COUPLE',
      ),
    ).rejects.toMatchObject({ code: 'PRINT_QUOTE_STALE' });
    expect(await orders.getPrintOrder(f.bookingId, requested.orderId, f.couple)).toMatchObject({
      status: 'REQUESTED',
      revision: 1,
    });
  });

  it('rejects foreign identities and incomplete quotations without leaking or charging', async () => {
    const { f, orders, requested, quotation, quote } = await setup();
    await expect(
      orders.requestPrintOrder(
        f.bookingId,
        { lines: [{ designId: randomUUID(), quantity: 1 }] },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      orders.getPrintOrder(randomUUID(), requested.orderId, f.couple),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orders.cancelPrintOrder(
        randomUUID(),
        requested.orderId,
        { expectedRevision: 1 },
        randomUUID(),
        f.couple,
        'COUPLE',
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orders.quotePrintOrder(
        requested.orderId,
        { ...quotation, lines: [...quotation.lines, { lineId: randomUUID(), unitPriceVnd: 1 }] },
        randomUUID(),
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const quoted = await quote();
    await expect(
      orders.approvePrintOrder(
        f.bookingId,
        requested.orderId,
        { expectedRevision: quoted.revision, commercialRevisionId: randomUUID() },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'PRINT_QUOTE_STALE' });
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
  });

  it('paginates mixed requested, quoted and approved orders for couple and manager', async () => {
    const { f, orders, requested, quotation, request, approve } = await setup();
    const approved = await approve();
    const pending = await orders.proposeReplacement(
      approved.orderId,
      { ...quotation, expectedRevision: approved.revision },
      randomUUID(),
      f.manager,
    );
    const second = await request();
    const third = await request();
    await orders.quotePrintOrder(
      third.orderId,
      {
        ...quotation,
        expectedRevision: third.revision,
        lines: [{ lineId: third.lines[0]!.lineId, unitPriceVnd: 2_000 }],
      },
      randomUUID(),
      f.manager,
    );
    const ids = new Set([requested.orderId, second.orderId, third.orderId]);
    const first = await orders.listPrintOrders(f.bookingId, { limit: 1 }, f.couple);
    expect(first.nextCursor).not.toBeNull();
    const rest = await orders.listPrintOrders(
      f.bookingId,
      { limit: 10, cursor: first.nextCursor! },
      f.couple,
    );
    expect(new Set([...first.items, ...rest.items].map((o) => o.orderId))).toEqual(ids);
    expect(rest.nextCursor).toBeNull();
    const all = await orders.listPrintOrders(
      f.bookingId,
      { limit: 10, cursor: randomUUID() },
      f.couple,
    );
    expect(
      all.items.find((o) => o.orderId === approved.orderId)?.pendingReplacementProposal
        ?.commercialRevisionId,
    ).toBe(pending.pendingReplacementProposal?.commercialRevisionId);
    const management = await orders.listManagementPrintOrders(
      { bookingId: f.bookingId, limit: 1 },
      f.manager,
    );
    expect(management.nextCursor).not.toBeNull();
    const managementRest = await orders.listManagementPrintOrders(
      { bookingId: f.bookingId, cursor: management.nextCursor!, limit: 10 },
      f.manager,
    );
    expect(new Set([...management.items, ...managementRest.items].map((o) => o.orderId))).toEqual(
      ids,
    );
    const unfiltered = await orders.listManagementPrintOrders({ limit: 1 }, f.manager);
    const unfilteredRest = await orders.listManagementPrintOrders(
      { limit: 100, cursor: unfiltered.nextCursor! },
      f.manager,
    );
    expect(unfilteredRest.items.some((o) => ids.has(o.orderId))).toBe(true);
    expect(
      (await orders.getPrintOrder(null, approved.orderId, f.manager)).pendingReplacementProposal,
    ).not.toBeNull();
  });

  it('allows cancellation of unapproved orders but forbids repeated cancellation', async () => {
    const { f, orders, requested, quote, request } = await setup();
    const quoted = await quote();
    const cancelled = await orders.cancelPrintOrder(
      f.bookingId,
      quoted.orderId,
      { expectedRevision: quoted.revision, reason: 'Rework' },
      randomUUID(),
      f.couple,
      'COUPLE',
    );
    expect(cancelled.status).toBe('CANCELLED');
    await expect(
      orders.cancelPrintOrder(
        null,
        cancelled.orderId,
        { expectedRevision: cancelled.revision },
        randomUUID(),
        f.manager,
        'MANAGER',
      ),
    ).rejects.toMatchObject({ code: 'PRINT_CANCELLATION_NOT_ALLOWED' });
    await expect(
      orders.quotePrintOrder(
        requested.orderId,
        {
          expectedRevision: cancelled.revision,
          lines: [{ lineId: cancelled.lines[0]!.lineId, unitPriceVnd: 1_000 }],
          estimatedHandoverAt: new Date(f.now.getTime() + 86_400_000).toISOString(),
        },
        randomUUID(),
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'PRINT_ORDER_STATE_INVALID' });
    const fresh = await request();
    expect(
      (
        await orders.cancelPrintOrder(
          null,
          fresh.orderId,
          { expectedRevision: fresh.revision },
          randomUUID(),
          f.manager,
          'MANAGER',
        )
      ).status,
    ).toBe('CANCELLED');
  });

  it('requires a current couple cancellation intent and rejects missing replacement revisions', async () => {
    const { f, orders, approved, quotation } = await setup().then(async (s) => ({
      ...s,
      approved: await s.approve(),
    }));
    await expect(
      orders.cancelPrintOrder(
        f.bookingId,
        approved.orderId,
        { expectedRevision: approved.revision },
        randomUUID(),
        f.couple,
        'COUPLE',
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orders.cancelPrintOrder(
        null,
        approved.orderId,
        { expectedRevision: approved.revision },
        randomUUID(),
        f.manager,
        'MANAGER',
      ),
    ).rejects.toMatchObject({ code: 'PRINT_CANCELLATION_NOT_ALLOWED' });
    await expect(
      orders.approveReplacement(
        f.bookingId,
        approved.orderId,
        { expectedRevision: approved.revision, commercialRevisionId: randomUUID() },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orders.approveReplacement(
        f.bookingId,
        approved.orderId,
        {
          expectedRevision: approved.revision,
          commercialRevisionId: approved.currentCommercialRevisionId,
        },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'PRINT_QUOTE_STALE' });
    await expect(
      orders.proposeReplacement(
        approved.orderId,
        {
          ...quotation,
          expectedRevision: approved.revision,
          lines: [...quotation.lines, { lineId: randomUUID(), unitPriceVnd: 1 }],
        },
        randomUUID(),
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await orders.recordCancellationIntent(
      f.bookingId,
      approved.orderId,
      { expectedRevision: approved.revision, reason: 'Changed plans' },
      randomUUID(),
      f.couple,
    );
    const pending = await orders.proposeReplacement(
      approved.orderId,
      { ...quotation, expectedRevision: approved.revision },
      randomUUID(),
      f.manager,
    );
    await expect(
      orders.cancelPrintOrder(
        null,
        approved.orderId,
        { expectedRevision: pending.revision },
        randomUUID(),
        f.manager,
        'MANAGER',
      ),
    ).rejects.toMatchObject({ code: 'PRINT_CANCELLATION_NOT_ALLOWED' });
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.bookingId } }),
    ).toBe(1);
  });
});
