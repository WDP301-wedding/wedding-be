import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../src/config/config.js';
import { readRequiredMigrations } from '../src/core/database/database-readiness.js';
import {
  deploymentPlanSchema,
  releaseEvidenceSchema,
  evaluateBackendRelease,
  readBackendTaskStatus,
  releaseFeatureConfiguration,
  validateReleaseEnvironment,
} from '../src/modules/release-demo/release-policy.js';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length % 2 ||
    args.some((arg, i) => i % 2 === 0 && !['--input', '--output'].includes(arg))
  )
    throw Error('Invalid manifest arguments.');
  const options = Object.fromEntries(
    Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2]!, args[i * 2 + 1]!]),
  );
  const inputSchema = z.strictObject({
    deployment: deploymentPlanSchema.nullable(),
    evidence: z.array(releaseEvidenceSchema),
    frontendIntegrationStatus: z.enum(['PENDING', 'VERIFIED_SEPARATELY']),
  });
  const input = inputSchema.parse(
    options['--input']
      ? JSON.parse(await readFile(options['--input'], 'utf8'))
      : { deployment: null, evidence: [], frontendIntegrationStatus: 'PENDING' },
  );
  const git = (args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  const sha = git(['rev-parse', 'HEAD']);
  const clean = git(['status', '--porcelain', '--untracked-files=all']) === '';
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const apiBytes = await readFile('openapi/openapi.json'),
    apiHash = sha256(apiBytes);
  if ((await readFile('openapi/openapi.sha256', 'utf8')).trim() !== apiHash)
    throw Error('OpenAPI digest drift.');
  const paths = [
    ...new Set(git(['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean)),
  ]
    .filter((path) =>
      /^(?:src\/|prisma\/|scripts\/|tests\/|assets\/|certs\/|\.railway\/|\.github\/workflows\/|package(?:-lock)?\.json$|\.node-version$|Dockerfile$|\.dockerignore$|eslint\.config\.mjs$|prisma\.config\.ts$|tsconfig.*\.json$|vitest\.config\.ts$)/u.test(
        path,
      ),
    )
    .sort();
  const sourceFiles = await Promise.all(
    paths.map(async (path) => ({ path, sha256: sha256(await readFile(path)) })),
  );
  const workspaceContentSha256 = sha256(Buffer.from(JSON.stringify(sourceFiles)));
  const receipts = await Promise.all(
    input.evidence.map(async (receipt) => ({
      ...receipt,
      evidenceSha256: sha256(await readFile(resolve(receipt.evidence))),
    })),
  );
  const taskStatus = readBackendTaskStatus(
    await readFile('tasks/backend-revision-todo.md', 'utf8'),
  );
  const policy = {
    releaseId: `backend-${sha.slice(0, 12)}-${workspaceContentSha256.slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    sourceRevision: sha,
    cleanSource: clean,
    apiContractSha256: apiHash,
    configurationIssues: input.deployment
      ? validateReleaseEnvironment(config, input.deployment).issues
      : ['DEPLOYMENT_PLAN_REQUIRED'],
    taskStatus,
    ...input,
  };
  const result = evaluateBackendRelease(policy);
  const document = z
    .object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) })
    .parse(JSON.parse(apiBytes.toString()));
  const routeInventory = Object.entries(document.paths).flatMap(([path, operations]) =>
    Object.entries(operations)
      .filter(([method]) =>
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method),
      )
      .map(([method, value]) => {
        const operation = z
          .object({ security: z.array(z.record(z.string(), z.array(z.string()))).optional() })
          .parse(value);
        return {
          path,
          method: method.toUpperCase(),
          access:
            operation.security === undefined
              ? 'NOT_DECLARED'
              : operation.security.length === 0
                ? 'PUBLIC'
                : 'AUTHENTICATED',
          securitySchemes: operation.security?.flatMap((s) => Object.keys(s)) ?? [],
        };
      }),
  );
  const output = resolve(options['--output'] ?? 'test-results/release/manifest.json');
  const packageVersions = z
    .object({ dependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(await readFile('package.json', 'utf8'))).dependencies;
  await mkdir(dirname(output), { recursive: true });
  // Exclusive creation preserves evidence history; never replace a release record.
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        ...policy,
        ...result,
        repositoryCommits: clean ? [{ repo: 'wedding-be', sha }] : [],
        testedBaseRevision: sha,
        goNoGoResult: result.backendStatus,
        androidBuildId: null,
        evidenceLinks: receipts.map((receipt) => receipt.evidence),
        workspaceContentSha256,
        sourceFiles,
        migrationNames: readRequiredMigrations()
          .map((m) => m.name)
          .sort(),
        migrations: [...readRequiredMigrations()].sort((a, b) => a.name.localeCompare(b.name)),
        seedScenarioIds: ['no-names', 'partial-names'],
        deploymentTargets: input.deployment ? [input.deployment.apiOrigin] : [],
        recoveryOwner: input.deployment?.recoveryOwner ?? null,
        recoveryMode:
          input.deployment?.recoveryMode ?? (input.deployment ? 'BACKUP_RESTORE' : null),
        releaseScope:
          input.deployment?.recoveryMode === 'REBUILD_SYNTHETIC_DEMO'
            ? 'SYNTHETIC_STAGING_DEMO'
            : 'BACKUP_PROTECTED_DEPLOYMENT',
        runtimeConfiguration: releaseFeatureConfiguration(config, sha),
        runtimeVersion: process.version,
        pinnedRuntimeVersion: (await readFile('.node-version', 'utf8')).trim(),
        selectedGeminiModel: config.aiImage.provider === 'gemini' ? config.aiImage.model : null,
        providerDependencies: Object.fromEntries(
          [
            '@google/genai',
            '@supabase/storage-js',
            '@prisma/client',
            '@prisma/adapter-pg',
            'pg',
            'zod',
            'express',
          ].map((name) => [name, packageVersions[name]]),
        ),
        evidence: receipts,
        routeInventory,
        privacy: 'No credentials, tokens, raw PII, signed URLs or payment callback bodies.',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    `Backend ${result.backendStatus}; ${result.blockers.length} unresolved gates. Manifest: ${output}`,
  );
  process.exitCode = result.backendStatus === 'GO' ? 0 : 2;
}
void main().catch(() => {
  console.error(
    'Release manifest failed; configuration values are not printed. Use a fresh output path and valid redacted evidence.',
  );
  process.exitCode = 1;
});
