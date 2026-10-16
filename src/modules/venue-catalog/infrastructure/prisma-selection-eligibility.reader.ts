import { z } from 'zod';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type {
  LayoutEligibility,
  VenueSelectionEligibilityReader,
} from '../application/selection-eligibility.reader.js';

/** Hall -> template lifecycle shared locks match the existing retirement writers.
 * Only this Venue-owned adapter reads catalog rows; it keeps locks until UoW commit. */
export function createPrismaSelectionEligibilityReader(
  boundary: PrismaBookingBoundary,
): VenueSelectionEligibilityReader {
  async function getMany(values: readonly string[], context: ContractContext) {
    const ids = [...new Set(values.map((value) => z.uuid().parse(value).toLowerCase()))];
    const tx = boundary.enlist(context);
    if (ids.length === 0) return [];
    const references = await tx.$queryRaw<
      Array<{ id: string; templateId: string; hallId: string }>
    >`SELECT v.id, v."layoutTemplateId" AS "templateId", t."hallId"
      FROM "LayoutTemplateVersion" v JOIN "LayoutTemplate" t ON t.id=v."layoutTemplateId"
      WHERE v.id=ANY(${ids}::uuid[])`;
    if (references.length !== ids.length) throw new NotFoundError();
    const hallIds = [...new Set(references.map((r) => r.hallId))].sort();
    const templateIds = [...new Set(references.map((r) => r.templateId))].sort();
    // Sort before evaluating lock functions. Keep Hall -> template order, matching
    // single-version acceptance and the catalog retirement writers.
    for (const keys of [
      hallIds.map((id) => `HALL:${id}`),
      templateIds.map((id) => `LAYOUT_TEMPLATE:${id}`),
    ])
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(lock_key))
        FROM (SELECT unnest(${keys}::text[]) AS lock_key ORDER BY lock_key) ordered`;
    await tx.$queryRaw`SELECT id FROM "Hall" WHERE id=ANY(${hallIds}::uuid[]) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "LayoutTemplate" WHERE id=ANY(${templateIds}::uuid[]) ORDER BY id FOR SHARE`;
    // Re-read eligibility after the lifecycle locks; immutable geometry is summed
    // in the same query rather than loading every table and parent per layout.
    const facts = await tx.$queryRaw<LayoutEligibility[]>`
      SELECT v.id AS "layoutTemplateVersionId", t."hallId",
        (t.lifecycle='ACTIVE') AS "templateActive", (h.lifecycle='ACTIVE') AS "hallActive",
        COALESCE(t."currentPublishedVersionId"=v.id, false) AS "currentForNewSelection",
        h."maxGuests" AS "hallMaxGuests", COALESCE(SUM(g."seatCapacity"),0)::int AS "totalSeatCapacity"
      FROM "LayoutTemplateVersion" v
      JOIN "LayoutTemplate" t ON t.id=v."layoutTemplateId"
      JOIN "Hall" h ON h.id=t."hallId"
      LEFT JOIN "LayoutTableGeometry" g ON g."layoutTemplateVersionId"=v.id
      WHERE v.id=ANY(${ids}::uuid[]) AND v.state<>'DRAFT'
      GROUP BY v.id,t.id,h.id`;
    if (facts.length !== ids.length) throw new NotFoundError();
    return facts;
  }
  return {
    getLayoutEligibilities: getMany,
    async getLayoutEligibility(value, context) {
      return (await getMany([value], context))[0]!;
    },
  };
}
