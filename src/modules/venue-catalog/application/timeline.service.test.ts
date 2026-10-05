import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type {
  CatalogVersionRepository,
  CompareAndSwapDraftInput,
} from '../infrastructure/catalog-version.repository.js';
import { createTimelineService } from './timeline.service.js';

const context = { actorId: randomUUID(), requestId: randomUUID() };

function versionRepository(
  overrides: Partial<CatalogVersionRepository> = {},
): CatalogVersionRepository {
  return {
    compareAndSwapDraft: vi.fn(() => Promise.resolve({ revision: 2 })),
    publish: vi.fn(() =>
      Promise.resolve({
        aggregateId: randomUUID(),
        previousVersionId: null,
        versionId: randomUUID(),
        versionNumber: 1,
      }),
    ),
    changeLifecycle: vi.fn(() => Promise.resolve({ lifecycle: 'RETIRED' as const, revision: 2 })),
    registerLayoutTable: vi.fn(() => Promise.resolve()),
    resolveExactVersion: vi.fn(() =>
      Promise.resolve({
        id: randomUUID(),
        aggregateId: randomUUID(),
        versionNumber: 1,
        state: 'PUBLISHED' as const,
        revision: 2,
      }),
    ),
    requireCurrentVersion: vi.fn(() =>
      Promise.resolve({
        id: randomUUID(),
        aggregateId: randomUUID(),
        versionNumber: 1,
        state: 'PUBLISHED' as const,
        revision: 2,
      }),
    ),
    ...overrides,
  };
}

function timelineItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: randomUUID(),
    title: 'Welcome',
    description: null,
    offsetMinutes: 0,
    durationMinutes: 30,
    displayOrder: 1,
    ...overrides,
  };
}

