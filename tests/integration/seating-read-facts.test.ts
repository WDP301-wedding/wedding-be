import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect(), 60000);
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
  },
);
