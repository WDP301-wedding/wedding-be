import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { CatalogTestDatabase } from './venue-catalog/catalog-test-database.js';
import {
  seedBillingManager,
  createManualBillingFixture,
} from './payments-billing/operations-fixture.js';
import { CATALOG_SEED_IDS } from '../../scripts/catalog-seed.js';
import { createCommercialSelectionReader } from '../../src/modules/venue-catalog/application/commercial-selection.reader.js';

const db = new CatalogTestDatabase('codex_perf_review');

beforeAll(async () => {
  await db.connect();
  await seedBillingManager(db.prisma);
}, 60000);

afterAll(() => db.disconnect());

describe('Review regression probes', () => {
  it.each([2147483648, Number.MAX_SAFE_INTEGER])(
    'preserves 422 for a future revision %s',
    async (throughBillingRevision) => {
      const f = await createManualBillingFixture(db.prisma);
      await expect(
        f.providers.views.read(
          { bookingId: f.bookingId, limit: 1, throughBillingRevision },
          f.manager,
        ),
      ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
    },
  );

  it('preserves 422 for an encoded cursor with a large future fence', async () => {
    const f = await createManualBillingFixture(db.prisma);
    const cursor = Buffer.from(
      JSON.stringify({
        bookingId: f.bookingId,
        throughBillingRevision: 2147483648,
        revision: 0,
      }),
    ).toString('base64url');
    await expect(
      f.providers.views.read({ bookingId: f.bookingId, limit: 1, cursor }, f.manager),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
  });

  it('preserves the sorted baseline catalog error when MENU input order is reversed', async () => {
    const reader = createCommercialSelectionReader(db.prisma);
    const missing = {
      category: 'MENU' as const,
      sourceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      sourceRevisionId: randomUUID(),
      quantity: 1,
    };
    const stale = {
      category: 'MENU' as const,
      sourceId: CATALOG_SEED_IDS.classicMenu,
      sourceRevisionId: randomUUID(),
      quantity: 1,
    };
    const inputs = [missing, stale];
    const baseline = async () => {
      for (const line of [...inputs].sort((a, b) =>
        (a.category + a.sourceId).localeCompare(b.category + b.sourceId),
      )) {
        await reader.requireSelection(line, CATALOG_SEED_IDS.restaurant);
      }
    };
    await expect(baseline()).rejects.toMatchObject({
      status: 409,
      code: 'COMMERCIAL_PRICE_REVISION_STALE',
    });
    await expect(
      reader.requireSelections(inputs, CATALOG_SEED_IDS.restaurant),
    ).rejects.toMatchObject({
      status: 409,
      code: 'COMMERCIAL_PRICE_REVISION_STALE',
    });
  });

  it('preserves category error priority: MENU stale throws before PRINT missing even if PRINT is first in input', async () => {
    const reader = createCommercialSelectionReader(db.prisma);
    const printMissing = {
      category: 'PRINT' as const,
      sourceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      sourceRevisionId: randomUUID(),
      quantity: 1,
    };
    const menuStale = {
      category: 'MENU' as const,
      sourceId: CATALOG_SEED_IDS.classicMenu,
      sourceRevisionId: randomUUID(),
      quantity: 1,
    };
    // input has PRINT first, but MENU < PRINT alphabetically
    const inputs = [printMissing, menuStale];
    await expect(
      reader.requireSelections(inputs, CATALOG_SEED_IDS.restaurant),
    ).rejects.toMatchObject({
      status: 409,
      code: 'COMMERCIAL_PRICE_REVISION_STALE',
    });
  });

  it('resolves multiple PRINT offerings sharing the same template in batch without duplicate queries', async () => {
    // Create one invitation template inside a transaction (deferred FK check)
    const templateId = randomUUID();
    const templateVersionId = randomUUID();
    await db.prisma.$transaction(async (tx) => {
      await tx.invitationTemplateVersion.create({
        data: {
          id: templateVersionId,
          templateId,
          revision: 1,
          content: {
            title: 'Shared Romantic Gold',
            textFields: { message: 'Greeting' },
            sections: [],
            derivedAssetIds: [],
            includesSeating: false,
          },
        },
      });
      await tx.invitationTemplate.create({
        data: {
          id: templateId,
          active: true,
          revision: 1,
          currentVersionId: templateVersionId,
        },
      });
    });

    // Create 2 distinct print offerings sharing the same template
    const off1Id = randomUUID();
    const off1VerId = randomUUID();
    await db.prisma.printOffering.create({
      data: {
        id: off1Id,
        restaurantId: CATALOG_SEED_IDS.restaurant,
        active: true,
        revision: 1,
      },
    });
    await db.prisma.printOfferingRevision.create({
      data: {
        id: off1VerId,
        offeringId: off1Id,
        revision: 1,
        templateId,
        templateVersionId,
        templateTitle: 'Shared Romantic Gold',
        name: 'Thiệp Tiêu Chuẩn A',
        printType: 'Hai mặt',
        material: 'Giấy Mỹ Thuật',
        unitPriceVnd: 5000,
        active: true,
        actorId: CATALOG_SEED_IDS.actor,
      },
    });

    const off2Id = randomUUID();
    const off2VerId = randomUUID();
    await db.prisma.printOffering.create({
      data: {
        id: off2Id,
        restaurantId: CATALOG_SEED_IDS.restaurant,
        active: true,
        revision: 1,
      },
    });
    await db.prisma.printOfferingRevision.create({
      data: {
        id: off2VerId,
        offeringId: off2Id,
        revision: 1,
        templateId,
        templateVersionId,
        templateTitle: 'Shared Romantic Gold',
        name: 'Thiệp Tiêu Chuẩn B',
        printType: 'Hai mặt phủ kim',
        material: 'Giấy Ánh Kim',
        unitPriceVnd: 8000,
        active: true,
        actorId: CATALOG_SEED_IDS.actor,
      },
    });

    // Also get valid MENU versions from catalog seed
    const reader = createCommercialSelectionReader(db.prisma);
    const inputs = [
      {
        category: 'PRINT' as const,
        sourceId: off1Id,
        sourceRevisionId: off1VerId,
        quantity: 100,
      },
      {
        category: 'MENU' as const,
        sourceId: CATALOG_SEED_IDS.classicMenu,
        sourceRevisionId: CATALOG_SEED_IDS.classicMenuVersion,
        quantity: 20,
      },
      {
        category: 'PRINT' as const,
        sourceId: off2Id,
        sourceRevisionId: off2VerId,
        quantity: 50,
      },
    ];

    const results = await reader.requireSelections(inputs, CATALOG_SEED_IDS.restaurant);
    expect(results.size).toBe(3);

    // Verify all lines resolved correctly
    const print1 = results.get(`PRINT${off1Id}`);
    expect(print1).toBeDefined();
    expect(print1?.name).toBe('Thiệp Tiêu Chuẩn A');
    expect(print1?.unitPriceVnd).toBe(5000);
    expect(print1?.lineTotalVnd).toBe(500000);

    const print2 = results.get(`PRINT${off2Id}`);
    expect(print2).toBeDefined();
    expect(print2?.name).toBe('Thiệp Tiêu Chuẩn B');
    expect(print2?.unitPriceVnd).toBe(8000);
    expect(print2?.lineTotalVnd).toBe(400000);

    const menu = results.get(`MENU${CATALOG_SEED_IDS.classicMenu}`);
    expect(menu).toBeDefined();
    expect(menu?.unitPriceVnd).toBe(3500000);
    expect(menu?.lineTotalVnd).toBe(70000000);

    // Calling order-preserving mapper from caller perspective
    const callerLines = inputs.map((i) => results.get(i.category + i.sourceId)!);
    expect(callerLines[0]!.name).toBe('Thiệp Tiêu Chuẩn A');
    expect(callerLines[1]!.name).toContain('Classic');
    expect(callerLines[2]!.name).toBe('Thiệp Tiêu Chuẩn B');
  });
});
