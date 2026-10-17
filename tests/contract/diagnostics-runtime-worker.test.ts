import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('PERF-03 runtime evidence preconditions', () => {
  it.each([
    { mode: 'runtime', deploymentId: 'b'.repeat(36), region: 'sfo', pairs: 20 },
    { mode: 'operator', deploymentId: null, region: null, pairs: 20, operation: 'unknown' },
    { mode: 'operator', deploymentId: 'a'.repeat(36), region: null, pairs: 20 },
    { mode: 'operator', deploymentId: null, region: 'sfo', pairs: 20 },
    { mode: 'operator', deploymentId: null, region: null, pairs: 1000000 },
  ])('refuses invalid evidence configuration before loading the runtime: %j', async (input) => {
    const program = `import { runDiagnosticsRuntimeWorker } from './scripts/performance-diagnostics-runtime-worker.mjs';
      await runDiagnosticsRuntimeWorker(${JSON.stringify(input)}).catch(error => {
        console.error(error.message); process.exitCode = 2;
      });`;
    await expect(
      promisify(execFile)(process.execPath, ['--input-type=module', '-e', program], {
        windowsHide: true,
        timeout: 5000,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://127.0.0.1:1/perf03_never_connect',
          RAILWAY_DEPLOYMENT_ID: 'a'.repeat(36),
          RAILWAY_REPLICA_REGION: 'sfo',
        },
      }),
    ).rejects.toMatchObject({ code: 2, stdout: '', stderr: 'PERF03_RUNTIME_IDENTITY_REQUIRED\n' });
  });
});
