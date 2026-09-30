import { describe, expect, it } from 'vitest';

import { config } from './config.js';
import { EnvironmentConfigurationError, parseEnvironment } from './env.js';

const validProductionEnvironment = {
  NODE_ENV: 'production',
  PORT: '3001',
  LOG_LEVEL: 'info',
  RESTAURANT_TIME_ZONE: 'Asia/Ho_Chi_Minh',
  CORS_ALLOWED_ORIGINS: 'https://wedding.example.com, https://manage.example.com',
  DATABASE_URL: 'postgresql://runtime:secret@db.example.com:5432/wedding?sslmode=require',
  MIGRATION_DATABASE_URL: 'postgresql://migrate:secret@db.example.com:5432/wedding?sslmode=require',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  SUPABASE_STORAGE_BUCKET: 'wedding-media',
  RESEND_API_KEY: 'resend-secret',
  RESEND_FROM_EMAIL: 'Wedding Restaurant <notifications@example.com>',
} as const;

describe('parseEnvironment', () => {
  it('loads one immutable process configuration at module initialization', () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.runtime.environment).toBe('test');
  });

  it('applies safe defaults for a minimal development environment', () => {
    const parsed = parseEnvironment({});

    expect(parsed).toEqual({
      runtime: {
        environment: 'development',
        port: 3001,
        logLevel: 'info',
        restaurantTimeZone: 'Asia/Ho_Chi_Minh',
      },
      cors: { allowedOrigins: [] },
      database: { url: undefined, migrationUrl: undefined },
      storage: { enabled: false },
      email: { enabled: false },
      aiImage: { provider: null },
      metrics: { enabled: false },
      openApi: { enabledInProduction: false },
      telemetry: { otlpEndpoint: undefined },
    });
  });

  it('parses valid test configuration and removes blank optional values', () => {
    const parsed = parseEnvironment({
      NODE_ENV: 'test',
      PORT: '4100',
      LOG_LEVEL: 'debug',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3002',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/wedding',
      MIGRATION_DATABASE_URL: 'postgres://test:test@localhost:5432/wedding',
      SUPABASE_URL: 'https://project.supabase.co/',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
      SUPABASE_STORAGE_BUCKET: 'wedding-media',
      RESEND_API_KEY: 'resend-secret',
      RESEND_FROM_EMAIL: 'notifications@example.com',
      AI_IMAGE_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-secret',
      GEMINI_IMAGE_MODEL: 'gemini-image-model',
      METRICS_ENABLED: 'true',
      METRICS_TOKEN: 'metrics-secret',
      OPENAPI_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });

    expect(parsed.runtime).toEqual({
      environment: 'test',
      port: 4100,
      logLevel: 'debug',
      restaurantTimeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(parsed.cors.allowedOrigins).toEqual(['http://localhost:3000', 'http://127.0.0.1:3002']);
    expect(parsed.database).toEqual({
      url: 'postgresql://test:test@localhost:5432/wedding',
      migrationUrl: 'postgres://test:test@localhost:5432/wedding',
    });
    expect(parsed.storage).toEqual({
      enabled: true,
      supabaseUrl: 'https://project.supabase.co/',
      serviceRoleKey: 'service-role-secret',
      bucket: 'wedding-media',
    });
    expect(parsed.email).toEqual({
      enabled: true,
      resendApiKey: 'resend-secret',
      fromEmail: 'notifications@example.com',
    });
    expect(parsed.aiImage).toEqual({
      provider: 'gemini',
      apiKey: 'gemini-secret',
      model: 'gemini-image-model',
    });
    expect(parsed.metrics).toEqual({ enabled: true, token: 'metrics-secret' });
    expect(parsed.openApi).toEqual({ enabledInProduction: true });
    expect(parsed.telemetry).toEqual({ otlpEndpoint: 'http://localhost:4318' });

    expect(
      parseEnvironment({
        NODE_ENV: 'test',
        CORS_ALLOWED_ORIGINS: '   ',
        DATABASE_URL: '',
        MIGRATION_DATABASE_URL: ' ',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
      }),
    ).toMatchObject({
      cors: { allowedOrigins: [] },
      database: { url: undefined, migrationUrl: undefined },
      telemetry: { otlpEndpoint: undefined },
    });
  });

  it('parses complete production configuration', () => {
    const parsed = parseEnvironment(validProductionEnvironment);

    expect(parsed.runtime.environment).toBe('production');
    expect(parsed.cors.allowedOrigins).toEqual([
      'https://wedding.example.com',
      'https://manage.example.com',
    ]);
    expect(parsed.storage.enabled).toBe(true);
    expect(parsed.email.enabled).toBe(true);
  });

  it.each([
    'CORS_ALLOWED_ORIGINS',
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_STORAGE_BUCKET',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
  ] as const)('rejects production when %s is absent', (variableName) => {
    const source: Record<string, string | undefined> = { ...validProductionEnvironment };
    delete source[variableName];

    expect(() => parseEnvironment(source)).toThrow(EnvironmentConfigurationError);
    expect(() => parseEnvironment(source)).toThrow(variableName);
  });

  it('applies production requirements to staging', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'staging' })).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ['NODE_ENV', 'preview'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '3000.5'],
    ['PORT', 'not-a-number'],
    ['LOG_LEVEL', 'verbose'],
    ['RESTAURANT_TIME_ZONE', 'UTC'],
    ['METRICS_ENABLED', 'yes'],
    ['AI_IMAGE_PROVIDER', 'openai'],
  ])('rejects invalid %s values', (variableName, value) => {
    expect(() => parseEnvironment({ [variableName]: value })).toThrow(
      EnvironmentConfigurationError,
    );
  });

  it.each([
    ['DATABASE_URL', 'https://db.example.com'],
    ['MIGRATION_DATABASE_URL', 'mysql://db.example.com/wedding'],
    ['SUPABASE_URL', 'http://project.supabase.co'],
    ['OTEL_EXPORTER_OTLP_ENDPOINT', 'ftp://telemetry.example.com'],
  ])('rejects an invalid %s URL', (variableName, value) => {
    expect(() => parseEnvironment({ [variableName]: value })).toThrow(
      EnvironmentConfigurationError,
    );
  });

  it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'] as const)(
    'requires TLS for deployed %s connections',
    (variableName) => {
      expect(() =>
        parseEnvironment({
          ...validProductionEnvironment,
          [variableName]: 'postgresql://user:secret@db.example.com:5432/wedding',
        }),
      ).toThrow(EnvironmentConfigurationError);
    },
  );

  it.each([
    '*',
    'https://wedding.example.com/path',
    'https://user:password@wedding.example.com',
    'ftp://wedding.example.com',
    'https://wedding.example.com,,https://manage.example.com',
  ])('rejects the unsafe CORS origin list %s', (origins) => {
    expect(() =>
      parseEnvironment({ NODE_ENV: 'development', CORS_ALLOWED_ORIGINS: origins }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it('rejects cleartext deployed origins but permits loopback development origins', () => {
    expect(() =>
      parseEnvironment({
        ...validProductionEnvironment,
        CORS_ALLOWED_ORIGINS: 'http://wedding.example.com',
      }),
    ).toThrow(EnvironmentConfigurationError);

    expect(
      parseEnvironment({
        CORS_ALLOWED_ORIGINS: 'http://localhost:3000,http://[::1]:3002',
      }).cors.allowedOrigins,
    ).toEqual(['http://localhost:3000', 'http://[::1]:3002']);
  });

  it('rejects duplicate CORS origins', () => {
    expect(() =>
      parseEnvironment({
        CORS_ALLOWED_ORIGINS: 'https://wedding.example.com,https://wedding.example.com',
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ['SUPABASE_URL', 'https://project.supabase.co'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'service-role-secret'],
    ['SUPABASE_STORAGE_BUCKET', 'wedding-media'],
  ])('rejects partial storage provider configuration starting with %s', (key, value) => {
    expect(() => parseEnvironment({ [key]: value })).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ['RESEND_API_KEY', 'resend-secret'],
    ['RESEND_FROM_EMAIL', 'notifications@example.com'],
  ])('rejects partial email provider configuration starting with %s', (key, value) => {
    expect(() => parseEnvironment({ [key]: value })).toThrow(EnvironmentConfigurationError);
  });

  it('rejects an invalid Resend sender email', () => {
    expect(() =>
      parseEnvironment({
        RESEND_API_KEY: 'resend-secret',
        RESEND_FROM_EMAIL: 'not-an-email',
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each(['GEMINI_API_KEY', 'GEMINI_IMAGE_MODEL'] as const)(
    'requires %s when the Gemini provider is enabled',
    (variableName) => {
      const source: Record<string, string | undefined> = {
        AI_IMAGE_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gemini-secret',
        GEMINI_IMAGE_MODEL: 'gemini-image-model',
      };
      delete source[variableName];

      expect(() => parseEnvironment(source)).toThrow(variableName);
    },
  );

  it('rejects Gemini credentials while the provider is disabled', () => {
    expect(() => parseEnvironment({ GEMINI_API_KEY: 'gemini-secret' })).toThrow(
      EnvironmentConfigurationError,
    );
  });

  it('requires a token when metrics are enabled and rejects a token while disabled', () => {
    expect(() => parseEnvironment({ METRICS_ENABLED: 'true' })).toThrow('METRICS_TOKEN');
    expect(() => parseEnvironment({ METRICS_TOKEN: 'metrics-secret' })).toThrow(
      EnvironmentConfigurationError,
    );
  });

  it('returns deeply immutable configuration', () => {
    const parsed = parseEnvironment(validProductionEnvironment);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.runtime)).toBe(true);
    expect(Object.isFrozen(parsed.cors)).toBe(true);
    expect(Object.isFrozen(parsed.cors.allowedOrigins)).toBe(true);
    expect(Object.isFrozen(parsed.database)).toBe(true);
    expect(Object.isFrozen(parsed.storage)).toBe(true);
    expect(Object.isFrozen(parsed.email)).toBe(true);
    expect(Object.isFrozen(parsed.aiImage)).toBe(true);
    expect(Object.isFrozen(parsed.metrics)).toBe(true);
    expect(Object.isFrozen(parsed.openApi)).toBe(true);
    expect(Object.isFrozen(parsed.telemetry)).toBe(true);
  });

  it('rejects invalid OpenAPI serving flags', () => {
    expect(() => parseEnvironment({ OPENAPI_ENABLED: 'yes' })).toThrow(
      EnvironmentConfigurationError,
    );
  });

  it('reports only variable names and never secret values', () => {
    const secretValue = 'do-not-leak-this-secret';

    try {
      parseEnvironment({
        NODE_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: secretValue,
      });
      throw new Error('Expected configuration parsing to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect(String(error)).toContain('CORS_ALLOWED_ORIGINS');
      expect(String(error)).not.toContain(secretValue);
    }
  });
});
