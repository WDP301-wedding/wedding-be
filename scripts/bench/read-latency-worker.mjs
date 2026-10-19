export async function run(configuration, modules = []) {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const { createHash, randomUUID } = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const { setTimeout: delay } = await import('node:timers/promises');
  const assert = (await import('node:assert/strict')).default;
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  assert.equal(process.cwd(), '/app');
  assert.equal(process.env.RAILWAY_DEPLOYMENT_ID, configuration.deploymentId);
  assert.equal(process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION, 'sfo');
  assert.equal(process.env.DB_POOL_MAX, '1');
  assert.equal(process.env.DB_DIAGNOSTICS_ENABLED, 'false');
  assert.equal(process.env.DB_SAFE_READ_DEADLINE_ENABLED, 'false');
  assert([0, 20].includes(configuration.pairs));
  assert(Date.now() < Date.parse(configuration.expiresAt));
  for (const id of [configuration.bookingId, configuration.planId, configuration.attemptId])
    assert(/^[a-f0-9-]{36}$/.test(id));
  const moduleUrl = (path) => pathToFileURL('/app/dist/' + path).href;
  const load = (path) => import(moduleUrl(path));
  const { default: pg } = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await load('generated/prisma/client.js');
  const { DiagnosticPool, newDatabaseDiagnostics, withDatabaseDiagnostics } = await load(
    'core/database/diagnostics.js',
  );
  const { createInvitationStudioServices } = await load(
    'modules/invitation-studio/infrastructure/studio.composition.js',
  );
  const { createSeatingServices } = await load(
    'modules/seating-plan/infrastructure/seating.composition.js',
  );
  const { createPaymentsBillingProviders } = await load(
    'modules/payments-billing/payments-billing.providers.js',
  );
  const { createPaymentsBillingHttpServices } = await load(
    'modules/payments-billing/http/payments-billing.http-services.js',
  );
  const requestContext = new AsyncLocalStorage();
  const statements = new Map(),
    observedClients = new WeakSet(),
    initialAcquisitions = [];
  let backendPid,
    currentQuery,
    totalConnections = 0,
    observerStopped = false;
  const receipt = {
    event: 'read_attribution_native_receipt',
    startedAt: new Date().toISOString(),
    deploymentId: configuration.deploymentId,
    replicaId: process.env.RAILWAY_REPLICA_ID,
    region: 'sfo',
    node: process.version,
    poolMaximum: 1,
    observerConnections: 1,
    providerCalls: 0,
    writeGuard: true,
    samples: [],
    waits: [],
    plans: [],
    semantics:
      'Native owner invocations include one preflight actor resolution matching router authentication. Warm pool acquisition is separately measured; lock-command client RTT remains part of total SQL RTT. Server advisory acquisition timing includes function overhead and waiting but excludes network. EXPLAIN ANALYZE replays trusted captured SELECTs separately and is not an exact execution breakdown of earlier HTTP requests. Wait sampling cannot exclude short missed waits.',
  };

  function safe(text) {
    const stripped = text
      .replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/gu, '')
      .replace(/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/giu, '');
    if (
      !/^\s*(SELECT|WITH|SET|BEGIN|COMMIT|ROLLBACK|SHOW)\b/iu.test(stripped) ||
      /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|DO)\b/iu.test(stripped)
    )
      throw Error('NATIVE_WRITE_REFUSED');
  }
  class Pool extends DiagnosticPool {
    connect(callback) {
      const state = requestContext.getStore(),
        started = performance.now(),
        queued = this.idleCount === 0 && this.totalCount >= 1;
      const complete = (error, client, release) => {
        if (state)
          state.acquisitions.push({
            ms: performance.now() - started,
            queued,
            newConnection: !!client && !observedClients.has(client),
          });
        else
          initialAcquisitions.push({
            ms: performance.now() - started,
            queued,
            newConnection: !!client && !observedClients.has(client),
          });
        if (client) observedClients.add(client);
        if (callback)
          return state
            ? requestContext.run(state, () => callback(error, client, release))
            : callback(error, client, release);
      };
      if (callback) return super.connect(complete);
      return new Promise((resolve, reject) =>
        super.connect((error, client, release) => {
          complete(error, client, release);
          error ? reject(error) : resolve(client);
        }),
      );
    }
  }
  const connection = new URL(process.env.DATABASE_URL);
  connection.searchParams.set(
    'options',
    (connection.searchParams.get('options') ?? '') + ' -c timezone=UTC',
  );
  const pool = new Pool({
    connectionString: connection.toString(),
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 60000,
    application_name: 'read_latency_native',
  });
  pool.on('connect', (client) => {
    totalConnections++;
    backendPid = client.processID;
    const query = client.query.bind(client);
    client.query = new Proxy(query, {
      apply(target, receiver, args) {
        const state = requestContext.getStore();
        const input =
          typeof args[0] === 'string'
            ? { text: args[0], values: Array.isArray(args[1]) ? args[1] : [] }
            : args[0];
        const text = input?.text ?? '';
        safe(text);
        const advisory = /^\s*SELECT\s+pg_advisory_xact_lock(?:_shared)?\(/iu.test(text);
        const lifecycleBatch = /^\s*WITH layout_refs AS MATERIALIZED/iu.test(text);
        const rowLock = /\bFOR\s+(SHARE|UPDATE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)\b/iu.test(text);
        const fingerprint = hash(text);
        if (
          state &&
          /^\s*SELECT\b/iu.test(text) &&
          !advisory &&
          !rowLock &&
          /\bFROM\b/iu.test(text)
        )
          statements.set(fingerprint, { text, values: input.values ?? [] });
        if (advisory) {
          const original = text.replace(/;\s*$/u, '');
          const locked = /\bFROM\b/iu.test(original)
            ? original.replace(/\bFROM\b/iu, 'FROM __bench_start CROSS JOIN')
            : original + ' FROM __bench_start';
          const timed =
            'WITH __bench_start AS MATERIALIZED (SELECT clock_timestamp() AS started), __bench_lock AS MATERIALIZED (' +
            locked +
            ') SELECT (EXTRACT(EPOCH FROM (clock_timestamp()-(SELECT started FROM __bench_start)))*1000)::double precision AS __advisory_elapsed_ms FROM (SELECT count(*) FROM __bench_lock) completed';
          args[0] = typeof args[0] === 'string' ? timed : { ...input, text: timed };
        }
        if (lifecycleBatch) {
          assert(text.includes('locks.count AS "lockedTemplateCount"'));
          const timed = text
            .replace(
              /WITH layout_refs AS MATERIALIZED/iu,
              'WITH __bench_start AS MATERIALIZED (SELECT clock_timestamp() AS started), layout_refs AS MATERIALIZED',
            )
            .replace(/WHERE v\.id=ANY/iu, 'CROSS JOIN __bench_start WHERE v.id=ANY')
            .replace(
              'locks.count AS "lockedTemplateCount"',
              'locks.count AS "lockedTemplateCount", (EXTRACT(EPOCH FROM (clock_timestamp()-(SELECT started FROM __bench_start)))*1000)::double precision AS __lifecycle_lock_statement_ms',
            );
          args[0] = typeof args[0] === 'string' ? timed : { ...input, text: timed };
        }
        const started = performance.now();
        currentQuery = state
          ? { requestId: state.requestId, case: state.case, phase: state.phase }
          : undefined;
        let finished = false;
        const finish = (error, result) => {
          if (finished) return;
          finished = true;
          if (state) {
            const index =
              result?.fields?.findIndex((f) => f.name === '__advisory_elapsed_ms') ?? -1;
            const serverMs =
              index >= 0
                ? Number(
                    Array.isArray(result.rows[0])
                      ? result.rows[0][index]
                      : result.rows[0]?.__advisory_elapsed_ms,
                  )
                : undefined;
            const batchIndex =
              result?.fields?.findIndex((f) => f.name === '__lifecycle_lock_statement_ms') ?? -1;
            const batchServerMs =
              batchIndex >= 0
                ? Number(
                    Array.isArray(result.rows[0])
                      ? result.rows[0][batchIndex]
                      : result.rows[0]?.__lifecycle_lock_statement_ms,
                  )
                : undefined;
            state.commands.push({
              fingerprint,
              advisory,
              lifecycleBatch,
              rowLock,
              ms: performance.now() - started,
              ...(serverMs === undefined ? {} : { advisoryServerAcquireMs: serverMs }),
              ...(batchServerMs === undefined
                ? {}
                : { lifecycleLockStatementServerMs: batchServerMs }),
              failed: !!error,
            });
          }
          currentQuery = undefined;
        };
        const callback = args.at(-1);
        if (typeof callback === 'function')
          args[args.length - 1] = (error, result) => {
            finish(error, result);
            return callback(error, result);
          };
        try {
          const result = Reflect.apply(target, receiver, args);
          return result instanceof Promise
            ? result.then(
                (value) => {
                  finish(null, value);
                  return value;
                },
                (error) => {
                  finish(error);
                  throw error;
                },
              )
            : result;
        } catch (error) {
          finish(error);
          throw error;
        }
      },
    });
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
  const observer = new pg.Client({
    connectionString: connection.toString(),
    connectionTimeoutMillis: 10000,
    statement_timeout: 5000,
    application_name: 'read_latency_observer',
  });
  let watch;
  try {
    await observer.connect();
    await observer.query('SET default_transaction_read_only=on');
    const cold = {
      case: 'connection-establishment',
      phase: 'initial',
      requestId: randomUUID(),
      database: newDatabaseDiagnostics(),
      acquisitions: [],
      commands: [],
    };
    const start = performance.now();
    await requestContext.run(cold, () =>
      withDatabaseDiagnostics(cold.database, () => prisma.$queryRaw`SELECT 1`),
    );
    receipt.initialConnectAndFirstQuery = {
      ms: performance.now() - start,
      acquisitions: [...initialAcquisitions, ...cold.acquisitions],
      semantics:
        'Initial connection acquisition includes connection establishment; first-query wall time also includes SQL/network. These are not steady queue waits.',
    };
    const storage = new Proxy(
      {},
      {
        get() {
          return () => {
            throw Error('NATIVE_PROVIDER_REFUSED');
          };
        },
      },
    );
    const studio = createInvitationStudioServices(prisma, storage, null, null);
    const seating = createSeatingServices(prisma, studio);
    const payments = createPaymentsBillingHttpServices(
      prisma,
      createPaymentsBillingProviders(prisma, { vnpay: { enabled: false } }),
    );
    const variants = { baseline: { seating: seating.seating, payments } };
    const loaded = {},
      moduleCache = new Map();
    const definitionAt = new Map(
      modules.map((m) => [moduleUrl(m.path.replace(/^src\//u, '').replace(/\.ts$/u, '.js')), m]),
    );
    function relocatedModule(original) {
      if (moduleCache.has(original)) return moduleCache.get(original);
      const m = definitionAt.get(original);
      assert.equal(hash(m.compiled), m.compiledSha256);
      const relocated = m.compiled.replace(
        /\bfrom\s+(['"])([^'"]+)\1/gu,
        (_match, _quote, specifier) => {
          const resolved = specifier.startsWith('.')
            ? new URL(specifier, original).href
            : import.meta.resolve(specifier);
          return (
            'from ' +
            JSON.stringify(definitionAt.has(resolved) ? relocatedModule(resolved) : resolved)
          );
        },
      );
      const url = 'data:text/javascript;base64,' + Buffer.from(relocated).toString('base64');
      moduleCache.set(original, url);
      return url;
    }
    for (const [original, m] of definitionAt)
      loaded[m.key] = await import(relocatedModule(original));
    if (loaded.seating) {
      const { createGuestServices } = await load(
        'modules/guest-management/infrastructure/guest.composition.js',
      );
      const { createPrismaBookingReaders } = await load(
        'modules/booking-lifecycle/infrastructure/prisma-booking.readers.js',
      );
      const guests = createGuestServices(prisma, () => new Date(), undefined, studio.boundary);
      const billing = loaded.deposit.createPrismaDepositSettlementReader(prisma, guests.boundary);
      guests.owners.booking = createPrismaBookingReaders(
        prisma,
        guests.boundary,
        guests.identity.access,
        billing,
      ).booking;
      variants.candidate = {
        seating: new loaded.seating.SeatingService(
          guests,
          seating.seating.layouts,
          loaded.venue.createPrismaSelectionEligibilityReader(guests.boundary),
          seating.seating.registry,
        ),
        payments,
      };
    }
    watch = (async () => {
      while (!observerStopped && Date.now() < Date.parse(configuration.expiresAt)) {
        const active = currentQuery;
        if (active && backendPid) {
          const started = performance.now();
          const rows = (
            await observer.query(
              `SELECT a.wait_event_type,a.wait_event,
            cardinality(pg_blocking_pids(a.pid))>0 AS blocked,
            (SELECT jsonb_agg(jsonb_build_object('state',b.state,'statement',b.query,
              'transactionAgeMs',EXTRACT(EPOCH FROM clock_timestamp()-b.xact_start)*1000))
              FROM pg_stat_activity b WHERE b.pid=ANY(pg_blocking_pids(a.pid))) AS blockers
            FROM pg_stat_activity a WHERE a.pid=$1`,
              [backendPid],
            )
          ).rows.map(({ blockers, ...row }) => ({
            ...row,
            blockers: (blockers ?? []).map(({ statement, ...blocker }) => ({
              ...blocker,
              statementSha256: hash(statement ?? ''),
              kind:
                (statement ?? '')
                  .trim()
                  .match(/^[A-Za-z]+/u)?.[0]
                  ?.toUpperCase() ?? 'UNKNOWN',
              tables: [
                ...new Set(
                  [
                    ...(statement ?? '').matchAll(
                      /(?:FROM|JOIN|UPDATE|INTO)\s+(?:"[A-Za-z_]+"\.)?"([A-Za-z_]+)"/giu,
                    ),
                  ].map((m) => m[1]),
                ),
              ].slice(0, 20),
            })),
          }));
          receipt.waits.push({
            ...active,
            at: new Date().toISOString(),
            observerRoundTripMs: performance.now() - started,
            rows,
          });
        }
        await delay(100);
      }
    })();
    const cases = configuration.cases ?? ['seating-current', 'seating-detail', 'manual-attempt'];
    const expected = new Map();
    async function measure(variant, name, pair, phase) {
      assert(Date.now() < Date.parse(configuration.expiresAt));
      const state = {
        variant,
        case: name,
        phase,
        pair,
        requestId: randomUUID(),
        acquisitions: [],
        commands: [],
        database: newDatabaseDiagnostics(),
      };
      const started = performance.now(),
        connectsBefore = totalConnections;
      const result = await requestContext.run(state, () =>
        withDatabaseDiagnostics(state.database, async () => {
          const actor = await seating.resolver.resolve(configuration.token);
          const context = {
            accessToken: configuration.token,
            actorId: actor.accountId,
            requestId: state.requestId,
          };
          if (name === 'seating-current')
            return variants[variant].seating.readCurrent(configuration.bookingId, context);
          if (name === 'seating-detail')
            return variants[variant].seating.read(
              configuration.bookingId,
              configuration.planId,
              context,
            );
          if (name === 'manual-attempt')
            return variants[variant].payments.attempt(
              configuration.bookingId,
              configuration.attemptId,
              actor,
              state.requestId,
            );
          throw Error('NATIVE_CASE_REFUSED');
        }),
      );
      const sample = {
        ...state,
        ms: performance.now() - started,
        newConnections: totalConnections - connectsBefore,
        responseSha256: hash(JSON.stringify(result)),
      };
      assert(sample.ms < 25000);
      assert.equal(sample.newConnections, 0);
      if (!expected.has(name)) expected.set(name, sample.responseSha256);
      assert.equal(sample.responseSha256, expected.get(name));
      receipt.samples.push(sample);
      console.log(
        JSON.stringify({
          event: 'read_attribution_sample',
          variant,
          case: name,
          phase,
          pair,
          ms: sample.ms,
          queries: state.database.queries,
          acquireMs: state.database.acquireMs,
          advisoryServerAcquireMs: state.commands.reduce(
            (n, c) => n + (c.advisoryServerAcquireMs ?? 0),
            0,
          ),
        }),
      );
    }
    for (let pair = 0; pair <= configuration.pairs; pair++) {
      const order = pair % 2 === 0 ? Object.keys(variants) : Object.keys(variants).reverse();
      for (const name of cases)
        for (const variant of order)
          await measure(variant, name, pair, pair ? 'steady' : 'initial');
    }
    assert([0, 5].includes(configuration.cohorts ?? 0));
    for (let pair = 1; pair <= (configuration.cohorts ?? 0); pair++) {
      const order = pair % 2 === 0 ? Object.keys(variants) : Object.keys(variants).reverse();
      for (const variant of order)
        await Promise.all([
          measure(variant, 'seating-detail', pair, 'two-reader-cohort'),
          measure(variant, 'seating-detail', pair, 'two-reader-cohort'),
        ]);
    }
    observerStopped = true;
    await watch;
    for (const [fingerprint, statement] of statements) {
      safe(statement.text);
      const started = performance.now();
      const rows = (
        await observer.query(
          'EXPLAIN (ANALYZE, TIMING OFF, BUFFERS, FORMAT JSON) ' + statement.text,
          statement.values,
        )
      ).rows;
      const plan = rows[0]['QUERY PLAN'][0];
      receipt.plans.push({
        fingerprint,
        planningMs: plan['Planning Time'],
        executionMs: plan['Execution Time'],
        replayRoundTripMs: performance.now() - started,
        actualRows: plan.Plan['Actual Rows'],
        sharedHitBlocks: plan.Plan['Shared Hit Blocks'],
        sharedReadBlocks: plan.Plan['Shared Read Blocks'],
      });
    }
  } catch (error) {
    receipt.failure = {
      name: error.name,
      code: /^[A-Z0-9_]{1,80}$/u.test(error.code ?? '')
        ? error.code
        : /^NATIVE_/u.test(error.message ?? '')
          ? error.message
          : 'NATIVE_CHECK_FAILED',
    };
    process.exitCode = 1;
  } finally {
    observerStopped = true;
    if (watch) await watch.catch(() => {});
    await prisma.$disconnect();
    await observer.end();
    receipt.connectionsClosed = true;
    receipt.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(receipt));
  }
}
