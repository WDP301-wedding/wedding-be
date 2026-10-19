import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { createPrismaSelectionEligibilityReader } from '../../src/modules/venue-catalog/infrastructure/prisma-selection-eligibility.reader.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'Seating source snapshot and lifecycle fences',
  () => {
    const db = new CatalogTestDatabase('seating_read_facts');
    beforeAll(() => {
      vi.stubEnv('DB_DIAGNOSTICS_ENABLED', 'true');
      return db.connect();
    }, 60000);
    afterAll(async () => {
      try {
        await db.disconnect();
      } finally {
        vi.unstubAllEnvs();
      }
    }, 60000);
    const context = (accountId: string) => ({
      requestId: randomUUID(),
      causationId: randomUUID(),
      actorAccountId: accountId,
      authority: 'AUTHENTICATED' as const,
    });

    it('bundles the fully validated immutable layout with current eligibility in bounded SQL', async () => {
      const f = await studioFixture(db.prisma);
      const expected = await f.layout.resolveVersion(f.layoutId);
      const boundary = f.services.boundary;
      const reader = createPrismaSelectionEligibilityReader(boundary);
      const state = newDatabaseDiagnostics();
      const actual = await withDatabaseDiagnostics(state, () =>
        boundary.runRead({ bookingId: f.bookingId, context: context(f.couple.actorId) }, (scope) =>
          reader.getLayoutEligibility(f.layoutId, scope),
        ),
      );
      expect(actual.layoutSnapshot).toEqual(expected);
      expect(actual).toMatchObject({
        hallActive: true,
        templateActive: true,
        currentForNewSelection: true,
        totalSeatCapacity: expected.totalSeatCapacity,
      });
      expect(state.queries).toBeLessThanOrEqual(6);
      expect(state.queries).toBeGreaterThan(0);
      const batch = await boundary.runRead(
        { bookingId: f.bookingId, context: context(f.couple.actorId) },
        (scope) => reader.getLayoutEligibilities!([f.layoutId, f.layoutId], scope),
      );
      expect(batch).toHaveLength(1);
      expect(batch[0]).not.toHaveProperty('layoutSnapshot');
    });

    it('re-reads eligibility after a retirement writer releases its lifecycle fence', async () => {
      const f = await studioFixture(db.prisma);
      const boundary = f.services.boundary;
      const reader = createPrismaSelectionEligibilityReader(boundary);
      let writerReady!: () => void;
      let releaseWriter!: () => void;
      const ready = new Promise<void>((resolve) => {
        writerReady = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const writer = db.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`HALL:${f.hallId}`}))`;
          await tx.hall.update({
            where: { id: f.hallId },
            data: { lifecycle: 'RETIRED', retiredAt: new Date(), revision: { increment: 1 } },
          });
          writerReady();
          await release;
        },
        { timeout: 15000 },
      );
      await Promise.race([
        ready,
        writer.then(() => {
          throw new Error('Writer finished before release.');
        }),
      ]);
      const reading = boundary.runRead(
        { bookingId: f.bookingId, context: context(f.couple.actorId) },
        (scope) => reader.getLayoutEligibility(f.layoutId, scope),
      );
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          const [row] = await db.prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
        ) AS blocked`;
          blocked = row!.blocked;
          if (!blocked) await delay(10);
        }
        expect(blocked).toBe(true);
        releaseWriter();
        await writer;
        expect(await reading).toMatchObject({ hallActive: false, templateActive: true });
      } finally {
        releaseWriter();
        await Promise.allSettled([writer, reading]);
      }
    }, 20000);

    it.each(['Hall', 'LayoutTemplate'] as const)(
      'retains the %s row fence against a writer without advisory locking',
      async (table) => {
        const f = await studioFixture(db.prisma);
        const boundary = f.services.boundary;
        const reader = createPrismaSelectionEligibilityReader(boundary);
        let locked!: () => void;
        let releaseRead!: () => void;
        const ready = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const release = new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        const reading = boundary.runRead(
          { bookingId: f.bookingId, context: context(f.couple.actorId) },
          async (scope) => {
            await reader.getLayoutEligibility(f.layoutId, scope);
            locked();
            await release;
          },
        );
        await Promise.race([
          ready,
          reading.then(() => {
            throw new Error('Reader finished before release.');
          }),
        ]);
        let identifyWriter!: (pid: number) => void;
        const identified = new Promise<number>((resolve) => {
          identifyWriter = resolve;
        });
        const writing = db.prisma.$transaction(
          async (tx) => {
            const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            identifyWriter(row!.pid);
            if (table === 'Hall')
              await tx.hall.update({
                where: { id: f.hallId },
                data: { revision: { increment: 1 } },
              });
            else
              await tx.layoutTemplate.update({
                where: { id: f.templateId },
                data: { revision: { increment: 1 } },
              });
          },
          { timeout: 15000 },
        );
        try {
          const pid = await Promise.race([
            identified,
            writing.then(() => {
              throw new Error('Writer finished before identification.');
            }),
          ]);
          let blocked = false;
          for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
            const [row] = await db.prisma.$queryRaw<
              { blocked: boolean }[]
            >`SELECT cardinality(pg_blocking_pids(${pid}::int))>0 AS blocked`;
            blocked = row!.blocked;
            if (!blocked) await delay(10);
          }
          expect(blocked).toBe(true);
        } finally {
          releaseRead();
          await Promise.allSettled([reading, writing]);
        }
        await writing;
      },
      20000,
    );

    it('reads current and detail without reloading the same immutable source', async () => {
      const f = await studioFixture(db.prisma);
      const services = createSeatingServices(db.prisma, f.services, () => f.now);
      expect(await services.seating.readCurrent(f.bookingId, f.couple)).toBeNull();
      const plan = await services.seating.select(
        f.bookingId,
        {
          layoutTemplateVersionId: f.layoutId,
          expectedBookingRevision: 1,
        },
        randomUUID(),
        f.couple,
      );
      const geometry = vi.spyOn(services.seating.layouts, 'resolveVersion');
      const state = newDatabaseDiagnostics();
      const detail = await withDatabaseDiagnostics(state, () =>
        services.seating.read(f.bookingId, plan.seatingPlanId, f.couple),
      );
      expect(detail).toEqual(await services.seating.readCurrent(f.bookingId, f.couple));
      expect(detail).toMatchObject({
        seatingPlanId: plan.seatingPlanId,
        currentPlanningHeadcount: 20,
        currentBookingRevision: 1,
      });
      expect(geometry).not.toHaveBeenCalled();
      // Counts transaction commands and scoped authority checks. Router
      // authentication adds one further read to the public HTTP operation.
      expect(state.queries).toBeLessThanOrEqual(20);
      await expect(
        services.seating.read(f.bookingId, randomUUID(), f.couple),
      ).rejects.toMatchObject({ status: 404 });
    });
  },
);
