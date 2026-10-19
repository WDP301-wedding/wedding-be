import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { toLayoutSnapshot } from '../application/layout.service.js';
import type {
  LayoutEligibility,
  VenueSelectionEligibilityReader,
} from '../application/selection-eligibility.reader.js';

/** Hall -> template lifecycle shared locks match the existing retirement writers.
 * Only this Venue-owned adapter reads catalog rows; it keeps locks until UoW commit. */
export function createPrismaSelectionEligibilityReader(
  boundary: PrismaBookingBoundary,
): VenueSelectionEligibilityReader {
  async function getMany(values: readonly string[], context: ContractContext, snapshot = false) {
    const ids = [...new Set(values.map((value) => z.uuid().parse(value).toLowerCase()))];
    const tx = boundary.enlist(context);
    if (ids.length === 0) return [];
    const references = await tx.$queryRaw<
      Array<{ id: string; templateId: string; hallId: string }>
    >`WITH layout_refs AS MATERIALIZED (
        SELECT v.id, v."layoutTemplateId" AS "templateId", t."hallId"
        FROM "LayoutTemplateVersion" v JOIN "LayoutTemplate" t ON t.id=v."layoutTemplateId"
        WHERE v.id=ANY(${ids}::uuid[])
      ), hall_keys AS MATERIALIZED (
        SELECT pg_advisory_xact_lock_shared(hashtext('HALL:' || ordered.id::text))
        FROM (SELECT DISTINCT "hallId" AS id FROM layout_refs ORDER BY "hallId") ordered
        WHERE (SELECT count(*) FROM layout_refs)=cardinality(${ids}::uuid[])
      ), template_keys AS MATERIALIZED (
        SELECT pg_advisory_xact_lock_shared(hashtext('LAYOUT_TEMPLATE:' || ordered.id::text))
        FROM (SELECT DISTINCT "templateId" AS id FROM layout_refs ORDER BY "templateId") ordered
        WHERE (SELECT count(*) FROM hall_keys)>0
      ), hall_rows AS MATERIALIZED (
        SELECT h.id FROM "Hall" h WHERE h.id IN (SELECT "hallId" FROM layout_refs)
        AND (SELECT count(*) FROM template_keys)>0 ORDER BY h.id FOR SHARE
      ), template_rows AS MATERIALIZED (
        SELECT t.id FROM "LayoutTemplate" t WHERE t.id IN (SELECT "templateId" FROM layout_refs)
        AND (SELECT count(*) FROM hall_rows)>0 ORDER BY t.id FOR SHARE
      )
      SELECT r.id, r."templateId", r."hallId", locks.count AS "lockedTemplateCount"
      FROM layout_refs r CROSS JOIN (SELECT count(*) FROM template_rows) locks`;
    if (references.length !== ids.length) throw new NotFoundError();
    // Each materialized phase depends on completion of the previous one: Hall
    // advisory -> template advisory -> Hall rows -> template rows, all sorted.
    // Use a NEW statement snapshot after waiting for locks, so a retirement that
    // committed while we waited cannot be hidden by the lock statement's snapshot.
    const facts = await tx.$queryRaw<
      (LayoutEligibility & { layoutSnapshotInput?: Parameters<typeof toLayoutSnapshot>[0] })[]
    >`
      SELECT v.id AS "layoutTemplateVersionId", t."hallId",
        (t.lifecycle='ACTIVE') AS "templateActive", (h.lifecycle='ACTIVE') AS "hallActive",
        COALESCE(t."currentPublishedVersionId"=v.id, false) AS "currentForNewSelection",
        h."maxGuests" AS "hallMaxGuests", COALESCE(SUM(g."seatCapacity"),0)::int AS "totalSeatCapacity"
        ${
          snapshot
            ? Prisma.sql`, jsonb_build_object(
          'id',v.id,'layoutTemplateId',v."layoutTemplateId",'versionNumber',v."versionNumber",
          'revision',v.revision,'state',v.state,'name',v.name,'description',v.description,
          'minGuests',v."minGuests",'maxGuests',v."maxGuests",
          'layoutTemplate',jsonb_build_object('hallId',t."hallId"),
          'geometry',COALESCE(jsonb_agg(jsonb_build_object(
            'id',g.id,'layoutTemplateVersionId',g."layoutTemplateVersionId",'layoutTemplateId',g."layoutTemplateId",
            'tableId',g."tableId",'label',g.label,'shape',g.shape,'seatCapacity',g."seatCapacity",
            'x',g.x,'y',g.y,'width',g.width,'height',g.height,
            'rotationDegrees',g."rotationDegrees",'displayOrder',g."displayOrder"
          ) ORDER BY g."displayOrder") FILTER (WHERE g."tableId" IS NOT NULL),'[]'::jsonb)
        ) AS "layoutSnapshotInput"`
            : Prisma.empty
        }
      FROM "LayoutTemplateVersion" v
      JOIN "LayoutTemplate" t ON t.id=v."layoutTemplateId"
      JOIN "Hall" h ON h.id=t."hallId"
      LEFT JOIN "LayoutTableGeometry" g ON g."layoutTemplateVersionId"=v.id
      WHERE v.id=ANY(${ids}::uuid[]) AND v.state<>'DRAFT'
      GROUP BY v.id,t.id,h.id`;
    if (facts.length !== ids.length) throw new NotFoundError();
    return facts.map(({ layoutSnapshotInput, ...eligibility }) =>
      layoutSnapshotInput === undefined
        ? eligibility
        : { ...eligibility, layoutSnapshot: toLayoutSnapshot(layoutSnapshotInput) },
    );
  }
  return {
    getLayoutEligibilities: getMany,
    async getLayoutEligibility(value, context) {
      return (await getMany([value], context, true))[0]!;
    },
  };
}
