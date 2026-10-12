BEGIN;
CREATE TABLE "ReportingSequence" (owner TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0 CHECK(value>=0));
INSERT INTO "ReportingSequence"(owner) VALUES ('booking'),('billing'),('invitation'),('guest'),('staff'),('venue');
CREATE TABLE "ReportingFact" (owner TEXT NOT NULL REFERENCES "ReportingSequence"(owner), sequence INTEGER NOT NULL,
  "recordId" TEXT NOT NULL, "changedAt" TIMESTAMPTZ(6) NOT NULL, value JSONB NOT NULL,
  PRIMARY KEY(owner,sequence), CHECK(sequence>0 AND jsonb_typeof(value)='object'));
CREATE INDEX "ReportingFact_owner_recordId_sequence_idx" ON "ReportingFact"(owner,"recordId",sequence);
CREATE FUNCTION reporting_publish(source_owner TEXT, record_id TEXT, payload JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE n INTEGER; previous JSONB;
BEGIN
  -- Commit-ordered counter, not a PostgreSQL sequence that can fence over an uncommitted writer.
  PERFORM 1 FROM "ReportingSequence" WHERE owner=source_owner FOR UPDATE;
  SELECT value INTO previous FROM "ReportingFact" WHERE owner=source_owner AND "recordId"=record_id ORDER BY sequence DESC LIMIT 1;
  IF previous=payload THEN RETURN; END IF;
  UPDATE "ReportingSequence" SET value=value+1 WHERE owner=source_owner RETURNING value INTO n;
  INSERT INTO "ReportingFact" VALUES(source_owner,n,record_id,clock_timestamp(),payload);
END $$;
CREATE FUNCTION analytics_capture_booking(bid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE payload JSONB; guest_payload JSONB; staff_payload JSONB;
BEGIN
  SELECT jsonb_build_object('bookingId',b.id,'phase',b.phase,'eventDate',to_char(b."eventDate",'YYYY-MM-DD'),
    'hallId',b."hallId",'hallNameSnapshot',p."hallName",'shiftCode',b."shiftCode",'menuPackageId',p."menuPackageId",
    'menuNameSnapshot',p."menuName",'tableCount',p."tableCount",'baseChargeVnd',p."baseChargeVnd",
    'confirmedAt',s."settledAt",'cancelledAt',b."cancelledAt",'planningHeadcount',b."planningHeadcount",
    'originalContractTotalVnd',c."contractTotalVnd",'approvedAppendixDeltaVnd',COALESCE(a."effectiveTotalVnd"-c."contractTotalVnd",0),
    'effectiveAgreedTotalVnd',COALESCE(a."effectiveTotalVnd",c."contractTotalVnd"),
    'commercialLines',COALESCE((SELECT jsonb_agg(jsonb_build_object('category',l->>'category','sourceId',l->>'sourceId',
      'sourceRevisionId',l->>'sourceRevisionId','name',l->>'name','quantity',l->'quantity'))
      FROM jsonb_array_elements(COALESCE(a.document->'afterLines',c.document->'lines','[]'::jsonb)) l),'[]'::jsonb)) INTO payload
  FROM "Booking" b JOIN "BookingProposalSnapshot" p ON p."bookingId"=b.id
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
CREATE FUNCTION analytics_capture_billing(bid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE payload JSONB; invoice JSONB; iid UUID;
BEGIN
  SELECT value INTO payload FROM "BillingReportingSnapshot" WHERE "bookingId"=bid ORDER BY sequence DESC LIMIT 1;
  IF payload IS NULL THEN payload:=jsonb_build_object('bookingId',bid,'acceptedChargesVnd',0,'paidVnd',0,
    'refundedVnd',0,'outstandingVnd',0,'creditVnd',0,'ledger','[]'::jsonb); END IF;
  SELECT r.document,r.id INTO invoice,iid FROM "FinalInvoiceHead" h JOIN "FinalInvoiceRevision" r ON r.id=h."currentRevisionId" WHERE h."bookingId"=bid;
  PERFORM reporting_publish('billing',bid::text,payload || jsonb_build_object('finalInvoiceRevisionId',iid,
    'finalizedIncidentalTotalVnd',invoice->'incidentalTotalVnd','finalInvoiceTotalVnd',invoice->'totalVnd'));
END $$;
CREATE FUNCTION analytics_booking_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE bid UUID;
BEGIN
  IF TG_TABLE_NAME='Booking' THEN bid:=NEW.id; ELSE bid:=NEW."bookingId"; END IF;
  PERFORM analytics_capture_booking(bid);
  PERFORM analytics_capture_billing(bid);
  RETURN NEW;
END $$;
-- Deferred capture sees the final mutually approved state, head pointers and once-only ledger posting.
CREATE CONSTRAINT TRIGGER analytics_booking AFTER INSERT OR UPDATE ON "Booking" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();
CREATE CONSTRAINT TRIGGER analytics_proposal AFTER INSERT OR UPDATE ON "BookingProposalSnapshot" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();
CREATE CONSTRAINT TRIGGER analytics_contract AFTER INSERT OR UPDATE ON "CommercialContractRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();
CREATE CONSTRAINT TRIGGER analytics_contract_head AFTER INSERT OR UPDATE ON "CommercialContract" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();
CREATE CONSTRAINT TRIGGER analytics_appendix_head AFTER INSERT OR UPDATE ON "CommercialAppendixHead" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();
CREATE CONSTRAINT TRIGGER analytics_settlement AFTER INSERT OR UPDATE ON "BookingDepositSettlement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();
CREATE CONSTRAINT TRIGGER analytics_invoice AFTER INSERT OR UPDATE ON "FinalInvoiceHead" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();
CREATE FUNCTION analytics_feed_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='BillingReportingSnapshot' THEN PERFORM analytics_capture_billing(NEW."bookingId");
  ELSIF TG_TABLE_NAME='GuestOutbox' THEN PERFORM analytics_capture_booking(NEW."bookingId");
  ELSIF TG_TABLE_NAME='StaffAttendanceSnapshot' THEN PERFORM reporting_publish('staff',NEW."bookingId"::text,NEW.payload);
  ELSE PERFORM reporting_publish('invitation',NEW."orderId"::text,NEW."reportingSnapshot"); END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER analytics_billing AFTER INSERT ON "BillingReportingSnapshot" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_feed_changed();
CREATE CONSTRAINT TRIGGER analytics_guests AFTER INSERT ON "GuestOutbox" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_feed_changed();
CREATE CONSTRAINT TRIGGER analytics_staff AFTER INSERT ON "StaffAttendanceSnapshot" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_feed_changed();
CREATE CONSTRAINT TRIGGER analytics_print AFTER INSERT ON "InvitationPrintAudit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_feed_changed();
CREATE FUNCTION analytics_capture_venue() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE payload JSONB; n INTEGER;
BEGIN
  UPDATE "ReportingSequence" SET value=value+1 WHERE owner='venue' RETURNING value INTO n;
  SELECT jsonb_build_object('observedAt',clock_timestamp(),
    'halls',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'active',lifecycle='ACTIVE') ORDER BY id) FROM "Hall"),'[]'::jsonb),
    'shifts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',code,'active',"isActive") ORDER BY code) FROM "RestaurantShift"),'[]'::jsonb)) INTO payload;
  INSERT INTO "ReportingFact" VALUES('venue',n,n::text,clock_timestamp(),payload);
