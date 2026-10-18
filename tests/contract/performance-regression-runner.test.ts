import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Replace only the child process transport and clock: no live requests or credentials.
const preload = `
import timers from 'node:timers/promises';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
const realNow = performance.now.bind(performance);
let offset = 0, reads = 0;
Object.defineProperty(performance, 'now', { value: () => realNow() + offset });
timers.setTimeout = async ms => { offset += ms; };
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  if (options.method === 'POST') return new Response(JSON.stringify({data:{accessToken:'private-token'}}), {status:201});
  if (options.method === 'DELETE') return new Response(null, {status:204});
  reads++;
  if (process.env.SCENARIO === 'operator-mid' && reads === 1)
    writeFileSync(process.env.PERF_STOP_FILE, 'stop');
  if (process.env.SCENARIO === 'bounded')
    for (let tick = 0; tick < 32; tick++) await Promise.resolve();
  if (process.env.SCENARIO === 'transport') throw new TypeError('private transport details');
  const failureStatus = {overload:429, 'server-error':500}[process.env.SCENARIO];
  const status = failureStatus && reads === 2 ? failureStatus : 200;
  const count = process.env.SCENARIO === 'cardinality' ? 2 : 1;
  return new Response(JSON.stringify({data:Array.from({length:count},()=>({name:'private-person'}))}),
    {status,headers:{'x-request-id':'synthetic-request'}});
};
`;

interface Evidence {
  passed: boolean;
  samples: { status: number; errorCode?: string; at?: string }[];
  cleanup: { status: number }[];
  sessions: { status: number }[];
  peakActiveReads: Record<string, number>;
  summary: {
    n: number;
    successful: number;
    statusCounts: Record<string, number>;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  }[];
}

