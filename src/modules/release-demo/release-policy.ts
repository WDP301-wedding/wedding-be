import { z } from 'zod';
import type { BackendConfig } from '../../config/env.js';
import { createRuntimeFeatureManifest } from '../../config/runtime-manifest.js';

export const RELEASE_PROVIDER_VERSION = 'BACKEND-RELEASE@3.0.0';
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.string().regex(/^[a-f0-9]{40}$/u);
const origin = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value;
});
export const deploymentPlanSchema = z.strictObject({
  apiOrigin: origin,
  publicWebOrigin: origin,
  managementWebOrigin: origin,
  sameSiteDomain: z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u),
  recoveryOwner: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/u),
  backupRetentionDays: z.literal(30),
  encryptedBackups: z.literal(true),
  restoreReplaysErasureTombstones: z.literal(true),
});
export type DeploymentPlan = z.infer<typeof deploymentPlanSchema>;

/** Checks configuration only. A successful check never asserts deployed delivery. */
export function validateReleaseEnvironment(config: BackendConfig, plan: DeploymentPlan) {
  const issues: string[] = [];
  if (!['staging', 'production'].includes(config.runtime.environment))
    issues.push('DEPLOYED_ENV_REQUIRED');
  if (!config.database.url || !config.database.migrationUrl)
    issues.push('DATABASE_CONFIG_REQUIRED');
  if (config.security.replicaCount !== 1) issues.push('SINGLE_REPLICA_REQUIRED');
  if (!config.identityAccess.passwordOtpHashKey) issues.push('STABLE_OTP_KEY_REQUIRED');
  if (!config.email.enabled) issues.push('REAL_EMAIL_REQUIRED');
  if (!config.storage.enabled) issues.push('PRIVATE_STORAGE_REQUIRED');
  if (config.aiImage.provider !== 'gemini') issues.push('GEMINI_REQUIRED');
  if (!config.vnpay.enabled) issues.push('VNPAY_SANDBOX_REQUIRED');
  if (!config.notifications?.workerEnabled) issues.push('WORKER_REQUIRED');
  if (!config.notifications?.activeKeyVersion) issues.push('NOTIFICATION_ENCRYPTION_REQUIRED');
  if (!config.invitationStudio.publicOrigin) issues.push('PUBLIC_INVITATION_ORIGIN_REQUIRED');
  const parsed = deploymentPlanSchema.safeParse(plan);
  if (!parsed.success) return { valid: false, issues: [...issues, 'INVALID_DEPLOYMENT_PLAN'] };
  const origins = [plan.apiOrigin, plan.publicWebOrigin, plan.managementWebOrigin];
  if (
    origins.some((value) => {
      const host = new URL(value).hostname;
      return host !== plan.sameSiteDomain && !host.endsWith('.' + plan.sameSiteDomain);
    })
  )
    issues.push('SAME_SITE_HOSTS_REQUIRED');
  if (
    [plan.publicWebOrigin, plan.managementWebOrigin].some(
      (value) => !config.cors.allowedOrigins.includes(value),
    )
  )
    issues.push('EXACT_WEB_CORS_REQUIRED');
  return { valid: issues.length === 0, issues };
}

