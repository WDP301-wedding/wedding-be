import type { BackendConfig } from './env.js';

type Feature = Readonly<{
  configuration: 'configured' | 'unconfigured' | 'not-applicable';
  mode: string;
  implementation: 'implemented' | 'missing' | 'downstream-pending';
  offlineVerification: 'not-evaluated';
  liveVerification: 'pending' | 'optional-disabled';
}>;

/** Configuration describes adapter selection, never successful delivery or settlement. */
export function createRuntimeFeatureManifest(config: BackendConfig, revision?: string) {
  const feature = (
    configured: boolean,
    mode: string,
    implementation: Feature['implementation'] = 'implemented',
    optional = false,
  ): Feature =>
    Object.freeze({
      configuration: configured ? 'configured' : 'unconfigured',
      mode,
      implementation,
      offlineVerification: 'not-evaluated',
      liveVerification: optional && !configured ? 'optional-disabled' : 'pending',
    });
  return Object.freeze({
    schemaVersion: 1,
    environment: config.runtime.environment,
    revision: revision !== undefined && /^[a-f0-9]{40}$/u.test(revision) ? revision : null,
    evidencePolicy:
      'Attach target-specific evidence separately; configuration is not verification.',
    features: Object.freeze({
      database: feature(Boolean(config.database.url), 'postgresql'),
      emailDelivery: feature(
        config.email.enabled,
        config.email.enabled ? config.email.provider : 'development-fake',
      ),
      passwordOtpKey: feature(
        Boolean(config.identityAccess.passwordOtpHashKey),
        config.identityAccess.passwordOtpHashKey ? 'stable-configured' : 'ephemeral-development',
      ),
      catalogStorage: feature(
        config.storage.enabled,
        config.storage.enabled ? 'supabase-private' : 'development-fake',
      ),
      invitationStorage: feature(
        config.storage.enabled,
        config.storage.enabled ? 'supabase-private' : 'unavailable',
      ),
      gemini: feature(
        config.aiImage.provider === 'gemini',
        config.aiImage.provider === 'gemini' ? 'gemini' : 'disabled',
      ),
      publicInvitation: feature(
        Boolean(config.invitationStudio.publicOrigin),
        config.invitationStudio.publicOrigin ? 'configured-origin' : 'disabled',
      ),
      vnpay: feature(config.vnpay.enabled, config.vnpay.enabled ? 'sandbox-only' : 'disabled'),
      retention: feature(Boolean(config.database.url), 'operator-cli-manual-procedure'),
      workers: feature(false, 'outbox-and-due-ports-only', 'downstream-pending'),
      printFiles: feature(
        Boolean(config.database.url) &&
          config.storage.enabled &&
          Boolean(config.invitationStudio.publicOrigin),
        'invitation-a5-v1',
      ),
      metrics: feature(
        config.metrics.enabled,
        config.metrics.enabled ? 'protected-prometheus' : 'disabled',
        'implemented',
        true,
      ),
      tracing: feature(
        Boolean(config.telemetry.otlpEndpoint),
        config.telemetry.otlpEndpoint ? 'otlp-configured' : 'disabled',
        'implemented',
        true,
      ),
    }),
  });
}
