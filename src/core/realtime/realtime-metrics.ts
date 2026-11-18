import { Counter, Histogram, type Registry } from 'prom-client';

export interface RealtimeMetrics {
  delivery(stream: string, outcome: 'dispatched' | 'retry' | 'batch_error'): void;
  dispatchLag(stream: string, occurredAt: string): void;
  fanoutRecovered(): void;
}

export function createRealtimeMetrics(registry: Registry): RealtimeMetrics {
  const deliveries = new Counter({
    name: 'wedding_realtime_delivery_total',
    help: 'Outbox claim outcomes. Dispatched means relay processing completed, not client acknowledgement.',
    labelNames: ['stream', 'outcome'],
    registers: [registry],
  });
  const lag = new Histogram({
    name: 'wedding_realtime_dispatch_lag_seconds',
    help: 'Time from source event creation until server dispatch (not client receipt).',
    labelNames: ['stream'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300, 3600],
    registers: [registry],
  });
  const recoveries = new Counter({
    name: 'wedding_realtime_fanout_recoveries_total',
    help: 'Local Redis fanout recoveries that requested client resynchronization.',
    registers: [registry],
  });
  return {
    delivery: (stream, outcome) => deliveries.labels(stream, outcome).inc(),
    dispatchLag(stream, occurredAt) {
      const timestamp = Date.parse(occurredAt);
      if (Number.isFinite(timestamp))
        lag.labels(stream).observe(Math.max(0, Date.now() - timestamp) / 1000);
    },
    fanoutRecovered: () => recoveries.inc(),
  };
}
