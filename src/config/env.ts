import { isIP } from 'node:net';

import { z } from 'zod';
import type { VnpaySettings } from '../modules/payments-billing/application/vnpay.port.js';
import {
  parseNotificationConfiguration,
  NotificationConfigurationError,
  type NotificationConfiguration,
} from './notifications.js';

const deployedEnvironments = new Set(['staging', 'production']);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const identityRequiredVariables = [
  'AUTH_TRUST_PROXY_HOPS',
  'AUTH_ACCESS_TOKEN_TTL_SECONDS',
  'AUTH_REFRESH_IDLE_TTL_SECONDS',
  'AUTH_REFRESH_ABSOLUTE_TTL_SECONDS',
  'AUTH_PASSWORD_RESET_TTL_SECONDS',
  'AUTH_INVITATION_TTL_SECONDS',
  'AUTH_INVITATION_REISSUE_LIMIT',
  'AUTH_INVITATION_REISSUE_WINDOW_SECONDS',
  'AUTH_PASSWORD_MIN_CHARACTERS',
  'AUTH_PASSWORD_MAX_CHARACTERS',
  'AUTH_PASSWORD_MAX_BYTES',
  'AUTH_SCRYPT_COST',
  'AUTH_SCRYPT_BLOCK_SIZE',
  'AUTH_SCRYPT_PARALLELIZATION',
  'AUTH_SCRYPT_KEY_LENGTH_BYTES',
  'AUTH_SCRYPT_MAX_MEMORY_BYTES',
  'AUTH_TOKEN_ENTROPY_BYTES',
  'AUTH_LOGIN_RATE_LIMIT_MAX',
  'AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS',
  'AUTH_TOKEN_CONSUME_RATE_LIMIT_MAX',
  'AUTH_TOKEN_CONSUME_RATE_LIMIT_WINDOW_SECONDS',
  'AUTH_RESET_REQUEST_RATE_LIMIT_MAX',
  'AUTH_RESET_REQUEST_RATE_LIMIT_WINDOW_SECONDS',
  'AUTH_REFRESH_RATE_LIMIT_MAX',
  'AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS',
  'AUTH_INVITATION_RETENTION_DAYS',
  'AUTH_PASSWORD_RESET_RETENTION_DAYS',
  'AUTH_SESSION_RETENTION_DAYS',
  'AUTH_DISABLED_ACCOUNT_PII_RETENTION_DAYS',
] as const;
const productionRequiredVariables = [
  'CORS_ALLOWED_ORIGINS',
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  ...identityRequiredVariables,
] as const;

const approvedIdentityPolicy = Object.freeze({
  accessTokenTtlSeconds: 1_800,
  refreshIdleTtlSeconds: 2_592_000,
  refreshAbsoluteTtlSeconds: 7_776_000,
  passwordResetTtlSeconds: 1_800,
  invitationTtlSeconds: 259_200,
  invitationReissueLimit: 3,
  invitationReissueWindowSeconds: 86_400,
  passwordMinimumCharacters: 12,
  passwordMaximumCharacters: 128,
  passwordMaximumBytes: 512,
  scryptCost: 131_072,
  scryptBlockSize: 8,
  scryptParallelization: 1,
  scryptKeyLengthBytes: 64,
  scryptMaxMemoryBytes: 268_435_456,
  tokenEntropyBytes: 32,
  loginRateLimitMax: 10,
  loginRateLimitWindowSeconds: 900,
  tokenConsumeRateLimitMax: 10,
  tokenConsumeRateLimitWindowSeconds: 900,
  resetRequestRateLimitMax: 3,
  resetRequestRateLimitWindowSeconds: 3_600,
  refreshRateLimitMax: 60,
  refreshRateLimitWindowSeconds: 900,
  invitationRetentionDays: 180,
  passwordResetRetentionDays: 30,
  sessionRetentionDays: 90,
  disabledAccountPiiRetentionDays: 365,
});

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

function integerEnvironmentVariable(options: {
  readonly defaultValue: number;
  readonly maximum: number;
  readonly minimum: number;
}): z.ZodDefault<z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>, z.ZodNumber>> {
  return z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().min(options.minimum).max(options.maximum))
    .default(options.defaultValue);
}

function approvedInteger(value: number) {
  return z
    .literal(String(value))
    .transform(() => value)
    .optional();
}

const databaseUrl = z.url({ protocol: /^postgres(?:ql)?$/ });
const httpsUrl = z.url({ protocol: /^https$/ });
const httpUrl = z.url({ protocol: /^https?$/ });

const corsOrigin = httpUrl.refine(
  (value) => URL.canParse(value) && new URL(value).origin === value,
  {
    message: 'Must contain only an origin without credentials, path, query, or fragment.',
  },
);

