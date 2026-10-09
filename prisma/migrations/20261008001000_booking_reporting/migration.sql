CREATE TABLE "BookingReportingSequence" ("owner" TEXT PRIMARY KEY, "value" INTEGER NOT NULL DEFAULT 0);
INSERT INTO "BookingReportingSequence" VALUES ('booking', 0);
CREATE TABLE "BookingReportingSnapshot" (
  "sequence" INTEGER PRIMARY KEY,
  "bookingId" UUID NOT NULL,
  "changedAt" TIMESTAMPTZ(6) NOT NULL,
  "value" JSONB NOT NULL
);
CREATE INDEX "BookingReportingSnapshot_bookingId_sequence_idx" ON "BookingReportingSnapshot" ("bookingId", "sequence");

-- The counter row is locked until commit. Readers can never fence past an uncommitted earlier change.
CREATE FUNCTION capture_booking_reporting_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id UUID;
  snapshot JSONB;
  next_sequence INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Booking' THEN
    target_id := NEW."id";
  ELSE
    target_id := NEW."bookingId";
  END IF;
  EXECUTE format('SELECT jsonb_build_object(
    ''bookingId'', b."id", ''phase'', b."phase", ''eventDate'', to_char(b."eventDate", ''YYYY-MM-DD''),
    ''hallId'', b."hallId", ''hallNameSnapshot'', p."hallName", ''shiftCode'', b."shiftCode",
    ''menuPackageId'', p."menuPackageId", ''menuNameSnapshot'', p."menuName", ''tableCount'', p."tableCount",
    ''baseChargeVnd'', p."baseChargeVnd", ''confirmedAt'', s."settledAt", ''cancelledAt'', b."cancelledAt")
    FROM %I."Booking" b JOIN %I."BookingProposalSnapshot" p ON p."bookingId" = b."id"
    LEFT JOIN %I."BookingDepositSettlement" s ON s."bookingId" = b."id" WHERE b."id" = $1',
    TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA) INTO snapshot USING target_id;
  IF snapshot IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('UPDATE %I."BookingReportingSequence" SET "value" = "value" + 1 WHERE "owner" = ''booking'' RETURNING "value"', TG_TABLE_SCHEMA)
    INTO next_sequence;
  EXECUTE format('INSERT INTO %I."BookingReportingSnapshot" VALUES ($1, $2, CURRENT_TIMESTAMP, $3)', TG_TABLE_SCHEMA)
    USING next_sequence, target_id, snapshot;
  RETURN NEW;
END $$;

CREATE TRIGGER booking_reporting_changed AFTER UPDATE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION capture_booking_reporting_snapshot();
CREATE TRIGGER booking_reporting_created AFTER INSERT ON "BookingProposalSnapshot"
  FOR EACH ROW EXECUTE FUNCTION capture_booking_reporting_snapshot();
CREATE TRIGGER booking_reporting_confirmed AFTER INSERT ON "BookingDepositSettlement"
  FOR EACH ROW EXECUTE FUNCTION capture_booking_reporting_snapshot();

-- Upgrade existing bookings through the same transactionally serialized capture path.
UPDATE "Booking" SET "revision" = "revision";
