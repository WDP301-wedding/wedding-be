import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse } from 'dotenv';
import pg from 'pg';

// Local acceptance only: never inherit runtime DATABASE_URL from the application
// .env. The foundation tests also need an actual Prisma migration history table.
const demo = parse(readFileSync('.env.demo'));
const adminUrl = new URL(demo.DATABASE_URL);
if (
  adminUrl.hostname !== '127.0.0.1' ||
  adminUrl.port !== '55435' ||
  adminUrl.pathname !== '/wedding_local_demo'
)
  throw Error('Local demo administrator required for disposable verification.');
const databaseName = `staff_foundation_${randomUUID().replaceAll('-', '')}`;
if (!/^staff_foundation_[a-f0-9]{32}$/u.test(databaseName))
  throw Error('Invalid disposable database name.');
const isolatedUrl = new URL(adminUrl);
isolatedUrl.pathname = '/' + databaseName;
isolatedUrl.searchParams.delete('options');
isolatedUrl.searchParams.delete('schema');
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: isolatedUrl.toString(),
  MIGRATION_DATABASE_URL: isolatedUrl.toString(),
  TEST_MIGRATION_DATABASE_URL: adminUrl.toString(),
};
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
const admin = new pg.Client({ connectionString: adminUrl.toString() });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const deployment = await run([
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
    '--config',
    'prisma.config.ts',
  ]);
  if (deployment !== 0) throw Error('Disposable migration deployment failed.');
  process.exitCode = await run(['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)]);
} finally {
  if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
