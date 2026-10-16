import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { parse } from 'dotenv';

// Materialize only immutable pre-change modules beside their imports, then remove
// exactly those exclusively created files. Never check out/reset the user's work.
const baseline = process.env.PERF_BASELINE ?? '3c6e898';
if (!/^[a-f0-9]{7,40}$/u.test(baseline)) throw new Error('A commit SHA is required.');
const paths = [
  'invitation-studio/infrastructure/design.service',
  'invitation-studio/infrastructure/studio-authorization',
  'identity-access/authorization/invitation-editor.reader',
  'invitation-studio/infrastructure/print-order.service',
  'booking-lifecycle/infrastructure/notification-context.reader',
  'notifications-automation/application/notification-settings',
  'venue-catalog/application/catalog-query.service',
  'analytics-dashboard/application/projection',
  'analytics-dashboard/infrastructure/projection.repository',
  'analytics-dashboard/application/analytics.service',
];
const local = parse(readFileSync('.env.demo'));
const target = new URL(local.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || target.port !== '55435')
  throw new Error('Only the disposable local test administrator is allowed.');
const created = [];
try {
  for (const path of paths) {
    const source = `src/modules/${path}.ts`,
      temporary = `src/modules/${path}.performance-baseline.ts`;
    const text = execFileSync('git', ['show', `${baseline}:${source}`], { encoding: 'utf8' });
    writeFileSync(temporary, text, { flag: 'wx' });
    created.push(temporary);
  }
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        'tests/integration/performance-extension-measurement.test.ts',
        '--maxWorkers=1',
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          TEST_MIGRATION_DATABASE_URL: target.toString(),
          PERF_COMPARE_BASELINE: baseline,
          PERF_SAMPLES: process.env.PERF_SAMPLES ?? '20',
        },
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  for (const path of created) unlinkSync(path);
}
