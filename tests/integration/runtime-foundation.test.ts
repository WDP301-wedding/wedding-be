import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import { bootstrap } from '../../src/server.js';
import {
  executeManagerBootstrap,
  runManagerBootstrap,
  databaseTargetFingerprint,
} from '../../src/modules/identity-access/account/manager-bootstrap.js';

const baseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const local = baseUrl && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname);
const execFileAsync = promisify(execFile);

describe.skipIf(!local)('RV-01–03 disposable PostgreSQL runtime', () => {
  const admin = new Client({ connectionString: baseUrl });
  const schemas: string[] = [];
  beforeAll(async () => {
    await admin.connect();
  });
  afterAll(async () => {
    for (const schema of schemas) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });

  async function fixture() {
    const schema = `rv_foundation_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemas.push(schema);
    const url = new URL(baseUrl!);
    url.searchParams.set('schema', schema);
    await execFileAsync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      {
        env: { ...process.env, MIGRATION_DATABASE_URL: url.toString() },
        windowsHide: true,
      },
    );
    const config = parseEnvironment({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: url.toString(),
    });
    const prisma = createPrismaClient(url.toString());
    const execute = (input: Parameters<typeof executeManagerBootstrap>[1]) =>
      executeManagerBootstrap(config, input);
    const command = (email: string) => [
      '--environment=test',
      '--operator=rv-disposable-operator',
      `--target=${databaseTargetFingerprint(url.toString())}`,
      `--email=${email}`,
      '--confirm-bootstrap',
    ];
    const password = `Rv-${randomUUID()}`;
    const run = (email: string, records: object[]) =>
      runManagerBootstrap(command(email), {
        config,
        execute,
        readPassword: () => Promise.resolve(password),
        write: (record) => records.push(record),
      });
    return { schema, config, prisma, password, run };
  }

  it('uses the deployed composition for real schema/readiness, query timeout, recovery and shutdown', async () => {
    const f = await fixture();
    const running = await bootstrap({
      loadConfig: () => Promise.resolve({ ...f.config, runtime: { ...f.config.runtime, port: 0 } }),
    });
    const blocker = new Client({ connectionString: baseUrl });
    await blocker.connect();
    try {
      expect((await request(running.app).get('/health/ready')).status).toBe(200);
      await blocker.query('BEGIN');
      await blocker.query(`LOCK TABLE "${f.schema}"."_prisma_migrations" IN ACCESS EXCLUSIVE MODE`);
      const started = Date.now();
      const unavailable = await request(running.app).get('/health/ready');
      expect(unavailable.status).toBe(503);
      expect(JSON.stringify(unavailable.body)).not.toMatch(/postgresql|checksum|migration_name/u);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect((await request(running.app).get('/health/live')).status).toBe(200);
      await blocker.query('ROLLBACK');
      expect((await request(running.app).get('/health/ready')).status).toBe(200);
      await admin.query(
        `UPDATE "${f.schema}"."_prisma_migrations" SET checksum = 'incompatible' WHERE migration_name = '20261009040000_invitation_reporting_snapshots'`,
      );
      expect((await request(running.app).get('/health/ready')).status).toBe(503);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await running.shutdown();
      await f.prisma.$disconnect();
    }
    expect(running.httpServer.listening).toBe(false);
    expect(running.readiness.isReady()).toBe(false);
  }, 30_000);

  it('bootstraps once with a real password verifier and refuses a repeat without new audit or account', async () => {
    const f = await fixture();
    const records: object[] = [];
    try {
      await f.run('rv-first@example.test', records);
      await expect(f.run('rv-repeat@example.test', records)).rejects.toThrow();
      expect(await f.prisma.account.count()).toBe(1);
      expect(await f.prisma.accountRole.count({ where: { role: 'MANAGER' } })).toBe(1);
      expect(await f.prisma.passwordCredential.count()).toBe(1);
      const audits = await f.prisma.auditLog.findMany({
        where: { action: 'account.manager.bootstrapped' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.metadata).toEqual({
        environment: 'test',
        operatorReference: 'rv-disposable-operator',
      });
      expect(JSON.stringify([...records, ...audits])).not.toMatch(
        /rv-first@example|rv-repeat@example|derivedKeyEncoded|saltEncoded/u,
      );
      expect(JSON.stringify([...records, ...audits])).not.toContain(f.password);
    } finally {
      await f.prisma.$disconnect();
    }
  }, 30_000);

  it('serializes concurrent operators so exactly one Manager and one audit commit', async () => {
    const f = await fixture();
    const records: object[] = [];
    try {
      const results = await Promise.allSettled([
        f.run('rv-race-a@example.test', records),
        f.run('rv-race-b@example.test', records),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await f.prisma.account.count()).toBe(1);
      expect(
        await f.prisma.auditLog.count({ where: { action: 'account.manager.bootstrapped' } }),
      ).toBe(1);
      expect(records).toHaveLength(1);
    } finally {
      await f.prisma.$disconnect();
    }
  }, 30_000);

  it('runs the actual operator CLI using stdin descriptor without leaking secret material', async () => {
    const f = await fixture();
    const target = databaseTargetFingerprint(f.config.database.url!);
    const run = (descriptor: boolean) =>
      new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const args = [
          '--environment=test',
          '--operator=rv-cli-operator',
          `--target=${target}`,
          '--email=rv-cli@example.test',
          '--confirm-bootstrap',
          ...(descriptor ? ['--password-fd=0'] : []),
        ];
        const child = spawn(
          process.execPath,
          [
            '--import',
            'tsx',
            'src/modules/identity-access/account/manager-bootstrap.cli.ts',
            ...args,
          ],
          {
            env: { ...process.env, DATABASE_URL: f.config.database.url },
            windowsHide: true,
            stdio: 'pipe',
          },
        );
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, output }));
        child.stdin.on('error', () => undefined);
        child.stdin.end(descriptor ? `${f.password}\n` : '');
      });
    try {
      const noDescriptor = await run(false);
      expect(noDescriptor.code).toBe(1);
      expect(await f.prisma.account.count()).toBe(0);
      const first = await run(true);
      expect(first.code).toBe(0);
      expect(first.output).toContain('manager_bootstrap_completed');
      const repeat = await run(true);
      expect(repeat.code).toBe(1);
      for (const result of [noDescriptor, first, repeat]) {
        expect(result.output).not.toContain(f.password);
        expect(result.output).not.toMatch(
          /rv-cli@example|saltEncoded|derivedKeyEncoded|postgresql:\/\//u,
        );
      }
      expect(await f.prisma.account.count()).toBe(1);
      expect(
        await f.prisma.auditLog.count({ where: { action: 'account.manager.bootstrapped' } }),
      ).toBe(1);
    } finally {
      await f.prisma.$disconnect();
    }
  }, 30_000);

  it('rolls back account, role and password when audit insertion fails, then safely retries', async () => {
    const f = await fixture();
    const records: object[] = [];
    try {
      await admin.query(
        `CREATE FUNCTION "${f.schema}".reject_bootstrap_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled audit failure'; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER reject_bootstrap BEFORE INSERT ON "${f.schema}"."AuditLog" FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_bootstrap_audit()`,
      );
      await expect(f.run('rv-failure@example.test', records)).rejects.toThrow();
      expect(await f.prisma.account.count()).toBe(0);
      expect(await f.prisma.accountRole.count()).toBe(0);
      expect(await f.prisma.passwordCredential.count()).toBe(0);
      expect(await f.prisma.auditLog.count()).toBe(0);
      expect(records).toHaveLength(0);
      await admin.query(`DROP TRIGGER reject_bootstrap ON "${f.schema}"."AuditLog"`);
      await f.run('rv-recovered@example.test', records);
      expect(await f.prisma.account.count()).toBe(1);
    } finally {
      await f.prisma.$disconnect();
    }
  }, 30_000);
});
