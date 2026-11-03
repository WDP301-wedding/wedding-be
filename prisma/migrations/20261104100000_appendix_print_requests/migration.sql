CREATE TABLE "InvitationPrintRequest" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "quoteId" UUID NOT NULL,
  "appendixRevisionId" UUID NOT NULL,
  "orderId" UUID,
  "document" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvitationPrintRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvitationPrintRequest_booking_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvitationPrintRequest_quote_fkey" FOREIGN KEY ("quoteId") REFERENCES "InvitationPrintPurchaseQuote"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvitationPrintRequest_appendix_fkey" FOREIGN KEY ("appendixRevisionId") REFERENCES "CommercialAppendixRevision"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvitationPrintRequest_order_fkey" FOREIGN KEY ("orderId") REFERENCES "InvitationPrintOrder"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "InvitationPrintRequest_quoteId_key" ON "InvitationPrintRequest"("quoteId");
CREATE UNIQUE INDEX "InvitationPrintRequest_orderId_key" ON "InvitationPrintRequest"("orderId");
CREATE INDEX "InvitationPrintRequest_bookingId_createdAt_idx" ON "InvitationPrintRequest"("bookingId", "createdAt");
CREATE INDEX "InvitationPrintRequest_appendixRevisionId_idx" ON "InvitationPrintRequest"("appendixRevisionId");

-- Private print-only snapshots do not publish a public invitation as a side effect.
ALTER TABLE "InvitationPrintableRevision" ALTER COLUMN "publicInvitationId" DROP NOT NULL;
DO $$
DECLARE definition text; old_expression text;
BEGIN
 definition:=pg_get_functiondef('invitation_studio_reference_guard()'::regprocedure);
 old_expression:='EXISTS(SELECT 1 FROM "InvitationPublicIdentity" WHERE id=NEW."publicInvitationId" AND "bookingId"=NEW."bookingId")';
 IF position(old_expression IN definition)=0 THEN RAISE EXCEPTION 'unexpected printable owner guard'; END IF;
 EXECUTE replace(definition,old_expression,'(NEW."publicInvitationId" IS NULL OR '||old_expression||')');
END $$;

DO $$
DECLARE definition text; insertion text;
BEGIN
 definition:=pg_get_functiondef('print_commercial_quote_bounds_guard()'::regprocedure);
 insertion:=$branch$
 IF EXISTS(SELECT 1 FROM "InvitationPrintRequest" WHERE "orderId"=NEW."orderId" AND "bookingId"=NEW."bookingId") THEN
  SELECT count(*) INTO line_count FROM "InvitationPrintLine" WHERE "orderId"=NEW."orderId" AND "bookingId"=NEW."bookingId";
  SELECT count(DISTINCT q->>'lineId'),sum((q->>'lineTotalVnd')::numeric) INTO quoted_count,total FROM jsonb_array_elements(NEW."linesJson") q;
  IF line_count=0 OR line_count<>quoted_count OR line_count<>jsonb_array_length(NEW."linesJson") OR total IS DISTINCT FROM NEW."orderTotalVnd"
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."linesJson") q LEFT JOIN "InvitationPrintLine" p
    ON p.id::text=q->>'lineId' AND p."orderId"=NEW."orderId" AND p."bookingId"=NEW."bookingId"
    WHERE p.id IS NULL OR q->>'designId' IS DISTINCT FROM p."designId"::text
     OR (q->>'quantity')::numeric IS DISTINCT FROM p.quantity OR (q->>'unitPriceVnd')::numeric<>5000
     OR (q->>'lineTotalVnd')::numeric IS DISTINCT FROM p.quantity*5000) THEN
   RAISE EXCEPTION 'appendix print quantity or fixed price conflicts' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
$branch$;
 EXECUTE replace(definition,'BEGIN', 'BEGIN'||insertion);
END $$;

-- The retained request is consent evidence. Only its effective appendix/order
-- pointers may change; neither later design edits nor direct SQL reprice it.
CREATE FUNCTION appendix_print_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'appendixRevisionId'-'orderId') IS DISTINCT FROM
   (to_jsonb(OLD)-'appendixRevisionId'-'orderId') THEN
  RAISE EXCEPTION 'print request consent is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."orderId" IS NOT NULL AND NEW."orderId" IS DISTINCT FROM OLD."orderId" THEN
  RAISE EXCEPTION 'print request production identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_print_request_immutable BEFORE UPDATE OR DELETE ON "InvitationPrintRequest"
 FOR EACH ROW EXECUTE FUNCTION appendix_print_request_immutable();