const corsAllowedOrigins = z
  .string()
  .trim()
  .default('')
  .transform((value, context) => {
    if (value === '') {
      return [];
    }

    const origins = value.split(',').map((origin) => origin.trim());

    if (origins.some((origin) => origin === '')) {
      context.addIssue({ code: 'custom', message: 'Must not contain empty origins.' });
      return z.NEVER;
    }

    return origins;
  })
  .pipe(z.array(corsOrigin));

const resendFromEmail = z
  .string()
  .trim()
  .refine((value) => !/[\r\n]/u.test(value), 'Sender address must be a single line.')
  .refine(
    (value) => {
      const displayAddress = value.match(/^[^<>]+<([^<>]+)>$/u);
      const address = displayAddress?.[1] ?? value;

      return z.email().safeParse(address.trim()).success;
    },
    { message: 'Must be a valid email address or display-name email address.' },
  );

const rawEnvironmentSchema = z
  .strictObject({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z
      .string()
      .regex(/^\d+$/u)
      .transform(Number)
      .pipe(z.number().int().min(1).max(65_535))
      .default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    RESTAURANT_TIME_ZONE: z.literal('Asia/Ho_Chi_Minh').default('Asia/Ho_Chi_Minh'),
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    HTTP_BODY_LIMIT_BYTES: integerEnvironmentVariable({
      defaultValue: 1_048_576,
      minimum: 1_024,
      maximum: 10_485_760,
    }),
    HTTP_REQUEST_TIMEOUT_MS: integerEnvironmentVariable({
      defaultValue: 60_000,
      minimum: 1_000,
      maximum: 120_000,
    }),
    RATE_LIMIT_MAX_REQUESTS: integerEnvironmentVariable({
      defaultValue: 100,
      minimum: 1,
      maximum: 100_000,
    }),
    RATE_LIMIT_WINDOW_MS: integerEnvironmentVariable({
      defaultValue: 60_000,
      minimum: 1_000,
      maximum: 3_600_000,
    }),
    BACKEND_REPLICA_COUNT: z
      .literal('1')
      .transform(() => 1 as const)
      .default(1),
    AUTH_TRUST_PROXY_HOPS: z
      .enum(['0', '1'])
      .transform(Number)
      .pipe(z.union([z.literal(0), z.literal(1)]))
      .optional(),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: approvedInteger(approvedIdentityPolicy.accessTokenTtlSeconds),
    AUTH_REFRESH_IDLE_TTL_SECONDS: approvedInteger(approvedIdentityPolicy.refreshIdleTtlSeconds),
    AUTH_REFRESH_ABSOLUTE_TTL_SECONDS: approvedInteger(
      approvedIdentityPolicy.refreshAbsoluteTtlSeconds,
    ),
    AUTH_OTP_HASH_KEY: optionalString.pipe(z.string().min(32).optional()),
    AUTH_PASSWORD_RESET_TTL_SECONDS: approvedInteger(
      approvedIdentityPolicy.passwordResetTtlSeconds,
    ),
    AUTH_INVITATION_TTL_SECONDS: approvedInteger(approvedIdentityPolicy.invitationTtlSeconds),
    AUTH_INVITATION_REISSUE_LIMIT: approvedInteger(approvedIdentityPolicy.invitationReissueLimit),
    AUTH_INVITATION_REISSUE_WINDOW_SECONDS: approvedInteger(
      approvedIdentityPolicy.invitationReissueWindowSeconds,
    ),
    AUTH_PASSWORD_MIN_CHARACTERS: approvedInteger(approvedIdentityPolicy.passwordMinimumCharacters),
    AUTH_PASSWORD_MAX_CHARACTERS: approvedInteger(approvedIdentityPolicy.passwordMaximumCharacters),
    AUTH_PASSWORD_MAX_BYTES: approvedInteger(approvedIdentityPolicy.passwordMaximumBytes),
    AUTH_SCRYPT_COST: approvedInteger(approvedIdentityPolicy.scryptCost),
    AUTH_SCRYPT_BLOCK_SIZE: approvedInteger(approvedIdentityPolicy.scryptBlockSize),
    AUTH_SCRYPT_PARALLELIZATION: approvedInteger(approvedIdentityPolicy.scryptParallelization),
    AUTH_SCRYPT_KEY_LENGTH_BYTES: approvedInteger(approvedIdentityPolicy.scryptKeyLengthBytes),
    AUTH_SCRYPT_MAX_MEMORY_BYTES: approvedInteger(approvedIdentityPolicy.scryptMaxMemoryBytes),
    AUTH_TOKEN_ENTROPY_BYTES: approvedInteger(approvedIdentityPolicy.tokenEntropyBytes),
    AUTH_LOGIN_RATE_LIMIT_MAX: approvedInteger(approvedIdentityPolicy.loginRateLimitMax),
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: approvedInteger(
      approvedIdentityPolicy.loginRateLimitWindowSeconds,
    ),
    AUTH_TOKEN_CONSUME_RATE_LIMIT_MAX: approvedInteger(
      approvedIdentityPolicy.tokenConsumeRateLimitMax,
    ),
    AUTH_TOKEN_CONSUME_RATE_LIMIT_WINDOW_SECONDS: approvedInteger(
      approvedIdentityPolicy.tokenConsumeRateLimitWindowSeconds,
    ),
    AUTH_RESET_REQUEST_RATE_LIMIT_MAX: approvedInteger(
      approvedIdentityPolicy.resetRequestRateLimitMax,
    ),
    AUTH_RESET_REQUEST_RATE_LIMIT_WINDOW_SECONDS: approvedInteger(
      approvedIdentityPolicy.resetRequestRateLimitWindowSeconds,
    ),
    AUTH_REFRESH_RATE_LIMIT_MAX: approvedInteger(approvedIdentityPolicy.refreshRateLimitMax),
    AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS: approvedInteger(
      approvedIdentityPolicy.refreshRateLimitWindowSeconds,
    ),
    AUTH_INVITATION_RETENTION_DAYS: approvedInteger(approvedIdentityPolicy.invitationRetentionDays),
    AUTH_PASSWORD_RESET_RETENTION_DAYS: approvedInteger(
      approvedIdentityPolicy.passwordResetRetentionDays,
    ),
    AUTH_SESSION_RETENTION_DAYS: approvedInteger(approvedIdentityPolicy.sessionRetentionDays),
    AUTH_DISABLED_ACCOUNT_PII_RETENTION_DAYS: approvedInteger(
      approvedIdentityPolicy.disabledAccountPiiRetentionDays,
    ),
    DATABASE_URL: optionalString.pipe(databaseUrl.optional()),
    MIGRATION_DATABASE_URL: optionalString.pipe(databaseUrl.optional()),
    SUPABASE_URL: optionalString.pipe(httpsUrl.optional()),
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_STORAGE_BUCKET: optionalString,
    RESEND_API_KEY: optionalString,
    VNPAY_TMN_CODE: optionalString.pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9]{8}$/u)
        .optional(),
    ),
    VNPAY_HASH_SECRET: optionalString.pipe(z.string().max(1024).optional()),
    VNPAY_RETURN_URL: optionalString.pipe(httpUrl.optional()),
    VNPAY_QUERY_IP: optionalString.pipe(
      z
        .string()
        .refine((value) => isIP(value) !== 0)
        .optional(),
    ),
    RESEND_FROM_EMAIL: optionalString.pipe(resendFromEmail.optional()),
    BREVO_API_KEY: optionalString.pipe(
      z
        .string()
        .regex(/^[^\r\n]+$/u)
        .optional(),
    ),
    BREVO_FROM_EMAIL: optionalString.pipe(resendFromEmail.optional()),
    AI_IMAGE_PROVIDER: optionalString.pipe(z.literal('gemini').optional()),
    GEMINI_API_KEY: optionalString,
    GEMINI_IMAGE_MODEL: optionalString,
    METRICS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    METRICS_TOKEN: optionalString,
    OPENAPI_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PUBLIC_INVITATION_ORIGIN: optionalString.pipe(corsOrigin.optional()),
    SEATING_RECONCILER_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(true),
    AI_IMAGE_JOBS_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalString.pipe(httpUrl.optional()),
  })
  .superRefine((environment, context) => {
    const deployed = deployedEnvironments.has(environment.NODE_ENV);
    if (
      environment.PUBLIC_INVITATION_ORIGIN !== undefined &&
      URL.canParse(environment.PUBLIC_INVITATION_ORIGIN)
    ) {
      const origin = new URL(environment.PUBLIC_INVITATION_ORIGIN);
      if (origin.protocol !== 'https:' && (deployed || !loopbackHosts.has(origin.hostname)))
        context.addIssue({
          code: 'custom',
          path: ['PUBLIC_INVITATION_ORIGIN'],
          message: 'Public invitation origins require HTTPS outside loopback development.',
        });
    }

    if (deployed) {
      for (const variableName of productionRequiredVariables) {
        const value = environment[variableName];

        if (value === undefined || (Array.isArray(value) && value.length === 0)) {
          context.addIssue({
            code: 'custom',
            path: [variableName],
            message: 'Required in staging and production.',
          });
        }
      }
    }

    for (const [variableName, value] of [
      ['DATABASE_URL', environment.DATABASE_URL],
      ['MIGRATION_DATABASE_URL', environment.MIGRATION_DATABASE_URL],
    ] as const) {
      const parsedDatabaseUrl = databaseUrl.safeParse(value);

      if (
        deployed &&
        parsedDatabaseUrl.success &&
        !['require', 'verify-ca', 'verify-full'].includes(
          new URL(parsedDatabaseUrl.data).searchParams.get('sslmode') ?? '',
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: [variableName],
          message: 'Must require TLS in staging and production.',
        });
      }
    }

    const uniqueOrigins = new Set(environment.CORS_ALLOWED_ORIGINS);
    if (uniqueOrigins.size !== environment.CORS_ALLOWED_ORIGINS.length) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'Must not contain duplicate origins.',
      });
    }

    for (const [index, origin] of environment.CORS_ALLOWED_ORIGINS.entries()) {
      const parsedOrigin = httpUrl.safeParse(origin);

      if (!parsedOrigin.success) {
        continue;
      }

      const url = new URL(parsedOrigin.data);

      if (url.protocol !== 'https:' && !loopbackHosts.has(url.hostname)) {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ALLOWED_ORIGINS', index],
          message: 'Cleartext origins are allowed only for explicitly configured loopback hosts.',
        });
      }
    }

    requireAllOrNone(
      environment,
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'],
      context,
    );
    requireAllOrNone(environment, ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'], context);
    requireAllOrNone(
      environment,
      ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET', 'VNPAY_RETURN_URL', 'VNPAY_QUERY_IP'],
      context,
    );
    if (environment.VNPAY_RETURN_URL !== undefined && URL.canParse(environment.VNPAY_RETURN_URL)) {
      const url = new URL(environment.VNPAY_RETURN_URL);
      if (
        url.username !== '' ||
        url.password !== '' ||
        url.hash !== '' ||
        (url.protocol !== 'https:' && (deployed || !loopbackHosts.has(url.hostname)))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['VNPAY_RETURN_URL'],
          message: 'Use a credential-free HTTPS return URL, or loopback HTTP in development/test.',
        });
      }
    }
    requireAllOrNone(environment, ['BREVO_API_KEY', 'BREVO_FROM_EMAIL'], context);
    const hasBrevo =
      environment.BREVO_API_KEY !== undefined || environment.BREVO_FROM_EMAIL !== undefined;
    const hasResend =
      environment.RESEND_API_KEY !== undefined || environment.RESEND_FROM_EMAIL !== undefined;
    if (hasBrevo && hasResend) {
      context.addIssue({
        code: 'custom',
        path: ['BREVO_API_KEY'],
        message: 'Configure only one email provider.',
      });
    }
    if (deployed && !hasBrevo && !hasResend) {
      requireVariables(environment, ['BREVO_API_KEY', 'BREVO_FROM_EMAIL'], context);
    }

    if (environment.AI_IMAGE_PROVIDER === 'gemini') {
      requireVariables(environment, ['GEMINI_API_KEY', 'GEMINI_IMAGE_MODEL'], context);
    } else {
      rejectVariables(environment, ['GEMINI_API_KEY', 'GEMINI_IMAGE_MODEL'], context);
    }

    if (environment.METRICS_ENABLED) {
      requireVariables(environment, ['METRICS_TOKEN'], context);
    } else {
      rejectVariables(environment, ['METRICS_TOKEN'], context);
    }
  });

