import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL?.trim() || !process.env.PERF_POOL_OUTPUT)
  throw new Error('Selected DATABASE_URL and new PERF_POOL_OUTPUT are required.');
const result = {
  at: new Date().toISOString(),
  source: 'Operator machine to selected database; not container RTT',
  method:
    'Six alternating pairs, 12s idle gap, max=1 per pool, operator-only connect timeout 8s, read-only transactions only. Runtime acquisition budget is unchanged.',
  samples: [],
};
await writeFile(process.env.PERF_POOL_OUTPUT, '{}\n', { flag: 'wx' });
const pools = [10000, 60000].map((idleTimeoutMillis) => {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis,
    connectionTimeoutMillis: 8000,
    statement_timeout: 3000,
    query_timeout: 5000,
    application_name: 'wedding_performance_readonly_pool_lifecycle',
  });
  let connections = 0;
  pool.on('connect', () => connections++);
  pool.on('error', (error) => {
    result.failure = error.code ?? error.name;
  });
  return { pool, idleTimeoutMillis, connections: () => connections };
});
try {
  for (let round = 0; round < 6; round++) {
    if (round) await delay(12000);
    if (result.failure) throw new Error('Idle pool error');
    for (const state of round % 2 ? [...pools].reverse() : pools) {
      const started = performance.now();
      const client = await state.pool.connect();
      const acquireMs = performance.now() - started;
      let clean = false;
      try {
        await client.query('BEGIN READ ONLY');
        const value = await client.query(
          "SELECT 1 AS value, current_setting('transaction_read_only') AS read_only",
        );
        if (value.rows[0]?.value !== 1 || value.rows[0]?.read_only !== 'on')
          throw new Error('Read-only probe invariant failed');
        await client.query('ROLLBACK');
        clean = true;
      } finally {
        client.release(!clean);
      }
      result.samples.push({
        round,
        idleTimeoutMillis: state.idleTimeoutMillis,
        acquireMs,
        totalMs: performance.now() - started,
        connectionsCreated: state.connections(),
        readOnly: true,
      });
    }
    console.log(JSON.stringify({ round, samples: result.samples.length }));
  }
  if (result.failure) throw new Error('Idle pool error');
} catch (error) {
  result.failure = /timeout/iu.test(error.message)
    ? 'CONNECTION_OR_QUERY_TIMEOUT'
    : (error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await Promise.all(pools.map(({ pool }) => pool.end()));
  result.finishedAt = new Date().toISOString();
  await writeFile(process.env.PERF_POOL_OUTPUT, JSON.stringify(result, null, 2) + '\n');
}
