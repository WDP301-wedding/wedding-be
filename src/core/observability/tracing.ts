import type { ShutdownResource } from '../http/lifecycle.js';

export interface TracingSdk {
  start(): Promise<void> | void;
  shutdown(): Promise<void>;
}

type TracingSdkFactory = (traceEndpoint: string) => Promise<TracingSdk> | TracingSdk;

export interface StartTracingOptions {
  readonly createSdk?: TracingSdkFactory;
  readonly otlpEndpoint?: string;
}

let activeTracingResource: ShutdownResource | undefined;

export async function startTracing(
  options: StartTracingOptions = {},
): Promise<ShutdownResource | undefined> {
  if (options.otlpEndpoint === undefined) {
    return undefined;
  }

  const traceEndpoint = toOtlpTraceEndpoint(options.otlpEndpoint);
  const sdk = await (options.createSdk ?? createOpenTelemetrySdk)(traceEndpoint);
  await sdk.start();
  let closed = false;

  return Object.freeze({
    name: 'open-telemetry',
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await sdk.shutdown();
    },
  });
}

export async function activateConfiguredTracing(otlpEndpoint: string): Promise<void> {
  activeTracingResource = await startTracing({ otlpEndpoint });
}

export function getActiveTracingResource(): ShutdownResource | undefined {
  return activeTracingResource;
}

export function toOtlpTraceEndpoint(otlpEndpoint: string): string {
  const endpoint = new URL(otlpEndpoint);
  endpoint.pathname = `${endpoint.pathname.endsWith('/') ? endpoint.pathname : `${endpoint.pathname}/`}v1/traces`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

async function createOpenTelemetrySdk(traceEndpoint: string): Promise<TracingSdk> {
  const [sdkNode, exporter, httpInstrumentation, expressInstrumentation] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-express'),
  ]);

  return new sdkNode.NodeSDK({
    serviceName: 'wedding-be',
    traceExporter: new exporter.OTLPTraceExporter({ url: traceEndpoint }),
    instrumentations: [
      new httpInstrumentation.HttpInstrumentation(),
      new expressInstrumentation.ExpressInstrumentation(),
    ],
  });
}