CREATE FUNCTION appendix_request_production_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source record; before_line jsonb; after_line jsonb;
BEGIN
 IF NEW.state<>'APPROVED' THEN RETURN NEW; END IF;
 FOR source IN SELECT s->'line'->>'sourceId' AS source_id FROM "InvitationPrintRequest" r
  JOIN "InvitationPrintOrder" o ON o.id=r."orderId"
  CROSS JOIN LATERAL jsonb_array_elements(r.document->'lines') s
  WHERE r."bookingId"=NEW."bookingId" AND o.status IN ('IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER') LOOP
  SELECT v INTO before_line FROM jsonb_array_elements(NEW.document->'beforeLines') v WHERE v->>'category'='PRINT' AND v->>'sourceId'=source.source_id;
  SELECT v INTO after_line FROM jsonb_array_elements(NEW.document->'afterLines') v WHERE v->>'category'='PRINT' AND v->>'sourceId'=source.source_id;
  IF before_line IS DISTINCT FROM after_line THEN
   RAISE EXCEPTION 'produced print content and quantities are immutable' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_request_production_guard BEFORE UPDATE ON "CommercialAppendixRevision"
 FOR EACH ROW EXECUTE FUNCTION appendix_request_production_guard();

CREATE FUNCTION appendix_print_validate_order(oid uuid, bid uuid, target_status text,
 commercial_id uuid, charge_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r "InvitationPrintRequest"%ROWTYPE; a "CommercialAppendixRevision"%ROWTYPE;
 c "InvitationCommercialRevision"%ROWTYPE; l record; source jsonb; agreed jsonb;
 actual_total numeric:=0; expected_count integer:=0; actual_count integer:=0;
BEGIN
 SELECT * INTO STRICT r FROM "InvitationPrintRequest" WHERE "orderId"=oid AND "bookingId"=bid;
 SELECT a1.* INTO a FROM "CommercialAppendixHead" h JOIN "CommercialAppendixRevision" a1
  ON a1.id=h."effectiveRevisionId" WHERE h."bookingId"=bid;
 IF NOT FOUND OR a.state<>'APPROVED' OR
  (SELECT count(DISTINCT party) FROM "CommercialAppendixApproval" WHERE "revisionId"=a.id AND "documentDigest"=a."documentDigest")<>2 THEN
  RAISE EXCEPTION 'print production requires mutual appendix approval' USING ERRCODE='23514';
 END IF;
 IF target_status='REQUESTED' THEN RETURN; END IF;
 IF target_status='CANCELLED' THEN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.document->'lines') s
    JOIN LATERAL jsonb_array_elements(a.document->'afterLines') v ON v->>'category'='PRINT' AND v->>'sourceId'=s->'line'->>'sourceId') THEN
   RAISE EXCEPTION 'print cancellation requires approved removal' USING ERRCODE='23514';
  END IF;
  RETURN;
 END IF;
 IF target_status NOT IN ('APPROVED','IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER') THEN
  RAISE EXCEPTION 'appendix print order state is invalid' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM "InvitationCommercialRevision" WHERE id=commercial_id AND "orderId"=oid AND "bookingId"=bid;
 IF NOT FOUND THEN RAISE EXCEPTION 'print commercial revision required' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO expected_count FROM jsonb_array_elements(r.document->'lines') s
  JOIN LATERAL jsonb_array_elements(a.document->'afterLines') v ON v->>'category'='PRINT' AND v->>'sourceId'=s->'line'->>'sourceId';
 FOR l IN SELECT * FROM "InvitationPrintLine" WHERE "orderId"=oid AND "bookingId"=bid LOOP
  actual_count:=actual_count+1;
  SELECT s INTO source FROM jsonb_array_elements(r.document->'lines') s WHERE s->>'designId'=l."designId"::text
   AND s->>'printableRevisionId'=l."printableRevisionId"::text;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM "InvitationPrintableRevision" v WHERE v.id=l."printableRevisionId"
    AND v."bookingId"=bid AND v."contentDigest"=source->>'contentDigest') THEN
   RAISE EXCEPTION 'print retained content conflicts' USING ERRCODE='23514'; END IF;
  SELECT v INTO agreed FROM jsonb_array_elements(a.document->'afterLines') v WHERE v->>'category'='PRINT'
   AND v->>'sourceId'=source->'line'->>'sourceId';
  IF NOT FOUND OR (agreed->>'quantity')::integer<>l.quantity OR (agreed->>'unitPriceVnd')::numeric<>5000
   OR agreed->>'sourceRevisionId' IS DISTINCT FROM source->'line'->>'sourceRevisionId'
   OR (agreed->>'lineTotalVnd')::numeric<>l.quantity*5000 THEN
   RAISE EXCEPTION 'print allocation differs from effective appendix' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c."linesJson") v WHERE v->>'lineId'=l.id::text
   AND v->>'designId'=l."designId"::text AND (v->>'quantity')::integer=l.quantity
   AND (v->>'unitPriceVnd')::numeric=5000 AND (v->>'lineTotalVnd')::numeric=l.quantity*5000) THEN
   RAISE EXCEPTION 'print commercial amount conflicts' USING ERRCODE='23514'; END IF;
  actual_total:=actual_total+l.quantity*5000;
 END LOOP;
 IF actual_count=0 OR actual_count<>expected_count OR actual_count<>jsonb_array_length(c."linesJson") OR c."orderTotalVnd"<>actual_total THEN
  RAISE EXCEPTION 'print allocation count or total conflicts' USING ERRCODE='23514'; END IF;
 IF charge_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "BillingLedgerEntry" e
  JOIN "CommercialAppendixRevision" ca ON ca.id=e."sourceRevisionId" AND ca."bookingId"=bid
  WHERE e.id=charge_id AND e."bookingId"=bid AND e."sourceType"='CONTRACT_APPENDIX' AND ca.state='APPROVED') THEN
  RAISE EXCEPTION 'print charge must reference approved appendix' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION appendix_print_committed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid; bid uuid; o "InvitationPrintOrder"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='InvitationPrintRequest' THEN oid:=NEW."orderId"; bid:=NEW."bookingId";
 ELSIF TG_TABLE_NAME='InvitationPrintOrder' THEN oid:=NEW.id; bid:=NEW."bookingId";
 ELSIF TG_OP='DELETE' THEN oid:=OLD."orderId"; bid:=OLD."bookingId";
 ELSE oid:=NEW."orderId"; bid:=NEW."bookingId"; END IF;
 IF oid IS NULL OR NOT EXISTS(SELECT 1 FROM "InvitationPrintRequest" WHERE "orderId"=oid AND "bookingId"=bid) THEN RETURN NULL; END IF;
 SELECT * INTO STRICT o FROM "InvitationPrintOrder" WHERE id=oid AND "bookingId"=bid;
 IF o.status IN ('REQUESTED','QUOTED') THEN RAISE EXCEPTION 'print request cannot expose an unapproved production order' USING ERRCODE='23514'; END IF;
 PERFORM appendix_print_validate_order(oid,bid,o.status,o."currentCommercialRevisionId",o."receivableChargeId");
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER appendix_print_committed_guard AFTER INSERT OR UPDATE ON "InvitationPrintRequest"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION appendix_print_committed_guard();
CREATE CONSTRAINT TRIGGER appendix_print_committed_guard AFTER INSERT OR UPDATE ON "InvitationPrintOrder"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION appendix_print_committed_guard();
CREATE CONSTRAINT TRIGGER appendix_print_committed_guard AFTER INSERT OR UPDATE OR DELETE ON "InvitationPrintLine"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION appendix_print_committed_guard();

