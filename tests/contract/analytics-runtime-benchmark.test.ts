import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  analyticsBenchmarkConfig,
  buildAnalyticsRuntimeProgram,
  loadAnalyticsBaseline,
} from '../../scripts/performance-analytics-runtime.js';

const configuration = {
  scope: randomUUID(),
  deploymentId: randomUUID(),
  region: 'sfo',
  pair: 1,
  maxRefreshMs: 25000,
};
describe('PERF-10 bounded native runtime benchmark contract', () => {
  it('rejects credentials, arbitrary scopes, unsupported regions and unbounded workloads', () => {
    for (const input of [
      { ...configuration, scope: "x'; DROP TABLE Booking;--" },
      { ...configuration, pair: 21 },
      { ...configuration, throughPair: 21 },
      { ...configuration, maxRefreshMs: 600000 },
      { ...configuration, region: 'singapore' },
      { ...configuration, accessToken: 'private-token' },
    ])
      expect(() => analyticsBenchmarkConfig.parse(input)).toThrow();
  });
  it('materializes only the two pinned Analytics modules and records immutable source hashes', () => {
    const paths: string[] = [];
    const baseline = loadAnalyticsBaseline((path) => {
      paths.push(path);
      return 'export const fixture: number = 1;';
    });
    expect(baseline.commit).toBe('3c6e8984c547d92f25dc4959c44503321e5f5528');
    expect(paths).toEqual([
      'src/modules/analytics-dashboard/application/projection.ts',
      'src/modules/analytics-dashboard/infrastructure/projection.repository.ts',
    ]);
    expect(baseline.modules).toHaveLength(2);
    for (const module of baseline.modules) {
      expect(module.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(module.compiledSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(module.compiled).toContain('export const fixture = 1');
      expect(module.compiled).not.toContain(': number');
    }
  });
  it('renders a syntax-valid guarded program without executing or persisting credentials', () => {
    const baseline = loadAnalyticsBaseline(() => 'export const fixture: number = 1;');
    const program = buildAnalyticsRuntimeProgram(configuration, baseline);
    expect(program).toContain('RAILWAY_DEPLOYMENT_ID');
    expect(program).toContain('sourceFencesUnchanged');
    expect(program).toContain('matchedFacts');
    expect(program).toContain('warmup');
    expect(program).toContain('measurement');
    expect(program).toContain('prisma.$disconnect');
    expect(program).toContain('waitForPublication');
    expect(() =>
      buildAnalyticsRuntimeProgram({ ...configuration, throughPair: 0 }, baseline),
    ).toThrow();
    expect(() =>
      buildAnalyticsRuntimeProgram({ ...configuration, throughPair: 20 }, baseline),
    ).toThrow();
    expect(() =>
      buildAnalyticsRuntimeProgram({ ...configuration, pair: 0, throughPair: 20 }, baseline),
    ).not.toThrow();
    expect(program).not.toContain('private-token');
    expect(() =>
      execFileSync(process.execPath, ['--check', '--input-type=module'], {
        input: program,
        windowsHide: true,
      }),
    ).not.toThrow();
  });
  it('rejects changed baseline provenance or compiled contents before transport', () => {
    const baseline = loadAnalyticsBaseline(() => 'export const fixture: number = 1;');
    expect(() =>
      buildAnalyticsRuntimeProgram(configuration, { ...baseline, commit: 'unreviewed' }),
    ).toThrow('Unexpected Analytics baseline provenance');
    expect(() => buildAnalyticsRuntimeProgram(configuration, { ...baseline, modules: [] })).toThrow(
      'Unexpected Analytics baseline provenance',
    );
    expect(() =>
      buildAnalyticsRuntimeProgram(configuration, {
        ...baseline,
        modules: baseline.modules.map((module) => ({ ...module, compiled: 'changed' })),
      }),
    ).toThrow('Compiled Analytics baseline changed');
  });
});
