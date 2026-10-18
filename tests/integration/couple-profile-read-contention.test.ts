import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import { createCoupleProfileService } from '../../src/modules/booking-lifecycle/application/couple-profile.service.js';
import type { AuthenticatedActor } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'Couple profile read under pool contention',
  () => {
    const database = new CatalogTestDatabase('profile_contention');
    const consultationId = randomUUID();
    const managerId = randomUUID();
    const ownerId = randomUUID();
    const staffId = randomUUID();
    const actor = (accountId: string, roles: AuthenticatedActor['roles']): AuthenticatedActor => ({
      accountId,
      sessionId: randomUUID(),
      displayEmail: 'profile-test@example.test',
      roles,
    });
    const expected = {
      consultationId,
      displayName: 'Legacy label without inferred roles',
      revision: 1,
      brideName: null,
      groomName: null,
    };
    let pool: Pool;
    let prisma: PrismaClient;

    beforeAll(async () => {
      await database.connect();
      for (const accountId of [managerId, ownerId, staffId])
        await database.prisma.account.create({
          data: {
            id: accountId,
            emailNormalized: `${accountId}@example.test`,
            displayEmail: `${accountId}@example.test`,
          },
        });
      await database.prisma.consultation.create({
        data: {
          id: consultationId,
          managerAccountId: managerId,
          intendedEmail: 'profile-test@example.test',
          intendedEmailNormalized: 'profile-test@example.test',
          displayName: expected.displayName,
        },
      });
      for (const accountId of [ownerId, staffId])
        await database.prisma.consultationAccess.create({
          data: { accountId, consultationId, level: 'RESTRICTED' },
        });
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = '/' + database.databaseName;
      url.searchParams.delete('schema');
      url.searchParams.delete('options');
      pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10000 });
      prisma = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
      await prisma.$queryRaw`SELECT 1`;
    }, 60000);
    afterAll(async () => {
      await prisma?.$disconnect();
      await database.disconnect();
    });

    it('waits for an occupied single connection beyond two seconds and returns the authorized profile', async () => {
      const holder = await pool.connect();
      await holder.query('BEGIN READ ONLY');
      const pending = createCoupleProfileService(prisma)
        .read(consultationId, actor(ownerId, ['COUPLE']))
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      try {
        await delay(2500);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
      expect(await pending).toEqual({ value: expected });
      expect(await prisma.$queryRaw`SELECT 1 AS value`).toEqual([{ value: 1 }]);
    }, 15000);

    it('preserves owner, restricted prospect and mixed-role access while concealing ungranted and Staff-only reads', async () => {
      const service = createCoupleProfileService(prisma);
      for (const allowed of [
        actor(managerId, ['MANAGER']),
        actor(managerId, ['MANAGER', 'STAFF']),
        actor(ownerId, []),
        actor(ownerId, ['COUPLE']),
        actor(staffId, ['STAFF', 'COUPLE']),
      ])
        expect(await service.read(consultationId, allowed)).toEqual(expected);
      for (const denied of [
        actor(randomUUID(), ['MANAGER']),
        actor(randomUUID(), ['COUPLE']),
        actor(staffId, ['STAFF']),
      ])
        await expect(service.read(consultationId, denied)).rejects.toMatchObject({ status: 404 });
      await expect(service.read(randomUUID(), actor(managerId, ['MANAGER']))).rejects.toMatchObject(
        { status: 404 },
      );
      await database.prisma.consultationAccess.delete({
        where: { accountId_consultationId: { accountId: ownerId, consultationId } },
      });
      await expect(service.read(consultationId, actor(ownerId, ['COUPLE']))).rejects.toMatchObject({
        status: 404,
      });
    });

    it("reads the configured quoted schema without falling back to another schema's grant or profile", async () => {
      const schema = `profile_"${randomUUID().replaceAll('-', '')}`;
      const quoted = `"${schema.replaceAll('"', '""')}"`;
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = '/' + database.databaseName;
      const admin = new Client({ connectionString: url.toString() });
      await admin.connect();
      try {
        await admin.query(`CREATE SCHEMA ${quoted}`);
        for (const table of ['Consultation', 'ConsultationAccess'])
          await admin.query(
            `CREATE TABLE ${quoted}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
          );
      } finally {
        await admin.end();
      }
      url.searchParams.set('schema', schema);
      const scoped = createPrismaClient(url.toString());
      const seed = new Client({ connectionString: url.toString() });
      await seed.connect();
      try {
        const service = createCoupleProfileService(scoped);
        const owner = actor(staffId, ['COUPLE']);
        await expect(service.read(consultationId, owner)).rejects.toMatchObject({ status: 404 });
        await seed.query(
          `INSERT INTO ${quoted}."Consultation" (id,"managerAccountId","intendedEmail","intendedEmailNormalized","displayName","brideName","groomName",revision,"updatedAt") VALUES ($1,$2,$3,$3,$4,'Lan','Minh',7,now())`,
          [consultationId, managerId, 'scoped@example.test', 'Schema-owned label'],
        );
        await expect(service.read(consultationId, owner)).rejects.toMatchObject({ status: 404 });
        await seed.query(
          `INSERT INTO ${quoted}."ConsultationAccess" (id,"accountId","consultationId",level,"updatedAt") VALUES ($1,$2,$3,'RESTRICTED',now())`,
          [randomUUID(), staffId, consultationId],
        );
        expect(await service.read(consultationId, owner)).toEqual({
          consultationId,
          displayName: 'Schema-owned label',
          brideName: 'Lan',
          groomName: 'Minh',
          revision: 7,
        });
      } finally {
        await seed.end();
        await scoped.$disconnect();
      }
    });
  },
);
