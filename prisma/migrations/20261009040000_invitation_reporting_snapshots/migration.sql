BEGIN;

-- The row lock is held until commit: a later transaction cannot publish a
-- higher fence while an earlier reporting transition is still uncommitted.
LOCK TABLE "InvitationPrintAudit" IN ACCESS EXCLUSIVE MODE;
CREATE TABLE "InvitationReportingSequence" (
  "owner" TEXT PRIMARY KEY,
  "value" BIGINT NOT NULL DEFAULT 0 CHECK ("value" BETWEEN 0 AND 9007199254740991)
);
INSERT INTO "InvitationReportingSequence" ("owner", "value")
SELECT 'invitation-studio', COALESCE(MAX("sequence"), 0) FROM "InvitationPrintAudit";

ALTER TABLE "InvitationPrintAudit" ADD COLUMN "reportingSnapshot" JSONB;

-- Recover historical commercial identities from the immutable transition log,
-- never from the current order pointer (which may already have been replaced).
ALTER TABLE "InvitationPrintAudit" DISABLE TRIGGER studio_immutable;
WITH history AS (
  SELECT a.*, c."commercialRevisionId", approval."approvedAt"
  FROM "InvitationPrintAudit" a
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN h."action" = 'invitation.print-order-replacement-approved'
        THEN h."metadata"->>'newCommercialRevisionId'
      ELSE h."metadata"->>'commercialRevisionId'
    END AS "commercialRevisionId"
    FROM "InvitationPrintAudit" h
    WHERE h."orderId" = a."orderId" AND h."sequence" <= a."sequence"
      AND h."action" IN ('invitation.print-quotation-issued', 'invitation.print-order-quoted',
        'invitation.print-order-approved', 'invitation.print-order-replacement-approved')
    ORDER BY h."sequence" DESC LIMIT 1
  ) c ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE((
      SELECT (o."envelope"->'payload'->>'approvedAt')::timestamptz
      FROM "InvitationStudioOutbox" o
      WHERE o."eventType" = 'invitation.print-order-approved' AND o."bookingId" = h."bookingId"
        AND o."envelope"->'payload'->>'printOrderId' = h."orderId"::text
        AND o."envelope"->'payload'->>'commercialRevisionId' = CASE
          WHEN h."action" = 'invitation.print-order-replacement-approved' THEN h."metadata"->>'newCommercialRevisionId'
          ELSE h."metadata"->>'commercialRevisionId' END
      ORDER BY o."createdAt", o."eventId" LIMIT 1
    ), h."createdAt") AS "approvedAt" FROM "InvitationPrintAudit" h
    WHERE h."orderId" = a."orderId" AND h."sequence" <= a."sequence"
      AND h."action" IN ('invitation.print-order-approved', 'invitation.print-order-replacement-approved')
    ORDER BY h."sequence" DESC LIMIT 1
  ) approval ON TRUE
)
UPDATE "InvitationPrintAudit" a SET "reportingSnapshot" = jsonb_build_object(
  'bookingId', h."bookingId", 'printOrderId', h."orderId", 'status', h."toStatus",
  'commercialRevisionId', h."commercialRevisionId", 'receivableChargeId', charge."id",
  'acceptedAmountVnd', CASE WHEN h."toStatus" IN ('APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER')
    THEN COALESCE(rev."orderTotalVnd", 0) ELSE 0 END,
  'approvedAt', CASE WHEN h."toStatus" IN ('APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER')
    THEN to_char(h."approvedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
  'updatedAt', to_char(h."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
FROM history h
LEFT JOIN "InvitationCommercialRevision" rev ON rev."id"::text = h."commercialRevisionId"
LEFT JOIN "BookingReceivableCharge" charge ON charge."sourceRevisionId" = rev."id"
  AND charge."bookingId" = h."bookingId" AND h."approvedAt" IS NOT NULL
WHERE a."id" = h."id";

ALTER TABLE "InvitationPrintAudit" ENABLE TRIGGER studio_immutable;
ALTER TABLE "InvitationPrintAudit" ALTER COLUMN "reportingSnapshot" SET NOT NULL;
ALTER TABLE "InvitationPrintAudit" ALTER COLUMN "reportingSnapshot" SET DEFAULT '{}'::jsonb;
ALTER TABLE "InvitationPrintAudit" ALTER COLUMN "sequence" DROP DEFAULT;

CREATE FUNCTION invitation_capture_reporting_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE order_row "InvitationPrintOrder"%ROWTYPE; amount NUMERIC;
BEGIN
  UPDATE "InvitationReportingSequence" SET "value" = "value" + 1
    WHERE "owner" = 'invitation-studio' RETURNING "value" INTO NEW."sequence";
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing invitation reporting sequence'; END IF;
  SELECT * INTO STRICT order_row FROM "InvitationPrintOrder"
    WHERE "id" = NEW."orderId" AND "bookingId" = NEW."bookingId";
  IF order_row."status" <> NEW."toStatus" THEN
    RAISE EXCEPTION 'Reporting transition does not match order state';
  END IF;
  SELECT "orderTotalVnd" INTO amount FROM "InvitationCommercialRevision"
    WHERE "id" = order_row."currentCommercialRevisionId";
  NEW."reportingSnapshot" := jsonb_build_object(
    'bookingId', NEW."bookingId", 'printOrderId', NEW."orderId", 'status', NEW."toStatus",
    'commercialRevisionId', order_row."currentCommercialRevisionId",
    'receivableChargeId', order_row."receivableChargeId",
    'acceptedAmountVnd', CASE WHEN NEW."toStatus" IN ('APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER')
      THEN COALESCE(amount, 0) ELSE 0 END,
    'approvedAt', CASE WHEN NEW."toStatus" IN ('APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER')
      THEN to_char(order_row."approvedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
    'updatedAt', to_char(order_row."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  RETURN NEW;
END $$;
CREATE TRIGGER invitation_reporting_transition BEFORE INSERT ON "InvitationPrintAudit"
  FOR EACH ROW EXECUTE FUNCTION invitation_capture_reporting_transition();

COMMIT;
