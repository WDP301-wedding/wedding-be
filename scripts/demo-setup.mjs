import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config as dotenv, parse } from 'dotenv';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const mode = process.argv[2] ?? 'setup';
if (!['setup', 'start-db', 'stop-db'].includes(mode))
  throw new Error('Usage: node scripts/demo-setup.mjs [setup|start-db|stop-db]');
const directory = resolve(root, '.local-demo');
const data = resolve(directory, 'postgres');
const envFile = resolve(root, '.env.demo');
mkdirSync(directory, { recursive: true });
dotenv({ quiet: true });
if (!existsSync(envFile)) {
  if (mode !== 'setup') throw new Error('Run npm run demo:setup first.');
  const sender =
    process.env.BREVO_FROM_EMAIL?.match(/<([^<>]+)>/)?.[1] ?? process.env.BREVO_FROM_EMAIL;
  const gmail = sender?.trim().match(/^([^+@]+)@gmail\.com$/i);
  const managerEmail =
    process.env.DEMO_MANAGER_EMAIL ??
    (gmail ? `${gmail[1]}+manager@gmail.com` : 'manager@demo.example');
  const coupleEmail =
    process.env.DEMO_COUPLE_EMAIL ??
    (gmail ? `${gmail[1]}+couple@gmail.com` : 'couple@demo.example');
  const databasePassword = randomBytes(24).toString('hex');
  writeFileSync(
    envFile,
    [
      'NODE_ENV=development',
      'PORT=3001',
      'LOG_LEVEL=info',
      'CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3002',
      `DATABASE_URL=postgresql://wedding_demo:${databasePassword}@127.0.0.1:55435/wedding_local_demo`,
      `MIGRATION_DATABASE_URL=postgresql://wedding_demo:${databasePassword}@127.0.0.1:55435/wedding_local_demo`,
      `AUTH_OTP_HASH_KEY=${randomBytes(32).toString('hex')}`,
      `DEMO_MANAGER_EMAIL=${managerEmail}`,
      `DEMO_COUPLE_EMAIL=${coupleEmail}`,
      `DEMO_MANAGER_PASSWORD=Manager-${randomBytes(9).toString('base64url')}!`,
      `DEMO_COUPLE_PASSWORD=Couple-${randomBytes(9).toString('base64url')}!`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}
const demo = parse(readFileSync(envFile));
Object.assign(process.env, demo);
const databaseUrl = new URL(demo.DATABASE_URL);
if (
  databaseUrl.hostname !== '127.0.0.1' ||
  databaseUrl.port !== '55435' ||
  databaseUrl.pathname !== '/wedding_local_demo'
) {
  throw new Error('Demo setup only operates on 127.0.0.1:55435/wedding_local_demo.');
}
const bin = process.env.POSTGRES_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: process.env,
    windowsHide: true,
    encoding: 'utf8',
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${executable.split(/[\\/]/).at(-1)} failed. ${result.error?.message ?? result.stderr ?? ''}`,
    );
  return result.stdout;
}
if (mode === 'stop-db') {
  if (!existsSync(resolve(data, 'PG_VERSION'))) throw new Error('Demo cluster is not initialized.');
  run(resolve(bin, 'pg_ctl.exe'), ['-D', data, 'stop', '-m', 'fast']);
  console.log('Stopped local demo PostgreSQL; data remains saved.');
  process.exit(0);
}
if (!existsSync(resolve(data, 'PG_VERSION'))) {
  if (mode !== 'setup') throw new Error('Run npm run demo:setup first.');
  const passwordFile = resolve(directory, 'init-password.tmp');
  writeFileSync(passwordFile, decodeURIComponent(databaseUrl.password), { mode: 0o600 });
  try {
    run(resolve(bin, 'initdb.exe'), [
      '-D',
      data,
      '-U',
      'wedding_demo',
      '--auth-local=trust',
      '--auth-host=scram-sha-256',
      '--no-locale',
      '-E',
      'UTF8',
      `--pwfile=${passwordFile}`,
    ]);
  } finally {
    unlinkSync(passwordFile);
  }
}
const status = spawnSync(resolve(bin, 'pg_ctl.exe'), ['-D', data, 'status'], {
  windowsHide: true,
  encoding: 'utf8',
});
// On Windows postgres can inherit captured pipe handles and keep spawnSync waiting.
if (status.status !== 0)
  run(
    resolve(bin, 'pg_ctl.exe'),
    ['-D', data, '-l', resolve(directory, 'postgres.log'), '-o', '-h 127.0.0.1 -p 55435', 'start'],
    { stdio: 'ignore' },
  );
if (mode === 'start-db') {
  console.log('Local demo PostgreSQL ready on 127.0.0.1:55435.');
  process.exit(0);
}
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.href });
await admin.connect();
try {
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    'wedding_local_demo',
  ]);
  if (found.rowCount === 0) await admin.query('CREATE DATABASE wedding_local_demo');
} finally {
  await admin.end();
}
run(process.execPath, [
  'node_modules/prisma/build/index.js',
  'migrate',
  'deploy',
  '--config',
  'prisma.config.ts',
]);
run(process.execPath, ['--env-file=.env.demo', '--import', 'tsx', 'scripts/demo-seed.ts']);
console.log('Local demo is ready. Credentials are saved privately in .env.demo.');
