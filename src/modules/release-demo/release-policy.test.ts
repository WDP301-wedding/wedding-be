import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../config/env.js';
import {
  BACKEND_PREREQUISITES,
  RELEASE_GATES,
  evaluateBackendRelease,
  readBackendTaskStatus,
  validateReleaseEnvironment,
  releaseFeatureConfiguration,
  type ReleaseInput,
} from './release-policy.js';
const sha = 'a'.repeat(40),
  hash = 'b'.repeat(64);
const plan = {
  apiOrigin: 'https://api.wedding.test',
  publicWebOrigin: 'https://web.wedding.test',
  managementWebOrigin: 'https://manage.wedding.test',
  sameSiteDomain: 'wedding.test',
  recoveryOwner: 'test-operator',
  backupRetentionDays: 30 as const,
  encryptedBackups: true as const,
  restoreReplaysErasureTombstones: true as const,
};
function complete(): ReleaseInput {
  return {
    releaseId: 'release-test',
    createdAt: '2026-10-13T10:00:00Z',
    sourceRevision: sha,
    cleanSource: true,
    apiContractSha256: hash,
    configurationIssues: [],
    deployment: plan,
    frontendIntegrationStatus: 'PENDING',
    taskStatus: Object.fromEntries(BACKEND_PREREQUISITES.map((t) => [t, true])),
    evidence: Object.entries(RELEASE_GATES).map(([gate, dimension]) => ({
      gate,
      dimension,
      status: 'PASS',
      sourceRevision: sha,
      apiContractSha256: hash,
      target: dimension === 'offline' ? 'disposable-postgresql' : 'authorized-staging',
      targetOrigin: dimension === 'offline' ? null : plan.apiOrigin,
      observedAt: '2026-10-13T09:00:00Z',
      evidence: 'tasks/evidence/release-test.json',
    })),
  };
}
describe('backend release evidence gates', () => {
  it('separates frontend completion from backend acceptance', () => {
    expect(evaluateBackendRelease(complete())).toMatchObject({
      backendStatus: 'GO',
      productStatus: 'PENDING',
      blockers: [],
    });
    expect(
      evaluateBackendRelease({ ...complete(), frontendIntegrationStatus: 'VERIFIED_SEPARATELY' })
        .productStatus,
    ).toBe('READY_FOR_JOINT_REVIEW');
  });
  it('refuses dirty artifacts, absent prerequisites and missing deployment authority', () => {
    const input = complete();
    input.taskStatus['NTF-W4'] = false;
    delete input.taskStatus['BE-17'];
    expect(
      evaluateBackendRelease({
        ...input,
        cleanSource: false,
        deployment: null,
        configurationIssues: ['WORKER_REQUIRED'],
      }).blockers,
    ).toEqual(
      expect.arrayContaining([
        'UNCOMMITTED_SOURCE',
        'NTF-W4',
        'BE-17',
        'DEPLOYMENT_AND_RECOVERY_OWNER_PENDING',
        'WORKER_REQUIRED',
      ]),
    );
  });
  it.each([
    'status',
    'source',
    'api',
    'target',
    'origin',
    'dimension',
    'future',
    'duplicate',
    'missing',
  ] as const)('refuses %s evidence', (kind) => {
    const input = complete(),
      receipt = input.evidence.find((r) => r.gate === 'workers.runtime')!;
    if (kind === 'status') receipt.status = 'PENDING';
    if (kind === 'source') receipt.sourceRevision = 'c'.repeat(40);
    if (kind === 'api') receipt.apiContractSha256 = 'd'.repeat(64);
    if (kind === 'target') receipt.target = 'disposable-postgresql';
    if (kind === 'origin') receipt.targetOrigin = 'https://other.wedding.test';
    if (kind === 'dimension') receipt.dimension = 'offline';
    if (kind === 'future') receipt.observedAt = '2027-01-01T00:00:00Z';
    if (kind === 'duplicate') input.evidence.push(receipt);
    if (kind === 'missing') input.evidence = input.evidence.filter((r) => r !== receipt);
    expect(evaluateBackendRelease(input).blockers).toContain('workers.runtime');
  });
  it('rejects arbitrary evidence URLs and extra secret fields', () => {
    const input = complete();
    input.evidence[0]!.evidence = 'https://user:secret@host/file';
    expect(() => evaluateBackendRelease(input)).toThrow();
    expect(() =>
      evaluateBackendRelease({ ...complete(), token: 'SECRET' } as ReleaseInput),
    ).toThrow();
  });
  it('reads only active backend checkboxes, fails ambiguous IDs', () => {
    expect(
      readBackendTaskStatus(
        '- [x] RV-01\n- [ ] REL-W3: staging\n- [x] unrelated\nHistorical RV-02',
      ),
    ).toEqual({ 'RV-01': true, 'REL-W3': false });
    expect(() => readBackendTaskStatus('- [x] RV-01\n- [ ] RV-01')).toThrow('Duplicate');
  });
  it('fails closed without providers and checks explicit HTTPS same-site/CORS topology', () => {
    const config = parseEnvironment({ NODE_ENV: 'test' });
    expect(validateReleaseEnvironment(config, plan)).toMatchObject({ valid: false });
    expect(
      validateReleaseEnvironment(config, { ...plan, apiOrigin: 'https://evil.test' }).issues,
    ).toContain('SAME_SITE_HOSTS_REQUIRED');
    expect(
      validateReleaseEnvironment(config, { ...plan, apiOrigin: 'http://api.wedding.test' }).issues,
    ).toContain('INVALID_DEPLOYMENT_PLAN');
    expect(JSON.stringify(validateReleaseEnvironment(config, plan))).not.toContain('secret');
  });
  it('validates configured topology without claiming provider acceptance', () => {
    const base = parseEnvironment({ NODE_ENV: 'test' });
    const configured = {
      ...base,
      runtime: { ...base.runtime, environment: 'staging' as const },
      database: {
        url: 'postgresql://test@db.test/db?sslmode=require',
        migrationUrl: 'postgresql://test@db.test/db?sslmode=require',
      },
      identityAccess: { ...base.identityAccess, passwordOtpHashKey: 'x'.repeat(32) },
      cors: { allowedOrigins: [plan.publicWebOrigin, plan.managementWebOrigin] },
      storage: {
        enabled: true as const,
        supabaseUrl: 'https://storage.test',
        serviceRoleKey: 'fixture',
        bucket: 'private',
      },
      email: {
        enabled: true as const,
        provider: 'brevo' as const,
        apiKey: 'fixture',
        fromEmail: 'test@example.test',
      },
      aiImage: { provider: 'gemini' as const, apiKey: 'fixture', model: 'fixture-model' },
      vnpay: {
        enabled: true as const,
        merchantCode: 'CTTVNP01',
        hashSecret: 'fixture',
        returnUrl: plan.publicWebOrigin + '/return',
        queryIp: '127.0.0.1',
      },
      notifications: {
        ...base.notifications,
        workerEnabled: true,
        activeKeyVersion: 'v1',
        credentialKeys: { v1: Buffer.alloc(32).toString('base64') },
      },
      invitationStudio: { publicOrigin: plan.apiOrigin },
    };
    expect(validateReleaseEnvironment(configured, plan)).toEqual({ valid: true, issues: [] });
    expect(
      validateReleaseEnvironment(
        { ...configured, security: { ...base.security, replicaCount: 2 as 1 } },
        plan,
      ).issues,
    ).toContain('SINGLE_REPLICA_REQUIRED');
    expect(releaseFeatureConfiguration(configured, sha).features.gemini.liveVerification).toBe(
      'pending',
    );
    expect(releaseFeatureConfiguration(base, sha).features.tracing.liveVerification).toBe(
      'optional-disabled',
    );
  });
});
