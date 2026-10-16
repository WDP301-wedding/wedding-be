import pg from 'pg';

const region = process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION;
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
  source: region ? 'Railway container' : 'operator machine',
  region: region ?? null,
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
} catch (error) {
  result.failure = error.code ?? error.name;
  process.exitCode = 1;
} finally {
  await client.end();
  console.log(JSON.stringify(result));
}
