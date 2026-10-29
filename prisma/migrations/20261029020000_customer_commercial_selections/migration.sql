CREATE TABLE "BookingCommercialSelectionRevision" (
  "id" UUID PRIMARY KEY,
  "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
  "revisionNumber" INTEGER NOT NULL CHECK ("revisionNumber" > 0),
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('DRAFT', 'SUBMITTED')),
  "lines" JSONB NOT NULL CHECK (jsonb_typeof("lines") = 'array' AND jsonb_array_length("lines") BETWEEN 1 AND 50),
  "totalVnd" DECIMAL(18,0) NOT NULL CHECK ("totalVnd" >= 0),
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "submittedAt" TIMESTAMPTZ(6),
  CONSTRAINT "CommercialSelection_submission_time" CHECK (("status" = 'SUBMITTED') = ("submittedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "BookingCommercialSelectionRevision_bookingId_revisionNumber_key"
  ON "BookingCommercialSelectionRevision" ("bookingId", "revisionNumber");

CREATE FUNCTION protect_commercial_selection_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE latest_number INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Commercial selection history is immutable';
  END IF;
  PERFORM 1 FROM "Booking" WHERE "id" = NEW."bookingId" FOR UPDATE;
  SELECT MAX("revisionNumber") INTO latest_number
    FROM "BookingCommercialSelectionRevision" WHERE "bookingId" = NEW."bookingId";
  IF EXISTS (SELECT 1 FROM "BookingCommercialSelectionRevision"
    WHERE "bookingId" = NEW."bookingId" AND "status" = 'SUBMITTED') THEN
    RAISE EXCEPTION 'Submitted customer selections are locked';
  END IF;
  IF NEW."revisionNumber" <> COALESCE(latest_number, 0) + 1 THEN
    RAISE EXCEPTION 'Commercial selection predecessor is stale';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommercialSelection_history_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "BookingCommercialSelectionRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_commercial_selection_history();