END $$;
CREATE FUNCTION analytics_venue_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN PERFORM analytics_capture_venue(); RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER analytics_hall AFTER INSERT OR UPDATE OR DELETE ON "Hall" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_venue_changed();
CREATE CONSTRAINT TRIGGER analytics_shift AFTER INSERT OR UPDATE OR DELETE ON "RestaurantShift" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_venue_changed();
-- Forward upgrade: old facts are never edited. No invented availability before this observation.
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM "Booking" ORDER BY id LOOP PERFORM analytics_capture_booking(r.id); PERFORM analytics_capture_billing(r.id); END LOOP;
  FOR r IN SELECT DISTINCT ON ("bookingId") * FROM "StaffAttendanceSnapshot" ORDER BY "bookingId","sourceSequence" DESC LOOP
    PERFORM reporting_publish('staff',r."bookingId"::text,r.payload); END LOOP;
  FOR r IN SELECT DISTINCT ON ("orderId") * FROM "InvitationPrintAudit" ORDER BY "orderId",sequence DESC LOOP
    PERFORM reporting_publish('invitation',r."orderId"::text,r."reportingSnapshot"); END LOOP;
  PERFORM analytics_capture_venue();
END $$;
CREATE FUNCTION reporting_fact_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Reporting facts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER reporting_fact_guard BEFORE UPDATE OR DELETE ON "ReportingFact" FOR EACH ROW EXECUTE FUNCTION reporting_fact_immutable();
COMMIT;