describe('timeline service', () => {
  it('enforces item count, offset, duration, text, identity, and order bounds', async () => {
    const service = createTimelineService({ $transaction: vi.fn() } as unknown as PrismaClient);

    await expect(
      service.createTemplate({
        templateId: randomUUID(),
        versionId: randomUUID(),
        displayOrder: 0,
        name: 'Wedding day',
        description: '',
        items: [],
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_ITEM_COUNT_OUT_OF_BOUNDS' });
    await expect(
      service.createTemplate({
        templateId: randomUUID(),
        versionId: randomUUID(),
        displayOrder: 0,
        name: 'Wedding day',
        description: '',
        items: [timelineItem({ offsetMinutes: 1_441 })],
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INTEGER_OUT_OF_BOUNDS' });
  });

  it('replaces and reorders draft items through revision CAS', async () => {
    let mutate: ((transaction: Prisma.TransactionClient) => Promise<void>) | undefined;
    const compareAndSwapDraft = vi.fn((input: CompareAndSwapDraftInput) => {
      mutate = input.mutate;
      return Promise.resolve({ revision: 4 });
    });
    const service = createTimelineService(
      {} as PrismaClient,
      versionRepository({ compareAndSwapDraft }),
    );
    const first = timelineItem({ displayOrder: 2, offsetMinutes: 60 });
    const second = timelineItem({ displayOrder: 1, offsetMinutes: 0 });

    await service.updateDraft({
      templateId: randomUUID(),
      versionId: randomUUID(),
      expectedRevision: 3,
      name: 'Wedding day',
      description: '',
      items: [first, second],
      context,
    });
    const createMany = vi.fn(() => Promise.resolve({ count: 2 }));
    await mutate?.({
      timelineTemplateVersion: { update: vi.fn(() => Promise.resolve({})) },
      timelineTemplateItem: {
        deleteMany: vi.fn(() => Promise.resolve({ count: 2 })),
        createMany,
      },
    } as unknown as Prisma.TransactionClient);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ id: second.id, displayOrder: 1 }),
        expect.objectContaining({ id: first.id, displayOrder: 2 }),
      ],
    });
  });

  it('clones immutable history into an independent draft with fresh item identities', async () => {
    const sourceItemId = randomUUID();
    const clonedItemId = randomUUID();
    const createMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const transaction = {
      timelineTemplateVersion: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            name: 'Published',
            description: '',
            items: [timelineItem({ id: sourceItemId })],
          }),
        ),
        create: vi.fn(() => Promise.resolve({})),
      },
      timelineTemplateItem: { createMany },
      timelineTemplate: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;
    const service = createTimelineService(prisma, versionRepository(), () => clonedItemId);

    await service.cloneVersion({
      templateId: randomUUID(),
      sourceVersionId: randomUUID(),
      versionId: randomUUID(),
      context,
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: clonedItemId })],
    });
    expect(createMany).not.toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: sourceItemId })],
    });
  });

  it('revalidates ordered items inside the publication transaction', async () => {
    const publish = vi.fn(
      async (input: {
        validateDependencies: (transaction: Prisma.TransactionClient) => Promise<void>;
      }) => {
        await input.validateDependencies({
          timelineTemplateItem: {
            findMany: vi.fn(() => Promise.resolve([timelineItem({ displayOrder: 2 })])),
          },
        } as unknown as Prisma.TransactionClient);
        return {
          aggregateId: randomUUID(),
          previousVersionId: null,
          versionId: randomUUID(),
          versionNumber: 1,
        };
      },
    );
    const service = createTimelineService(
      {} as PrismaClient,
      versionRepository({ publish: publish as CatalogVersionRepository['publish'] }),
    );

    await expect(
      service.publish({
        templateId: randomUUID(),
        versionId: randomUUID(),
        expectedRevision: 1,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID_DISPLAY_ORDER' });
  });

  it('resolves a superseded exact version independently of aggregate lifecycle', async () => {
    const versionId = randomUUID();
    const prisma = {
      timelineTemplateVersion: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: versionId,
            timelineTemplateId: randomUUID(),
            versionNumber: 2,
            revision: 4,
            state: 'SUPERSEDED',
            name: 'Historical',
            description: '',
            items: [timelineItem()],
          }),
        ),
      },
    } as unknown as PrismaClient;
    const service = createTimelineService(prisma, versionRepository());

    await expect(service.resolveVersion(versionId)).resolves.toMatchObject({
      id: versionId,
      state: 'SUPERSEDED',
      items: [{ title: 'Welcome' }],
    });
  });

  it('delegates lifecycle changes and resolves current published templates', async () => {
    const changeLifecycle = vi.fn(() =>
      Promise.resolve({ lifecycle: 'ACTIVE' as const, revision: 3 }),
    );
    const version = {
      id: randomUUID(),
      timelineTemplateId: randomUUID(),
      versionNumber: 1,
      revision: 2,
      state: 'PUBLISHED',
      name: 'Current',
      description: '',
      items: [timelineItem()],
    } as const;
    const service = createTimelineService(
      {
        timelineTemplateVersion: { findFirst: vi.fn(() => Promise.resolve(version)) },
      } as unknown as PrismaClient,
      versionRepository({ changeLifecycle }),
    );

    await service.changeLifecycle({
      aggregateId: version.timelineTemplateId,
      expectedRevision: 2,
      transition: 'RESTORE',
      context,
    });
    await expect(service.requireCurrentVersion(version.timelineTemplateId)).resolves.toMatchObject({
      id: version.id,
      state: 'PUBLISHED',
    });
    expect(changeLifecycle).toHaveBeenCalledOnce();
  });

  it('conceals missing and draft versions and rejects invalid display order', async () => {
    const missing = createTimelineService(
      {
        timelineTemplateVersion: { findFirst: vi.fn(() => Promise.resolve(null)) },
      } as unknown as PrismaClient,
      versionRepository(),
    );
    await expect(missing.requireCurrentVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(missing.resolveVersion(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const invalid = createTimelineService(
      {
        timelineTemplateVersion: {
          findFirst: vi.fn(() =>
            Promise.resolve({
              id: randomUUID(),
              timelineTemplateId: randomUUID(),
              versionNumber: null,
              revision: 1,
              state: 'DRAFT',
              name: 'Draft',
              description: '',
              items: [timelineItem()],
            }),
          ),
        },
      } as unknown as PrismaClient,
      versionRepository(),
    );
    await expect(invalid.resolveVersion(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      invalid.createTemplate({
        templateId: randomUUID(),
        versionId: randomUUID(),
        displayOrder: -1,
        name: 'Invalid',
        description: '',
        items: [timelineItem()],
        context,
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('maps database uniqueness failures to a stable draft conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const service = createTimelineService(
      { $transaction: vi.fn(() => Promise.reject(duplicate)) } as unknown as PrismaClient,
      versionRepository(),
    );

    await expect(
      service.createTemplate({
        templateId: randomUUID(),
        versionId: randomUUID(),
        displayOrder: 0,
        name: 'Template',
        description: '',
        items: [timelineItem()],
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_DRAFT_CONFLICT' });
  });
});
