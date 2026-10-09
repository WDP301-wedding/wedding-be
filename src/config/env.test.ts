import { describe, expect, it } from 'vitest';

import { config } from './config.js';
import { EnvironmentConfigurationError, parseEnvironment } from './env.js';

describe('Public invitation origin configuration', () => {
  it('defaults publication to unavailable and accepts explicit HTTPS or loopback test origins', () => {
    expect(parseEnvironment({ NODE_ENV: 'test' }).invitationStudio.publicOrigin).toBeNull();
    for (const origin of ['https://wedding.example.test', 'http://127.0.0.1:3000'])
      expect(
        parseEnvironment({ NODE_ENV: 'test', PUBLIC_INVITATION_ORIGIN: origin }).invitationStudio
          .publicOrigin,
      ).toBe(origin);
  });
  it.each([
    'invalid',
    'http://public.example.test',
    'https://wedding.example.test/path',
    'https://user:secret@example.test',
  ])('rejects unsafe origin %s', (origin) => {
    expect(() => parseEnvironment({ NODE_ENV: 'test', PUBLIC_INVITATION_ORIGIN: origin })).toThrow(
      EnvironmentConfigurationError,
    );
  });
});

const approvedIdentityEnvironment = {
  AUTH_TRUST_PROXY_HOPS: '1',
  AUTH_ACCESS_TOKEN_TTL_SECONDS: '600',
  AUTH_REFRESH_IDLE_TTL_SECONDS: '2592000',
  AUTH_REFRESH_ABSOLUTE_TTL_SECONDS: '7776000',
  AUTH_PASSWORD_RESET_TTL_SECONDS: '1800',
  AUTH_INVITATION_TTL_SECONDS: '259200',
  AUTH_INVITATION_REISSUE_LIMIT: '3',
  AUTH_INVITATION_REISSUE_WINDOW_SECONDS: '86400',
  AUTH_PASSWORD_MIN_CHARACTERS: '12',
  AUTH_PASSWORD_MAX_CHARACTERS: '128',
  AUTH_PASSWORD_MAX_BYTES: '512',
  AUTH_SCRYPT_COST: '131072',
  AUTH_SCRYPT_BLOCK_SIZE: '8',
  AUTH_SCRYPT_PARALLELIZATION: '1',
  AUTH_SCRYPT_KEY_LENGTH_BYTES: '64',
  AUTH_SCRYPT_MAX_MEMORY_BYTES: '268435456',
  AUTH_TOKEN_ENTROPY_BYTES: '32',
  AUTH_LOGIN_RATE_LIMIT_MAX: '10',
  AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: '900',
  AUTH_TOKEN_CONSUME_RATE_LIMIT_MAX: '10',
  AUTH_TOKEN_CONSUME_RATE_LIMIT_WINDOW_SECONDS: '900',
  AUTH_RESET_REQUEST_RATE_LIMIT_MAX: '3',
  AUTH_RESET_REQUEST_RATE_LIMIT_WINDOW_SECONDS: '3600',
  AUTH_REFRESH_RATE_LIMIT_MAX: '60',
  AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS: '900',
  AUTH_INVITATION_RETENTION_DAYS: '180',
  AUTH_PASSWORD_RESET_RETENTION_DAYS: '30',
  AUTH_SESSION_RETENTION_DAYS: '90',
  AUTH_DISABLED_ACCOUNT_PII_RETENTION_DAYS: '365',
} as const;

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
  ...approvedIdentityEnvironment,
} as const;

