export async function runAnalyticsRuntimeWorker(configuration, baseline) {
  const { createHash, randomUUID } = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const { setTimeout: delay } = await import('node:timers/promises');
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const emit = (value) => console.log(JSON.stringify(value));
  const region = process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION;
  if (
    process.cwd() !== '/app' ||
    region !== configuration.region ||
    process.env.RAILWAY_DEPLOYMENT_ID !== configuration.deploymentId ||
    process.env.ANALYTICS_DIAGNOSTICS_ENABLED !== 'true' ||
    process.env.DB_POOL_MAX !== '3' ||
    process.env.DB_POOL_ACQUIRE_TIMEOUT_MS !== '2000' ||
    process.env.DB_POOL_IDLE_TIMEOUT_MS !== '60000' ||
    process.env.DB_DIAGNOSTICS_ENABLED !== 'false' ||
    process.env.DB_SAFE_READ_DEADLINE_ENABLED !== 'false'
  )
    throw Error('PERF10_RUNTIME_IDENTITY_MISMATCH');
  const moduleUrl = (path) => pathToFileURL(resolve('/app/dist', path)).href;
  const projectionUrl = moduleUrl('modules/analytics-dashboard/application/projection.js');
  const relocate = (source, path, legacyProjection) =>
    source.replace(/\bfrom\s+(['"])([^'"]+)\1/gu, (_match, _quote, specifier) => {
      const target = specifier.startsWith('.')
        ? new URL(specifier, path).href
        : specifier === 'zod'
          ? import.meta.resolve('zod')
          : specifier;
      return (
        'from ' +
        JSON.stringify(legacyProjection && target === projectionUrl ? legacyProjection : target)
      );
    });
  for (const module of baseline.modules)
    if (hash(module.compiled) !== module.compiledSha256)
      throw Error('PERF10_BASELINE_HASH_MISMATCH');
  const legacyProjectionUrl =
    'data:text/javascript;base64,' +
    Buffer.from(relocate(baseline.modules[0].compiled, projectionUrl)).toString('base64');
  const legacyRepositoryUrl =
    'data:text/javascript;base64,' +
    Buffer.from(
      relocate(
        baseline.modules[1].compiled,
        moduleUrl('modules/analytics-dashboard/infrastructure/projection.repository.js'),
        legacyProjectionUrl,
      ),
    ).toString('base64');
  const { AnalyticsProjector: LegacyProjector } = await import(legacyProjectionUrl);
  const { createProjectionRepository: legacyStore } = await import(legacyRepositoryUrl);
  const { AnalyticsProjector } = await import(projectionUrl);
  const { createAnalyticsServices } = await import(
    moduleUrl('modules/analytics-dashboard/infrastructure/analytics.composition.js')
  );
  const { createPrismaClient } = await import(moduleUrl('core/database/prisma.js'));
  const { reportingOwners } = await import(moduleUrl('core/reporting/reporting-feed.js'));
  const prisma = createPrismaClient(process.env.DATABASE_URL, false);
  const receipt = {
    event: 'perf10_native_pair',
    source:
      'Serving Railway replica via dedicated temporary SSH key; native incremental projector, not HTTP latency',
    at: new Date().toISOString(),
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID,
    replicaId: process.env.RAILWAY_REPLICA_ID ?? null,
    region,
    node: process.version,
    scopeDigest: hash(configuration.scope),
    pair: configuration.pair,
    baseline: {
      commit: baseline.commit,
      modules: baseline.modules.map(({ path, sourceSha256, compiledSha256 }) => ({
        path,
        sourceSha256,
        compiledSha256,
      })),
    },
    pool: {
      maximum: 3,
      acquisitionTimeoutMs: 2000,
      idleTimeoutMs: 60000,
      additionalNativePools: 1,
    },
    samples: [],
    sourceFencesUnchanged: false,
    matchedFacts: false,
  };
  const errorCode = (error) =>
    error?.code === 'ANALYTICS_REFRESH_CONFLICT'
      ? 'ANALYTICS_REFRESH_CONFLICT'
      : error instanceof Error && /^PERF10_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'PERF10_NATIVE_FAILED';
  try {
    await prisma.$connect();
    const requireManager = async () => {
      const actor = await prisma.account.findUnique({
        where: { id: configuration.scope },
        select: { status: true, disabledAt: true, roles: { select: { role: true } } },
      });
      if (
        !actor ||
        actor.status !== 'ACTIVE' ||
        actor.disabledAt !== null ||
        !actor.roles.some((grant) => grant.role === 'MANAGER')
      )
        throw Error('PERF10_ACTIVE_MANAGER_REQUIRED');
    };
    await requireManager();
    const services = createAnalyticsServices(prisma);
    let activeSample;
    const sources = Object.fromEntries(
      reportingOwners.map((owner) => [
        owner,
        {
          async readPage(query, context) {
            activeSample.sourceWork[owner].pages++;
            const page = await services.sources[owner].readPage(query, context);
            activeSample.sourceWork[owner].rows += page.rows.length;
            return page;
          },
        },
      ]),
    );
    const projectors = {
      baseline: new LegacyProjector(
        sources,
        legacyStore(prisma),
        () => new Date(),
        services.projector.fences,
      ),
      candidate: new AnalyticsProjector(
        sources,
        services.store,
        () => new Date(),
        services.projector.fences,
        (observation) => activeSample.observations.push(observation),
      ),
    };
    const fences = async () =>
      (await prisma.reportingSequence.findMany({ orderBy: { owner: 'asc' } })).map((row) => ({
        owner: row.owner,
        value: row.value,
      }));
    const facts = async () => {
      const projection = await services.store.load(configuration.scope);
      if (!projection || projection.checkpoints.some((checkpoint) => checkpoint.status !== 'READY'))
        throw Error('PERF10_SOURCES_NOT_READY');
      const rows = projection.rows
        .map(({ owner, recordId, sequence, value }) => ({ owner, recordId, sequence, value }))
        .sort(
          (left, right) =>
            left.owner.localeCompare(right.owner) || left.recordId.localeCompare(right.recordId),
        );
      return {
        generationId: projection.generationId,
        rows: rows.length,
        factsSha256: hash(JSON.stringify(rows)),
        checkpoints: projection.checkpoints,
      };
    };
    const run = async (variant, phase) => {
      await requireManager();
      const requestId = randomUUID();
      const sample = {
        variant,
        phase,
        measured: phase === 'measurement' && configuration.pair > 0,
        requestId,
        startedAt: new Date().toISOString(),
        sourceWork: Object.fromEntries(
          reportingOwners.map((owner) => [owner, { pages: 0, rows: 0 }]),
        ),
        observations: [],
      };
      activeSample = sample;
      const started = performance.now();
      try {
        sample.generationId = await projectors[variant].refresh(
          configuration.scope,
          {
            authority: 'AUTHENTICATED',
            actorAccountId: configuration.scope,
            requestId,
            causationId: requestId,
          },
          false,
          'cli',
        );
        sample.ms = performance.now() - started;
        sample.refreshCompletedAt = new Date().toISOString();
        sample.outcome = 'published';
        sample.snapshot = await facts();
        if (sample.ms > configuration.maxRefreshMs) throw Error('PERF10_LATENCY_BUDGET');
      } catch (error) {
        sample.ms ??= performance.now() - started;
        sample.refreshCompletedAt ??= new Date().toISOString();
        sample.outcome = errorCode(error) === 'ANALYTICS_REFRESH_CONFLICT' ? 'conflict' : 'failed';
        sample.errorCode = errorCode(error);
        throw error;
      } finally {
        receipt.samples.push(sample);
        emit({ event: 'perf10_native_sample', pair: configuration.pair, ...sample });
      }
      return sample;
    };
    const waitForPublication = async (previousGeneration) => {
      const started = performance.now();
      while (performance.now() - started < 130000) {
        const heads =
          await prisma.$queryRaw`SELECT h."generationId",g.checkpoints FROM "AnalyticsHead" h JOIN "AnalyticsGeneration" g ON h."generationId"=g.id AND h.scope=g.scope WHERE h.scope=${configuration.scope}`;
        const projection = heads[0];
        if (
          !projection ||
          projection.checkpoints.length !== 6 ||
          projection.checkpoints.some((checkpoint) => checkpoint.status !== 'READY')
        )
          throw Error('PERF10_SOURCES_NOT_READY');
        const oldest = Math.max(
          ...projection.checkpoints.map(
            (checkpoint) => Date.now() - Date.parse(checkpoint.refreshedAt),
          ),
        );
        if (projection.generationId !== previousGeneration && oldest < 10000) {
          receipt.window = {
            generationId: projection.generationId,
            observedAt: new Date().toISOString(),
            oldestCheckpointAgeMs: oldest,
          };
          return;
        }
        await delay(1000);
      }
      throw Error('PERF10_PUBLICATION_WINDOW_TIMEOUT');
    };
    let previousGeneration = (await services.store.load(configuration.scope))?.generationId;
    const firstPair = configuration.pair;
    const throughPair = configuration.throughPair ?? firstPair;
    receipt.pairs = [];
    for (let pair = firstPair; pair <= throughPair; pair++) {
      configuration.pair = pair;
      receipt.pair = pair;
      await waitForPublication(previousGeneration);
      const pairStarted = performance.now();
      const order = pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
      receipt.order = order;
      receipt.sourceFencesBefore = await fences();
      const measured = [];
      for (const variant of order)
        measured.push(await run(variant, pair === 0 ? 'warmup' : 'measurement'));
      receipt.sourceFencesAfter = await fences();
      receipt.sourceFencesUnchanged =
        JSON.stringify(receipt.sourceFencesBefore) === JSON.stringify(receipt.sourceFencesAfter);
      receipt.matchedFacts = measured[0].snapshot.factsSha256 === measured[1].snapshot.factsSha256;
      const pairReceipt = {
        pair,
        order,
        window: receipt.window,
        sourceFencesBefore: receipt.sourceFencesBefore,
        sourceFencesAfter: receipt.sourceFencesAfter,
        sourceFencesUnchanged: receipt.sourceFencesUnchanged,
        matchedFacts: receipt.matchedFacts,
        elapsedMs: performance.now() - pairStarted,
        samples: measured,
      };
      receipt.pairs.push(pairReceipt);
      emit({ event: 'perf10_native_pair_completed', ...pairReceipt });
      if (!receipt.sourceFencesUnchanged || !receipt.matchedFacts)
        throw Error('PERF10_COMPARISON_NOT_MATCHED');
      if (pairReceipt.elapsedMs > 45000) throw Error('PERF10_PAIR_WINDOW_BUDGET');
      previousGeneration = measured.at(-1).snapshot.generationId;
    }
  } catch (error) {
    receipt.failure = errorCode(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    receipt.finishedAt = new Date().toISOString();
    emit(receipt);
  }
}
