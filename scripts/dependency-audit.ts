import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluateDependencyAudit } from './dependency-audit-policy.js';

const policyPath = join(process.cwd(), 'docs', 'dependency-audit-exceptions.json');

async function main(): Promise<void> {
  const npmCliPath = process.env.npm_execpath;
  if (npmCliPath === undefined || npmCliPath.trim() === '') {
    throw new Error('npm_execpath is required to run the dependency audit');
  }

  const audit = spawnSync(process.execPath, [npmCliPath, 'audit', '--audit-level=high', '--json'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });

  if (audit.error !== undefined) {
    throw audit.error;
  }
  if (audit.status !== 0 && audit.status !== 1) {
    throw new Error(`npm audit failed to produce a policy-checkable report (exit ${audit.status})`);
  }

  let report: unknown;
  let policy: unknown;
  try {
    report = JSON.parse(audit.stdout) as unknown;
    policy = JSON.parse(await readFile(policyPath, 'utf8')) as unknown;
  } catch {
    throw new Error('Dependency audit report or exception policy is not valid JSON');
  }

  const currentDate = new Date().toISOString().slice(0, 10);
  const evaluation = evaluateDependencyAudit(report, policy, currentDate);

  if (evaluation.accepted.length === 0) {
    console.log('Dependency audit passed with no high/critical advisories.');
  } else {
    console.log(
      `Dependency audit passed with ${evaluation.accepted.length} documented, unexpired exception(s): ${evaluation.accepted.map(({ advisoryId }) => advisoryId).join(', ')}.`,
    );
  }
  if (evaluation.staleExceptions.length > 0) {
    console.warn(
      `Remove stale dependency audit exception(s): ${evaluation.staleExceptions.join(', ')}.`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown dependency audit failure';
  console.error(`Dependency audit gate failed: ${message}`);
  process.exitCode = 1;
});
