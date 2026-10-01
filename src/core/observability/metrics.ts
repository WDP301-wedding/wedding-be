import { performance } from 'node:perf_hooks';

import type { Request, RequestHandler, Response } from 'express';
import { Counter, Histogram, Registry } from 'prom-client';

import { resolveNormalizedRoute } from '../logging/request-logger.js';

const durationBucketsSeconds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type HttpStatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'aborted' | 'unknown';
type HttpMethod =
  'CONNECT' | 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT' | 'TRACE' | 'OTHER';
export type ProviderModule = 'ai_image' | 'email' | 'storage';
export type ProviderName = 'gemini' | 'resend' | 'supabase_storage';
export type ProviderOutcome = 'failure' | 'success' | 'timeout' | 'unavailable';

export interface ProviderObservation {
  readonly durationSeconds: number;
  readonly module: ProviderModule;
  readonly outcome: ProviderOutcome;
  readonly provider: ProviderName;
}

interface HttpObservation {
  readonly durationSeconds: number;
  readonly method: HttpMethod;
  readonly route: string;
  readonly statusClass: HttpStatusClass;
}

export interface ObservabilityMetrics {
  readonly registry: Registry;
  observeHttp(observation: HttpObservation): void;
  observeProvider(observation: ProviderObservation): void;
}

export function createObservabilityMetrics(): ObservabilityMetrics {
  const registry = new Registry();
  const httpRequests = new Counter({
    name: 'wedding_http_requests_total',
    help: 'Completed HTTP requests.',
    labelNames: ['method', 'route', 'status_class'],
    registers: [registry],
  });
  const httpErrors = new Counter({
    name: 'wedding_http_request_errors_total',
    help: 'HTTP requests that ended in a server error or aborted connection.',
    labelNames: ['method', 'route', 'status_class'],
    registers: [registry],
  });
  const httpDuration = new Histogram({
    name: 'wedding_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_class'],
    buckets: durationBucketsSeconds,
    registers: [registry],
  });
  const providerRequests = new Counter({
    name: 'wedding_provider_requests_total',
    help: 'Completed external provider operations.',
    labelNames: ['module', 'provider', 'outcome'],
    registers: [registry],
  });
  const providerErrors = new Counter({
    name: 'wedding_provider_errors_total',
    help: 'External provider operations that did not succeed.',
    labelNames: ['module', 'provider', 'error_kind'],
    registers: [registry],
  });
  const providerDuration = new Histogram({
    name: 'wedding_provider_request_duration_seconds',
    help: 'External provider operation duration in seconds.',
    labelNames: ['module', 'provider', 'outcome'],
    buckets: durationBucketsSeconds,
    registers: [registry],
  });

  return Object.freeze({
    registry,
    observeHttp(observation: HttpObservation) {
      const labels = [observation.method, observation.route, observation.statusClass] as const;
      httpRequests.labels(...labels).inc();
      httpDuration.labels(...labels).observe(nonNegativeDuration(observation.durationSeconds));
      if (observation.statusClass === '5xx' || observation.statusClass === 'aborted') {
        httpErrors.labels(...labels).inc();
      }
    },
    observeProvider(observation: ProviderObservation) {
      const labels = [observation.module, observation.provider, observation.outcome] as const;
      providerRequests.labels(...labels).inc();
      providerDuration.labels(...labels).observe(nonNegativeDuration(observation.durationSeconds));
      if (observation.outcome !== 'success') {
        providerErrors.labels(observation.module, observation.provider, observation.outcome).inc();
      }
    },
  });
}

export function createHttpMetricsMiddleware(metrics: ObservabilityMetrics): RequestHandler {
  return (request, response, next) => {
    const startedAt = performance.now();
    let observed = false;

    response.once('finish', () => {
      observeOnce(request, response, statusClass(response.statusCode));
    });
    response.once('close', () => {
      observeOnce(request, response, 'aborted');
    });

    function observeOnce(
      currentRequest: Request,
      currentResponse: Response,
      currentStatusClass: HttpStatusClass,
    ): void {
      if (observed) {
        return;
      }
      observed = true;
      const capturedRoute = currentResponse.locals.normalizedRoute as unknown;
      metrics.observeHttp({
        durationSeconds: Math.max(0, performance.now() - startedAt) / 1_000,
        method: normalizeHttpMethod(currentRequest.method),
        route:
          typeof capturedRoute === 'string'
            ? capturedRoute
            : resolveNormalizedRoute(currentRequest),
        statusClass: currentStatusClass,
      });
    }

    next();
  };
}

export function normalizeHttpMethod(method: string): HttpMethod {
  const normalized = method.toUpperCase();
  switch (normalized) {
    case 'CONNECT':
    case 'DELETE':
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
    case 'PATCH':
    case 'POST':
    case 'PUT':
    case 'TRACE':
      return normalized;
    default:
      return 'OTHER';
  }
}

function statusClass(statusCode: number): HttpStatusClass {
  const hundred = Math.floor(statusCode / 100);
  return hundred >= 1 && hundred <= 5 ? (`${hundred}xx` as HttpStatusClass) : 'unknown';
}

function nonNegativeDuration(durationSeconds: number): number {
  return Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
}
