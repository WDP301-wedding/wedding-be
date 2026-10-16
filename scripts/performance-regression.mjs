import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Reuse initialized synthetic fixtures only. Credentials/tokens never enter evidence.
const config = JSON.parse(await readFile(process.env.PERF_FIXTURE_CONFIG, 'utf8'));
const origin = new URL(config.origin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/')
  throw new Error('A credential-free HTTPS origin is required.');
if (
  config.synthetic !== true ||
  config.initialized !== true ||
  !config.deploymentId ||
  !/^[a-f0-9]{40}$/u.test(config.commit)
)
  throw new Error('Record the selected synthetic deployment.');
const mode = process.env.PERF_MODE ?? 'baseline';
if (!['baseline', 'bounded'].includes(mode)) throw new Error('Unknown mode.');
const cases = mode === 'baseline' ? config.baselineCases : config.boundedCases;
if (
  !Array.isArray(cases) ||
  cases.length < 1 ||
  cases.length > 30 ||
  cases.some(
    (c) =>
      !/^\/(api\/v1\/|health\/)/u.test(c.path) ||
      c.path.includes('://') ||
      c.path.includes('#') ||
      !['public', 'manager', 'couple', 'staff'].includes(c.role),
  )
)
  throw new Error('Invalid read cases.');
const output = process.env.PERF_OUTPUT;
if (!output) throw new Error('PERF_OUTPUT must name a new evidence file.');
await writeFile(output, '{}\n', { flag: 'wx' });
const evidence = {
  startedAt: new Date().toISOString(),
  node: process.version,
  mode,
  origin: origin.origin,
  deploymentId: config.deploymentId,
  commit: config.commit,
  topology: config.topology,
  fixture: config.fixture,
  methodology:
    '20 round-robin samples/case/stage plus initial probes. Reader caps 1 or 1/2/4; starts spaced >=750ms (<=80/min). Stop on unexpected status, transport failure or >25000ms (old measured Analytics tail ~13s). In-flight reads drain; no automatic retries. Session writes only; Analytics GET may refresh derived projections.',
  samples: [],
  sessions: [],
  cleanup: [],
};
const sessions = new Map();
let lastStart = 0;
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
async function call(role, path, method = 'GET', body) {
  // This caller is dispatched sequentially by the scheduler, even with active reads.
  await delay(Math.max(0, 750 - (performance.now() - lastStart)));
  lastStart = performance.now();
  const started = lastStart;
  const response = await fetch(new URL(path, origin), {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(26000),
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      ...(sessions.has(role) ? { Authorization: `Bearer ${sessions.get(role).token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ttfbMs = performance.now() - started;
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    /* never retain response bodies */
  }
  const items = Array.isArray(data?.data) ? data.data : data?.data?.items;
  return {
    data,
    sample: {
      at: new Date().toISOString(),
      status: response.status,
      ms: performance.now() - started,
      ttfbMs,
      bytes: Buffer.byteLength(text),
      requestId: response.headers.get('x-request-id'),
      ...(items ? { itemCount: items.length } : {}),
      ...(data?.error?.code ? { errorCode: data.error.code } : {}),
      ...(data?.data?.meta?.generationId
        ? {
            generationId: data.data.meta.generationId,
            refreshedAt: data.data.meta.refreshedAt,
            analyticsStatus: data.data.meta.status,
          }
        : {}),
    },
  };
}
async function login(role) {
  if (sessions.has(role)) {
    const revoked = await call(role, '/api/v1/auth/sessions/current', 'DELETE');
    evidence.cleanup.push({ role, ...revoked.sample });
    if (revoked.sample.status !== 204) throw new Error('Session renewal cleanup failed.');
    sessions.delete(role);
  }
  const login = await call(role, '/api/v1/auth/web-sessions', 'POST', config.credentials[role]);
  evidence.sessions.push({ role, ...login.sample });
  if (login.sample.status !== 201 || !login.data?.data?.accessToken)
    throw new Error(`Login failed: ${role} ${login.sample.status}.`);
  sessions.set(role, { token: login.data.data.accessToken, at: performance.now() });
}
let stopped = false;
try {
  const roles = [...new Set(cases.map((c) => c.role))].filter((role) => role !== 'public');
  for (const role of roles) await login(role);
  for (const readers of mode === 'baseline' ? [1] : [1, 2, 4]) {
    for (let round = 0; round <= 20 && !stopped; round++) {
      for (const role of roles)
        if (performance.now() - sessions.get(role).at > 240000) await login(role);
      const pending = new Set();
      for (const item of cases) {
        if (stopped) break;
        if (pending.size >= readers) await Promise.race(pending);
        if (stopped) break;
        const work = (async () => {
          try {
            const { sample } = await call(item.role, item.path);
            evidence.samples.push({
              role: item.role,
              route: item.label ?? item.path,
              readers,
              round,
              phase: round === 0 ? 'initial' : 'steady',
              ...sample,
            });
            if (
              sample.status !== (item.expectedStatus ?? 200) ||
              sample.status === 429 ||
              sample.status >= 500 ||
              sample.ms > 25000
            )
              stopped = true;
          } catch (error) {
            stopped = true;
            evidence.samples.push({
              role: item.role,
              route: item.label ?? item.path,
              readers,
              round,
              phase: round === 0 ? 'initial' : 'steady',
              status: 0,
              errorCode: error.name,
            });
          }
        })();
        pending.add(work);
        // Await spacing before the next dispatch, including when a slot is free.
        await delay(750);
        void work.finally(() => pending.delete(work));
      }
      await Promise.all(pending);
      await save();
      if (round % 5 === 0)
        console.log(JSON.stringify({ readers, round, samples: evidence.samples.length, stopped }));
    }
  }
  if (stopped)
    throw new Error('Aborted on unexpected status/latency/transport; partial evidence retained.');
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  for (const role of sessions.keys()) {
    try {
      const revoked = await call(role, '/api/v1/auth/sessions/current', 'DELETE');
      evidence.cleanup.push({ role, ...revoked.sample });
      if (revoked.sample.status !== 204) process.exitCode = 1;
    } catch {
      evidence.cleanup.push({ role, status: 0 });
      process.exitCode = 1;
    }
  }
  sessions.clear();
  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  evidence.summary = [
    ...new Set(evidence.samples.map((s) => JSON.stringify([s.role, s.route, s.readers]))),
  ].map((key) => {
    const [role, route, readers] = JSON.parse(key);
    const rows = evidence.samples.filter(
      (s) => s.role === role && s.route === route && s.readers === readers && s.phase === 'steady',
    );
    return {
      role,
      route,
      readers,
      n: rows.length,
      statuses: [...new Set(rows.map((s) => s.status))],
      p50Ms: percentile(
        rows.map((s) => s.ms),
        0.5,
      ),
      p95Ms: percentile(
        rows.map((s) => s.ms),
        0.95,
      ),
      itemCounts: [...new Set(rows.map((s) => s.itemCount).filter((v) => v !== undefined))],
    };
  });
  evidence.finishedAt = new Date().toISOString();
  await save();
}
