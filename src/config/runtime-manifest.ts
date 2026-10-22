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
        config.storage.enabled
          ? 'provider' in config.storage
            ? config.storage.provider
            : 'supabase-private'
          : 'development-fake',
      ),
      invitationStorage: feature(
        config.storage.enabled,
        config.storage.enabled
          ? 'provider' in config.storage
            ? config.storage.provider
            : 'supabase-private'
          : 'unavailable',
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
      analytics: feature(Boolean(config.database.url), 'analytics-owner-feeds-v3-60s'),
      retention: feature(Boolean(config.database.url), 'operator-cli-manual-procedure'),
      workers: feature(
        config.notifications.workerEnabled,
        'durable-notifications-60s',
        'implemented',
      ),
      seatingReconciliation: feature(
        config.invitationStudio.reconcilerEnabled,
        config.invitationStudio.reconcilerEnabled ? 'seating-reconciliation-300s' : 'disabled',
        'implemented',
        true,
      ),
      androidDeviceRegistry: feature(Boolean(config.database.url), 'account-session-bound'),
      androidPush: feature(
        config.notifications.fcm.enabled,
        config.notifications.fcm.enabled ? 'fcm-http-v1' : 'disabled',
        'implemented',
        true,
      ),
      printFiles: feature(
        Boolean(config.database.url) &&
          config.storage.enabled &&
          Boolean(config.invitationStudio.publicOrigin),
        'invitation-a5-v2-seating',
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
