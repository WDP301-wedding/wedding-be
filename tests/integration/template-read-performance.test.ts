import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';
import { StudioRepository } from '../../src/modules/invitation-studio/infrastructure/studio.repository.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('PERF-06 captured template versions', () => {
  const db = new CatalogTestDatabase('template_perf');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);

  it('uses three actual driver commands for both authority checks and a bounded page', async () => {
    const f = await studioFixture(db.prisma);
    for (let n = 0; n < 21; n++)
      await f.services.designs.saveTemplate(
        {
          templateId: randomUUID(),
          expectedRevision: 0,
          active: true,
          content: f.content,
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    const measured = createPrismaClient(url.toString(), true);
    try {
      const studio = createInvitationStudioServices(
        measured,
        controlledStorage().provider,
        null,
        null,
        () => f.now,
      );
      for (const limit of [1, 4, 20]) {
        const diagnostics = newDatabaseDiagnostics();
        const page = await withDatabaseDiagnostics(diagnostics, () =>
          studio.designs.listTemplates({ limit }, f.manager),
        );
        expect(page.items).toHaveLength(limit);
        expect(diagnostics.queries).toBe(3);
        expect(diagnostics.errors).toBe(0);
      }
      const diagnostics = newDatabaseDiagnostics();
      const empty = await withDatabaseDiagnostics(diagnostics, () =>
        studio.designs.listTemplates({ cursor: 'ffffffff-ffff-4fff-bfff-ffffffffffff' }, f.manager),
      );
      expect(empty).toEqual({ items: [], nextCursor: null });
      expect(diagnostics.queries).toBe(3);
    } finally {
      await measured.$disconnect();
    }
  });

  it('quotes the constructed schema and binds archive, cursor and page boundaries', async () => {
    const f = await studioFixture(db.prisma);
    const templateId = randomUUID();
    await f.services.designs.saveTemplate(
      {
        templateId,
        expectedRevision: 0,
        active: false,
        content: f.content,
        idempotencyKey: randomUUID(),
      },
      f.manager,
    );
    await f.services.designs.saveTemplate(
      {
        templateId: randomUUID(),
        expectedRevision: 0,
        active: true,
        content: f.content,
        idempotencyKey: randomUUID(),
      },
      f.manager,
    );
    await db.prisma.$executeRawUnsafe('CREATE SCHEMA "perf06 ""isolated"');
    await db.prisma.$executeRawUnsafe(
      'CREATE TABLE "perf06 ""isolated"."InvitationTemplate" AS TABLE "public"."InvitationTemplate"',
    );
    await db.prisma.$executeRawUnsafe(
      'CREATE TABLE "perf06 ""isolated"."InvitationTemplateVersion" AS TABLE "public"."InvitationTemplateVersion"',
    );
    // Change the public copy to catch an accidental fallback to public.
    await f.services.designs.saveTemplate(
      {
        templateId,
        expectedRevision: 1,
        active: true,
        content: f.content,
        idempotencyKey: randomUUID(),
      },
      f.manager,
    );
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.set('schema', 'perf06 "isolated');
    const scoped = createPrismaClient(url.toString());
    try {
      const repository = new StudioRepository(scoped, f.services.boundary);
      const active = await repository.templatePage({ limit: 100, includeArchived: false });
      expect(active.some((row) => row.id === templateId)).toBe(false);
      const archived = await repository.templatePage({ limit: 100, includeArchived: true });
      expect(archived.some((row) => row.id === templateId)).toBe(true);
      const first = await repository.templatePage({ limit: 1, includeArchived: true });
      expect(first).toHaveLength(2); // one returned item plus the cursor sentinel
      const rest = await repository.templatePage({
        cursor: first[0]!.id,
        limit: 100,
        includeArchived: true,
      });
      expect(rest.map((row) => row.id)).toEqual(archived.slice(1).map((row) => row.id));
    } finally {
      await scoped.$disconnect();
    }
  });

  it('bounds version reads for 1/4/20 templates and preserves pages and captured revisions', async () => {
    const f = await studioFixture(db.prisma);
    for (let n = 0; n < 21; n++)
      await f.services.designs.saveTemplate(
        {
          templateId: randomUUID(),
          expectedRevision: 0,
          active: true,
          content: { ...f.content, title: `Template ${n}` },
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
    const one = vi.spyOn(db.prisma.invitationTemplateVersion, 'findUniqueOrThrow');
    const batch = vi.spyOn(db.prisma.invitationTemplateVersion, 'findMany');
    const joined = vi.spyOn(f.services.studioRepository, 'templatePage');
    const sessionReads = vi.spyOn(db.prisma.session, 'findUnique');
    try {
      for (const limit of [1, 4, 20]) {
        one.mockClear();
        batch.mockClear();
        joined.mockClear();
        sessionReads.mockClear();
        const page = await f.services.designs.listTemplates({ limit }, f.manager);
        expect(page.items).toHaveLength(limit);
        expect(page.nextCursor).toBe(page.items.at(-1)!.templateId);
        const next = await f.services.designs.listTemplates(
          { limit: 100, cursor: page.nextCursor },
          f.manager,
        );
        expect(next.items.every((r) => r.templateId > page.nextCursor!)).toBe(true);
        expect(one).not.toHaveBeenCalled();
        expect(batch).not.toHaveBeenCalled();
        expect(joined).toHaveBeenCalledTimes(2);
        expect(sessionReads).not.toHaveBeenCalled();
      }
    } finally {
      one.mockRestore();
      batch.mockRestore();
      joined.mockRestore();
      sessionReads.mockRestore();
    }
  });

  it.each([
    ['empty', 'session'],
    ['populated', 'session'],
    ['empty', 'role'],
    ['populated', 'role'],
  ] as const)('rechecks %s-page authority after %s revocation', async (page, revoked) => {
    const f = await studioFixture(db.prisma);
    const read = f.services.studioRepository.templatePage.bind(f.services.studioRepository);
    const spy = vi
      .spyOn(f.services.studioRepository, 'templatePage')
      .mockImplementationOnce((args) => {
        const result = read(args);
        return result.then(async (rows) => {
          if (revoked === 'session')
            await db.prisma.session.update({
              where: { id: f.manager.sessionId },
              data: { status: 'REVOKED' },
            });
          else
            await db.prisma.accountRole.deleteMany({
              where: { accountId: f.manager.actorId, role: 'MANAGER' },
            });
          return rows;
        });
      });
    try {
      await expect(
        f.services.designs.listTemplates(
          page === 'empty' ? { cursor: 'ffffffff-ffff-4fff-bfff-ffffffffffff' } : { limit: 1 },
          f.manager,
        ),
      ).rejects.toMatchObject({ status: revoked === 'session' ? 401 : 404 });
    } finally {
      spy.mockRestore();
    }
  });
  it.each(['wrong owner', 'missing version'])(
    'rejects a captured row with %s',
    async (corruption) => {
      const f = await studioFixture(db.prisma);
      await f.services.designs.saveTemplate(
        {
          templateId: randomUUID(),
          expectedRevision: 0,
          active: true,
          content: f.content,
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
      const read = f.services.studioRepository.templatePage.bind(f.services.studioRepository);
      const spy = vi
        .spyOn(f.services.studioRepository, 'templatePage')
        .mockImplementationOnce((args) => {
          const result = read(args);
          return result.then((rows) =>
            rows.map((r) =>
              corruption === 'wrong owner'
                ? { ...r, versionTemplateId: randomUUID() }
                : { ...r, versionId: null, versionTemplateId: null, content: null },
            ),
          );
        });
      try {
        await expect(
          f.services.designs.listTemplates({ limit: 1 }, f.manager),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        spy.mockRestore();
      }
    },
  );
  it('returns the captured version if its head is revised and archived during the batch read', async () => {
    const f = await studioFixture(db.prisma);
    await f.services.designs.saveTemplate(
      {
        templateId: '00000000-0000-4000-8000-000000000001',
        expectedRevision: 0,
        active: true,
        content: f.content,
        idempotencyKey: randomUUID(),
      },
      f.manager,
    );
    const before = (await f.services.designs.listTemplates({ limit: 1 }, f.manager)).items[0]!;
    const read = f.services.studioRepository.templatePage.bind(f.services.studioRepository);
    const spy = vi
      .spyOn(f.services.studioRepository, 'templatePage')
      .mockImplementationOnce((args) => {
        const result = read(args);
        return result.then(async (rows) => {
          await f.services.designs.saveTemplate(
            {
              templateId: before.templateId,
              expectedRevision: before.revisionNumber,
              active: false,
              content: { ...f.content, title: 'Successor' },
              idempotencyKey: randomUUID(),
            },
            f.manager,
          );
          return rows;
        });
      });
    try {
      const during = await f.services.designs.listTemplates({ limit: 1 }, f.manager);
      expect(during.items[0]).toEqual(before);
      expect(
        (await f.services.designs.listTemplates({ limit: 100 }, f.manager)).items.some(
          (r) => r.templateId === before.templateId,
        ),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
