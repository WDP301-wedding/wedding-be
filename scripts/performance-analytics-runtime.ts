import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

const baselineCommit = '3c6e8984c547d92f25dc4959c44503321e5f5528';
const baselinePaths = [
  'src/modules/analytics-dashboard/application/projection.ts',
  'src/modules/analytics-dashboard/infrastructure/projection.repository.ts',
];
export const analyticsBenchmarkConfig = z.strictObject({
  scope: z.uuid(),
  deploymentId: z.uuid(),
  region: z.literal('sfo'),
  pair: z.int().min(0).max(20),
  throughPair: z.int().min(0).max(20).optional(),
  maxRefreshMs: z.literal(25000),
});
export type AnalyticsBenchmarkConfig = z.infer<typeof analyticsBenchmarkConfig>;
export type AnalyticsBaseline = {
  commit: string;
  modules: { path: string; sourceSha256: string; compiledSha256: string; compiled: string }[];
};

export function loadAnalyticsBaseline(
  readSource: (path: string) => string = (path) =>
    execFileSync('git', ['show', baselineCommit + ':' + path], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 2000000,
    }),
): AnalyticsBaseline {
  return {
    commit: baselineCommit,
    modules: baselinePaths.map((path) => {
      const source = readSource(path);
      const compiled = ts.transpileModule(source, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          removeComments: true,
        },
      });
      if (
        compiled.diagnostics?.some(
          (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
        )
      )
        throw Error('Pinned Analytics module could not be transpiled');
      return {
        path,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        compiledSha256: createHash('sha256').update(compiled.outputText).digest('hex'),
        compiled: compiled.outputText,
      };
    }),
  };
}

export function buildAnalyticsRuntimeProgram(input: unknown, baseline = loadAnalyticsBaseline()) {
  const configuration = analyticsBenchmarkConfig.parse(input);
  if (configuration.throughPair !== undefined && configuration.throughPair < configuration.pair)
    throw Error('Benchmark range must be increasing');
  if (
    configuration.throughPair !== undefined &&
    configuration.throughPair > configuration.pair &&
    configuration.pair !== 0
  )
    throw Error('A campaign must include the unmeasured warmup pair');
  if (
    baseline.commit !== baselineCommit ||
    JSON.stringify(baseline.modules.map((module) => module.path)) !== JSON.stringify(baselinePaths)
  )
    throw Error('Unexpected Analytics baseline provenance');
  for (const module of baseline.modules) {
    if (createHash('sha256').update(module.compiled).digest('hex') !== module.compiledSha256)
      throw Error('Compiled Analytics baseline changed');
  }
  const worker = readFileSync(
    new URL('./performance-analytics-runtime-worker.mjs', import.meta.url),
    'utf8',
  );
  const declaration = 'export async function runAnalyticsRuntimeWorker';
  if (!worker.startsWith(declaration)) throw Error('Unexpected runtime worker declaration');
  return (
    worker.replace(declaration, 'async function runAnalyticsRuntimeWorker') +
    '\nawait runAnalyticsRuntimeWorker(' +
    JSON.stringify(configuration) +
    ',' +
    JSON.stringify(baseline) +
    ').catch(() => { console.log(JSON.stringify({event:"perf10_native_error",errorCode:"PERF10_NATIVE_SETUP_FAILED"})); process.exitCode=1; });\n'
  );
}
