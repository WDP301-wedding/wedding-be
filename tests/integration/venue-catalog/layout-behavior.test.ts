import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLayoutService } from '../../../src/modules/venue-catalog/application/layout.service.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('VC-08 layout behavior', () => {
  const database = new CatalogTestDatabase('catalog_layout');
  const actorId = randomUUID();
  const hallId = randomUUID();
  const templateId = randomUUID();
  const firstVersionId = randomUUID();
  const tableId = randomUUID();
  const context = { actorId, requestId: randomUUID() };

  beforeAll(async () => {
    await database.connect();
    await database.prisma.hall.create({
      data: {
        id: hallId,
        name: 'Grand Hall',
        nameNormalized: 'grand hall',
        description: '',
        maxGuests: 100,
        displayOrder: 0,
        updatedByAccountId: actorId,
      },
    });
  }, 60_000);

  afterAll(async () => database.disconnect());

  it('publishes one winner, preserves exact history, and never reuses retired table IDs', async () => {
    const service = createLayoutService(database.prisma);
    const geometry = {
      tableId,
      label: 'T1',
      shape: 'ROUND' as const,
      seatCapacity: 10,
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      rotationDegrees: 0,
      displayOrder: 1,
    };
    await service.createTemplate({
      templateId,
      versionId: firstVersionId,
      hallId,
      displayOrder: 0,
      name: 'Grand Hall layout',
      description: '',
      minGuests: 1,
      maxGuests: 10,
      tables: [geometry],
      context,
    });

    const publishResults = await Promise.allSettled([
      service.publish({
        templateId,
        versionId: firstVersionId,
        expectedRevision: 1,
        context: { ...context, requestId: randomUUID() },
      }),
      service.publish({
        templateId,
        versionId: firstVersionId,
        expectedRevision: 1,
        context: { ...context, requestId: randomUUID() },
      }),
    ]);
    expect(publishResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(publishResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(service.requireCurrentVersion(templateId)).resolves.toMatchObject({
      id: firstVersionId,
      totalSeatCapacity: 10,
      tables: [{ tableId }],
    });

    const secondVersionId = randomUUID();
    await service.cloneVersion({
      templateId,
      sourceVersionId: firstVersionId,
      versionId: secondVersionId,
      context,
    });
    await service.updateDraft({
      templateId,
      versionId: secondVersionId,
      expectedRevision: 1,
      name: 'Grand Hall layout v2',
      description: '',
      minGuests: 1,
      maxGuests: 8,
      tables: [{ ...geometry, label: 'Stable T1', seatCapacity: 8 }],
      context,
    });
    await service.publish({
      templateId,
      versionId: secondVersionId,
      expectedRevision: 2,
      context,
    });
    await expect(service.resolveVersion(firstVersionId)).resolves.toMatchObject({
      state: 'SUPERSEDED',
      maxGuests: 10,
      tables: [{ tableId, label: 'T1' }],
    });
    await expect(service.requireCurrentVersion(templateId)).resolves.toMatchObject({
      id: secondVersionId,
      maxGuests: 8,
      tables: [{ tableId, label: 'Stable T1' }],
    });

    await service.retireTable({ templateId, tableId, context });
    const thirdVersionId = randomUUID();
    await expect(
      service.cloneVersion({
        templateId,
        sourceVersionId: secondVersionId,
        versionId: thirdVersionId,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_TABLE_RETIRED' });
    await expect(service.resolveVersion(secondVersionId)).resolves.toMatchObject({
      tables: [{ tableId }],
    });
  }, 30_000);

  it('rejects a hall range above either current hall capacity or summed table seats', async () => {
    const service = createLayoutService(database.prisma);
    await expect(
      service.createTemplate({
        templateId: randomUUID(),
        versionId: randomUUID(),
        hallId,
        displayOrder: 1,
        name: 'Invalid layout',
        description: '',
        minGuests: 1,
        maxGuests: 11,
        tables: [
          {
            tableId: randomUUID(),
            label: 'T1',
            shape: 'RECTANGLE',
            seatCapacity: 10,
            x: 9_000,
            y: 9_000,
            width: 1_000,
            height: 1_000,
            rotationDegrees: 359,
            displayOrder: 1,
          },
        ],
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INTEGER_OUT_OF_BOUNDS' });
  }, 15_000);
});
