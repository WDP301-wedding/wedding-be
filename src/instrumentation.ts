import { register } from 'node:module';
import { config as loadDotEnv } from 'dotenv';

loadDotEnv({ quiet: true });
const otlpEndpoint = optionalHttpEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

if (otlpEndpoint !== undefined) {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const { activateConfiguredTracing } = await import('./core/observability/tracing.js');
  await activateConfiguredTracing(otlpEndpoint);
}

function optionalHttpEndpoint(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'http:' || endpoint.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}
