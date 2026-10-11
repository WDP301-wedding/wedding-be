import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { retentionOptions } from '../../scripts/retention-options.js';
const exec = promisify(execFile),
  database = new CatalogTestDatabase('rv06cli');
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'current retention CLIs on populated disposable database',
  () => {
    let url: string;
    beforeAll(async () => {
      const base = new URL(catalogMigrationDatabaseUrl!);
      if (!['127.0.0.1', 'localhost'].includes(base.hostname))
        throw new Error('CLI rehearsal requires disposable loopback PostgreSQL.');
      await database.connect();
      base.pathname = '/' + database.databaseName;
      base.searchParams.delete('schema');
      base.searchParams.delete('options');
      url = base.toString();
    }, 60000);
    afterAll(() => database.disconnect());
    async function run(script: 'identity' | 'intake', args?: string[]) {
      const fingerprint = retentionOptions(['--inspect-target'], url).fingerprint;
      const result = await exec(
        process.execPath,
        [
          '--import',
          'tsx',
          `scripts/${script}-retention.ts`,
          ...(args ?? [
            '--confirm-retention',
            `--target-fingerprint=${fingerprint}`,
            '--operator=rv06-disposable-rehearsal',
            '--batch-size=1',
          ]),
        ],
        {
          env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url, NODE_ENV: 'test' },
          timeout: 30000,
        },
      );
      const line = result.stdout
        .split(/\r?\n/u)
        .find((row) => row.startsWith('{') && row.includes('_retention_completed'));
      return JSON.parse(line!) as Record<string, number | string>;
    }
    const past = (days: number) => new Date(Date.now() - days * 86400000);
    it('executes due cleanup in bounded batches; preserves not-due, held and missing facts; retries/concurrency are safe', async () => {
      const prisma = database.prisma;
      async function account(kind: 'due' | 'held' | 'missing' | 'financial') {
        const consultationId = randomUUID();
        return prisma.account.create({
          data: {
            emailNormalized: `${randomUUID()}@example.invalid`,
            displayEmail: 'test@example.invalid',
            status: 'DISABLED',
            disabledAt: past(800),
            piiRetentionEligibleAt: past(400),
            ...(kind === 'held' ? { legalHoldUntil: new Date(Date.now() + 86400000) } : {}),
            consultationAccesses: { create: { consultationId } },
            ...(kind === 'missing'
              ? {}
              : {
                  retentionFacts: {
                    create: {
                      consultationId,
                      sourceBusinessRecordId: randomUUID(),
                      eligibleAfter:
                        kind === 'financial' ? new Date(Date.now() + 86400000) : past(500),
                    },
                  },
                }),
          },
        });
      }
      const due = await account('due'),
        held = await account('held'),
        missing = await account('missing'),
        financial = await account('financial');
      for (const days of [400, 399, 1])
        await prisma.session.create({
          data: {
            accountId: held.id,
            clientKind: 'WEB',
            refreshFamilyId: randomUUID(),
            status: 'REVOKED',
            revokedAt: past(days),
            idleExpiresAt: past(days),
            absoluteExpiresAt: past(days),
            createdAt: past(days + 1),
          },
        });
      await expect(
        run('identity', [
          '--confirm-retention',
          '--target-fingerprint=' + '0'.repeat(64),
          '--operator=test',
        ]),
      ).rejects.toThrow();
      expect(await prisma.session.count()).toBe(3);
      const first = await run('identity');
      expect(first.anonymizedAccounts).toBe(1);
      expect(first.deletedSessions).toBe(1);
      const concurrent = await Promise.all([run('identity'), run('identity')]);
      expect(concurrent.reduce((sum, r) => sum + Number(r.deletedSessions), 0)).toBe(1);
      expect((await run('identity')).deletedSessions).toBe(0);
      expect(await prisma.session.count()).toBe(1);
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: due.id } })).piiAnonymizedAt,
      ).not.toBeNull();
      for (const row of [held, missing, financial])
        expect(
          (await prisma.account.findUniqueOrThrow({ where: { id: row.id } })).piiAnonymizedAt,
        ).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: 'account.pii.anonymized' } })).toBe(1);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'identity.retention-batch.completed', requestId: String(first.requestId) },
      });
      expect(audit.metadata).toMatchObject({
        operatorId: 'rv06-disposable-rehearsal',
        batchSize: 1,
      });
      expect(JSON.stringify(audit)).not.toContain('example.invalid');
    }, 60000);
    it('runs actual intake script, retains converted reference and scrubs names once', async () => {
      const p = database.prisma;
      const manager = await p.account.create({
        data: {
          emailNormalized: `${randomUUID()}@example.invalid`,
          displayEmail: 'operator@example.invalid',
        },
      });
      const consultation = await p.consultation.create({
        data: {
          id: randomUUID(),
          managerAccountId: manager.id,
          intendedEmailNormalized: 'fixture@example.invalid',
          intendedEmail: 'fixture@example.invalid',
          displayName: 'Retained business record',
        },
      });
      const common = {
        payloadHash: 'a'.repeat(64),
        displayName: 'Synthetic',
        brideName: 'Lan',
        groomName: 'Minh',
        email: 'fixture@example.invalid',
        phone: '0900000000',
        message: 'Disposable fixture',
        createdAt: past(181),
      };
      const converted = await p.consultationRequest.create({
        data: {
          ...common,
          submissionId: randomUUID(),
          status: 'CONVERTED',
          consultationId: consultation.id,
        },
      });
      await p.consultationRequest.create({ data: { ...common, submissionId: randomUUID() } });
      const recent = await p.consultationRequest.create({
        data: { ...common, submissionId: randomUUID(), createdAt: past(1) },
      });
      const a = await run('intake'),
        b = await run('intake'),
        replay = await run('intake');
      expect(Number(a.deleted) + Number(b.deleted)).toBe(1);
      expect(Number(a.scrubbed) + Number(b.scrubbed)).toBe(1);
      expect(replay).toMatchObject({ deleted: 0, scrubbed: 0 });
      expect(
        await p.consultationRequest.findUniqueOrThrow({ where: { id: converted.id } }),
      ).toMatchObject({
        consultationId: consultation.id,
        email: '',
        brideName: null,
        groomName: null,
      });
      expect(
        (await p.consultationRequest.findUniqueOrThrow({ where: { id: recent.id } })).email,
      ).toBe('fixture@example.invalid');
      const audit = await p.auditLog.findFirstOrThrow({
        where: { requestId: String(a.requestId) },
      });
      expect(audit.metadata).toMatchObject({
        operatorId: 'rv06-disposable-rehearsal',
        batchSize: 1,
      });
    }, 60000);
  },
);
