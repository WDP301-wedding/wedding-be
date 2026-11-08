import { Prisma } from '../../../generated/prisma/client.js';

/** Sort before LIMIT/OFFSET, using the same approved source as the row projection. */
export async function readEffectiveTablePage(
  tx: Prisma.TransactionClient,
  query: { q: string; scope: string; phase: string; order: 'asc' | 'desc'; pageSize: number },
  managerId: string,
  offset: number,
  schemaName = 'public',
) {
  const schema = Prisma.raw('"' + schemaName.replaceAll('"', '""') + '"');
  const direction = query.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // Match the existing Prisma contains filters used for the page's total count.
  const text = '%' + query.q + '%';
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT b.id
    FROM ${schema}."Booking" b
    JOIN ${schema}."Consultation" c ON c.id=b."consultationId"
    LEFT JOIN ${schema}."ConsultationRequest" intake ON intake."consultationId"=c.id
    LEFT JOIN ${schema}."BookingProposalSnapshot" p ON p."bookingId"=b.id
    LEFT JOIN ${schema}."CommercialContract" ch ON ch."bookingId"=b.id
    LEFT JOIN ${schema}."CommercialContractRevision" cr ON cr.id=ch."currentRevisionId"
    LEFT JOIN ${schema}."CommercialAppendixHead" ah ON ah."bookingId"=b.id
    LEFT JOIN ${schema}."CommercialAppendixRevision" ar ON ar.id=ah."effectiveRevisionId"
    WHERE b.phase<>'CANCELLED'
      AND (${query.scope !== 'mine'} OR c."managerAccountId"=${managerId}::uuid)
      AND (${query.phase === 'ALL'} OR b.phase::text=${query.phase})
      AND (${query.q === ''} OR b."bookingCode" ILIKE ${text} OR b.alias ILIKE ${text}
        OR p."hallName" ILIKE ${text} OR c."displayName" ILIKE ${text}
        OR c."brideName" ILIKE ${text} OR c."groomName" ILIKE ${text}
        OR c."intendedEmail" ILIKE ${text} OR intake.phone LIKE ${text})
    ORDER BY CASE
      WHEN ar.state='APPROVED' AND (SELECT count(*)=2 AND count(DISTINCT a.party)=2
        AND count(DISTINCT a."actorAccountId")=2 AND bool_and(a."documentDigest"=ar."documentDigest")
        FROM ${schema}."CommercialAppendixApproval" a WHERE a."revisionId"=ar.id)
      THEN (ar.document->>'tableCount')::int
      WHEN cr.state='APPROVED' AND (SELECT count(*)=2 AND count(DISTINCT a.party)=2
        AND count(DISTINCT a."actorAccountId")=2 AND bool_and(a."documentDigest"=cr."documentDigest")
        FROM ${schema}."CommercialContractApproval" a WHERE a."revisionId"=cr.id)
      THEN (cr.document->>'tableCount')::int
      ELSE COALESCE(p."tableCount",0) END ${direction}, b.id ${direction}
    LIMIT ${query.pageSize} OFFSET ${offset}
  `);
  return rows.map((row) => row.id);
}
