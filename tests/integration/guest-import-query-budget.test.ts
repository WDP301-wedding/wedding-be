import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { normalizeGroupName } from '../../src/modules/guest-management/domain/guest-policy.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('Guest import bounded reference reads', () => {
  const db = new CatalogTestDatabase('guest_import_budget');
  let fixture: Awaited<ReturnType<typeof studioFixture>>;
  let guests: ReturnType<typeof createGuestServices>['guests'];
  let groupId: string;
  beforeAll(async () => {
    vi.stubEnv('DB_DIAGNOSTICS_ENABLED', 'true');
    await db.connect();
    fixture = await studioFixture(db.prisma);
    guests = createGuestServices(db.prisma).guests;
    groupId = (await guests.groups(fixture.bookingId, fixture.couple))[0]!.guestGroupId;
  }, 60000);
  afterAll(async () => {
    try {
      await db.disconnect();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  const rows = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      externalRowKey: `${prefix}-${index}`,
      guestGroupId: groupId,
      name: `Khách ${index}`,
    }));
  const measure = async <T>(work: () => Promise<T>) => {
    const diagnostics = newDatabaseDiagnostics();
    const result = await withDatabaseDiagnostics(diagnostics, work);
    // Counts are actual pg commands, not mocked Prisma method calls.
    expect(diagnostics.queries).toBeGreaterThan(0);
    return { result, queries: diagnostics.queries };
  };
  it('keeps preview SQL count constant from 10 through the maximum 1000 rows', async () => {
    const small = await measure(() =>
      guests.preview(fixture.bookingId, { rows: rows('new', 10) }, randomUUID(), fixture.couple),
    );
    expect(small.result.createdCount).toBe(10);
    for (const count of [100, 1000]) {
      const large = await measure(() =>
        guests.preview(
          fixture.bookingId,
          { rows: rows('new', count) },
          randomUUID(),
          fixture.couple,
        ),
      );
      expect(large.result.createdCount).toBe(count);
      expect(large.queries).toBe(small.queries);
    }
  });
  it('keeps unchanged-import SQL count constant without creating history or changing headcount', async () => {
    const input = rows('retained', 100);
    await db.prisma.guest.createMany({
      data: input.map((row) => ({
        ...row,
        id: randomUUID(),
        bookingId: fixture.bookingId,
        normalizedName: normalizeGroupName(row.name),
      })),
    });
    const previews = [];
    for (const count of [10, 100])
      previews.push(
        await guests.preview(
          fixture.bookingId,
          { rows: input.slice(0, count) },
          randomUUID(),
          fixture.couple,
        ),
      );
    const results = [];
    const before = await db.prisma.guestHistory.count();
    for (const preview of previews)
      results.push(
        await measure(() =>
          guests.import(
            fixture.bookingId,
            { previewId: preview.previewId, digest: preview.digest },
            randomUUID(),
            fixture.couple,
          ),
        ),
      );
    expect(results[0]!.result).toMatchObject({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 10,
    });
    expect(results[1]!.result).toMatchObject({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 100,
    });
    expect(results[1]!.queries).toBe(results[0]!.queries);
    expect(await db.prisma.guestHistory.count()).toBe(before);
    expect(
      (await db.prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } }))
        .planningHeadcount,
    ).toBe(20);
  });
  it('preserves row-order error precedence and rejects inactive or foreign groups', async () => {
    const archived = rows('archived', 1)[0]!;
    await db.prisma.guest.create({
      data: {
        ...archived,
        id: randomUUID(),
        bookingId: fixture.bookingId,
        normalizedName: normalizeGroupName(archived.name),
        status: 'ARCHIVED',
      },
    });
    const missingGroup = { ...rows('missing', 1)[0]!, guestGroupId: randomUUID() };
    await expect(
      guests.preview(
        fixture.bookingId,
        { rows: [archived, missingGroup] },
        randomUUID(),
        fixture.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_IMPORT_ROW_CONFLICT' });
    await expect(
      guests.preview(
        fixture.bookingId,
        { rows: [missingGroup, archived] },
        randomUUID(),
        fixture.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
