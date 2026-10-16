import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('PERF-06 captured template versions', () => {
  const db = new CatalogTestDatabase('template_perf');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);

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
    const sessionReads = vi.spyOn(db.prisma.session, 'findUnique');
    try {
      for (const limit of [1, 4, 20]) {
        one.mockClear();
        batch.mockClear();
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
        expect(batch).toHaveBeenCalledTimes(2);
        expect(sessionReads).not.toHaveBeenCalled();
      }
    } finally {
      one.mockRestore();
      batch.mockRestore();
      sessionReads.mockRestore();
    }
  });

  it('rechecks authority even for an empty page after session revocation', async () => {
    const f = await studioFixture(db.prisma);
    const read = db.prisma.invitationTemplate.findMany.bind(db.prisma.invitationTemplate);
    const spy = vi
      .spyOn(db.prisma.invitationTemplate, 'findMany')
      .mockImplementationOnce((args) => {
        const result = read(args);
        return result.then(async (rows) => {
          await db.prisma.session.update({
            where: { id: f.manager.sessionId },
            data: { status: 'REVOKED' },
          });
          return rows;
        }) as typeof result;
      });
    try {
      await expect(
        f.services.designs.listTemplates(
          { cursor: 'ffffffff-ffff-4fff-bfff-ffffffffffff' },
          f.manager,
        ),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      spy.mockRestore();
    }
  });
  it('rejects a captured version owned by another template', async () => {
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
    const read = db.prisma.invitationTemplateVersion.findMany.bind(
      db.prisma.invitationTemplateVersion,
    );
    const spy = vi
      .spyOn(db.prisma.invitationTemplateVersion, 'findMany')
      .mockImplementationOnce((args) => {
        const result = read(args);
        return result.then((rows) =>
          rows.map((r) => ({ ...r, templateId: randomUUID() })),
        ) as typeof result;
      });
    try {
      await expect(f.services.designs.listTemplates({ limit: 1 }, f.manager)).rejects.toMatchObject(
        { status: 404 },
      );
    } finally {
      spy.mockRestore();
    }
  });
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
    const read = db.prisma.invitationTemplateVersion.findMany.bind(
      db.prisma.invitationTemplateVersion,
    );
    const spy = vi
      .spyOn(db.prisma.invitationTemplateVersion, 'findMany')
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
        }) as typeof result;
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
