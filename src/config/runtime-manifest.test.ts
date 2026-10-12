import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env.js';
import { createRuntimeFeatureManifest } from './runtime-manifest.js';

describe('runtime feature manifest', () => {
  it('reports configured FCM separately from live proof and never publishes its service credentials', () => {
    const config = parseEnvironment({ NODE_ENV: 'test' });
    const manifest = createRuntimeFeatureManifest({
      ...config,
      notifications: {
        ...config.notifications,
        fcm: {
          enabled: true,
          projectId: 'wdp301-wedding',
          clientEmail: 'private-service@example.invalid',
          privateKey: 'private-key-sentinel',
          accountAllowlist: ['private-account'],
        },
      },
    });
    expect(manifest.features.androidPush).toMatchObject({
      implementation: 'implemented',
      configuration: 'configured',
      mode: 'fcm-http-v1',
      liveVerification: 'pending',
    });
    expect(JSON.stringify(manifest)).not.toMatch(/private-|wdp301-wedding/u);
  });
  it('labels absent integrations and development fallbacks without claiming verification', () => {
    const manifest = createRuntimeFeatureManifest(parseEnvironment({ NODE_ENV: 'test' }));
    expect(manifest.features.emailDelivery).toMatchObject({
      configuration: 'unconfigured',
      mode: 'development-fake',
      liveVerification: 'pending',
    });
    expect(manifest.features.catalogStorage.mode).toBe('development-fake');
    expect(manifest.features.invitationStorage.mode).toBe('unavailable');
    expect(manifest.features.gemini.mode).toBe('disabled');
    expect(manifest.features.vnpay.mode).toBe('disabled');
    expect(manifest.features.workers).toMatchObject({
      implementation: 'implemented',
      configuration: 'unconfigured',
      liveVerification: 'pending',
    });
    expect(manifest.features.androidPush).toMatchObject({
      mode: 'disabled',
      liveVerification: 'optional-disabled',
    });
    expect(manifest.features.printFiles).toMatchObject({
      implementation: 'implemented',
      configuration: 'unconfigured',
      mode: 'invitation-a5-v2-seating',
      liveVerification: 'pending',
    });
    expect(manifest.features.retention.mode).toBe('operator-cli-manual-procedure');
    expect(manifest.features.metrics.liveVerification).toBe('optional-disabled');
  });

  it('reports configured providers separately from offline or live proof and excludes secrets/targets', () => {
    const manifest = createRuntimeFeatureManifest(
      parseEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:sentinel-db@localhost/db',
        BREVO_API_KEY: 'sentinel-email',
        BREVO_FROM_EMAIL: 'private@example.com',
        SUPABASE_URL: 'https://private.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'sentinel-storage',
        SUPABASE_STORAGE_BUCKET: 'private-bucket',
        AI_IMAGE_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'sentinel-ai',
        GEMINI_IMAGE_MODEL: 'gemini-test-image',
        VNPAY_TMN_CODE: 'TESTCODE',
        VNPAY_HASH_SECRET: 'sentinel-payment',
        VNPAY_RETURN_URL: 'http://localhost/return',
        VNPAY_QUERY_IP: '127.0.0.1',
        AUTH_OTP_HASH_KEY: 'sentinel-otp'.repeat(4),
        METRICS_ENABLED: 'true',
        METRICS_TOKEN: 'sentinel-metrics'.repeat(3),
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://private-collector.example.com',
      }),
      'a'.repeat(40),
    );
    expect(manifest.revision).toBe('a'.repeat(40));
    expect(manifest.features.emailDelivery.mode).toBe('brevo');
    expect(manifest.features.vnpay.mode).toBe('sandbox-only');
    for (const feature of Object.values(manifest.features)) {
      expect(feature.offlineVerification).toBe('not-evaluated');
      expect(feature.liveVerification).not.toBe('verified');
    }
    expect(JSON.stringify(manifest)).not.toMatch(
      /sentinel|private@example|private-bucket|postgresql:\/\/|private.supabase|private-collector/u,
    );
  });

  it('refuses to echo arbitrary revision or model metadata', () => {
    const config = parseEnvironment({
      AI_IMAGE_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'secret',
      GEMINI_IMAGE_MODEL: 'secret-model-value',
    });
    const manifest = createRuntimeFeatureManifest(config, 'credential-value');
    expect(manifest.revision).toBeNull();
    expect(JSON.stringify(manifest)).not.toContain('secret-model-value');
  });
});
