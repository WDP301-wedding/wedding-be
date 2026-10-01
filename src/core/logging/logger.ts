import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from 'pino';

import type { LogLevel, RuntimeEnvironment } from '../../config/env.js';
import { redactLogRecord, redactSensitiveData } from './redaction.js';

export type EntryPoint = 'http' | 'scheduler' | 'provider_callback' | 'replay' | 'cli';

export interface CreateLoggerOptions {
  readonly destination?: DestinationStream;
  readonly level: LogLevel;
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly service?: string;
}

export interface ProviderLoggerContext {
  readonly entryPoint: EntryPoint;
  readonly module: string;
  readonly provider: string;
  readonly requestId: string;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    base: {
      environment: options.runtimeEnvironment,
      service: options.service ?? 'wedding-be',
    },
    formatters: {
      bindings(bindings) {
        return redactLogRecord(bindings);
      },
      level(label) {
        return { level: label };
      },
      log(record) {
        return redactLogRecord(record);
      },
    },
    level: productionLogLevel(options.runtimeEnvironment, options.level),
    serializers: {
      err(error) {
        return redactSensitiveData(error);
      },
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    ...(options.destination === undefined && options.runtimeEnvironment === 'development'
      ? {
          transport: {
            options: {
              colorize: process.stdout.isTTY,
              singleLine: false,
              translateTime: false,
            },
            target: 'pino-pretty',
          },
        }
      : {}),
  };

  return options.destination === undefined
    ? pino(loggerOptions)
    : pino(loggerOptions, options.destination);
}

export function createProviderLogger(logger: Logger, context: ProviderLoggerContext): Logger {
  const inheritedBindings = logger.bindings();

  return logger.child({
    ...(inheritedBindings.entryPoint === undefined ? { entryPoint: context.entryPoint } : {}),
    module: context.module,
    provider: context.provider,
    ...(inheritedBindings.requestId === undefined ? { requestId: context.requestId } : {}),
  });
}

function productionLogLevel(
  runtimeEnvironment: RuntimeEnvironment,
  level: LogLevel,
): LevelWithSilent {
  if (runtimeEnvironment === 'production' && (level === 'debug' || level === 'trace')) {
    return 'info';
  }

  return level;
}
