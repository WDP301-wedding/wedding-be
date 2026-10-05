import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type {
  CatalogVersionRepository,
  CompareAndSwapDraftInput,
} from '../infrastructure/catalog-version.repository.js';
import { createLayoutService } from './layout.service.js';

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

function table(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tableId: randomUUID(),
    label: 'Table 1',
    shape: 'ROUND' as const,
    seatCapacity: 10,
    x: 0,
    y: 0,
    width: 500,
    height: 500,
    rotationDegrees: 0,
    displayOrder: 1,
    ...overrides,
  };
}

describe('layout service', () => {
  it('creates a hall-bound draft and its stable table registry atomically', async () => {
    const hallId = randomUUID();
    const templateId = randomUUID();
    const versionId = randomUUID();
    const geometry = table();
    const transaction = {
      hall: {
        findFirst: vi.fn(() => Promise.resolve({ id: hallId, maxGuests: 100 })),
      },
      layoutTemplate: {
        create: vi.fn(() => Promise.resolve({})),
        update: vi.fn(() => Promise.resolve({})),
      },
      layoutTemplateVersion: { create: vi.fn(() => Promise.resolve({})) },
      layoutTableIdentity: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
      layoutTableGeometry: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;

    const service = createLayoutService(prisma, versionRepository());
    await expect(
      service.createTemplate({
        templateId,
        versionId,
        hallId,
        displayOrder: 0,
        name: 'Grand layout',
        description: '',
        minGuests: 1,
        maxGuests: 10,
        tables: [geometry],
        context,
      }),
    ).resolves.toEqual({ versionId, revision: 1 });

    expect(transaction.layoutTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: templateId, hallId }),
    });
    expect(transaction.layoutTableIdentity.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: geometry.tableId,
          layoutTemplateId: templateId,
          createdByAccountId: context.actorId,
        },
      ],
    });
  });

  it('replaces draft geometry through CAS without accepting a hall or total override', async () => {
    const templateId = randomUUID();
    const versionId = randomUUID();
    const geometry = table();
    let mutate: ((transaction: Prisma.TransactionClient) => Promise<void>) | undefined;
    const compareAndSwapDraft = vi.fn((input: CompareAndSwapDraftInput) => {
      mutate = input.mutate;
      return Promise.resolve({ revision: 4 });
    });
    const prisma = {
      layoutTemplate: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: templateId,
            hall: { maxGuests: 100 },
            tableIdentities: [{ id: geometry.tableId, retiredAt: null }],
          }),
        ),
      },
    } as unknown as PrismaClient;
    const service = createLayoutService(prisma, versionRepository({ compareAndSwapDraft }));

    await service.updateDraft({
      templateId,
      versionId,
      expectedRevision: 3,
      name: 'Updated',
      description: '',
      minGuests: 1,
      maxGuests: 10,
      tables: [geometry],
      context,
    });
    const createMany = vi.fn(() => Promise.resolve({ count: 1 }));
    await mutate?.({
      layoutTemplateVersion: { update: vi.fn(() => Promise.resolve({})) },
      layoutTableGeometry: {
        deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
        createMany,
      },
    } as unknown as Prisma.TransactionClient);

    expect(compareAndSwapDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({
        hallId: expect.anything(),
        totalSeatCapacity: expect.anything(),
      }),
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ tableId: geometry.tableId, layoutTemplateId: templateId })],
    });
  });

  it('recomputes hall and seat bounds in the publication transaction', async () => {
    const geometry = table({ seatCapacity: 10 });
    const publish = vi.fn(
      async (input: {
        validateDependencies: (transaction: Prisma.TransactionClient) => Promise<void>;
      }) => {
        await input.validateDependencies({
          layoutTemplate: {
            findFirst: vi.fn(() =>
              Promise.resolve({
                hall: { maxGuests: 100 },
                tableIdentities: [{ id: geometry.tableId, retiredAt: null }],
                draftVersion: {
                  name: 'Layout',
                  description: '',
                  minGuests: 1,
                  maxGuests: 11,
                  geometry: [geometry],
                },
              }),
            ),
          },
        } as unknown as Prisma.TransactionClient);
        throw new Error('unreachable');
      },
    );
    const service = createLayoutService(
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
    ).rejects.toMatchObject({ code: 'CATALOG_INTEGER_OUT_OF_BOUNDS' });
  });

  it('clones history with the same stable table IDs and resolves exact retired history', async () => {
    const templateId = randomUUID();
    const sourceVersionId = randomUUID();
    const versionId = randomUUID();
    const geometry = table();
    const transaction = {
      layoutTemplate: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: templateId,
            lifecycle: 'ACTIVE',
            hall: { maxGuests: 100 },
            tableIdentities: [{ id: geometry.tableId, retiredAt: null }],
          }),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      layoutTemplateVersion: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            name: 'Published',
            description: '',
            minGuests: 1,
            maxGuests: 10,
            geometry: [geometry],
          }),
        ),
        create: vi.fn(() => Promise.resolve({})),
      },
      layoutTableGeometry: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation(transaction),
      ),
      layoutTemplateVersion: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: sourceVersionId,
            layoutTemplateId: templateId,
            versionNumber: 1,
            revision: 2,
            state: 'SUPERSEDED',
            name: 'Published',
            description: '',
            minGuests: 1,
            maxGuests: 10,
            layoutTemplate: { hallId: randomUUID() },
            geometry: [geometry],
          }),
        ),
      },
    } as unknown as PrismaClient;
    const service = createLayoutService(prisma, versionRepository());

    await service.cloneVersion({ templateId, sourceVersionId, versionId, context });
    expect(transaction.layoutTableGeometry.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ tableId: geometry.tableId })],
    });
    await expect(service.resolveVersion(sourceVersionId)).resolves.toMatchObject({
      id: sourceVersionId,
      state: 'SUPERSEDED',
      totalSeatCapacity: 10,
    });
  });

  it('registers and irreversibly retires table identities while mapping conflicts', async () => {
    const registerLayoutTable = vi.fn(() => Promise.resolve());
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      layoutTableIdentity: { updateMany },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation({
          layoutTableIdentity: { updateMany },
          auditLog: { create: vi.fn(() => Promise.resolve({})) },
        }),
      ),
    } as unknown as PrismaClient;
    const service = createLayoutService(prisma, versionRepository({ registerLayoutTable }));

    await service.registerTable({ templateId: randomUUID(), tableId: randomUUID(), context });
    await expect(
      service.retireTable({ templateId: randomUUID(), tableId: randomUUID(), context }),
    ).resolves.toBeUndefined();
    await expect(
      service.retireTable({ templateId: randomUUID(), tableId: randomUUID(), context }),
    ).rejects.toMatchObject({ code: 'CATALOG_TABLE_IDENTITY_CONFLICT' });
  });

  it('rejects a missing/inactive hall and maps duplicate draft identities', async () => {
    const missingHall = createLayoutService({
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation({ hall: { findFirst: vi.fn(() => Promise.resolve(null)) } }),
      ),
    } as unknown as PrismaClient);
    await expect(
      missingHall.createTemplate({
        templateId: randomUUID(),
        versionId: randomUUID(),
        hallId: randomUUID(),
        displayOrder: 0,
        name: 'Layout',
        description: '',
        minGuests: 1,
        maxGuests: 10,
        tables: [table()],
        context,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const conflict = createLayoutService({
      $transaction: vi.fn(() => Promise.reject(duplicate)),
    } as unknown as PrismaClient);
    await expect(
      conflict.createTemplate({
        templateId: randomUUID(),
        versionId: randomUUID(),
        hallId: randomUUID(),
        displayOrder: 0,
        name: 'Layout',
        description: '',
        minGuests: 1,
        maxGuests: 10,
        tables: [table()],
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_DRAFT_CONFLICT' });
  });
});
