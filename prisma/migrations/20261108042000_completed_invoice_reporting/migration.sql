BEGIN;
CREATE INDEX "ReportingFact_latest_record_idx" ON "ReportingFact"(owner,"recordId",sequence DESC);

CREATE OR REPLACE FUNCTION analytics_capture_billing(bid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE payload JSONB; invoice JSONB; iid UUID; commercial_lines JSONB; legacy_invoice JSONB;
BEGIN
  SELECT value INTO payload FROM "BillingReportingSnapshot" WHERE "bookingId"=bid ORDER BY sequence DESC LIMIT 1;
  IF payload IS NULL THEN payload:=jsonb_build_object('bookingId',bid,'acceptedChargesVnd',0,'paidVnd',0,
    'refundedVnd',0,'outstandingVnd',0,'creditVnd',0,'ledger','[]'::jsonb); END IF;
  SELECT r.document,r.id INTO invoice,iid FROM "FinalInvoiceHead" h
    JOIN "FinalInvoiceRevision" r ON r.id=h."currentRevisionId" WHERE h."bookingId"=bid;
  IF iid IS NOT NULL THEN
    commercial_lines := CASE WHEN jsonb_array_length(invoice->'appendices') > 0
      THEN invoice->'appendices'->-1->'document'->'afterLines'
      ELSE invoice->'contract'->'document'->'lines' END;
  ELSE
    -- Retained legacy invoices are genuine invoice evidence too. Their proposal
    -- snapshot is immutable after settlement; no current catalog prices are read.
    SELECT i.snapshot,i.id INTO legacy_invoice,iid FROM "BillingInvoice" i JOIN "Booking" b ON b.id=i."bookingId"
      WHERE i."bookingId"=bid AND b."commercialModelVersion"='LEGACY_PROPOSAL_V1'
      ORDER BY i."issuedAt" DESC,i.id DESC LIMIT 1;
    IF iid IS NOT NULL THEN
      invoice := jsonb_build_object('totalVnd',legacy_invoice->'totals'->'acceptedChargesVnd');
      SELECT CASE WHEN p.menus IS NOT NULL THEN
        (SELECT jsonb_agg(jsonb_build_object('category','MENU','sourceId',l->>'packageId',
          'sourceRevisionId',l->>'versionId','name',l->>'name','unit','bàn','quantity',l->'tableCount',
          'lineTotalVnd',l->'lineTotalVnd')) FROM jsonb_array_elements(p.menus) l)
        ELSE jsonb_build_array(jsonb_build_object('category','MENU','sourceId',p."menuPackageId",
          'sourceRevisionId',p."menuPackageVersionId",'name',p."menuName",'unit','bàn','quantity',p."tableCount",
          'lineTotalVnd',p."baseChargeVnd")) END INTO commercial_lines
      FROM "BookingProposalSnapshot" p WHERE p."bookingId"=bid;
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('category',l->>'category','sourceId',l->>'sourceId',
    'sourceRevisionId',l->>'sourceRevisionId','name',l->>'name','unit',l->>'unit',
    'quantity',l->'quantity','lineTotalVnd',l->'lineTotalVnd')),'[]'::jsonb)
    INTO commercial_lines FROM jsonb_array_elements(COALESCE(commercial_lines,'[]'::jsonb)) l;
  PERFORM reporting_publish('billing',bid::text,payload || jsonb_build_object('finalInvoiceRevisionId',iid,
    'finalizedIncidentalTotalVnd',invoice->'incidentalTotalVnd','finalInvoiceTotalVnd',invoice->'totalVnd',
    'finalCommercialLines',commercial_lines));
END $$;
ALTER FUNCTION analytics_capture_billing(UUID) SET search_path FROM CURRENT;

-- Existing latest legacy-invoice writes need the same deferred owner publication.
CREATE CONSTRAINT TRIGGER analytics_legacy_invoice AFTER INSERT ON "BillingInvoice"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_booking_changed();

CREATE OR REPLACE FUNCTION analytics_capture_venue() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE payload JSONB; n INTEGER;
BEGIN
  UPDATE "ReportingSequence" SET value=value+1 WHERE owner='venue' RETURNING value INTO n;
  SELECT jsonb_build_object('observedAt',clock_timestamp(),
    'halls',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',lifecycle='ACTIVE') ORDER BY id) FROM "Hall"),'[]'::jsonb),
    'shifts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',code,'active',"isActive") ORDER BY code) FROM "RestaurantShift"),'[]'::jsonb)) INTO payload;
  INSERT INTO "ReportingFact" VALUES('venue',n,n::text,clock_timestamp(),payload);
END $$;
ALTER FUNCTION analytics_capture_venue() SET search_path FROM CURRENT;

-- Append derived facts only; never update/delete old facts or financial documents.
DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT id FROM "Booking" ORDER BY id LOOP PERFORM analytics_capture_billing(item.id); END LOOP;
  PERFORM analytics_capture_venue();
END $$;
COMMIT;
