import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Logger } from 'pino';
import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import type { NotificationScheduler } from './notification-scheduler.js';
import type { NotificationDispatcher } from './notification-dispatcher.js';

/** One replica, non-overlapping ticks; PostgreSQL remains the delivery/claim authority. */
export class NotificationWorker {
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private stopped = false;
  private readonly runs: Counter<'outcome'>;
  private readonly duration: Histogram<'outcome'>;
  private readonly queue: Gauge<'state'>;
  private readonly deliveries: Counter<'channel' | 'outcome'>;
  private readonly providerDuration: Histogram<'channel' | 'outcome'>;
  constructor(
    readonly scheduler: NotificationScheduler,
    readonly dispatcher: NotificationDispatcher,
    readonly logger: Logger,
    registry: Registry,
  ) {
    this.runs = new Counter({
      name: 'wedding_notification_worker_runs_total',
      help: 'Notification worker runs.',
      labelNames: ['outcome'],
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'wedding_notification_worker_duration_seconds',
      help: 'Notification worker duration.',
      labelNames: ['outcome'],
      buckets: [0.1, 1, 5, 10, 30, 60, 120],
      registers: [registry],
    });
    this.queue = new Gauge({
      name: 'wedding_notification_queue',
      help: 'Durable intent count by state.',
      labelNames: ['state'],
      registers: [registry],
    });
    this.deliveries = new Counter({
      name: 'wedding_notification_delivery_attempts_total',
      help: 'Delivery attempt outcomes.',
      labelNames: ['channel', 'outcome'],
      registers: [registry],
    });
    this.providerDuration = new Histogram({
      name: 'wedding_notification_delivery_duration_seconds',
      help: 'Delivery attempt duration.',
      labelNames: ['channel', 'outcome'],
      buckets: [0.01, 0.1, 1, 5, 10, 30, 60],
      registers: [registry],
    });
  }
  start() {
    if (!this.stopped && !this.timer && !this.active) this.schedule(0);
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const began = performance.now();
      void this.tick().finally(() => {
        if (!this.stopped) this.schedule(Math.max(0, 60000 - (performance.now() - began)));
      });
    }, delay);
    this.timer.unref();
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.run().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  private async run() {
    const requestId = randomUUID(),
      start = performance.now();
    const log = this.logger.child({
      module: 'notifications-automation',
      entryPoint: 'scheduler',
      requestId,
    });
    const foundation = this.scheduler.consumer.foundation;
    let outcome: 'success' | 'failure' = 'success';
    let stage = 'lease-reconciliation';
    try {
      await foundation.reconcileExpired(100);
      stage = 'provider-reconciliation';
      await this.dispatcher.reconcile();
      stage = 'event-consumption';
      const consumed = await this.scheduler.consumer.poll(100);
      stage = 'schedule';
      await this.scheduler.tick();
      stage = 'dispatch';
      let claimedCount = 0;
      for (let n = 0; n < 100 && !this.stopped; n++) {
        const [row] = await foundation.claimDue(1);
        if (!row) break;
        claimedCount++;
        const began = performance.now();
        let evidence: Awaited<ReturnType<NotificationDispatcher['send']>>;
        if (this.stopped)
          evidence = { outcome: 'RETRYABLE_FAILED', errorCode: 'WORKER_STOPPED_BEFORE_SEND' };
        else
          try {
            evidence = await this.dispatcher.send(row);
          } catch {
            evidence = { outcome: 'UNKNOWN', errorCode: 'DISPATCH_RESULT_UNKNOWN' };
          }
        const { outcome: result, ...metadata } = evidence;
        await foundation.recordOutcome(row.id, row.leaseId!, result, metadata);
        this.deliveries.labels(row.channel, result).inc();
        this.providerDuration
          .labels(row.channel, result)
          .observe((performance.now() - began) / 1000);
        log.info(
          {
            event: 'notification_attempt_recorded',
            notificationIntentId: row.id,
            sourceEventId: row.eventId,
            channel: row.channel,
            outcome: result,
            attempt: row.attemptCount,
            ...(evidence.errorCode ? { errorCode: evidence.errorCode } : {}),
          },
          'notification attempt recorded',
        );
      }
      stage = 'queue-observation';
      const counts = await foundation.prisma.notificationIntent.groupBy({
        by: ['state'],
        _count: { id: true },
      });
      this.queue.reset();
      for (const count of counts) this.queue.labels(count.state).set(count._count.id);
      log.info(
        { event: 'notification_worker_completed', consumed, claimed: claimedCount },
        'notification worker completed',
      );
    } catch {
      outcome = 'failure';
      log.error(
        { event: 'notification_worker_failed', stage, errorCode: 'NOTIFICATION_WORKER_FAILED' },
        'notification worker requires investigation',
      );
    } finally {
      this.runs.labels(outcome).inc();
      this.duration.labels(outcome).observe((performance.now() - start) / 1000);
    }
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.active;
  }
}