describe('PERF-13 repeatable live runner safety', () => {
  it.each(['expired', 'operator-stop'])(
    'does not authenticate after %s',
    async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), 'wedding-perf13-stop-'));
      const config = join(directory, 'fixture.json');
      const output = join(directory, 'evidence.json');
      const mock = join(directory, 'transport.mjs');
      const stop = join(directory, 'stop');
      try {
        await writeFile(
          mock,
          `globalThis.fetch = () => { throw new Error('Transport must not run'); };`,
        );
        await writeFile(stop, 'stop');
        await writeFile(
          config,
          JSON.stringify({
            origin: 'https://synthetic.example.invalid',
            synthetic: true,
            initialized: true,
            deploymentId: 'test',
            commit: 'a'.repeat(40),
            credentials: { couple: { email: 'private-email', password: 'private-password' } },
            ...(scenario === 'expired'
              ? { authorization: { expiresAt: '2000-01-01T00:00:00Z' } }
              : {}),
            baselineCases: [{ role: 'couple', path: '/api/v1/auth/me' }],
          }),
        );
        await expect(
          promisify(execFile)(
            process.execPath,
            ['--import', pathToFileURL(mock).href, 'scripts/performance-regression.mjs'],
            {
              env: {
                ...process.env,
                PERF_FIXTURE_CONFIG: config,
                PERF_OUTPUT: output,
                PERF_MODE: 'baseline',
                PERF_STOP_FILE: scenario === 'operator-stop' ? stop : '',
              },
              windowsHide: true,
            },
          ),
        ).rejects.toMatchObject({ code: 1 });
        const evidence = JSON.parse(await readFile(output, 'utf8')) as Evidence & {
          failure: string;
        };
        expect(evidence.passed).toBe(false);
        expect(evidence.samples).toHaveLength(0);
        expect(evidence.sessions).toHaveLength(0);
        expect(evidence.cleanup).toHaveLength(0);
        expect(evidence.failure).toContain(
          scenario === 'expired' ? 'authorization expired' : 'pressure monitor',
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    15000,
  );
  it.each([
    'success',
    'bounded',
    'overload',
    'server-error',
    'transport',
    'cardinality',
    'operator-mid',
  ])(
    'retains complete sanitized evidence and session cleanup for %s',
    async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), 'wedding-perf13-'));
      const config = join(directory, 'fixture.json');
      const output = join(directory, 'evidence.json');
      const mock = join(directory, 'transport.mjs');
      try {
        await writeFile(mock, preload);
        await writeFile(
          config,
          JSON.stringify({
            origin: 'https://synthetic.example.invalid',
            synthetic: true,
            initialized: true,
            deploymentId: 'test',
            commit: 'a'.repeat(40),
            credentials: { couple: { email: 'private-email', password: 'private-password' } },
            baselineCases: [
              {
                role: 'couple',
                path: '/api/v1/notifications/inbox?limit=20',
                expectedItemCount: 1,
              },
            ],
            boundedCases: Array.from({ length: 5 }, (_, index) => ({
              role: 'couple',
              path: '/api/v1/notifications/inbox?limit=20',
              label: `case-${index}`,
              expectedItemCount: 1,
            })),
          }),
        );
        const run = promisify(execFile)(
          process.execPath,
          ['--import', pathToFileURL(mock).href, 'scripts/performance-regression.mjs'],
          {
            env: {
              ...process.env,
              PERF_MODE: scenario === 'bounded' ? 'bounded' : 'baseline',
              PERF_STOP_FILE: scenario === 'operator-mid' ? join(directory, 'pressure-stop') : '',
              PERF_FIXTURE_CONFIG: config,
              PERF_OUTPUT: output,
              SCENARIO: scenario,
            },
            windowsHide: true,
          },
        );
        const success = scenario === 'success' || scenario === 'bounded';
        if (success) await run;
        else await expect(run).rejects.toMatchObject({ code: 1 });
        const raw = await readFile(output, 'utf8');
        expect(raw).not.toMatch(
          /private-token|private-person|private-email|private-password|private transport/,
        );
        const evidence = JSON.parse(raw) as Evidence;
        expect(evidence.passed).toBe(success);
        expect(evidence.cleanup).toHaveLength(evidence.sessions.length);
        expect(evidence.cleanup.length).toBeGreaterThan(0);
        expect(evidence.cleanup.every((s) => s.status === 204)).toBe(true);
        const summary = evidence.summary[0]!;
        const failureStatus =
          scenario === 'overload'
            ? 429
            : scenario === 'server-error'
              ? 500
              : scenario === 'operator-mid'
                ? 0
                : null;
        expect(evidence.samples).toHaveLength(
          scenario === 'bounded'
            ? 315
            : scenario === 'success'
              ? 21
              : failureStatus !== null
                ? 2
                : 1,
        );
        expect(summary.n).toBe(success ? 20 : failureStatus !== null ? 1 : 0);
        expect(summary.successful).toBe(success ? 20 : 0);
        expect(summary.statusCounts).toEqual(
          success ? { '200': 20 } : failureStatus !== null ? { [failureStatus]: 1 } : {},
        );
        if (success) expect(summary.maxMs).toBeGreaterThanOrEqual(summary.p95Ms!);
        else {
          expect(summary.p50Ms).toBeNull();
          expect(summary.p95Ms).toBeNull();
          expect(summary.maxMs).toBeNull();
        }
        if (scenario === 'bounded') {
          expect(evidence.summary).toHaveLength(15);
          expect(evidence.summary.every((s) => s.n === 20 && s.successful === 20)).toBe(true);
          expect(evidence.peakActiveReads['1']).toBe(1);
          expect(evidence.peakActiveReads['2']).toBe(2);
          expect(evidence.peakActiveReads['4']).toBe(4);
        }
        if (scenario === 'operator-mid') {
          expect(evidence.samples.at(-1)?.errorCode).toBe('PERF_OPERATOR_STOP');
          expect(evidence.samples.at(-1)?.at).toEqual(expect.any(String));
        }
      } finally {
        // Only this test's freshly created temporary directory.
        await rm(directory, { recursive: true, force: true });
      }
    },
    15000,
  );
});
