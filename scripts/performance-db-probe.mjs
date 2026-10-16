import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';

if (process.argv.includes('--if-enabled')) {
  const enabled = process.env.PERF_READONLY_DB_PROBE;
  if (enabled === undefined || enabled === 'false') process.exit(0);
  if (enabled !== 'true') throw new Error('PERF_READONLY_DB_PROBE must be true or false.');
}
const region = process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION;
const predeploy = process.argv.includes('--railway-predeploy');
if (
  predeploy &&
  !['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID'].every((key) =>
    process.env[key]?.trim(),
  )
)
  throw new Error('Predeploy evidence requires Railway project/environment/service metadata.');
if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
if (process.argv.includes('--container') && !region)
  throw new Error('Container evidence requires Railway region metadata.');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 8000,
  statement_timeout: 3000,
  query_timeout: 5000,
  application_name: 'wedding_performance_readonly_probe',
});
const result = {
  at: new Date().toISOString(),
  source: predeploy
    ? 'Railway predeploy container; runtime placement not inferred'
    : process.argv.includes('--container')
      ? 'Railway runtime container'
      : 'operator machine',
  region: region ?? null,
  ...(predeploy
    ? {
        target: {
          project: process.env.RAILWAY_PROJECT_ID,
          environment: process.env.RAILWAY_ENVIRONMENT_ID,
          service: process.env.RAILWAY_SERVICE_ID,
        },
      }
    : {}),
  pingMs: [],
};
try {
  const start = performance.now();
  await client.connect();
  result.connectMs = performance.now() - start;
  await client.query('BEGIN READ ONLY');
  for (let i = 0; i < 20; i++) {
    const before = performance.now();
    await client.query('SELECT 1');
    result.pingMs.push(performance.now() - before);
  }
  result.waiters = (
    await client.query(`SELECT state,wait_event_type,wait_event,count(*)::int AS count
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
    GROUP BY state,wait_event_type,wait_event`)
  ).rows;
  await client.query('ROLLBACK');
  if (process.argv.includes('--deadline')) {
    // Fixed, bounded, read-only SQL only. No table locks or business rows.
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('statement_timeout','100',true)");
    let serverCode;
    try {
      await client.query('SELECT pg_sleep(0.5)::text');
    } catch (error) {
      serverCode = error.code;
    } finally {
      await client.query('ROLLBACK');
    }
    result.deadline = { serverCode: serverCode ?? null };
    if (serverCode !== '57014') throw new Error('Server deadline not observed');
    const { createPrismaClient } = await import('../dist/core/database/prisma.js');
    const { safeReadQuery } = await import('../dist/core/database/safe-read.js');
    const { withRequestDeadline } = await import('../dist/core/http/request-deadline.js');
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('application_name', 'wedding_performance_safe_read_probe');
    const prisma = createPrismaClient(url.toString(), false);
    try {
      await prisma.$queryRaw`SELECT 1`;
      const deadline = (work) =>
        withRequestDeadline(
          { expiresAt: performance.now() + 5000, signal: new AbortController().signal },
          work,
        );
      const fast = await deadline(() =>
        safeReadQuery(
          prisma,
          (tx) => tx.$queryRaw`SELECT current_setting('transaction_read_only') AS read_only`,
          true,
        ),
      );
      if (fast[0]?.read_only !== 'on') throw new Error('Safe read is not read-only');
      let submitted = false;
      const started = performance.now();
      const pending = deadline(() =>
        safeReadQuery(
          prisma,
          (tx) => {
            submitted = true;
            return tx.$queryRaw`/* wedding_perf_readonly_deadline */ SELECT pg_sleep(10)::text`;
          },
          true,
        ),
      ).then(
        () => ({ code: 'UNEXPECTED_SUCCESS' }),
        (error) => ({ code: error.code ?? error.name }),
      );
      const active = async () =>
        Number(
          (
            await client.query(`SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE pid<>pg_backend_pid() AND state='active'
              AND query LIKE '/* wedding_perf_readonly_deadline */%'`)
          ).rows[0].count,
        );
      let activeBefore = 0;
      while (performance.now() - started < 3500 && activeBefore === 0) {
        await delay(250);
        activeBefore = await active();
      }
      const outcome = await pending;
      const elapsedMs = performance.now() - started;
      await delay(250);
      const activeAfter = await active();
      const reusable = await prisma.$queryRaw`SELECT 1 AS value`;
      result.deadline = {
        serverCode,
        submitted,
        activeBefore,
        activeAfter,
        outcome: outcome.code,
        elapsedMs,
        reusable: reusable[0]?.value === 1,
        readOnly: true,
      };
      if (
        !submitted ||
        activeBefore < 1 ||
        activeAfter !== 0 ||
        outcome.code !== 'REQUEST_TIMEOUT' ||
        reusable[0]?.value !== 1
      )
        throw new Error('Safe read deadline verification failed');
    } finally {
      await prisma.$disconnect();
    }
  }
} catch (error) {
  result.failure = error.code ?? error.name;
  process.exitCode = 1;
} finally {
  await client.end();
  console.log(JSON.stringify(result));
}
