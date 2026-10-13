import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import {
  reportingOwners,
  type ReportingOwner,
  type ReportingReader,
  type FeedRow,
  type ReportingFences,
} from '../../../core/reporting/reporting-feed.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
export const checkpointSchema = z.strictObject({
  owner: z.enum(reportingOwners),
  throughSequence: z.int().nonnegative(),
  refreshedAt: z.iso.datetime().nullable(),
  status: z.enum(['READY', 'STALE', 'SOURCE_NOT_READY']),
});
export const checkpointsSchema = z
  .array(checkpointSchema)
  .length(6)
  .refine((rows) => new Set(rows.map((r) => r.owner)).size === 6);
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type ProjectionRow = FeedRow<unknown> & { owner: ReportingOwner };
export type Projection = { generationId: string; checkpoints: Checkpoint[]; rows: ProjectionRow[] };
export type ProjectionReadFilter = Readonly<{
  dateFrom: string;
  dateTo: string;
  cashFrom: string;
  cashTo: string;
  hallId?: string;
  phase?: string;
  menuPackageId?: string;
  includeCash: boolean;
  includeUtilization: boolean;
  owners: readonly ReportingOwner[];
}>;
export interface ProjectionStore {
  load(scope: string, bounded?: boolean, filter?: ProjectionReadFilter): Promise<Projection | null>;
  publish(
    scope: string,
    expectedGeneration: string | null,
    projection: Omit<Projection, 'generationId'>,
  ): Promise<string>;
}
export class AnalyticsProjector {
  constructor(
    readonly sources: Record<ReportingOwner, ReportingReader>,
    readonly store: ProjectionStore,
    readonly now: () => Date = () => new Date(),
    readonly fences?: () => Promise<ReportingFences>,
  ) {}
  async refresh(scope: string, context: ContractContext, rebuild = false) {
    const previous = await this.store.load(scope);
    // One owner-head observation forms the common committed cut; sequences remain owner-local.
    const sourceFences = await this.fences?.();
    const rows = new Map(
      (rebuild ? [] : (previous?.rows ?? [])).map((r) => [r.owner + '/' + r.recordId, r]),
    );
    const checkpoints: Checkpoint[] = [];
    for (const owner of reportingOwners) {
      const checkpoint = previous?.checkpoints.find((c) => c.owner === owner);
      const afterSequence = rebuild ? 0 : (checkpoint?.throughSequence ?? 0);
      const staged = new Map<string, ProjectionRow>();
      try {
        let cursor: string | undefined,
          fence: number | undefined = sourceFences?.[owner];
        const seenCursors = new Set<string>();
        let pages = 0;
        do {
          if (++pages > 2000) throw new Error('Source refresh page budget exceeded.');
          const page = await this.sources[owner].readPage(
            {
              afterSequence,
              limit: 500,
              ...(fence === undefined ? {} : { throughSequence: fence }),
              ...(cursor === undefined ? {} : { cursor }),
            },
            context,
          );
          if (
            !Number.isSafeInteger(page.throughSequence) ||
            page.throughSequence < afterSequence ||
            (fence !== undefined && fence !== page.throughSequence)
          )
            throw new Error('Invalid source fence.');
          fence = page.throughSequence;
          for (const row of page.rows) {
            if (
              !Number.isSafeInteger(row.sequence) ||
              row.sequence <= afterSequence ||
              row.sequence > fence
            )
              throw new Error('Source row outside fence.');
            const key = owner + '/' + row.recordId;
            const current = staged.get(key) ?? rows.get(key);
            if (current === undefined || row.sequence > current.sequence)
              staged.set(key, { ...row, owner });
          }
          cursor = page.nextCursor ?? undefined;
          if (cursor !== undefined && seenCursors.has(cursor))
            throw new Error('Source cursor cycle.');
          if (cursor !== undefined) seenCursors.add(cursor);
        } while (cursor !== undefined);
        for (const [key, row] of staged) rows.set(key, row);
        checkpoints.push({
          owner,
          throughSequence: fence,
          refreshedAt: this.now().toISOString(),
          status: 'READY',
        });
      } catch (error) {
        if (rebuild)
          throw new AppError({
            status: 503,
            code: 'ANALYTICS_REBUILD_FAILED',
            message: 'The rebuild preserved the current generation because a source failed.',
            cause: error,
          });
        checkpoints.push({
          owner,
          throughSequence: checkpoint?.throughSequence ?? 0,
          refreshedAt: checkpoint?.refreshedAt ?? null,
          status: checkpoint?.refreshedAt ? 'STALE' : 'SOURCE_NOT_READY',
        });
      }
    }
    return this.store.publish(scope, previous?.generationId ?? null, {
      checkpoints,
      rows: [...rows.values()],
    });
  }
}
