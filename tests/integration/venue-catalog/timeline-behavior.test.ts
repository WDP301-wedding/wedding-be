import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTimelineService } from '../../../src/modules/venue-catalog/application/timeline.service.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('VC-07 timeline-template behavior', () => {
  const database = new CatalogTestDatabase('vc07');
  const actorId = randomUUID();

  beforeAll(async () => database.connect(), 60_000);
  afterAll(async () => database.disconnect());

  it('clones independent drafts, serializes publication, and preserves retired history', async () => {
    const prisma = database.prisma;
    const service = createTimelineService(prisma);
    const context = { actorId, requestId: randomUUID() };
    const templateId = randomUUID();
    const firstVersionId = randomUUID();
    const firstItemId = randomUUID();
    await service.createTemplate({
      templateId,
      versionId: firstVersionId,
      displayOrder: 1,
      name: 'Wedding day',
      description: '',
      items: [
        {
          id: firstItemId,
          title: 'Welcome guests',
          description: null,
          offsetMinutes: 0,
          durationMinutes: 30,
          displayOrder: 1,
        },
      ],
      context,
    });
    await service.publish({
      templateId,
      versionId: firstVersionId,
      expectedRevision: 1,
      context: { ...context, requestId: randomUUID() },
    });

    const secondVersionId = randomUUID();
    await service.cloneVersion({
      templateId,
      sourceVersionId: firstVersionId,
      versionId: secondVersionId,
      context: { ...context, requestId: randomUUID() },
    });
    const draft = await prisma.timelineTemplateVersion.findUniqueOrThrow({
      where: { id: secondVersionId },
      include: { items: true },
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]?.id).not.toBe(firstItemId);

    const secondItemId = randomUUID();
    await service.updateDraft({
      templateId,
      versionId: secondVersionId,
      expectedRevision: 1,
      name: 'Wedding day revised',
      description: '',
      items: [
        {
          id: secondItemId,
          title: 'Ceremony',
          description: 'Garden ceremony',
          offsetMinutes: 60,
          durationMinutes: 45,
          displayOrder: 1,
        },
      ],
      context: { ...context, requestId: randomUUID() },
    });

    const publishRace = await Promise.allSettled([
      service.publish({
        templateId,
        versionId: secondVersionId,
        expectedRevision: 2,
        context: { ...context, requestId: randomUUID() },
      }),
      service.publish({
        templateId,
        versionId: secondVersionId,
        expectedRevision: 2,
        context: { ...context, requestId: randomUUID() },
      }),
    ]);
    expect(publishRace.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(publishRace.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    await expect(service.resolveVersion(firstVersionId)).resolves.toMatchObject({
      state: 'SUPERSEDED',
      name: 'Wedding day',
      items: [{ id: firstItemId, title: 'Welcome guests' }],
    });
    await expect(service.requireCurrentVersion(templateId)).resolves.toMatchObject({
      state: 'PUBLISHED',
      name: 'Wedding day revised',
      items: [{ id: secondItemId, title: 'Ceremony' }],
    });

    const aggregate = await prisma.timelineTemplate.findUniqueOrThrow({
      where: { id: templateId },
    });
    await service.changeLifecycle({
      aggregateId: templateId,
      expectedRevision: aggregate.revision,
      transition: 'RETIRE',
      context: { ...context, requestId: randomUUID() },
    });
    await expect(service.requireCurrentVersion(templateId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.resolveVersion(secondVersionId)).resolves.toMatchObject({
      state: 'PUBLISHED',
      name: 'Wedding day revised',
    });
  }, 120_000);
});
