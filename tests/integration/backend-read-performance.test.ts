import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;

databaseDescribe('Backend read performance with real owner persistence', () => {
  const db = new CatalogTestDatabase('backend_read_performance');

  beforeAll(async () => {
    // These tests create and drop a disposable database. Never use a shared target.
    const target = new URL(catalogMigrationDatabaseUrl!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname))
      throw new Error('Backend read performance tests require a loopback test database.');
    await db.connect();
  }, 60_000);
  afterAll(() => db.disconnect(), 60_000);

  function testDatabaseUrl() {
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = `/${db.databaseName}`;
    url.searchParams.delete('schema');
    url.searchParams.set('options', '-c timezone=UTC');
    return url.toString();
  }

  it.each(['options', 'readCurrent'] as const)(
    'serves seating %s with a single available database connection',
    async (operation) => {
      const f = await studioFixture(db.prisma);
      const setup = createSeatingServices(db.prisma, f.services, () => f.now);
      await setup.guests.guests.groups(f.bookingId, f.couple);
      const plan = await setup.seating.select(
        f.bookingId,
        { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      const prisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: testDatabaseUrl(),
          max: 1,
          connectionTimeoutMillis: 750,
        }),
      });
      try {
        const studio = createInvitationStudioServices(
          prisma,
          controlledStorage().provider,
          null,
          'https://wedding.example.test',
          () => f.now,
        );
        const { seating } = createSeatingServices(prisma, studio, () => f.now);

        // A transaction already occupies the pool's sole connection. A nested read
        // must enlist it, rather than attempting to acquire another connection.
        if (operation === 'options') {
          expect(await seating.options(f.bookingId, f.couple)).toMatchObject({
            planningHeadcount: 20,
            bookingRevision: 1,
            items: [{ layoutTemplateVersionId: f.layoutId, compatible: true }],
          });
        } else {
          expect(await seating.readCurrent(f.bookingId, f.couple)).toMatchObject({
            seatingPlanId: plan.seatingPlanId,
            revisionId: plan.revisionId,
            status: 'DRAFT',
            currentPlanningHeadcount: 20,
            currentBookingRevision: 1,
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    },
    15_000,
  );

  it('batches eligibility for ten layout options without per-layout database work', async () => {
    const f = await studioFixture(db.prisma);
    const setup = createSeatingServices(db.prisma, f.services, () => f.now);
    await setup.guests.guests.groups(f.bookingId, f.couple);
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl() }),
      log: [{ level: 'query', emit: 'event' }],
    });
    let queries = 0;
    prisma.$on('query', () => queries++);
    try {
      await prisma.$connect();
      const studio = createInvitationStudioServices(
        prisma,
        controlledStorage().provider,
        null,
        'https://wedding.example.test',
        () => f.now,
      );
      const { seating } = createSeatingServices(prisma, studio, () => f.now);
      queries = 0;
      const single = await seating.options(f.bookingId, f.couple);
      const singleQueries = queries;
      expect(single).toEqual({
        planningHeadcount: 20,
        bookingRevision: 1,
        items: [
          {
            layoutTemplateVersionId: f.layoutId,
            name: 'Approved layout',
            minGuests: 10,
            maxGuests: 30,
            totalSeatCapacity: 40,
            compatible: true,
            warning: null,
          },
        ],
      });
      const expected = [...single.items];
      for (let index = 1; index < 10; index++) {
        const templateId = randomUUID();
        const versionId = randomUUID();
        const minGuests = index >= 6 ? 25 : 10;
        await f.layout.createTemplate({
          templateId,
          versionId,
          hallId: f.hallId,
          displayOrder: index,
          name: `Layout option ${index}`,
          description: '',
          minGuests,
          maxGuests: 30,
          tables: [
            {
              tableId: randomUUID(),
              label: 'T1',
              shape: 'ROUND',
              seatCapacity: 40,
              x: 0,
              y: 0,
              width: 500,
              height: 500,
              rotationDegrees: 0,
              displayOrder: 1,
            },
          ],
          context: f.ownerContext,
        });
        await f.layout.publish({
          templateId,
          versionId,
          expectedRevision: 1,
          context: f.ownerContext,
        });
        expected.push({
          layoutTemplateVersionId: versionId,
          name: `Layout option ${index}`,
          minGuests,
          maxGuests: 30,
          totalSeatCapacity: 40,
          compatible: minGuests <= 20,
          warning: minGuests <= 20 ? null : 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE',
        });
      }
      expected.sort(
        (a, b) =>
          Number(b.compatible) - Number(a.compatible) ||
          a.layoutTemplateVersionId.localeCompare(b.layoutTemplateVersionId),
      );
      queries = 0;
      const ten = await seating.options(f.bookingId, f.couple);
      const tenQueries = queries;
      expect(ten).toEqual({ planningHeadcount: 20, bookingRevision: 1, items: expected });
      expect(singleQueries).toBeGreaterThan(0);
      expect(tenQueries).toBeLessThanOrEqual(singleQueries + 12);
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it('returns current invitation views and stable pages without database work growing per item', async () => {
    const f = await studioFixture(db.prisma);
    const created = [];
    for (let index = 0; index < 21; index++) {
      created.push(
        await f.services.designs.create(
          {
            bookingId: f.bookingId,
            content: { ...f.content, title: `Invitation ${index}` },
            idempotencyKey: randomUUID(),
          },
          f.couple,
        ),
      );
    }
    const ordered = created.sort((a, b) => a.designId.localeCompare(b.designId));
    // Include a successor to ensure list resolves the current immutable revision.
    ordered[0] = await f.services.designs.edit(
      {
        bookingId: f.bookingId,
        designId: ordered[0]!.designId,
        expectedRevision: 1,
        textFields: { greeting: 'Lời mời mới nhất' },
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl() }),
      log: [{ level: 'query', emit: 'event' }],
    });
    let queries = 0;
    prisma.$on('query', () => queries++);
    try {
      await prisma.$connect();
      const studio = createInvitationStudioServices(
        prisma,
        controlledStorage().provider,
        null,
        'https://wedding.example.test',
        () => f.now,
      );
      queries = 0;
      const single = await studio.designs.list(f.bookingId, { limit: 1 }, f.couple);
      const singleQueries = queries;
      queries = 0;
      const page = await studio.designs.list(f.bookingId, { limit: 20 }, f.couple);
      const pageQueries = queries;
      const rest = await studio.designs.list(
        f.bookingId,
        { limit: 20, cursor: page.nextCursor },
        f.couple,
      );
      expect(single).toEqual({ items: ordered.slice(0, 1), nextCursor: ordered[0].designId });
      expect(page).toEqual({ items: ordered.slice(0, 20), nextCursor: ordered[19]!.designId });
      expect(rest).toEqual({ items: ordered.slice(20), nextCursor: null });
      // This is a round-trip budget, independent of machine speed and DB latency.
      // Allow a few extra batched reads, but never repeated per-design authorization.
      expect(singleQueries).toBeGreaterThan(0);
      expect(pageQueries).toBeLessThanOrEqual(singleQueries + 4);
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it('conceals invitation pages from another couple and rechecks access after revocation', async () => {
    const f = await studioFixture(db.prisma);
    await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    const stranger = await f.actor('COUPLE');
    await expect(
      f.services.designs.list(f.bookingId, { limit: 20 }, stranger),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await f.services.designs.list(f.bookingId, { limit: 20 }, f.couple)).items,
    ).toHaveLength(1);
    await db.prisma.consultationAccess.deleteMany({ where: { bookingId: f.bookingId } });
    await expect(
      f.services.designs.list(f.bookingId, { limit: 20 }, f.couple),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each([0, 1])(
    'denies a page of %i invitations when access is revoked during the read',
    async (count) => {
      const f = await studioFixture(db.prisma);
      if (count)
        await f.services.designs.create(
          { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
          f.couple,
        );
      const read = db.prisma.invitationDesignRevision.findMany.bind(
        db.prisma.invitationDesignRevision,
      );
      let revoked = false;
      const pending = vi
        .spyOn(db.prisma.invitationDesignRevision, 'findMany')
        .mockImplementationOnce((args) => {
          const result = read(args);
          return result.then(async (rows) => {
            await db.prisma.consultationAccess.deleteMany({ where: { bookingId: f.bookingId } });
            revoked = true;
            return rows;
          }) as typeof result;
        });
      try {
        await expect(
          f.services.designs.list(f.bookingId, { limit: 20 }, f.couple),
        ).rejects.toMatchObject({ status: 404 });
        expect(revoked).toBe(true);
      } finally {
        pending.mockRestore();
      }
    },
  );
});
