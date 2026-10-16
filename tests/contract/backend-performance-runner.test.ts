import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('bounded performance CLI', () => {
  it.each([200, 429])(
    'retains sanitized %s evidence and revokes measurement sessions',
    async (status) => {
      const directory = await mkdtemp(join(tmpdir(), 'wedding-perf-runner-'));
      let reads = 0,
        logouts = 0;
      const server = createServer((request, response) => {
        request.resume();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('x-request-id', 'synthetic-request');
        if (request.method === 'POST') {
          response.writeHead(201).end(JSON.stringify({ data: { accessToken: 'private-token' } }));
        } else if (request.method === 'DELETE') {
          logouts++;
          response.writeHead(204).end();
        } else {
          reads++;
          response
            .writeHead(status)
            .end(
              JSON.stringify(
                status === 200
                  ? { data: [{ name: 'private-person' }] }
                  : { error: { code: 'RATE_LIMITED' } },
              ),
            );
        }
      });
      try {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address() as { port: number };
        const path = join(directory, 'fixture.json'),
          output = join(directory, 'evidence.json');
        await writeFile(
          path,
          JSON.stringify({
            origin: `http://127.0.0.1:${address.port}`,
            synthetic: true,
            initialized: true,
            bookingId: '00000000-0000-4000-8000-000000000001',
            deploymentId: 'test',
            commit: 'a'.repeat(40),
            credentials: {
              couple: { email: 'private-email', password: 'private-password' },
              staff: { email: 'private-email', password: 'private-password' },
            },
          }),
        );
        const run = promisify(execFile)(process.execPath, ['scripts/backend-performance.mjs'], {
          env: { ...process.env, PERF_FIXTURE_CONFIG: path, PERF_OUTPUT: output },
          windowsHide: true,
        });
        if (status === 200) await run;
        else await expect(run).rejects.toMatchObject({ code: 1 });
        const evidence = await readFile(output, 'utf8');
        expect(evidence).not.toMatch(/private-token|private-person|private-password|private-email/);
        expect(reads).toBe(status === 200 ? 168 : 1);
        expect(logouts).toBe(2);
        const parsed = JSON.parse(evidence) as { summary?: { n: number }[]; samples: unknown[] };
        expect(parsed.samples).toHaveLength(reads);
        if (status === 200) expect(parsed.summary?.every((item) => item.n === 20)).toBe(true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        // Only this test's mkdtemp directory, never a supplied artifact path.
        await rm(directory, { recursive: true, force: true });
      }
    },
    15000,
  );
});
