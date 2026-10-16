import { readFile, writeFile } from 'node:fs/promises';

// Credentials live only in the operator's ignored configuration and in memory.
// This runner never creates business fixtures, sends mail or invokes a provider.
const configPath = process.env.PERF_FIXTURE_CONFIG;
if (!configPath) throw new Error('PERF_FIXTURE_CONFIG must name a private fixture configuration.');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const origin = new URL(config.origin);
if (origin.username || origin.password) throw new Error('Use credential-free origins.');
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))
  throw new Error('HTTPS is required for remote targets.');
if (
  config.synthetic !== true ||
  config.initialized !== true ||
  !/^[a-f0-9-]{36}$/i.test(config.bookingId)
)
  throw new Error('An explicitly selected synthetic, initialized booking is required.');
if (!config.deploymentId || !/^[a-f0-9]{40}$/i.test(config.commit))
  throw new Error('Record the exact deployment and commit before measuring.');
const output = process.env.PERF_OUTPUT;
if (!output) throw new Error('PERF_OUTPUT must name a new evidence file.');
// Exclusive create prevents accidentally replacing a baseline.
await writeFile(output, '{}\n', { flag: 'wx' });
const sessions = new Map();
const authenticatedAt = new Map();
const evidence = {
  startedAt: new Date().toISOString(),
  origin: origin.origin,
  deploymentId: config.deploymentId,
  commit: config.commit,
  methodology:
    'Sequential round-robin: one initial probe, then 20 samples per route. Initialization is a separate operator action. No business writes. Session login/logout only.',
  samples: [],
  cleanup: [],
};
const cases = [
  ...[
    'guest-groups',
    'guests?limit=20',
    'guest-plan',
    'seating-plans/current',
    'seating-layout-options',
    'invitations?limit=20',
    'billing',
  ].map((suffix) => ({
    role: 'couple',
    path: `/api/v1/bookings/${config.bookingId}/${suffix}`,
    route: `/api/v1/bookings/{bookingId}/${suffix}`,
  })),
  {
    role: 'staff',
    path: `/api/v1/staff/events/${config.bookingId}/guests/search?query=${encodeURIComponent(config.syntheticSearch ?? 'Khách')}&limit=20`,
    route: '/api/v1/staff/events/{bookingId}/guests/search',
  },
];
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
async function call(role, path, method = 'GET', body) {
  const started = performance.now();
  const response = await fetch(new URL(path, origin), {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(35000),
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      ...(sessions.has(role) ? { Authorization: `Bearer ${sessions.get(role)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    /* record non-JSON status, never body */
  }
  const items = Array.isArray(data?.data) ? data.data : data?.data?.items;
  return {
    data,
    sample: {
      at: new Date().toISOString(),
      status: response.status,
      durationMs: performance.now() - started,
      requestId: response.headers.get('x-request-id'),
      bytes: Buffer.byteLength(text),
      ...(items ? { itemCount: items.length } : {}),
      ...(data?.error?.code ? { errorCode: data.error.code } : {}),
    },
  };
}
async function login(role) {
  if (sessions.has(role)) {
    const previous = await call(role, '/api/v1/auth/sessions/current', 'DELETE');
    if (previous.sample.status < 200 || previous.sample.status >= 300)
      throw new Error('Previous measurement session could not be revoked.');
    sessions.delete(role);
  }
  const login = await call(role, '/api/v1/auth/web-sessions', 'POST', config.credentials[role]);
  if (login.sample.status !== 201 || !login.data?.data?.accessToken)
    throw new Error(`Fixture ${role} login failed (${login.sample.status}).`);
  sessions.set(role, login.data.data.accessToken);
  authenticatedAt.set(role, performance.now());
}
try {
  for (const role of ['couple', 'staff']) await login(role);
  for (let round = 0; round <= 20; round++) {
    for (const item of cases) {
      if (performance.now() - authenticatedAt.get(item.role) > 240000) await login(item.role);
      const { sample } = await call(item.role, item.path);
      evidence.samples.push({
        role: item.role,
        route: item.route,
        phase: round === 0 ? 'initial' : 'steady',
        round,
        ...sample,
      });
      await save();
      if (sample.status !== 200)
        throw new Error(`Stopped on ${item.route}: ${sample.status}. Partial evidence retained.`);
    }
  }
  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  evidence.summary = cases.map((item) => {
    const rows = evidence.samples.filter((s) => s.route === item.route && s.phase === 'steady');
    return {
      role: item.role,
      route: item.route,
      n: rows.length,
      p50Ms: percentile(
        rows.map((s) => s.durationMs),
        0.5,
      ),
      p95Ms: percentile(
        rows.map((s) => s.durationMs),
        0.95,
      ),
      itemCounts: [...new Set(rows.map((s) => s.itemCount).filter((n) => n !== undefined))],
    };
  });
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  for (const role of sessions.keys()) {
    try {
      const { sample } = await call(role, '/api/v1/auth/sessions/current', 'DELETE');
      evidence.cleanup.push({ role, status: sample.status });
      if (sample.status < 200 || sample.status >= 300) process.exitCode = 1;
    } catch {
      evidence.cleanup.push({ role, failed: true });
      process.exitCode = 1;
    }
  }
  sessions.clear();
  evidence.finishedAt = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      success: !evidence.failure && !process.exitCode,
      samples: evidence.samples.length,
      output,
    }),
  );
}
