BEGIN;
CREATE SEQUENCE "Booking_code_seq" AS BIGINT START WITH 1 NO CYCLE;
CREATE FUNCTION new_booking_code() RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE n TEXT;
BEGIN
  n := nextval('"Booking_code_seq"')::text;
  RETURN 'HY-' || lpad(n, greatest(6, length(n)), '0');
END $$;
ALTER TABLE "Booking" ADD COLUMN "bookingCode" VARCHAR(32);
ALTER TABLE "Booking" ALTER COLUMN "bookingCode" SET DEFAULT new_booking_code();
-- Stable ordering for existing records. Gaps from rolled-back transactions are intentional.
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM "Booking" ORDER BY "createdAt", id LOOP
    UPDATE "Booking" SET "bookingCode"=new_booking_code() WHERE id=r.id;
  END LOOP;
END $$;
ALTER TABLE "Booking" ALTER COLUMN "bookingCode" SET NOT NULL;
CREATE UNIQUE INDEX "Booking_bookingCode_key" ON "Booking"("bookingCode");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_bookingCode_format" CHECK ("bookingCode" ~ '^HY-[0-9]{6,}$');
ALTER SEQUENCE "Booking_code_seq" OWNED BY "Booking"."bookingCode";
CREATE FUNCTION protect_booking_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."bookingCode" IS DISTINCT FROM OLD."bookingCode" THEN
    RAISE EXCEPTION 'Booking business code is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Booking_code_immutable" BEFORE UPDATE OF "bookingCode" ON "Booking"
FOR EACH ROW EXECUTE FUNCTION protect_booking_code();
CREATE OR REPLACE FUNCTION analytics_capture_booking(bid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE payload JSONB; guest_payload JSONB; staff_payload JSONB;
BEGIN
  SELECT jsonb_build_object('bookingId',b.id,'bookingCode',b."bookingCode",'customerName',contact."displayName",'alias',b.alias,'phase',b.phase,'eventDate',to_char(b."eventDate",'YYYY-MM-DD'),
    'hallId',b."hallId",'hallNameSnapshot',p."hallName",'shiftCode',b."shiftCode",'menuPackageId',p."menuPackageId",
    'menuNameSnapshot',p."menuName",'tableCount',p."tableCount",'baseChargeVnd',p."baseChargeVnd",
    'confirmedAt',s."settledAt",'cancelledAt',b."cancelledAt",'planningHeadcount',b."planningHeadcount",
    'originalContractTotalVnd',c."contractTotalVnd",'approvedAppendixDeltaVnd',COALESCE(a."effectiveTotalVnd"-c."contractTotalVnd",0),
    'effectiveAgreedTotalVnd',COALESCE(a."effectiveTotalVnd",c."contractTotalVnd"),
    'commercialLines',COALESCE((SELECT jsonb_agg(jsonb_build_object('category',l->>'category','sourceId',l->>'sourceId',
      'sourceRevisionId',l->>'sourceRevisionId','name',l->>'name','quantity',l->'quantity'))
      FROM jsonb_array_elements(COALESCE(a.document->'afterLines',c.document->'lines','[]'::jsonb)) l),'[]'::jsonb)) INTO payload
  FROM "Booking" b JOIN "Consultation" contact ON contact.id=b."consultationId" JOIN "BookingProposalSnapshot" p ON p."bookingId"=b.id
  LEFT JOIN "BookingDepositSettlement" s ON s."bookingId"=b.id
  LEFT JOIN "CommercialContract" h ON h."bookingId"=b.id
  LEFT JOIN "CommercialContractRevision" c ON c.id=COALESCE(s."contractRevisionId",h."currentRevisionId") AND c.state='APPROVED'
  LEFT JOIN "CommercialAppendixHead" ah ON ah."bookingId"=b.id
  LEFT JOIN "CommercialAppendixRevision" a ON a.id=ah."effectiveRevisionId" AND a.state='APPROVED'
  WHERE b.id=bid;
  IF payload IS NULL THEN RETURN; END IF;
  PERFORM reporting_publish('booking',bid::text,payload);
  SELECT jsonb_build_object('bookingId',bid,'planningHeadcount',o.payload->'planningHeadcount',
    'listedGuestCount',o.payload->'listedGuestCount','planSourceSequence',o.payload->'planSourceSequence') INTO guest_payload
    FROM "GuestOutbox" o WHERE o."bookingId"=bid ORDER BY o."sourceSequence" DESC LIMIT 1;
  IF guest_payload IS NULL THEN guest_payload:=jsonb_build_object('bookingId',bid,
    'planningHeadcount',payload->'planningHeadcount','listedGuestCount',0,'planSourceSequence',0); END IF;
  PERFORM reporting_publish('guest',bid::text,guest_payload);
  SELECT value INTO staff_payload FROM "ReportingFact" WHERE owner='staff' AND "recordId"=bid::text ORDER BY sequence DESC LIMIT 1;
  IF staff_payload IS NULL THEN
    PERFORM reporting_publish('staff',bid::text,jsonb_build_object('bookingId',bid,'checkInMode','NONE',
      'measurementStatus','NOT_RECORDED','checkedInGuestCount',NULL,'ledgerRevision',0,'byGuestGroup','[]'::jsonb));
  END IF;
END $$;

CREATE FUNCTION analytics_booking_contact_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE bid UUID;
BEGIN
  IF NEW."displayName" IS DISTINCT FROM OLD."displayName" THEN
    SELECT id INTO bid FROM "Booking" WHERE "consultationId"=NEW.id;
    IF bid IS NOT NULL THEN PERFORM analytics_capture_booking(bid); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER analytics_booking_contact AFTER UPDATE ON "Consultation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_contact_changed();
-- Append fresh facts; never rewrite historical financial/contract/reporting records.
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM "Booking" ORDER BY id LOOP PERFORM analytics_capture_booking(r.id); END LOOP;
END $$;
COMMIT;