type RawEnvironment = z.output<typeof rawEnvironmentSchema>;
type EnvironmentSource = Readonly<Record<string, string | undefined>>;
type EnvironmentKey = keyof z.input<typeof rawEnvironmentSchema>;

export type RuntimeEnvironment = 'development' | 'test' | 'staging' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

type DisabledProvider = Readonly<{ enabled: false }>;
type StorageConfig =
  | DisabledProvider
  | Readonly<{
      enabled: true;
      supabaseUrl: string;
      serviceRoleKey: string;
      bucket: string;
    }>;
type EmailConfig =
  | DisabledProvider
  | Readonly<{ enabled: true; provider: 'resend'; resendApiKey: string; fromEmail: string }>
  | Readonly<{ enabled: true; provider: 'brevo'; apiKey: string; fromEmail: string }>;
type AiImageConfig =
  Readonly<{ provider: null }> | Readonly<{ provider: 'gemini'; apiKey: string; model: string }>;
type MetricsConfig = DisabledProvider | Readonly<{ enabled: true; token: string }>;

export type BackendConfig = Readonly<{
  runtime: Readonly<{
    environment: RuntimeEnvironment;
    port: number;
    logLevel: LogLevel;
    restaurantTimeZone: 'Asia/Ho_Chi_Minh';
  }>;
  cors: Readonly<{ allowedOrigins: readonly string[] }>;
  security: Readonly<{
    bodyLimitBytes: number;
    requestTimeoutMs: number;
    rateLimit: Readonly<{ maxRequests: number; windowMs: number }>;
    replicaCount: 1;
  }>;
  identityAccess: Readonly<{
    passwordOtpHashKey: string | undefined;
    trustedProxyHops: 0 | 1;
    refreshCookie: Readonly<{
      name: '__Host-wedding-refresh';
      path: '/';
      httpOnly: true;
      secure: true;
      sameSite: 'lax';
    }>;
    lifetimesSeconds: Readonly<{
      accessToken: number;
      refreshIdle: number;
      refreshAbsolute: number;
      passwordReset: number;
    }>;
    invitation: Readonly<{
      lifetimeSeconds: number;
      reissueLimit: number;
      reissueWindowSeconds: number;
    }>;
    password: Readonly<{
      minimumCharacters: number;
      maximumCharacters: number;
      maximumBytes: number;
      scrypt: Readonly<{
        cost: number;
        blockSize: number;
        parallelization: number;
        keyLengthBytes: number;
        maxMemoryBytes: number;
      }>;
    }>;
    tokenEntropyBytes: number;
    rateLimits: Readonly<{
      login: Readonly<{ maxAttempts: number; windowSeconds: number }>;
      tokenConsume: Readonly<{ maxAttempts: number; windowSeconds: number }>;
      resetRequest: Readonly<{ maxAttempts: number; windowSeconds: number }>;
      refresh: Readonly<{ maxAttempts: number; windowSeconds: number }>;
    }>;
    retentionDays: Readonly<{
      invitation: number;
      passwordReset: number;
      session: number;
      disabledAccountPii: number;
    }>;
  }>;
  database: Readonly<{ url: string | undefined; migrationUrl: string | undefined }>;
  storage: StorageConfig;
  email: EmailConfig;
  aiImage: AiImageConfig;
  metrics: MetricsConfig;
  vnpay: DisabledProvider | (Readonly<{ enabled: true }> & VnpaySettings);
  openApi: Readonly<{ enabledInProduction: boolean }>;
  invitationStudio: Readonly<{
    publicOrigin: string | null;
    reconcilerEnabled: boolean;
    imageJobsEnabled?: boolean;
  }>;
  telemetry: Readonly<{ otlpEndpoint: string | undefined }>;
  notifications: NotificationConfiguration;
}>;

