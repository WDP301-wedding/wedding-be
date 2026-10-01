import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('node:module');
  vi.doUnmock('dotenv');
  vi.doUnmock('./tracing.js');
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('process instrumentation preload', () => {
  it('does not register hooks or load the tracing SDK when OTLP is disabled', async () => {
    const register = vi.fn();
    vi.doMock('node:module', () => ({ register }));
    vi.doMock('dotenv', () => ({ config: vi.fn() }));
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.resetModules();

    await expect(import('../../instrumentation.js')).resolves.toBeDefined();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the ESM hook before activating configured tracing', async () => {
    const events: string[] = [];
    const register = vi.fn(() => {
      events.push('hook-registered');
    });
    const activateConfiguredTracing = vi.fn(() => {
      events.push('tracing-activated');
      return Promise.resolve();
    });
    vi.doMock('node:module', () => ({ register }));
    vi.doMock('dotenv', () => ({ config: vi.fn() }));
    vi.doMock('./tracing.js', () => ({ activateConfiguredTracing }));
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'https://collector.example.com');
    vi.resetModules();

    await import('../../instrumentation.js');

    expect(register).toHaveBeenCalledWith(
      '@opentelemetry/instrumentation/hook.mjs',
      expect.stringMatching(/instrumentation\.ts$/u),
    );
    expect(activateConfiguredTracing).toHaveBeenCalledWith('https://collector.example.com');
    expect(events).toEqual(['hook-registered', 'tracing-activated']);
  });

  it('defers malformed endpoint reporting to the validated server configuration path', async () => {
    const register = vi.fn();
    vi.doMock('node:module', () => ({ register }));
    vi.doMock('dotenv', () => ({ config: vi.fn() }));
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'file:///tmp/collector');
    vi.resetModules();

    await import('../../instrumentation.js');

    expect(register).not.toHaveBeenCalled();
  });
});
