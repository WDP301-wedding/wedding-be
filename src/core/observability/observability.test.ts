import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createObservabilityMetrics,
  normalizeHttpMethod,
  type ProviderObservation,
} from './metrics.js';
import { startTracing, toOtlpTraceEndpoint, type TracingSdk } from './tracing.js';

afterEach(() => {
  vi.doUnmock('@opentelemetry/sdk-node');
  vi.doUnmock('@opentelemetry/exporter-trace-otlp-http');
  vi.doUnmock('@opentelemetry/instrumentation-http');
  vi.doUnmock('@opentelemetry/instrumentation-express');
  vi.resetModules();
});

describe('RED metrics', () => {
  it('collapses arbitrary HTTP methods into one bounded label', () => {
    expect(normalizeHttpMethod('get')).toBe('GET');
    expect(normalizeHttpMethod('BREW-67a9ab42')).toBe('OTHER');
  });

  it('records bounded provider rate, errors, and duration histogram series', async () => {
    const metrics = createObservabilityMetrics();
    const success: ProviderObservation = {
      durationSeconds: 0.08,
      module: 'storage',
      outcome: 'success',
      provider: 'supabase_storage',
    };
    const timeout: ProviderObservation = {
      durationSeconds: 1.2,
      module: 'email',
      outcome: 'timeout',
      provider: 'resend',
    };

    metrics.observeProvider(success);
    metrics.observeProvider(timeout);

    const output = await metrics.registry.metrics();
    expect(output).toContain(
      'wedding_provider_requests_total{module="storage",provider="supabase_storage",outcome="success"} 1',
    );
    expect(output).toContain(
      'wedding_provider_errors_total{module="email",provider="resend",error_kind="timeout"} 1',
    );
    expect(output).toContain(
      'wedding_provider_request_duration_seconds_count{module="email",provider="resend",outcome="timeout"} 1',
    );
    expect(output).toContain(
      'wedding_provider_request_duration_seconds_bucket{le="2.5",module="email",provider="resend",outcome="timeout"} 1',
    );
    expect(output).not.toMatch(/request_?id|raw_?url|message|email_address/iu);
  });
});

describe('optional OpenTelemetry startup', () => {
  it('does not construct or start an SDK when no endpoint is configured', async () => {
    const createSdk = vi.fn();

    await expect(startTracing({ createSdk })).resolves.toBeUndefined();
    expect(createSdk).not.toHaveBeenCalled();
  });

  it('starts the SDK for the signal endpoint and exposes bounded lifecycle cleanup', async () => {
    const events: string[] = [];
    const shutdown = vi.fn(() => {
      events.push('tracing-stopped');
      return Promise.resolve();
    });
    const sdk: TracingSdk = {
      start: vi.fn(() => {
        events.push('tracing-started');
      }),
      shutdown,
    };
    const createSdk = vi.fn((traceEndpoint: string) => {
      events.push(`sdk-created:${traceEndpoint}`);
      return sdk;
    });

    const resource = await startTracing({
      createSdk,
      otlpEndpoint: 'https://collector.example.com/tenant',
    });
    events.push('application-imported');

    expect(events.slice(0, 3)).toEqual([
      'sdk-created:https://collector.example.com/tenant/v1/traces',
      'tracing-started',
      'application-imported',
    ]);
    expect(resource?.name).toBe('open-telemetry');
    await resource?.close();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(events.at(-1)).toBe('tracing-stopped');
  });

  it('preserves an OTLP base path when constructing the trace signal URL', () => {
    expect(toOtlpTraceEndpoint('https://collector.example.com/base/')).toBe(
      'https://collector.example.com/base/v1/traces',
    );
  });

  it('constructs the approved OTLP and HTTP auto-instrumentation stack', async () => {
    const start = vi.fn();
    const shutdown = vi.fn(() => Promise.resolve());
    const nodeSdkOptions: unknown[] = [];
    const NodeSDK = vi.fn(function (options: unknown) {
      nodeSdkOptions.push(options);
      return { shutdown, start };
    });
    const OTLPTraceExporter = vi.fn(function (options: unknown) {
      return { options };
    });
    const HttpInstrumentation = vi.fn(function () {
      return { kind: 'http' };
    });
    const ExpressInstrumentation = vi.fn(function () {
      return { kind: 'express' };
    });
    vi.doMock('@opentelemetry/sdk-node', () => ({ NodeSDK }));
    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter }));
    vi.doMock('@opentelemetry/instrumentation-http', () => ({ HttpInstrumentation }));
    vi.doMock('@opentelemetry/instrumentation-express', () => ({ ExpressInstrumentation }));
    vi.resetModules();
    const tracing = await import('./tracing.js');

    await tracing.activateConfiguredTracing('http://collector:4318');
    const resource = tracing.getActiveTracingResource();
    await resource?.close();
    await resource?.close();

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: 'http://collector:4318/v1/traces',
    });
    expect(HttpInstrumentation).toHaveBeenCalledOnce();
    expect(ExpressInstrumentation).toHaveBeenCalledOnce();
    const sdkOptions = nodeSdkOptions[0] as {
      readonly instrumentations: readonly unknown[];
      readonly serviceName: unknown;
      readonly traceExporter: unknown;
    };
    expect(sdkOptions.serviceName).toBe('wedding-be');
    expect(sdkOptions.traceExporter).toEqual({
      options: { url: 'http://collector:4318/v1/traces' },
    });
    expect(sdkOptions.instrumentations).toEqual([{ kind: 'http' }, { kind: 'express' }]);
    expect(start).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