export class EnvironmentConfigurationError extends Error {
  override readonly name = 'EnvironmentConfigurationError';
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    const safeVariables = [...new Set(variables)].sort();
    super(`Invalid environment configuration: ${safeVariables.join(', ')}.`);
    this.variables = Object.freeze(safeVariables);
  }
}

export function parseEnvironment(source: EnvironmentSource): BackendConfig {
  const result = rawEnvironmentSchema.safeParse(pickEnvironment(source));

  if (!result.success) {
    throw new EnvironmentConfigurationError(
      result.error.issues.map((issue) => String(issue.path[0])),
    );
  }

  const config = createConfig(result.data);
  try {
    return Object.freeze({
      ...config,
      notifications: parseNotificationConfiguration(
        source,
        result.data.NODE_ENV,
        config.email.enabled,
      ),
    });
  } catch (error) {
    if (error instanceof NotificationConfigurationError)
      throw new EnvironmentConfigurationError(error.variables);
    throw error;
  }
}

function pickEnvironment(source: EnvironmentSource): EnvironmentSource {
  return {
    NODE_ENV: source.NODE_ENV,
    PORT: source.PORT,
    LOG_LEVEL: source.LOG_LEVEL,
    RESTAURANT_TIME_ZONE: source.RESTAURANT_TIME_ZONE,
    CORS_ALLOWED_ORIGINS: source.CORS_ALLOWED_ORIGINS,
    HTTP_BODY_LIMIT_BYTES: source.HTTP_BODY_LIMIT_BYTES,
    HTTP_REQUEST_TIMEOUT_MS: source.HTTP_REQUEST_TIMEOUT_MS,
    RATE_LIMIT_MAX_REQUESTS: source.RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS: source.RATE_LIMIT_WINDOW_MS,
    BACKEND_REPLICA_COUNT: source.BACKEND_REPLICA_COUNT,
    AUTH_TRUST_PROXY_HOPS: source.AUTH_TRUST_PROXY_HOPS,
    AUTH_ACCESS_TOKEN_TTL_SECONDS: source.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    AUTH_REFRESH_IDLE_TTL_SECONDS: source.AUTH_REFRESH_IDLE_TTL_SECONDS,
    AUTH_REFRESH_ABSOLUTE_TTL_SECONDS: source.AUTH_REFRESH_ABSOLUTE_TTL_SECONDS,
    AUTH_OTP_HASH_KEY: source.AUTH_OTP_HASH_KEY,
    AUTH_PASSWORD_RESET_TTL_SECONDS: source.AUTH_PASSWORD_RESET_TTL_SECONDS,
    AUTH_INVITATION_TTL_SECONDS: source.AUTH_INVITATION_TTL_SECONDS,
    AUTH_INVITATION_REISSUE_LIMIT: source.AUTH_INVITATION_REISSUE_LIMIT,
    AUTH_INVITATION_REISSUE_WINDOW_SECONDS: source.AUTH_INVITATION_REISSUE_WINDOW_SECONDS,
    AUTH_PASSWORD_MIN_CHARACTERS: source.AUTH_PASSWORD_MIN_CHARACTERS,
    AUTH_PASSWORD_MAX_CHARACTERS: source.AUTH_PASSWORD_MAX_CHARACTERS,
    AUTH_PASSWORD_MAX_BYTES: source.AUTH_PASSWORD_MAX_BYTES,
    AUTH_SCRYPT_COST: source.AUTH_SCRYPT_COST,
    AUTH_SCRYPT_BLOCK_SIZE: source.AUTH_SCRYPT_BLOCK_SIZE,
    AUTH_SCRYPT_PARALLELIZATION: source.AUTH_SCRYPT_PARALLELIZATION,
    AUTH_SCRYPT_KEY_LENGTH_BYTES: source.AUTH_SCRYPT_KEY_LENGTH_BYTES,
    AUTH_SCRYPT_MAX_MEMORY_BYTES: source.AUTH_SCRYPT_MAX_MEMORY_BYTES,
    AUTH_TOKEN_ENTROPY_BYTES: source.AUTH_TOKEN_ENTROPY_BYTES,
    AUTH_LOGIN_RATE_LIMIT_MAX: source.AUTH_LOGIN_RATE_LIMIT_MAX,
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: source.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_TOKEN_CONSUME_RATE_LIMIT_MAX: source.AUTH_TOKEN_CONSUME_RATE_LIMIT_MAX,
    AUTH_TOKEN_CONSUME_RATE_LIMIT_WINDOW_SECONDS:
      source.AUTH_TOKEN_CONSUME_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_RESET_REQUEST_RATE_LIMIT_MAX: source.AUTH_RESET_REQUEST_RATE_LIMIT_MAX,
    AUTH_RESET_REQUEST_RATE_LIMIT_WINDOW_SECONDS:
      source.AUTH_RESET_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_REFRESH_RATE_LIMIT_MAX: source.AUTH_REFRESH_RATE_LIMIT_MAX,
    AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS: source.AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_INVITATION_RETENTION_DAYS: source.AUTH_INVITATION_RETENTION_DAYS,
    AUTH_PASSWORD_RESET_RETENTION_DAYS: source.AUTH_PASSWORD_RESET_RETENTION_DAYS,
    AUTH_SESSION_RETENTION_DAYS: source.AUTH_SESSION_RETENTION_DAYS,
    AUTH_DISABLED_ACCOUNT_PII_RETENTION_DAYS: source.AUTH_DISABLED_ACCOUNT_PII_RETENTION_DAYS,
    DATABASE_URL: source.DATABASE_URL,
    MIGRATION_DATABASE_URL: source.MIGRATION_DATABASE_URL,
    SUPABASE_URL: source.SUPABASE_URL,
    PUBLIC_INVITATION_ORIGIN: source.PUBLIC_INVITATION_ORIGIN,
    SEATING_RECONCILER_ENABLED: source.SEATING_RECONCILER_ENABLED,
    AI_IMAGE_JOBS_ENABLED: source.AI_IMAGE_JOBS_ENABLED,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET: source.SUPABASE_STORAGE_BUCKET,
    RESEND_API_KEY: source.RESEND_API_KEY,
    VNPAY_TMN_CODE: source.VNPAY_TMN_CODE,
    VNPAY_HASH_SECRET: source.VNPAY_HASH_SECRET,
    VNPAY_RETURN_URL: source.VNPAY_RETURN_URL,
    VNPAY_QUERY_IP: source.VNPAY_QUERY_IP,
    RESEND_FROM_EMAIL: source.RESEND_FROM_EMAIL,
    BREVO_API_KEY: source.BREVO_API_KEY,
    BREVO_FROM_EMAIL: source.BREVO_FROM_EMAIL,
    AI_IMAGE_PROVIDER: source.AI_IMAGE_PROVIDER,
    GEMINI_API_KEY: source.GEMINI_API_KEY,
    GEMINI_IMAGE_MODEL: source.GEMINI_IMAGE_MODEL,
    METRICS_ENABLED: source.METRICS_ENABLED,
    METRICS_TOKEN: source.METRICS_TOKEN,
    OPENAPI_ENABLED: source.OPENAPI_ENABLED,
    OTEL_EXPORTER_OTLP_ENDPOINT: source.OTEL_EXPORTER_OTLP_ENDPOINT,
  };
}