export const releaseEvidenceSchema = z.strictObject({
  gate: z.string().regex(/^[A-Za-z0-9.-]{1,80}$/u),
  status: z.enum(['PASS', 'FAIL', 'PENDING']),
  dimension: z.enum(['offline', 'runtime', 'owner-review']),
  sourceRevision: revision,
  apiContractSha256: digest,
  target: z.enum(['disposable-postgresql', 'authorized-staging']),
  targetOrigin: origin.nullable(),
  observedAt: z.iso.datetime(),
  // Only repository evidence references; no arbitrary URLs, PII or secret bodies.
  evidence: z.string().regex(/^(?:tasks\/evidence|docs)\/[a-zA-Z0-9_.-]+\.(?:md|json)$/u),
});
export type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>;
export const RELEASE_GATES = {
  'quality.backend': 'offline',
  'journey.no-names': 'offline',
  'journey.partial-names': 'offline',
  'migration.empty-upgrade': 'offline',
  'staging.runtime': 'runtime',
  'staging.recovery': 'runtime',
  'provider.revised-journey': 'runtime',
  'workers.runtime': 'runtime',
  'RV-21': 'owner-review',
} as const;
export const releaseInputSchema = z.strictObject({
  releaseId: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/u),
  createdAt: z.iso.datetime(),
  sourceRevision: revision,
  cleanSource: z.boolean(),
  apiContractSha256: digest,
  configurationIssues: z.array(z.string().regex(/^[A-Z_]+$/u)),
  deployment: deploymentPlanSchema.nullable(),
  taskStatus: z.record(
    z.string().regex(/^(?:RV-\d{2}|BE-\d{2}|(?:GM|SEA|STF|NTF|ANL|REL)-W\d)$/u),
    z.boolean(),
  ),
  evidence: z.array(releaseEvidenceSchema),
  frontendIntegrationStatus: z.enum(['PENDING', 'VERIFIED_SEPARATELY']),
});
export type ReleaseInput = z.infer<typeof releaseInputSchema>;
export const BACKEND_PREREQUISITES = [
  ...Array.from({ length: 21 }, (_, i) => `RV-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 17 }, (_, i) => `BE-${String(i + 1).padStart(2, '0')}`),
  ...['GM', 'SEA', 'STF', 'NTF'].flatMap((owner) =>
    Array.from({ length: 5 }, (_, i) => `${owner}-W${i + 1}`),
  ),
  ...Array.from({ length: 4 }, (_, i) => `ANL-W${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `REL-W${i + 1}`),
] as const;

/** Release never changes an owner's acceptance, nor substitutes frontend tests. */
export function evaluateBackendRelease(raw: ReleaseInput) {
  const input = releaseInputSchema.parse(raw);
  const blockers = [...input.configurationIssues];
  if (!input.cleanSource) blockers.push('UNCOMMITTED_SOURCE');
  if (!input.deployment) blockers.push('DEPLOYMENT_AND_RECOVERY_OWNER_PENDING');
  for (const task of BACKEND_PREREQUISITES)
    if (input.taskStatus[task] !== true) blockers.push(task);
  for (const [gate, dimension] of Object.entries(RELEASE_GATES)) {
    const receipts = input.evidence.filter((r) => r.gate === gate);
    if (receipts.length !== 1) {
      blockers.push(gate);
      continue;
    }
    const receipt = receipts[0]!;
    if (
      receipt.status !== 'PASS' ||
      receipt.dimension !== dimension ||
      receipt.sourceRevision !== input.sourceRevision ||
      receipt.apiContractSha256 !== input.apiContractSha256 ||
      receipt.target !==
        (dimension === 'offline' ? 'disposable-postgresql' : 'authorized-staging') ||
      receipt.targetOrigin !== (dimension === 'offline' ? null : input.deployment?.apiOrigin) ||
      Date.parse(receipt.observedAt) > Date.parse(input.createdAt)
    )
      blockers.push(gate);
  }
  return {
    providerVersion: RELEASE_PROVIDER_VERSION,
    releaseId: input.releaseId,
    sourceRevision: input.sourceRevision,
    sourceState: input.cleanSource ? 'COMMITTED_CANDIDATE' : 'WORKSPACE_CANDIDATE',
    apiContractSha256: input.apiContractSha256,
    backendStatus: blockers.length ? 'NO_GO' : 'GO',
    frontendIntegrationStatus: input.frontendIntegrationStatus,
    productStatus:
      blockers.length || input.frontendIntegrationStatus === 'PENDING'
        ? 'PENDING'
        : 'READY_FOR_JOINT_REVIEW',
    blockers: [...new Set(blockers)],
  } as const;
}

export function readBackendTaskStatus(text: string): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const match of text.matchAll(
    /^- \[([ x])\] ((?:RV-\d{2}|BE-\d{2}|(?:GM|SEA|STF|NTF|ANL|REL)-W\d))\b/gmu,
  )) {
    if (Object.hasOwn(result, match[2]!)) throw Error('Duplicate backend task ID.');
    result[match[2]!] = match[1] === 'x';
  }
  return result;
}

export function releaseFeatureConfiguration(config: BackendConfig, sha: string) {
  return createRuntimeFeatureManifest(config, sha);
}
