import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, createProviderLogger } from './logger.js';
import { resolveNormalizedRoute } from './request-logger.js';
import { REDACTED_VALUE, redactLogRecord, redactSensitiveData } from './redaction.js';

type LogRecord = Record<string, unknown>;

function captureLogs(): {
  readonly destination: Writable;
  readonly records: LogRecord[];
} {
  const records: LogRecord[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).trim().split('\n')) {
        if (line !== '') {
          records.push(JSON.parse(line) as LogRecord);
        }
      }
      callback();
    },
  });

  return { destination, records };
}

describe('structured logger', () => {
  it('writes newline-delimited production JSON with stable base fields and no debug output', () => {
    const capture = captureLogs();
    const logger = createLogger({
      destination: capture.destination,
      level: 'debug',
      runtimeEnvironment: 'production',
    });

    logger.debug({ event: 'diagnostic_probe' }, 'diagnostic probe');
    logger.info({ event: 'service_ready' }, 'service ready');

    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]).toMatchObject({
      level: 'info',
      service: 'wedding-be',
      environment: 'production',
      event: 'service_ready',
      msg: 'service ready',
    });
    expect(capture.records[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(capture.records[0]).not.toHaveProperty('time');
  });

  it('redacts credentials, contact data, payment fields, errors, and bodies at any nesting depth', () => {
    const capture = captureLogs();
    const logger = createLogger({
      destination: capture.destination,
      level: 'info',
      runtimeEnvironment: 'test',
    });
    const secrets = [
      'Bearer auth-secret',
      'session=cookie-secret',
      'access-token-secret',
      'couple@example.com',
      '+84-900-000-000',
      '4111111111111111',
      '123',
      'body-password-secret',
      'provider-error-secret',
    ];

    logger.info(
      {
        event: 'redaction_probe',
        request: {
          headers: {
            authorization: secrets[0],
            cookie: secrets[1],
          },
          body: { password: secrets[7] },
        },
        provider: {
          accessToken: secrets[2],
          contact: {
            email: secrets[3],
            phone: secrets[4],
          },
          payment: {
            cardNumber: secrets[5],
            cvv: secrets[6],
          },
          safeCode: 'PROVIDER_TIMEOUT',
        },
        err: new Error(secrets[8]),
      },
      'redaction probe',
    );

    const serialized = JSON.stringify(capture.records);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain(REDACTED_VALUE);
    expect(capture.records[0]).toMatchObject({
      event: 'redaction_probe',
      provider: { safeCode: 'PROVIDER_TIMEOUT' },
    });
  });

  it('adds correlation and entry-point fields to provider child loggers', () => {
    const capture = captureLogs();
    const logger = createLogger({
      destination: capture.destination,
      level: 'info',
      runtimeEnvironment: 'test',
    });
    const providerLogger = createProviderLogger(logger, {
      entryPoint: 'http',
      module: 'notifications',
      provider: 'resend',
      requestId: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
    });

    providerLogger.info(
      { event: 'provider_request_completed', providerCode: 'DELIVERED' },
      'provider request completed',
    );

    expect(capture.records[0]).toMatchObject({
      event: 'provider_request_completed',
      requestId: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
      entryPoint: 'http',
      module: 'notifications',
      provider: 'resend',
      providerCode: 'DELIVERED',
    });
  });
});

describe('redactSensitiveData', () => {
  it('preserves safe primitives and recursively sanitizes arrays and records', () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData('safe')).toBe('safe');
    expect(redactSensitiveData([{ safeCode: 'OK', refreshToken: 'secret' }, 2])).toEqual([
      { safeCode: 'OK', refreshToken: REDACTED_VALUE },
      2,
    ]);
  });

  it('removes error details and terminates circular structures safely', () => {
    const circular: { self?: unknown; value: string } = { value: 'safe' };
    circular.self = circular;

    expect(redactSensitiveData(new Error('secret error detail'))).toEqual({
      name: 'Error',
    });
    expect(redactSensitiveData(circular)).toEqual({
      self: '[Circular]',
      value: 'safe',
    });
  });

  it('fails closed when an unsafe object cannot be inspected', () => {
    const unsafeRecord = Object.defineProperty({}, 'authorization', {
      enumerable: true,
      get() {
        throw new Error('unsafe getter detail');
      },
    });

    expect(redactLogRecord(unsafeRecord)).toEqual({ event: 'log_redaction_failed' });
  });
});

describe('resolveNormalizedRoute', () => {
  it.each([
    ['/api/', 'health', '/api/health'],
    ['/api', '/', '/api'],
  ])('joins mount %s and route %s as %s', (baseUrl, routePath, expected) => {
    expect(resolveNormalizedRoute({ baseUrl, route: { path: routePath } } as never)).toBe(expected);
  });
});
