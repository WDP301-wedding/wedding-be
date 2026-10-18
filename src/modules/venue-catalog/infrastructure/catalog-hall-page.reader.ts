import { safeReadQuery } from '../../../core/database/safe-read.js';
import { prismaSchema } from '../../../core/database/prisma.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';

export interface HallPageInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

interface HallPageRow {
  id: string;
  name: string;
  description: string;
  maxGuests: number;
  assets: {
    id: string;
    resourceType: 'HALL';
    resourceId: string;
    objectKey: string;
    checksumSha256: string;
    contentType: string;
    sizeBytes: number;
    alternativeText: string;
    displayOrder: number;
  }[];
}

/** Capture only the bounded public Hall page and its attached media together.
 * Resource existence, cursor eligibility and media ownership share one snapshot. */
export async function readCatalogHallPage(prisma: PrismaClient, input: HallPageInput) {
  const schema = Prisma.raw('"' + prismaSchema(prisma).replaceAll('"', '""') + '"');
  const cursor =
    input.cursor === undefined ? Prisma.sql`NULL::uuid` : Prisma.sql`${input.cursor}::uuid`;
  const [snapshot] = await safeReadQuery(prisma, (db) =>
    db.$queryRaw<
      {
        cursorValid: boolean;
        rows: HallPageRow[];
      }[]
    >(Prisma.sql`
    WITH anchor AS (
      SELECT h.id, h."displayOrder" FROM ${schema}."Hall" h
      WHERE h.id=${cursor} AND h.lifecycle='ACTIVE'
    ), page AS MATERIALIZED (
      SELECT h.id, h.name, h.description, h."maxGuests", h."displayOrder"
      FROM ${schema}."Hall" h
      WHERE h.lifecycle='ACTIVE' AND (${cursor} IS NULL OR
        (h."displayOrder", h.id) > (SELECT a."displayOrder", a.id FROM anchor a))
      ORDER BY h."displayOrder", h.id LIMIT ${input.limit + 1}
    )
    SELECT (${cursor} IS NULL OR EXISTS(SELECT 1 FROM anchor)) AS "cursorValid",
      COALESCE((SELECT jsonb_agg(
        jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
          'maxGuests',p."maxGuests",'assets',COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id',m.id,'resourceType',m."resourceType",
              'resourceId',m."resourceId",'objectKey',m."objectKey",
              'checksumSha256',m."checksumSha256",'contentType',m."contentType",
              'sizeBytes',m."sizeBytes",'alternativeText',m."alternativeText",
              'displayOrder',m."displayOrder") ORDER BY m."displayOrder")
            FROM ${schema}."CatalogMediaAsset" m WHERE m."resourceType"='HALL'
              AND m."resourceId"=p.id AND m."detachedAt" IS NULL
          ),'[]'::jsonb)) ORDER BY p."displayOrder",p.id) FROM page p),'[]'::jsonb) AS rows
  `),
  );
  return snapshot!;
}
