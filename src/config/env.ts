import { z } from 'zod';

const deployedEnvironments = new Set(['staging', 'production']);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const productionRequiredVariables = [
  'CORS_ALLOWED_ORIGINS',
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
] as const;

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
      defaultValue: 30_000,
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
    DATABASE_URL: optionalString.pipe(databaseUrl.optional()),
    MIGRATION_DATABASE_URL: optionalString.pipe(databaseUrl.optional()),
    SUPABASE_URL: optionalString.pipe(httpsUrl.optional()),
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_STORAGE_BUCKET: optionalString,
    RESEND_API_KEY: optionalString,
    RESEND_FROM_EMAIL: optionalString.pipe(resendFromEmail.optional()),
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
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalString.pipe(httpUrl.optional()),
  })
  .superRefine((environment, context) => {
    const deployed = deployedEnvironments.has(environment.NODE_ENV);

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

      if (url.protocol !== 'https:' && (deployed || !loopbackHosts.has(url.hostname))) {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ALLOWED_ORIGINS', index],
          message: 'Cleartext origins are allowed only for loopback development and test hosts.',
        });
      }
    }

    requireAllOrNone(
      environment,
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'],
      context,
    );
    requireAllOrNone(environment, ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'], context);

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
  DisabledProvider | Readonly<{ enabled: true; resendApiKey: string; fromEmail: string }>;
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
  database: Readonly<{ url: string | undefined; migrationUrl: string | undefined }>;
  storage: StorageConfig;
  email: EmailConfig;
  aiImage: AiImageConfig;
  metrics: MetricsConfig;
  openApi: Readonly<{ enabledInProduction: boolean }>;
  telemetry: Readonly<{ otlpEndpoint: string | undefined }>;
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

  return createConfig(result.data);
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
    DATABASE_URL: source.DATABASE_URL,
    MIGRATION_DATABASE_URL: source.MIGRATION_DATABASE_URL,
    SUPABASE_URL: source.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET: source.SUPABASE_STORAGE_BUCKET,
    RESEND_API_KEY: source.RESEND_API_KEY,
    RESEND_FROM_EMAIL: source.RESEND_FROM_EMAIL,
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

function createConfig(environment: RawEnvironment): BackendConfig {
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
    environment.RESEND_API_KEY !== undefined && environment.RESEND_FROM_EMAIL !== undefined
      ? Object.freeze({
          enabled: true,
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
    database: Object.freeze({
      url: environment.DATABASE_URL,
      migrationUrl: environment.MIGRATION_DATABASE_URL,
    }),
    storage,
    email,
    aiImage,
    metrics,
    openApi: Object.freeze({
      enabledInProduction: environment.OPENAPI_ENABLED,
    }),
    telemetry: Object.freeze({
      otlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
  });
}
