import { createHash, randomUUID } from 'node:crypto';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { ReportingOwner } from '../../../core/reporting/reporting-feed.js';

export type AnalyticsEntryPoint = 'http' | 'scheduler' | 'cli';
type ObservationContext = {
  requestId: string;
  scopeDigest: string;
  entryPoint: AnalyticsEntryPoint;
};
export type AnalyticsOwnerObservation = {
  owner: ReportingOwner;
  pages: number;
  rows: number;
  status: 'READY' | 'STALE' | 'SOURCE_NOT_READY';
  durationMs: number;
};
type RefreshIdentity = ObservationContext & {
  refreshId: string;
  mode: 'incremental' | 'rebuild';
};
export type AnalyticsObservation =
  | (RefreshIdentity & { event: 'analytics_refresh_started' })
  | (RefreshIdentity & {
      event: 'analytics_refresh_completed';
      outcome: 'published' | 'conflict' | 'failed';
      durationMs: number;
      generationId: string | null;
      errorCode: string | null;
      sourcePageCount: number;
      sourceRowCount: number;
      sourceFailures: number;
      owners: AnalyticsOwnerObservation[];
    })
  | (ObservationContext & {
      event: 'analytics_query_decision';
      report: string;
      path: 'warm' | 'pinned' | 'refresh-started' | 'refresh-joined';
      reason: 'missing' | 'ttl' | 'source-not-ready' | 'invalidated' | null;
      generationId: string | null;
    });
export type AnalyticsObserver = (observation: AnalyticsObservation) => void;

export function analyticsObservationContext(
  scope: string,
  context: ContractContext,
  entryPoint: AnalyticsEntryPoint,
): ObservationContext {
  return {
    requestId: context.requestId,
    scopeDigest: createHash('sha256').update(scope).digest('hex'),
    entryPoint,
  };
}

export function observeAnalytics(observer: AnalyticsObserver, observation: AnalyticsObservation) {
  try {
    observer(observation);
  } catch {
    return;
  }
}

export class AnalyticsRefreshObservation {
  readonly owners: AnalyticsOwnerObservation[] = [];
  private readonly startedAt = performance.now();
  private readonly identity: RefreshIdentity;

  constructor(
    private readonly observer: AnalyticsObserver,
    scope: string,
    context: ContractContext,
    entryPoint: AnalyticsEntryPoint,
    rebuild: boolean,
  ) {
    this.identity = {
      ...analyticsObservationContext(scope, context, entryPoint),
      refreshId: randomUUID(),
      mode: rebuild ? 'rebuild' : 'incremental',
    };
    observeAnalytics(observer, { ...this.identity, event: 'analytics_refresh_started' });
  }

  owner(owner: ReportingOwner) {
    const observation: AnalyticsOwnerObservation = {
      owner,
      pages: 0,
      rows: 0,
      status: 'SOURCE_NOT_READY',
      durationMs: 0,
    };
    this.owners.push(observation);
    return observation;
  }

  complete(generationId: string | null, failure?: { error: unknown }) {
    const errorCode =
      failure === undefined
        ? null
        : failure.error instanceof AppError &&
            ['ANALYTICS_REFRESH_CONFLICT', 'ANALYTICS_REBUILD_FAILED'].includes(failure.error.code)
          ? failure.error.code
          : 'ANALYTICS_REFRESH_FAILED';
    observeAnalytics(this.observer, {
      ...this.identity,
      event: 'analytics_refresh_completed',
      outcome:
        failure === undefined
          ? 'published'
          : errorCode === 'ANALYTICS_REFRESH_CONFLICT'
            ? 'conflict'
            : 'failed',
      durationMs: performance.now() - this.startedAt,
      generationId,
      errorCode,
      sourcePageCount: this.owners.reduce((total, owner) => total + owner.pages, 0),
      sourceRowCount: this.owners.reduce((total, owner) => total + owner.rows, 0),
      sourceFailures: this.owners.filter((owner) => owner.status !== 'READY').length,
      owners: this.owners,
    });
  }
}
