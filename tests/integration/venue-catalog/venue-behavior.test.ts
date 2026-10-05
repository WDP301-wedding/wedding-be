import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVenueService } from '../../../src/modules/venue-catalog/application/venue.service.js';
import { createPrismaCatalogVersionRepository } from '../../../src/modules/venue-catalog/infrastructure/catalog-version.repository.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('VC-05 venue behavior', () => {
  const database = new CatalogTestDatabase('vc05');
  const actorId = randomUUID();

  beforeAll(async () => database.connect(), 60_000);
  afterAll(async () => database.disconnect());

  it('enforces CAS, active names, capacity guards, snapshots, lifecycle, and safe audit data', async () => {
    const prisma = database.prisma;
    const service = createVenueService(prisma);
    const context = { actorId, requestId: randomUUID() };
    await prisma.restaurantProfile.create({
      data: {
        displayName: 'Wedding Estate',
        description: '',
        address: 'Old address',
        publicPhone: '000',
        publicEmail: 'old@example.test',
        updatedByAccountId: actorId,
      },
    });
    await prisma.restaurantShift.createMany({
      data: [
        {
          code: 'LUNCH',
          startTime: new Date('1970-01-01T11:00:00.000Z'),
          endTime: new Date('1970-01-01T14:00:00.000Z'),
          updatedByAccountId: actorId,
        },
        {
          code: 'DINNER',
          startTime: new Date('1970-01-01T18:00:00.000Z'),
          endTime: new Date('1970-01-01T21:00:00.000Z'),
          updatedByAccountId: actorId,
        },
      ],
    });

    await service.updateRestaurantProfile({
      displayName: 'Wedding Estate',
      description: 'Private estate',
      address: '1 Garden Road',
      publicPhone: '+84 123 456 789',
      publicEmail: 'hello@example.test',
      expectedRevision: 1,
      context,
    });
    await expect(
      service.updateRestaurantProfile({
        displayName: 'Stale',
        description: '',
        address: '1 Garden Road',
        publicPhone: null,
        publicEmail: null,
        expectedRevision: 1,
        context: { ...context, requestId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_REVISION_CONFLICT' });

    const hallId = randomUUID();
    await service.createHall({
      id: hallId,
      name: ' Grand Hall ',
      description: 'Ballroom',
      maxGuests: 500,
      displayOrder: 1,
      context,
    });
    await expect(
      service.createHall({
        id: randomUUID(),
        name: 'grand hall',
        description: '',
        maxGuests: 50,
        displayOrder: 2,
        context: { ...context, requestId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_HALL_NAME_CONFLICT' });

    const templateId = randomUUID();
    const layoutVersionId = randomUUID();
    await prisma.layoutTemplate.create({
      data: {
        id: templateId,
        hallId,
        displayOrder: 1,
        createdByAccountId: actorId,
        updatedByAccountId: actorId,
      },
    });
    await prisma.$transaction(async (transaction) => {
      await transaction.layoutTemplateVersion.create({
        data: {
          id: layoutVersionId,
          layoutTemplateId: templateId,
          name: 'Large layout',
          description: '',
          minGuests: 1,
          maxGuests: 350,
          createdByAccountId: actorId,
        },
      });
      await transaction.layoutTemplate.update({
        where: { id: templateId },
        data: { draftVersionId: layoutVersionId },
      });
    });
    await createPrismaCatalogVersionRepository(prisma).publish({
      kind: 'LAYOUT_TEMPLATE',
      aggregateId: templateId,
      versionId: layoutVersionId,
      expectedRevision: 1,
      context: { ...context, requestId: randomUUID() },
      validateDependencies: () => Promise.resolve(),
    });
    await expect(
      service.updateHall({
        id: hallId,
        name: 'Grand Hall',
        description: 'Ballroom',
        maxGuests: 300,
        displayOrder: 1,
        expectedRevision: 1,
        context: { ...context, requestId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_HALL_CAPACITY_CONFLICT' });

    await expect(service.requireActiveHallSnapshot(hallId)).resolves.toEqual({
      id: hallId,
      name: 'Grand Hall',
      description: 'Ballroom',
      maxGuests: 500,
    });
    await expect(service.requireActiveShiftSnapshot('LUNCH')).resolves.toEqual({
      code: 'LUNCH',
      startTime: '11:00',
      endTime: '14:00',
    });
    await service.changeHallLifecycle({
      id: hallId,
      expectedRevision: 1,
      transition: 'RETIRE',
      context: { ...context, requestId: randomUUID() },
    });
    await expect(service.requireActiveHallSnapshot(hallId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.getHall(hallId)).resolves.toMatchObject({ lifecycle: 'RETIRED' });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'catalog.restaurant-updated' },
    });
    const auditJson = JSON.stringify(audit.metadata);
    expect(auditJson).not.toContain('+84 123 456 789');
    expect(auditJson).not.toContain('hello@example.test');
    expect(auditJson).not.toContain('1 Garden Road');
  }, 120_000);
});
