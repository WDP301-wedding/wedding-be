ALTER TABLE "BookingOutboxEvent"
  ADD COLUMN "eventVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("eventVersion" > 0),
  ADD COLUMN "correlationId" UUID,
  ADD COLUMN "causationId" UUID;

-- Recover the original correlation where the atomic audit contains it. Older rows
-- without matching audit evidence start their own event correlation; no request is fabricated.
UPDATE "BookingOutboxEvent" e SET "correlationId" = COALESCE(
  (SELECT a."requestId" FROM "AuditLog" a
   WHERE a."occurredAt" = e."occurredAt"
     AND (a."entityId" = e."aggregateId"
       OR a."metadata"->>'bookingId' = e."aggregateId"::text)
   ORDER BY a."id" LIMIT 1), e."id");
ALTER TABLE "BookingOutboxEvent" ALTER COLUMN "correlationId" SET NOT NULL;
