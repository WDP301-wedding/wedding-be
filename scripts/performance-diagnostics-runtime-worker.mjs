export async function runDiagnosticsRuntimeWorker(configuration) {
  const region = process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION;
  const runtime = configuration.mode === 'runtime';
  const operator = configuration.mode === 'operator';
  if (
    (!runtime && !operator) ||
    ![undefined, 'waits', 'explain'].includes(configuration.operation) ||
    configuration.pairs !== 20 ||
    !process.env.DATABASE_URL ||
    (runtime &&
      (!/^[a-f0-9-]{36}$/u.test(configuration.deploymentId ?? '') ||
        process.env.RAILWAY_DEPLOYMENT_ID !== configuration.deploymentId ||
        configuration.region !== 'sfo' ||
        region !== configuration.region)) ||
    (operator &&
      (configuration.deploymentId !== null ||
        configuration.region !== null ||
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname)))
  )
    throw Error('PERF03_RUNTIME_IDENTITY_REQUIRED');
  const { createServer } = await import('node:http');
  const { createHash } = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { default: pg } = await import('pg');
  const moduleAt = (path) => import(pathToFileURL(resolve(path)).href);
  const { DiagnosticPool } = await moduleAt('dist/core/database/diagnostics.js');
  const { createApp } = await moduleAt('dist/app.js');
  const { createLogger } = await moduleAt('dist/core/logging/logger.js');
  const report = {
    event: 'perf03_runtime_receipt',
    at: new Date().toISOString(),
    deploymentId: runtime ? configuration.deploymentId : null,
    region: runtime ? region : null,
    node: process.version,
    source: runtime
      ? 'actual Railway runtime container; fixed read-only diagnostic experiment'
      : 'operator machine, loopback PostgreSQL; not Railway/container acceptance',
    pingMs: [],
    samples: [],
    middlewareSamples: [],
    waitSnapshots: [],
    semantics:
      'Loopback HTTP on/off pairs include DB/network noise. Pool cap1 for both owned probe pools. No business owner pool or external provider is invoked.',
  };
  const resources = [],
    servers = [];
  const observer = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 8000,
    statement_timeout: 3000,
    query_timeout: 5000,
    application_name: 'perf03_readonly_observer',
  });
  try {
    const started = performance.now();
    resources.push(() => observer.end());
    await observer.connect();
    report.connectMs = performance.now() - started;
    await observer.query('SET default_transaction_read_only=on');
    for (let index = 0; index < 20; index++) {
      const before = performance.now();
      await observer.query('SELECT 1');
      report.pingMs.push(performance.now() - before);
    }
    if (configuration.operation === 'explain') {
      report.semantics =
        'Fixed SELECT 1 only: PostgreSQL-reported execution/planning times versus measured container round trip. These are not execution times of business SQL.';
      report.serverExecutionSamples = [];
      for (let index = 0; index < 20; index++) {
        const before = performance.now();
        const result = await observer.query('EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1');
        const plan = result.rows[0]['QUERY PLAN'][0];
        report.serverExecutionSamples.push({
          index,
          roundTripMs: performance.now() - before,
          executionMs: plan['Execution Time'],
          planningMs: plan['Planning Time'],
        });
      }
      return;
    }
    if (configuration.operation === 'waits') {
      report.semantics =
        'Bounded database-wide wait snapshots during HTTP reads; no SQL, PID or request-specific lock-duration inference. Each SELECT has its own fresh statistics snapshot.';
      for (let index = 0; index < 180; index++) {
        const before = performance.now();
        const rows = (
          await observer.query(`SELECT state,wait_event_type,wait_event,
          count(*)::int AS count,
          count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid))>0)::int AS blocked
          FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND backend_type='client backend'
          GROUP BY state,wait_event_type,wait_event ORDER BY state,wait_event_type,wait_event`)
        ).rows;
        report.waitSnapshots.push({
          index,
          at: new Date().toISOString(),
          ms: performance.now() - before,
          rows,
        });
        await delay(750);
      }
      return;
    }
    const pools = {};
    let sharedPool;
    const probeUrl = new URL(process.env.DATABASE_URL);
    probeUrl.searchParams.set(
      'options',
      `${probeUrl.searchParams.get('options') ?? ''} -c default_transaction_read_only=on -c timezone=UTC`.trim(),
    );
    for (const enabled of [false, true]) {
      const Pool = enabled || configuration.sharedPool === true ? DiagnosticPool : pg.Pool;
      const pool =
        sharedPool ??
        new Pool({
          connectionString: probeUrl.toString(),
          max: 1,
          connectionTimeoutMillis: 2000,
          idleTimeoutMillis: 60000,
          statement_timeout: 3000,
          query_timeout: 5000,
          application_name: enabled ? 'perf03_owned_on' : 'perf03_owned_off',
        });
      if (configuration.sharedPool === true && sharedPool === undefined) sharedPool = pool;
      pools[String(enabled)] = pool;
      if (configuration.sharedPool !== true || !enabled) resources.push(() => pool.end());
      const readOnly = await pool.query(
        "SELECT current_setting('default_transaction_read_only') AS value",
      );
      if (readOnly.rows[0]?.value !== 'on') throw Error('PERF03_READONLY_REQUIRED');
      const logs = new Map();
      const logger = createLogger({
        level: 'info',
        runtimeEnvironment: 'test',
        destination: {
          write(line) {
            const row = JSON.parse(line);
            if (row.event === 'http_request_completed') logs.set(row.requestId, row);
          },
        },
      });
      const app = createApp({
        runtimeEnvironment: 'test',
        databaseDiagnosticsEnabled: enabled,
        logger,
        securityConfig: {
          replicaCount: 1,
          bodyLimitBytes: 1024,
          requestTimeoutMs: 10000,
          rateLimit: { maxRequests: 1000, windowMs: 60000 },
        },
        registerRoutes(app) {
          app.get('/perf03-fixed-read', async (_request, response, next) => {
            try {
              const result = await pool.query('SELECT 1 AS value');
              response.json({ value: result.rows[0].value });
            } catch (error) {
              next(error);
            }
          });
        },
      });
      const server = createServer(app);
      servers.push(server);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      pools[String(enabled)] = { pool, logs, origin: 'http://127.0.0.1:' + server.address().port };
    }
    if (configuration.sharedPool === true)
      report.semantics =
        'Both variants share one diagnostic pool and the same connection; off forwards through an installed inactive driver proxy, on adds request ALS, numeric aggregates and log serialization. Measures aggregation/middleware overhead separately from full raw-pool comparison.';
    for (let pair = 0; pair <= 20; pair++) {
      const order = pair % 2 === 0 ? [false, true] : [true, false];
      for (const enabled of order) {
        const { logs, origin } = pools[String(enabled)];
        const before = performance.now();
        const response = await fetch(origin + '/perf03-fixed-read', {
          signal: AbortSignal.timeout(10000),
        });
        const body = await response.json();
        const ms = performance.now() - before;
        const row = logs.get(response.headers.get('x-request-id'));
        logs.clear();
        report.samples.push({
          pair,
          enabled,
          status: response.status,
          ms,
          serverMs: row?.durationMs,
          ...(enabled ? { database: row?.database } : {}),
        });
        if (
          response.status !== 200 ||
          body.value !== 1 ||
          !row ||
          ms > 10000 ||
          (enabled && (row.database?.queries !== 1 || row.database.errors !== 0))
        )
          throw Error('PERF03_FIXED_READ_FAILED');
      }
      // Repeat health to measure middleware/logging overhead without a DB RTT.
      for (const enabled of order) {
        const { origin, logs } = pools[String(enabled)];
        const before = performance.now();
        const response = await fetch(origin + '/health/live', {
          signal: AbortSignal.timeout(10000),
        });
        await response.arrayBuffer();
        const ms = performance.now() - before;
        const row = logs.get(response.headers.get('x-request-id'));
        logs.clear();
        report.middlewareSamples.push({
          pair,
          enabled,
          status: response.status,
          ms,
          serverMs: row?.durationMs,
        });
        if (response.status !== 200 || !row) throw Error('PERF03_HEALTH_FAILED');
      }
      report.waitSnapshots.push({
        pair,
        at: new Date().toISOString(),
        rows: (
          await observer.query(
            `SELECT state,wait_event_type,wait_event,count(*)::int AS count
         FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
         GROUP BY state,wait_event_type,wait_event ORDER BY state,wait_event_type,wait_event`,
          )
        ).rows,
      });
      await delay(750);
    }
    report.fixedReadSha256 = createHash('sha256').update('SELECT 1 AS value').digest('hex');
  } catch (error) {
    report.failure = /^PERF03_/u.test(error.message)
      ? error.message
      : 'PERF03_RUNTIME_PROBE_FAILED';
    process.exitCode = 1;
  } finally {
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    const closed = await Promise.allSettled(resources.reverse().map((close) => close()));
    report.cleanupPassed = closed.every((result) => result.status === 'fulfilled');
    if (!report.cleanupPassed) process.exitCode = 1;
    report.completedAt = new Date().toISOString();
    console.log(JSON.stringify(report));
  }
}