describe('parseEnvironment', () => {
  it('loads one immutable process configuration at module initialization', () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.runtime.environment).toBe('test');
  });

  it('applies safe defaults for a minimal development environment', () => {
    const parsed = parseEnvironment({});

    expect(parsed).toEqual({
      invitationStudio: { publicOrigin: null },
      runtime: {
        environment: 'development',
        port: 3001,
        logLevel: 'info',
        restaurantTimeZone: 'Asia/Ho_Chi_Minh',
      },
      cors: { allowedOrigins: [] },
      security: {
        bodyLimitBytes: 1_048_576,
        requestTimeoutMs: 30_000,
        rateLimit: { maxRequests: 100, windowMs: 60_000 },
        replicaCount: 1,
      },
      identityAccess: {
        trustedProxyHops: 0,
        refreshCookie: {
          name: '__Host-wedding-refresh',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        },
        lifetimesSeconds: {
          accessToken: 600,
          refreshIdle: 2_592_000,
          refreshAbsolute: 7_776_000,
          passwordReset: 1_800,
        },
        invitation: {
          lifetimeSeconds: 259_200,
          reissueLimit: 3,
          reissueWindowSeconds: 86_400,
        },
        password: {
          minimumCharacters: 12,
          maximumCharacters: 128,
          maximumBytes: 512,
          scrypt: {
            cost: 131_072,
            blockSize: 8,
            parallelization: 1,
            keyLengthBytes: 64,
            maxMemoryBytes: 268_435_456,
          },
        },
        tokenEntropyBytes: 32,
        rateLimits: {
          login: { maxAttempts: 10, windowSeconds: 900 },
          tokenConsume: { maxAttempts: 10, windowSeconds: 900 },
          resetRequest: { maxAttempts: 3, windowSeconds: 3_600 },
          refresh: { maxAttempts: 60, windowSeconds: 900 },
        },
        retentionDays: {
          invitation: 180,
          passwordReset: 30,
          session: 90,
          disabledAccountPii: 365,
        },
      },
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
      HTTP_BODY_LIMIT_BYTES: '2048',
      HTTP_REQUEST_TIMEOUT_MS: '5000',
      RATE_LIMIT_MAX_REQUESTS: '25',
      RATE_LIMIT_WINDOW_MS: '30000',
      BACKEND_REPLICA_COUNT: '1',
    });

    expect(parsed.runtime).toEqual({
      environment: 'test',
      port: 4100,
      logLevel: 'debug',
      restaurantTimeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(parsed.cors.allowedOrigins).toEqual(['http://localhost:3000', 'http://127.0.0.1:3002']);
    expect(parsed.security).toEqual({
      bodyLimitBytes: 2048,
      requestTimeoutMs: 5000,
      rateLimit: { maxRequests: 25, windowMs: 30000 },
      replicaCount: 1,
    });
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
      provider: 'resend',
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
    expect(parsed.identityAccess.trustedProxyHops).toBe(1);
    expect(parsed.identityAccess.refreshCookie.name).toBe('__Host-wedding-refresh');
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
    ...Object.keys(approvedIdentityEnvironment),
  ] as const)('rejects production when %s is absent', (variableName) => {
    const source: Record<string, string | undefined> = { ...validProductionEnvironment };
    delete source[variableName];

    expect(() => parseEnvironment(source)).toThrow(EnvironmentConfigurationError);
    expect(() => parseEnvironment(source)).toThrow(variableName);
  });

  it.each([
    ['AUTH_TRUST_PROXY_HOPS', '2'],
    ['AUTH_ACCESS_TOKEN_TTL_SECONDS', '601'],
    ['AUTH_REFRESH_IDLE_TTL_SECONDS', '2591999'],
    ['AUTH_REFRESH_ABSOLUTE_TTL_SECONDS', '7776001'],
    ['AUTH_PASSWORD_RESET_TTL_SECONDS', '3600'],
    ['AUTH_INVITATION_TTL_SECONDS', '86400'],
    ['AUTH_INVITATION_REISSUE_LIMIT', '4'],
    ['AUTH_PASSWORD_MIN_CHARACTERS', '8'],
    ['AUTH_PASSWORD_MAX_CHARACTERS', '256'],
    ['AUTH_SCRYPT_COST', '16384'],
    ['AUTH_SCRYPT_MAX_MEMORY_BYTES', '33554432'],
    ['AUTH_TOKEN_ENTROPY_BYTES', '16'],
    ['AUTH_LOGIN_RATE_LIMIT_MAX', '100'],
    ['AUTH_RESET_REQUEST_RATE_LIMIT_WINDOW_SECONDS', '60'],
    ['AUTH_INVITATION_RETENTION_DAYS', '30'],
    ['AUTH_DISABLED_ACCOUNT_PII_RETENTION_DAYS', '0'],
  ])('rejects an unapproved identity policy value for %s', (variableName, value) => {
    expect(() =>
      parseEnvironment({
        ...approvedIdentityEnvironment,
        [variableName]: value,
      }),
    ).toThrow(EnvironmentConfigurationError);
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
    ['HTTP_BODY_LIMIT_BYTES', '0'],
    ['HTTP_REQUEST_TIMEOUT_MS', '0'],
    ['RATE_LIMIT_MAX_REQUESTS', '0'],
    ['RATE_LIMIT_WINDOW_MS', '0'],
    ['BACKEND_REPLICA_COUNT', '2'],
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

  it('enables Brevo from a complete credential group and disables blank email groups', () => {
    const parsed = parseEnvironment({
      BREVO_API_KEY: 'brevo-test-key',
      BREVO_FROM_EMAIL: 'Wedding <sender@gmail.com>',
    });
    expect(parsed.email).toEqual({
      enabled: true,
      provider: 'brevo',
      apiKey: 'brevo-test-key',
      fromEmail: 'Wedding <sender@gmail.com>',
    });
    expect(Object.isFrozen(parsed.email)).toBe(true);
    expect(
      parseEnvironment({
        BREVO_API_KEY: ' ',
        BREVO_FROM_EMAIL: '',
        RESEND_API_KEY: '',
        RESEND_FROM_EMAIL: '',
      }).email,
    ).toEqual({ enabled: false });
  });

  it.each(['BREVO_API_KEY', 'BREVO_FROM_EMAIL'] as const)(
    'requires %s when using Brevo in production',
    (key) => {
      const source: Record<string, string | undefined> = {
        ...validProductionEnvironment,
        RESEND_API_KEY: '',
        RESEND_FROM_EMAIL: '',
        BREVO_API_KEY: 'brevo-test-key',
        BREVO_FROM_EMAIL: 'Wedding <sender@gmail.com>',
      };
      expect(parseEnvironment(source).email).toMatchObject({ provider: 'brevo', enabled: true });
      delete source[key];
      expect(() => parseEnvironment(source)).toThrow(key);
    },
  );

  it.each([
    { BREVO_API_KEY: 'test-key' },
    { BREVO_FROM_EMAIL: 'sender@gmail.com' },
    { BREVO_API_KEY: 'test-key', BREVO_FROM_EMAIL: 'bad-address' },
    { BREVO_API_KEY: 'test-key', BREVO_FROM_EMAIL: 'Wedding\r\nRestaurant <sender@gmail.com>' },
    { BREVO_API_KEY: 'key\nheader', BREVO_FROM_EMAIL: 'sender@gmail.com' },
  ])('rejects incomplete or invalid Brevo configuration: %j', (source) => {
    expect(() => parseEnvironment(source)).toThrow(EnvironmentConfigurationError);
  });

  it('rejects simultaneous email providers', () => {
    expect(() =>
      parseEnvironment({
        RESEND_API_KEY: 'resend-key',
        RESEND_FROM_EMAIL: 'sender@example.com',
        BREVO_API_KEY: 'brevo-key',
        BREVO_FROM_EMAIL: 'sender@gmail.com',
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it('requires email credentials in deployed environments and never prints the Brevo key', () => {
    const source = { ...validProductionEnvironment, RESEND_API_KEY: '', RESEND_FROM_EMAIL: '' };
    expect(() => parseEnvironment(source)).toThrow('BREVO_API_KEY');
    try {
      parseEnvironment({ BREVO_API_KEY: 'private-brevo-key' });
      throw new Error('Expected invalid configuration');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect(String(error)).not.toContain('private-brevo-key');
    }
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
    expect(Object.isFrozen(parsed.security)).toBe(true);
    expect(Object.isFrozen(parsed.security.rateLimit)).toBe(true);
    expect(Object.isFrozen(parsed.identityAccess)).toBe(true);
    expect(Object.isFrozen(parsed.identityAccess.refreshCookie)).toBe(true);
    expect(Object.isFrozen(parsed.identityAccess.password.scrypt)).toBe(true);
    expect(Object.isFrozen(parsed.identityAccess.rateLimits.login)).toBe(true);
    expect(Object.isFrozen(parsed.identityAccess.retentionDays)).toBe(true);
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
