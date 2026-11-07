-- Forward-only policy change. Existing invoices, payments and approvals are retained.
CREATE OR REPLACE FUNCTION require_event_ended(bid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM "Booking" b JOIN "BookingProposalSnapshot" p ON p."bookingId"=b."id"
  WHERE b."id"=bid AND b."phase"='COMPLETED'
 ) THEN
  RAISE EXCEPTION 'commercial invoice requires eligible booking' USING ERRCODE='23514';
 END IF;
 IF current_setting('app.strict_settlement_date_check', true) IS DISTINCT FROM 'false'
  AND NOT EXISTS(
   SELECT 1 FROM "Booking" b JOIN "BookingProposalSnapshot" p ON p."bookingId"=b."id"
   WHERE b."id"=bid
    AND (b."eventDate"+p."shiftEndTime") AT TIME ZONE 'Asia/Ho_Chi_Minh'<=CURRENT_TIMESTAMP
  ) THEN
  RAISE EXCEPTION 'commercial invoice requires authoritative event end' USING ERRCODE='23514';
 END IF;
END $$;

CREATE FUNCTION booking_completion_appendix_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."phase"='COMPLETED' AND OLD."phase" IS DISTINCT FROM NEW."phase" THEN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."id"::text));
  IF EXISTS (
   SELECT 1 FROM "CommercialAppendixHead" h JOIN "CommercialAppendixRevision" r ON r.id=h."currentRevisionId"
   WHERE h."bookingId"=NEW.id AND r.state<>'SUPERSEDED' AND (
    r.state<>'APPROVED' OR NOT EXISTS (
     SELECT 1 FROM "CommercialAppendixApproval" a WHERE a."revisionId"=r.id
      AND a.party='MANAGER' AND a."documentDigest"=r."documentDigest"
    ) OR NOT EXISTS (
     SELECT 1 FROM "CommercialAppendixApproval" a WHERE a."revisionId"=r.id
      AND a.party='COUPLE' AND a."documentDigest"=r."documentDigest"
    )
   )
  ) THEN RAISE EXCEPTION 'completion requires approved current appendix' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_completion_appendix_valid BEFORE UPDATE OF "phase" ON "Booking"
 FOR EACH ROW EXECUTE FUNCTION booking_completion_appendix_guard();

CREATE FUNCTION appendix_before_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 -- Legacy completed bookings may discard an unapplied proposal without changing the agreement.
 IF TG_OP='UPDATE' AND OLD.state IN ('DRAFT','AWAITING_APPROVAL') AND NEW.state='SUPERSEDED'
  AND EXISTS(SELECT 1 FROM "Booking" WHERE id=NEW."bookingId" AND phase='COMPLETED') THEN
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Booking" WHERE id=NEW."bookingId" AND phase='CONFIRMED') THEN
  RAISE EXCEPTION 'appendix requires confirmed unfinished booking' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_before_completion BEFORE INSERT OR UPDATE ON "CommercialAppendixRevision"
 FOR EACH ROW EXECUTE FUNCTION appendix_before_completion_guard();
