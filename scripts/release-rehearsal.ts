import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { parseEnvironment } from '../src/config/env.js';
import { bootstrap, type RunningServer } from '../src/server.js';
import { createPrismaClient } from '../src/core/database/prisma.js';

let stage = 'CONFIGURATION';

async function main() {
  // This executable never accepts shared/staging/production URLs or imports their env.
  const local = parse(await readFile('.env.demo'));
  const adminUrl = new URL(local.DATABASE_URL ?? '');
  assert(
    adminUrl.hostname === '127.0.0.1' &&
      adminUrl.port === '55435' &&
      adminUrl.pathname === '/wedding_local_demo',
    'Dedicated local demo administrator required.',
  );
  adminUrl.pathname = '/postgres';
  adminUrl.searchParams.delete('schema');
  adminUrl.searchParams.delete('options');
  const id = randomUUID().replaceAll('-', ''),
    databaseName = `rel_rehearsal_${id}`,
    restoreName = `rel_restore_${id}`;
  const directory = resolve('test-results', 'release-rehearsal', id);
  await mkdir(directory, { recursive: true });
  const migrationRoot = resolve('prisma/migrations');
  const migrations = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const baseline = '20261012030000_staff_operations';
  assert(migrations.includes(baseline), 'Approved SPEC-08 migration baseline missing.');
  const priorDirectory = resolve(directory, 'prior-migrations');
  await mkdir(priorDirectory);
  for (const name of migrations.filter((name) => name <= baseline)) {
    await mkdir(resolve(priorDirectory, name));
    await copyFile(
      resolve(migrationRoot, name, 'migration.sql'),
      resolve(priorDirectory, name, 'migration.sql'),
    );
  }
  await copyFile(
    resolve(migrationRoot, 'migration_lock.toml'),
    resolve(priorDirectory, 'migration_lock.toml'),
  );
  const priorConfig = resolve(directory, 'prior.config.ts');
  await writeFile(
    priorConfig,
    `import { defineConfig } from 'prisma/config';\nexport default defineConfig({schema:${JSON.stringify(resolve('prisma/schema.prisma').replaceAll('\\', '/'))},migrations:{path:${JSON.stringify(priorDirectory.replaceAll('\\', '/'))}},datasource:{url:process.env.MIGRATION_DATABASE_URL}});\n`,
  );
  const withDatabase = (name: string) => {
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    return url.toString();
  };
  const url = withDatabase(databaseName),
    restoredUrl = withDatabase(restoreName);
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    MIGRATION_DATABASE_URL: url,
  };
  const run = (file: string, args: string[], env: NodeJS.ProcessEnv = environment) =>
    new Promise<void>((done, fail) => {
      const child = spawn(file, args, {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once('error', () => fail(Error('Local rehearsal executable unavailable.')));
      child.once('exit', (code) => {
        if (code === 0) done();
        else {
          void writeFile(resolve(directory, 'failure.private.log'), output).then(() =>
            fail(Error('Local rehearsal command failed; see ignored private log.')),
          );
        }
      });
    });
  const deploy = (config: string, env = environment) =>
    run(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', config],
      env,
    );
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const created: string[] = [];
  let server: RunningServer | undefined;
  const runtimeConfig = (databaseUrl: string) => {
    const value = parseEnvironment({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      NOTIFICATIONS_WORKER_ENABLED: 'false',
    });
    // Port 0 is only for this in-process disposable rehearsal, never env config.
    return { ...value, runtime: { ...value.runtime, port: 0 } };
  };
  const start = async (databaseUrl: string) => {
    const value = await bootstrap({
      loadConfig: () => Promise.resolve(runtimeConfig(databaseUrl)),
    });
    server = value;
    const address = value.httpServer.address();
    assert(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const status = async (origin: string, path: string) =>
    (await fetch(origin + path, { signal: AbortSignal.timeout(10000) })).status;
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created.push(databaseName);
    stage = 'PRIOR_SCHEMA';
    await deploy(priorConfig);
    const fixture = createPrismaClient(url),
      erasedId = randomUUID(),
      retainedId = randomUUID();
    try {
      await fixture.account.createMany({
        data: [
          {
            id: erasedId,
            emailNormalized: 'erased-release-fixture@example.test',
            displayEmail: 'erased-release-fixture@example.test',
            status: 'DISABLED',
            disabledAt: new Date(),
          },
          {
            id: retainedId,
            emailNormalized: 'retained-release-fixture@example.test',
            displayEmail: 'retained-release-fixture@example.test',
          },
        ],
      });
    } finally {
      await fixture.$disconnect();
    }
    stage = 'POPULATED_UPGRADE';
    await deploy('prisma.config.ts');
    await deploy('prisma.config.ts'); // Repeat deployment must be harmless.
    stage = 'RUNTIME_START';
    let origin = await start(url);
    assert.equal(await status(origin, '/health/live'), 200);
    assert.equal(await status(origin, '/health/ready'), 200);
    stage = 'CONTROLLED_OUTAGE';
    await admin.query(`ALTER DATABASE "${databaseName}" ALLOW_CONNECTIONS false`);
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [
      databaseName,
    ]);
    assert.equal(await status(origin, '/health/ready'), 503);
    assert.equal(await status(origin, '/health/live'), 200);
    await admin.query(`ALTER DATABASE "${databaseName}" ALLOW_CONNECTIONS true`);
    assert.equal(await status(origin, '/health/ready'), 200);
    stage = 'GRACEFUL_SHUTDOWN';
    await server!.shutdown();
    server = undefined;
    origin = await start(url);
    assert.equal(await status(origin, '/health/ready'), 200);
    await server!.shutdown();
    server = undefined;
    stage = 'BACKUP_RESTORE';
    const backup = resolve(directory, 'disposable-backup.dump');
    const dbEnv = {
      ...environment,
      PGHOST: '127.0.0.1',
      PGPORT: '55435',
      PGUSER: decodeURIComponent(adminUrl.username),
      PGPASSWORD: decodeURIComponent(adminUrl.password),
      PGDATABASE: databaseName,
    };
    await run(
      process.env.RELEASE_PG_DUMP ?? 'pg_dump',
      ['--format=custom', '--file', backup],
      dbEnv,
    );
    await admin.query(`CREATE DATABASE "${restoreName}"`);
    created.push(restoreName);
    await run(
      process.env.RELEASE_PG_RESTORE ?? 'pg_restore',
      ['--exit-on-error', '--dbname', restoreName, backup],
      dbEnv,
    );
    const restored = createPrismaClient(restoredUrl);
    try {
      // Simulated erasure tombstone is applied before starting a restored service.
      await restored.account.update({
        where: { id: erasedId },
        data: {
          emailNormalized: `erased-${erasedId}@erased.invalid`,
          displayEmail: `erased-${erasedId}@erased.invalid`,
          displayName: null,
        },
      });
      const erased = await restored.account.findUniqueOrThrow({ where: { id: erasedId } });
      assert.equal(erased.status, 'DISABLED');
      assert(erased.emailNormalized.endsWith('@erased.invalid'));
      assert.equal(
        (await restored.account.findUniqueOrThrow({ where: { id: retainedId } })).status,
        'ACTIVE',
      );
    } finally {
      await restored.$disconnect();
    }
    origin = await start(restoredUrl);
    assert.equal(await status(origin, '/health/ready'), 200);
    await server!.shutdown();
    server = undefined;
    // Also deploy current artifacts from empty, independently of populated upgrade.
    const emptyName = `rel_empty_${id}`;
    await admin.query(`CREATE DATABASE "${emptyName}"`);
    created.push(emptyName);
    await deploy('prisma.config.ts', {
      ...environment,
      MIGRATION_DATABASE_URL: withDatabase(emptyName),
    });
    origin = await start(withDatabase(emptyName));
    assert.equal(await status(origin, '/health/ready'), 200);
    await server!.shutdown();
    server = undefined;
    await writeFile(
      resolve(directory, 'report.json'),
      JSON.stringify(
        {
          providerVersion: 'BACKEND-RELEASE@3.0.0',
          observedAt: new Date().toISOString(),
          target: 'disposable-local-postgresql',
          node: process.version,
          baseline,
          migrationCount: migrations.length,
          migrations: await Promise.all(
            migrations.map(async (name) => ({
              name,
              sha256: sha256(await readFile(resolve(migrationRoot, name, 'migration.sql'))),
            })),
          ),
          emptyDeployment: 'PASS',
          populatedUpgrade: 'PASS',
          repeatedDeployment: 'PASS',
          outage: { ready: 503, live: 200, recovered: 200 },
          gracefulRestart: 'PASS',
          backupSha256: sha256(await readFile(backup)),
          restore: 'PASS',
          syntheticErasureTombstoneBeforeReopen: 'PASS',
          productionBackupRetentionAndEncryption: 'NOT_VERIFIED',
          staging: 'NOT_EXECUTED',
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    console.log(`Local release rehearsal passed. Redacted report: ${directory}/report.json`);
  } finally {
    await server?.shutdown();
    for (const name of created.reverse()) {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.end();
  }
}
await main().catch(async (error: unknown) => {
  await mkdir('test-results/release-rehearsal', { recursive: true });
  await writeFile('test-results/release-rehearsal/failure.private.log', String(error));
  console.error(
    `Release rehearsal failed at ${stage}. No shared target was used; inspect ignored local diagnostics.`,
  );
  process.exitCode = 1;
});
