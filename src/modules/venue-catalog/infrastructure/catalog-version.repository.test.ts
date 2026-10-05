import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  CatalogConflictError,
  createPrismaCatalogVersionRepository,
} from './catalog-version.repository.js';

function prismaWithTransaction(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as unknown as PrismaClient;
}

function transactionMock(prisma: PrismaClient): ReturnType<typeof vi.fn> {
  return (prisma as unknown as { readonly $transaction: ReturnType<typeof vi.fn> }).$transaction;
}

function context() {
  return { requestId: randomUUID(), actorId: randomUUID() };
}

describe('Prisma catalog version repository', () => {
  it('runs draft mutation only after winning the expected-revision CAS and audits it', async () => {
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const mutate = vi.fn(() => Promise.resolve());
    const auditCreate = vi.fn((input: unknown) => {
      void input;
      return Promise.resolve({});
    });
    const transaction = {
      $executeRaw: vi.fn(() => Promise.resolve(0)),
      $queryRaw: vi.fn(() => Promise.resolve([{ revision: 3 }])),
      auditLog: { create: auditCreate },
    };
    const repository = createPrismaCatalogVersionRepository(
      prismaWithTransaction(transaction),
      () => new Date('2026-10-05T01:00:00.000Z'),
    );

    await expect(
      repository.compareAndSwapDraft({
        kind: 'DISH',
        aggregateId,
        versionId,
        expectedRevision: 2,
        changedFields: ['name'],
        context: context(),
        mutate,
      }),
    ).resolves.toEqual({ revision: 3 });
    expect(mutate).toHaveBeenCalledWith(transaction);
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        metadata: { aggregateId, changedFields: ['name'], kind: 'DISH' },
      },
    });
  });

  it('rejects a stale draft without invoking mutation or writing audit evidence', async () => {
    const mutate = vi.fn(() => Promise.resolve());
    const auditCreate = vi.fn(() => Promise.resolve({}));
    const transaction = {
      $executeRaw: vi.fn(() => Promise.resolve(0)),
      $queryRaw: vi.fn(() => Promise.resolve([])),
      auditLog: { create: auditCreate },
    };
    const repository = createPrismaCatalogVersionRepository(prismaWithTransaction(transaction));

    const promise = repository.compareAndSwapDraft({
      kind: 'DISH',
      aggregateId: randomUUID(),
      versionId: randomUUID(),
      expectedRevision: 9,
      changedFields: [],
      context: context(),
      mutate,
    });

    await expect(promise).rejects.toMatchObject({ code: 'CATALOG_REVISION_CONFLICT' });
    expect(mutate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('publishes one draft, supersedes the prior current version, advances the pointer, and audits both', async () => {
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const previousVersionId = randomUUID();
    const validateDependencies = vi.fn(() => Promise.resolve());
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          currentPublishedVersionId: previousVersionId,
          draftVersionId: versionId,
          lifecycle: 'ACTIVE',
        },
      ])
      .mockResolvedValueOnce([{ revision: 4, state: 'DRAFT' }])
      .mockResolvedValueOnce([{ nextVersionNumber: 2 }]);
    const executeRaw = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const auditCreate = vi.fn(() => Promise.resolve({}));
    const transaction = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      auditLog: { create: auditCreate },
    };
    const prisma = prismaWithTransaction(transaction);
    const repository = createPrismaCatalogVersionRepository(
      prisma,
      () => new Date('2026-10-05T02:00:00.000Z'),
    );

    await expect(
      repository.publish({
        kind: 'MENU_PACKAGE',
        aggregateId,
        versionId,
        expectedRevision: 4,
        context: context(),
        validateDependencies,
      }),
    ).resolves.toEqual({
      aggregateId,
      previousVersionId,
      versionId,
      versionNumber: 2,
    });
    expect(validateDependencies).toHaveBeenCalledWith(transaction);
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(transactionMock(prisma)).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('returns a stable conflict without a partial publish when the draft pointer changed', async () => {
    const transaction = {
      $executeRaw: vi.fn(() => Promise.resolve(0)),
      $queryRaw: vi.fn(() =>
        Promise.resolve([
          {
            currentPublishedVersionId: null,
            draftVersionId: randomUUID(),
            lifecycle: 'ACTIVE',
          },
        ]),
      ),
      auditLog: { create: vi.fn() },
    };
    const repository = createPrismaCatalogVersionRepository(prismaWithTransaction(transaction));

    await expect(
      repository.publish({
        kind: 'TIMELINE_TEMPLATE',
        aggregateId: randomUUID(),
        versionId: randomUUID(),
        expectedRevision: 1,
        context: context(),
        validateDependencies: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_PUBLISH_CONFLICT' });
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('retries a serialization failure and returns the successful publication', async () => {
    const retryError = new Prisma.PrismaClientKnownRequestError('retry', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const transaction = {
      $executeRaw: vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          { currentPublishedVersionId: null, draftVersionId: versionId, lifecycle: 'ACTIVE' },
        ])
        .mockResolvedValueOnce([{ revision: 1, state: 'DRAFT' }])
        .mockResolvedValueOnce([{ nextVersionNumber: 1 }]),
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(retryError)
        .mockImplementationOnce(async (operation: (value: object) => Promise<unknown>) =>
          operation(transaction),
        ),
    } as unknown as PrismaClient;
    const repository = createPrismaCatalogVersionRepository(prisma);

    await expect(
      repository.publish({
        kind: 'LAYOUT_TEMPLATE',
        aggregateId,
        versionId,
        expectedRevision: 1,
        context: context(),
        validateDependencies: () => Promise.resolve(),
      }),
    ).resolves.toMatchObject({ versionNumber: 1 });
    expect(transactionMock(prisma)).toHaveBeenCalledTimes(2);
  });

  it('changes lifecycle by CAS and preserves exact historical resolution', async () => {
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ lifecycle: 'ACTIVE', revision: 3 }])
      .mockResolvedValueOnce([{ revision: 4 }])
      .mockResolvedValueOnce([
        {
          id: versionId,
          aggregateId,
          versionNumber: 1,
          state: 'SUPERSEDED',
          revision: 2,
        },
      ]);
    const transaction = {
      $executeRaw: vi.fn(() => Promise.resolve(0)),
      $queryRaw: queryRaw,
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const repository = createPrismaCatalogVersionRepository(prismaWithTransaction(transaction));

    await expect(
      repository.changeLifecycle({
        kind: 'MENU_PACKAGE',
        aggregateId,
        expectedRevision: 3,
        transition: 'RETIRE',
        context: context(),
      }),
    ).resolves.toEqual({ lifecycle: 'RETIRED', revision: 4 });
    await expect(repository.resolveExactVersion('MENU_PACKAGE', versionId)).resolves.toMatchObject({
      id: versionId,
      state: 'SUPERSEDED',
    });
  });

  it('maps stable table identity reuse to a domain conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const transaction = {
      layoutTableIdentity: { create: vi.fn(() => Promise.reject(duplicate)) },
      auditLog: { create: vi.fn() },
    };
    const repository = createPrismaCatalogVersionRepository(prismaWithTransaction(transaction));

    const promise = repository.registerLayoutTable({
      layoutTemplateId: randomUUID(),
      tableId: randomUUID(),
      context: context(),
    });

    await expect(promise).rejects.toBeInstanceOf(CatalogConflictError);
    await expect(promise).rejects.toMatchObject({ code: 'CATALOG_TABLE_IDENTITY_CONFLICT' });
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('registers a new stable table and propagates unrelated database failures', async () => {
    const create = vi.fn(() => Promise.resolve({}));
    const auditCreate = vi.fn(() => Promise.resolve({}));
    const transaction = { layoutTableIdentity: { create }, auditLog: { create: auditCreate } };
    const repository = createPrismaCatalogVersionRepository(prismaWithTransaction(transaction));

    await expect(
      repository.registerLayoutTable({
        layoutTemplateId: randomUUID(),
        tableId: randomUUID(),
        context: context(),
      }),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();

    const failure = new Prisma.PrismaClientKnownRequestError('failure', {
      code: 'P2024',
      clientVersion: 'test',
    });
    const failingRepository = createPrismaCatalogVersionRepository(
      prismaWithTransaction({
        layoutTableIdentity: { create: vi.fn(() => Promise.reject(failure)) },
        auditLog: { create: vi.fn() },
      }),
    );
    await expect(
      failingRepository.registerLayoutTable({
        layoutTemplateId: randomUUID(),
        tableId: randomUUID(),
        context: context(),
      }),
    ).rejects.toBe(failure);
  });

  it('resolves current versions and conceals missing, draft, or retired selections', async () => {
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const current = {
      id: versionId,
      aggregateId,
      versionNumber: 3,
      state: 'PUBLISHED',
      revision: 4,
    };
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...current, versionNumber: null, state: 'DRAFT' }])
      .mockResolvedValueOnce([{ ...current, state: 'DRAFT' }]);
    const repository = createPrismaCatalogVersionRepository(
      prismaWithTransaction({
        $executeRaw: vi.fn(() => Promise.resolve(0)),
        $queryRaw: queryRaw,
      }),
    );

    await expect(repository.requireCurrentVersion('DISH', aggregateId)).resolves.toEqual(current);
    await expect(repository.requireCurrentVersion('DISH', aggregateId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(repository.resolveExactVersion('DISH', versionId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(repository.resolveExactVersion('DISH', versionId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(repository.resolveExactVersion('DISH', versionId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each([
    ['missing aggregate', [], [], [], [0, 0]],
    [
      'missing draft',
      [{ currentPublishedVersionId: null, draftVersionId: 'VERSION', lifecycle: 'ACTIVE' }],
      [],
      [],
      [0, 0],
    ],
    [
      'missing next number',
      [{ currentPublishedVersionId: null, draftVersionId: 'VERSION', lifecycle: 'ACTIVE' }],
      [{ revision: 1, state: 'DRAFT' }],
      [],
      [0, 0],
    ],
    [
      'failed publish update',
      [{ currentPublishedVersionId: null, draftVersionId: 'VERSION', lifecycle: 'ACTIVE' }],
      [{ revision: 1, state: 'DRAFT' }],
      [{ nextVersionNumber: 1 }],
      [0, 0],
    ],
    [
      'failed pointer update',
      [{ currentPublishedVersionId: null, draftVersionId: 'VERSION', lifecycle: 'ACTIVE' }],
      [{ revision: 1, state: 'DRAFT' }],
      [{ nextVersionNumber: 1 }],
      [0, 1, 0],
    ],
  ] as const)(
    'rolls back a publication with %s',
    async (_label, aggregateRows, draftRows, nextRows, executeResults) => {
      const aggregateId = randomUUID();
      const versionId = randomUUID();
      const normalizedAggregateRows = aggregateRows.map((row) => ({
        ...row,
        draftVersionId: row.draftVersionId === 'VERSION' ? versionId : row.draftVersionId,
      }));
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce(normalizedAggregateRows)
        .mockResolvedValueOnce(draftRows)
        .mockResolvedValueOnce(nextRows);
      const executeRaw = vi.fn();
      for (const result of executeResults) executeRaw.mockResolvedValueOnce(result);
      const repository = createPrismaCatalogVersionRepository(
        prismaWithTransaction({
          $executeRaw: executeRaw,
          $queryRaw: queryRaw,
          auditLog: { create: vi.fn() },
        }),
      );

      await expect(
        repository.publish({
          kind: 'DISH',
          aggregateId,
          versionId,
          expectedRevision: 1,
          context: context(),
        }),
      ).rejects.toBeInstanceOf(CatalogConflictError);
    },
  );

  it('rejects a failed supersession before publishing the new version', async () => {
    const versionId = randomUUID();
    const repository = createPrismaCatalogVersionRepository(
      prismaWithTransaction({
        $executeRaw: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([
            {
              currentPublishedVersionId: randomUUID(),
              draftVersionId: versionId,
              lifecycle: 'ACTIVE',
            },
          ])
          .mockResolvedValueOnce([{ revision: 1, state: 'DRAFT' }])
          .mockResolvedValueOnce([{ nextVersionNumber: 2 }]),
        auditLog: { create: vi.fn() },
      }),
    );

    await expect(
      repository.publish({
        kind: 'DISH',
        aggregateId: randomUUID(),
        versionId,
        expectedRevision: 1,
        context: context(),
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_PUBLISH_CONFLICT' });
  });

  it('restores with revalidation and maps stale, invalid, and unique-conflict lifecycles', async () => {
    const validateRestore = vi.fn(() => Promise.resolve());
    const restoredTransaction = {
      $executeRaw: vi.fn(() => Promise.resolve(0)),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ lifecycle: 'RETIRED', revision: 2 }])
        .mockResolvedValueOnce([{ revision: 3 }]),
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const repository = createPrismaCatalogVersionRepository(
      prismaWithTransaction(restoredTransaction),
    );
    const input = {
      kind: 'DISH' as const,
      aggregateId: randomUUID(),
      expectedRevision: 2,
      transition: 'RESTORE' as const,
      context: context(),
      validateRestore,
    };

    await expect(repository.changeLifecycle(input)).resolves.toEqual({
      lifecycle: 'ACTIVE',
      revision: 3,
    });
    expect(validateRestore).toHaveBeenCalledWith(restoredTransaction);

    const staleRepository = createPrismaCatalogVersionRepository(
      prismaWithTransaction({
        $executeRaw: vi.fn(() => Promise.resolve(0)),
        $queryRaw: vi.fn(() => Promise.resolve([])),
        auditLog: { create: vi.fn() },
      }),
    );
    await expect(staleRepository.changeLifecycle(input)).rejects.toMatchObject({
      code: 'CATALOG_LIFECYCLE_CONFLICT',
    });

    const invalidRepository = createPrismaCatalogVersionRepository(
      prismaWithTransaction({
        $executeRaw: vi.fn(() => Promise.resolve(0)),
        $queryRaw: vi.fn(() => Promise.resolve([{ lifecycle: 'ACTIVE', revision: 2 }])),
        auditLog: { create: vi.fn() },
      }),
    );
    await expect(invalidRepository.changeLifecycle(input)).rejects.toMatchObject({
      code: 'CATALOG_LIFECYCLE_CONFLICT',
    });

    const unique = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const uniqueRepository = createPrismaCatalogVersionRepository({
      $transaction: vi.fn(() => Promise.reject(unique)),
    } as unknown as PrismaClient);
    await expect(uniqueRepository.changeLifecycle(input)).rejects.toMatchObject({
      code: 'CATALOG_RESTORE_CONFLICT',
    });
  });

  it('rejects missing lifecycle updates, unsafe audit field names, and exhausted retries', async () => {
    const transaction = {
      $executeRaw: vi.fn(() => Promise.resolve(0)),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ lifecycle: 'ACTIVE', revision: 1 }])
        .mockResolvedValueOnce([]),
      auditLog: { create: vi.fn() },
    };
    const repository = createPrismaCatalogVersionRepository(prismaWithTransaction(transaction));
    await expect(
      repository.changeLifecycle({
        kind: 'DISH',
        aggregateId: randomUUID(),
        expectedRevision: 1,
        transition: 'RETIRE',
        context: context(),
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_LIFECYCLE_CONFLICT' });
    expect(() =>
      repository.compareAndSwapDraft({
        kind: 'DISH',
        aggregateId: randomUUID(),
        versionId: randomUUID(),
        expectedRevision: 1,
        changedFields: ['objectKey.secret'],
        context: context(),
        mutate: () => Promise.resolve(),
      }),
    ).toThrow(TypeError);

    const retry = new Prisma.PrismaClientKnownRequestError('retry', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const retryingPrisma = {
      $transaction: vi.fn(() => Promise.reject(retry)),
    } as unknown as PrismaClient;
    const retryingRepository = createPrismaCatalogVersionRepository(retryingPrisma);
    await expect(
      retryingRepository.publish({
        kind: 'DISH',
        aggregateId: randomUUID(),
        versionId: randomUUID(),
        expectedRevision: 1,
        context: context(),
      }),
    ).rejects.toBe(retry);
    expect(transactionMock(retryingPrisma)).toHaveBeenCalledTimes(3);
  });
});