function requireAllOrNone<const Key extends EnvironmentKey>(
  environment: RawEnvironment,
  variableNames: readonly Key[],
  context: z.RefinementCtx,
): void {
  const configured = variableNames.filter(
    (variableName) => environment[variableName] !== undefined,
  );

  if (configured.length > 0 && configured.length < variableNames.length) {
    requireVariables(environment, variableNames, context);
  }
}

function requireVariables<const Key extends EnvironmentKey>(
  environment: RawEnvironment,
  variableNames: readonly Key[],
  context: z.RefinementCtx,
): void {
  for (const variableName of variableNames) {
    if (environment[variableName] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [variableName],
        message: 'Required by enabled feature.',
      });
    }
  }
}

function rejectVariables<const Key extends EnvironmentKey>(
  environment: RawEnvironment,
  variableNames: readonly Key[],
  context: z.RefinementCtx,
): void {
  for (const variableName of variableNames) {
    if (environment[variableName] !== undefined) {
      context.addIssue({
        code: 'custom',
        path: [variableName],
        message: 'Feature is not enabled.',
      });
    }
  }
}

function createConfig(environment: RawEnvironment): Omit<BackendConfig, 'notifications'> {
  const storage: StorageConfig =
    environment.SUPABASE_URL !== undefined &&
    environment.SUPABASE_SERVICE_ROLE_KEY !== undefined &&
    environment.SUPABASE_STORAGE_BUCKET !== undefined
      ? Object.freeze({
          enabled: true,
          supabaseUrl: environment.SUPABASE_URL,
          serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
          bucket: environment.SUPABASE_STORAGE_BUCKET,
        })
      : Object.freeze({ enabled: false });
  const email: EmailConfig =
    environment.BREVO_API_KEY !== undefined && environment.BREVO_FROM_EMAIL !== undefined
      ? Object.freeze({
          enabled: true,
          provider: 'brevo',
          apiKey: environment.BREVO_API_KEY,
          fromEmail: environment.BREVO_FROM_EMAIL,
        })
      : environment.RESEND_API_KEY !== undefined && environment.RESEND_FROM_EMAIL !== undefined
        ? Object.freeze({
            enabled: true,
            provider: 'resend',
            resendApiKey: environment.RESEND_API_KEY,
            fromEmail: environment.RESEND_FROM_EMAIL,
          })
        : Object.freeze({ enabled: false });
  const aiImage: AiImageConfig =
    environment.AI_IMAGE_PROVIDER === 'gemini' &&
    environment.GEMINI_API_KEY !== undefined &&
    environment.GEMINI_IMAGE_MODEL !== undefined
      ? Object.freeze({
          provider: 'gemini' as const,
          apiKey: environment.GEMINI_API_KEY,
          model: environment.GEMINI_IMAGE_MODEL,
        })
      : Object.freeze({ provider: null });
  const metrics: MetricsConfig =
    environment.METRICS_ENABLED && environment.METRICS_TOKEN !== undefined
      ? Object.freeze({ enabled: true, token: environment.METRICS_TOKEN })
      : Object.freeze({ enabled: false });

  return Object.freeze({
    runtime: Object.freeze({
      environment: environment.NODE_ENV,
      port: environment.PORT,
      logLevel: environment.LOG_LEVEL,
      restaurantTimeZone: environment.RESTAURANT_TIME_ZONE,
    }),
    cors: Object.freeze({
      allowedOrigins: Object.freeze([...environment.CORS_ALLOWED_ORIGINS]),
    }),
    security: Object.freeze({
      bodyLimitBytes: environment.HTTP_BODY_LIMIT_BYTES,
      requestTimeoutMs: environment.HTTP_REQUEST_TIMEOUT_MS,
      rateLimit: Object.freeze({
        maxRequests: environment.RATE_LIMIT_MAX_REQUESTS,
        windowMs: environment.RATE_LIMIT_WINDOW_MS,
      }),
      replicaCount: environment.BACKEND_REPLICA_COUNT,
    }),
    identityAccess: Object.freeze({
      passwordOtpHashKey: environment.AUTH_OTP_HASH_KEY,
      trustedProxyHops: environment.AUTH_TRUST_PROXY_HOPS ?? 0,
      refreshCookie: Object.freeze({
        name: '__Host-wedding-refresh' as const,
        path: '/' as const,
        httpOnly: true as const,
        secure: true as const,
        sameSite: 'lax' as const,
      }),
      lifetimesSeconds: Object.freeze({
        accessToken:
          environment.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? approvedIdentityPolicy.accessTokenTtlSeconds,
        refreshIdle:
          environment.AUTH_REFRESH_IDLE_TTL_SECONDS ?? approvedIdentityPolicy.refreshIdleTtlSeconds,
        refreshAbsolute:
          environment.AUTH_REFRESH_ABSOLUTE_TTL_SECONDS ??
          approvedIdentityPolicy.refreshAbsoluteTtlSeconds,
        passwordReset:
          environment.AUTH_PASSWORD_RESET_TTL_SECONDS ??
          approvedIdentityPolicy.passwordResetTtlSeconds,
      }),
      invitation: Object.freeze({
        lifetimeSeconds:
          environment.AUTH_INVITATION_TTL_SECONDS ?? approvedIdentityPolicy.invitationTtlSeconds,
        reissueLimit:
          environment.AUTH_INVITATION_REISSUE_LIMIT ??
          approvedIdentityPolicy.invitationReissueLimit,
        reissueWindowSeconds:
          environment.AUTH_INVITATION_REISSUE_WINDOW_SECONDS ??
          approvedIdentityPolicy.invitationReissueWindowSeconds,
      }),
      password: Object.freeze({
        minimumCharacters:
          environment.AUTH_PASSWORD_MIN_CHARACTERS ??
          approvedIdentityPolicy.passwordMinimumCharacters,
        maximumCharacters:
          environment.AUTH_PASSWORD_MAX_CHARACTERS ??
          approvedIdentityPolicy.passwordMaximumCharacters,
        maximumBytes:
          environment.AUTH_PASSWORD_MAX_BYTES ?? approvedIdentityPolicy.passwordMaximumBytes,
        scrypt: Object.freeze({
          cost: environment.AUTH_SCRYPT_COST ?? approvedIdentityPolicy.scryptCost,
          blockSize: environment.AUTH_SCRYPT_BLOCK_SIZE ?? approvedIdentityPolicy.scryptBlockSize,
          parallelization:
            environment.AUTH_SCRYPT_PARALLELIZATION ?? approvedIdentityPolicy.scryptParallelization,
          keyLengthBytes:
            environment.AUTH_SCRYPT_KEY_LENGTH_BYTES ?? approvedIdentityPolicy.scryptKeyLengthBytes,
          maxMemoryBytes:
            environment.AUTH_SCRYPT_MAX_MEMORY_BYTES ?? approvedIdentityPolicy.scryptMaxMemoryBytes,
        }),
      }),
      tokenEntropyBytes:
        environment.AUTH_TOKEN_ENTROPY_BYTES ?? approvedIdentityPolicy.tokenEntropyBytes,
      rateLimits: Object.freeze({
        login: Object.freeze({
          maxAttempts:
            environment.AUTH_LOGIN_RATE_LIMIT_MAX ?? approvedIdentityPolicy.loginRateLimitMax,
          windowSeconds:
            environment.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS ??
            approvedIdentityPolicy.loginRateLimitWindowSeconds,
        }),
        tokenConsume: Object.freeze({
          maxAttempts:
            environment.AUTH_TOKEN_CONSUME_RATE_LIMIT_MAX ??
            approvedIdentityPolicy.tokenConsumeRateLimitMax,
          windowSeconds:
            environment.AUTH_TOKEN_CONSUME_RATE_LIMIT_WINDOW_SECONDS ??
            approvedIdentityPolicy.tokenConsumeRateLimitWindowSeconds,
        }),
        resetRequest: Object.freeze({
          maxAttempts:
            environment.AUTH_RESET_REQUEST_RATE_LIMIT_MAX ??
            approvedIdentityPolicy.resetRequestRateLimitMax,
          windowSeconds:
            environment.AUTH_RESET_REQUEST_RATE_LIMIT_WINDOW_SECONDS ??
            approvedIdentityPolicy.resetRequestRateLimitWindowSeconds,
        }),
        refresh: Object.freeze({
          maxAttempts:
            environment.AUTH_REFRESH_RATE_LIMIT_MAX ?? approvedIdentityPolicy.refreshRateLimitMax,
          windowSeconds:
            environment.AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS ??
            approvedIdentityPolicy.refreshRateLimitWindowSeconds,
        }),
      }),
      retentionDays: Object.freeze({
        invitation:
          environment.AUTH_INVITATION_RETENTION_DAYS ??
          approvedIdentityPolicy.invitationRetentionDays,
        passwordReset:
          environment.AUTH_PASSWORD_RESET_RETENTION_DAYS ??
          approvedIdentityPolicy.passwordResetRetentionDays,
        session:
          environment.AUTH_SESSION_RETENTION_DAYS ?? approvedIdentityPolicy.sessionRetentionDays,
        disabledAccountPii:
          environment.AUTH_DISABLED_ACCOUNT_PII_RETENTION_DAYS ??
          approvedIdentityPolicy.disabledAccountPiiRetentionDays,
      }),
    }),
    database: Object.freeze({
      url: environment.DATABASE_URL,
      migrationUrl: environment.MIGRATION_DATABASE_URL,
    }),
    storage,
    email,
    aiImage,
    metrics,
    vnpay:
      environment.VNPAY_TMN_CODE !== undefined &&
      environment.VNPAY_HASH_SECRET !== undefined &&
      environment.VNPAY_RETURN_URL !== undefined &&
      environment.VNPAY_QUERY_IP !== undefined
        ? Object.freeze({
            enabled: true,
            merchantCode: environment.VNPAY_TMN_CODE,
            hashSecret: environment.VNPAY_HASH_SECRET,
            returnUrl: environment.VNPAY_RETURN_URL,
            queryIp: environment.VNPAY_QUERY_IP,
          })
        : Object.freeze({ enabled: false }),
    openApi: Object.freeze({
      enabledInProduction: environment.OPENAPI_ENABLED,
    }),
    invitationStudio: Object.freeze({
      publicOrigin: environment.PUBLIC_INVITATION_ORIGIN ?? null,
      reconcilerEnabled: environment.SEATING_RECONCILER_ENABLED,
      imageJobsEnabled: environment.AI_IMAGE_JOBS_ENABLED,
    }),
    telemetry: Object.freeze({
      otlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
  });
}