-- Extend the existing allocation trigger without changing any legacy catalogue,
-- contracted-copy, paid-history or ledger validation path.
DO $$
DECLARE definition text; insertion text;
BEGIN
 definition:=pg_get_functiondef('contracted_print_guard()'::regprocedure);
 insertion:=$branch$
 IF TG_TABLE_NAME='InvitationPrintOrder' AND EXISTS(SELECT 1 FROM "InvitationPrintRequest" WHERE "orderId"=NEW.id AND "bookingId"=bid) THEN
  IF TG_OP='UPDATE' AND OLD.status IN ('IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER')
    AND NEW."currentCommercialRevisionId" IS DISTINCT FROM OLD."currentCommercialRevisionId" THEN
   RAISE EXCEPTION 'produced print history is immutable' USING ERRCODE='23514'; END IF;
  PERFORM appendix_print_validate_order(NEW.id,bid,NEW.status,NEW."currentCommercialRevisionId",NEW."receivableChargeId");
  RETURN NEW;
 END IF;
$branch$;
 IF position('bid:=NEW."bookingId";' IN definition)=0 THEN RAISE EXCEPTION 'unexpected contracted print guard'; END IF;
 EXECUTE replace(definition,'bid:=NEW."bookingId";','bid:=NEW."bookingId";'||insertion);
END $$;
