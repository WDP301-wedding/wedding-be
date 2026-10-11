BEGIN;
ALTER TABLE "InvitationPrintLine" ADD COLUMN "commercialSource" jsonb;
CREATE FUNCTION contracted_print_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; agreement_id uuid; agreed_lines jsonb; l record; offered "PrintOfferingRevision"%ROWTYPE; quantity_used bigint; quantity_agreed integer;
BEGIN
 bid:=NEW."bookingId";
 PERFORM pg_advisory_xact_lock(hashtext(bid::text));
 IF TG_TABLE_NAME='InvitationPrintLine' THEN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'printableRevisionId') IS DISTINCT FROM (to_jsonb(OLD)-'printableRevisionId') THEN
   RAISE EXCEPTION 'print line quantity and commercial allocation are immutable' USING ERRCODE='23514'; END IF;
  IF NEW."commercialSource" IS NOT NULL AND NOT (NEW."commercialSource" ?& ARRAY['agreementRevisionId','offeringId','sourceRevisionId','templateVersionId','material','printType','unitPriceVnd']) THEN
   RAISE EXCEPTION 'contracted print source snapshot is incomplete' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD."status" IN ('IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER')
  AND NEW."currentCommercialRevisionId" IS DISTINCT FROM OLD."currentCommercialRevisionId" THEN
  RAISE EXCEPTION 'produced print history is immutable' USING ERRCODE='23514'; END IF;
 IF NEW."status" NOT IN ('APPROVED','IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER') THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM "CommercialContract" WHERE "bookingId"=bid) THEN RETURN NEW; END IF;
 SELECT COALESCE(h."effectiveRevisionId",s."contractRevisionId") INTO agreement_id FROM "BookingDepositSettlement" s
  LEFT JOIN "CommercialAppendixHead" h ON h."bookingId"=s."bookingId" WHERE s."bookingId"=bid;
 SELECT "document"->'afterLines' INTO agreed_lines FROM "CommercialAppendixRevision" WHERE "id"=agreement_id AND "state"='APPROVED';
 IF agreed_lines IS NULL THEN SELECT "document"->'lines' INTO agreed_lines FROM "CommercialContractRevision" WHERE "id"=agreement_id AND "approvedAt" IS NOT NULL; END IF;
 FOR l IN SELECT * FROM "InvitationPrintLine" WHERE "orderId"=NEW."id" LOOP
  IF l."commercialSource" IS NULL THEN RAISE EXCEPTION 'full contract print requires commercial allocation' USING ERRCODE='23514'; END IF;
  SELECT (v->>'quantity')::integer INTO quantity_agreed FROM jsonb_array_elements(agreed_lines) v WHERE v->>'category'='PRINT'
   AND v->>'sourceId'=l."commercialSource"->>'offeringId' AND v->>'sourceRevisionId'=l."commercialSource"->>'sourceRevisionId';
  IF NOT FOUND THEN RAISE EXCEPTION 'contracted print source is stale' USING ERRCODE='23514'; END IF;
  SELECT * INTO offered FROM "PrintOfferingRevision" WHERE "id"=(l."commercialSource"->>'sourceRevisionId')::uuid AND "offeringId"=(l."commercialSource"->>'offeringId')::uuid;
  IF NOT FOUND OR offered."templateVersionId"::text IS DISTINCT FROM l."commercialSource"->>'templateVersionId'
   OR offered."material" IS DISTINCT FROM l."commercialSource"->>'material' OR offered."printType" IS DISTINCT FROM l."commercialSource"->>'printType'
   OR offered."unitPriceVnd" IS DISTINCT FROM (l."commercialSource"->>'unitPriceVnd')::numeric THEN
   RAISE EXCEPTION 'contracted print material snapshot conflicts' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "InvitationDesign" d JOIN "InvitationDesignRevision" r ON r."id"=d."currentRevisionId"
   WHERE d."id"=l."designId" AND d."bookingId"=bid AND r."content"->>'templateVersionId'=offered."templateVersionId"::text) THEN
   RAISE EXCEPTION 'contracted print template conflicts' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(p."quantity"),0) INTO quantity_used FROM "InvitationPrintLine" p JOIN "InvitationPrintOrder" o ON o."id"=p."orderId"
   WHERE p."bookingId"=bid AND p."commercialSource"->>'offeringId'=l."commercialSource"->>'offeringId'
   AND (o."id"=NEW."id" OR o."status" IN ('APPROVED','IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER'));
  IF quantity_used>quantity_agreed THEN RAISE EXCEPTION 'contracted print quantity exceeds agreement' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM "BillingLedgerEntry" WHERE "id"=NEW."receivableChargeId" AND "bookingId"=bid AND "sourceType"='CONTRACT') THEN
  RAISE EXCEPTION 'contract fulfillment must reference original obligation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contracted_print_line_valid BEFORE INSERT OR UPDATE ON "InvitationPrintLine" FOR EACH ROW EXECUTE FUNCTION contracted_print_guard();
CREATE TRIGGER contracted_print_order_valid BEFORE INSERT OR UPDATE ON "InvitationPrintOrder" FOR EACH ROW EXECUTE FUNCTION contracted_print_guard();

CREATE FUNCTION appendix_print_obligations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record; agreed integer;
BEGIN
 IF NEW."state"<>'APPROVED' THEN RETURN NEW; END IF;
 FOR l IN SELECT p."commercialSource"->>'offeringId' AS offering_id, sum(p."quantity") AS used
  FROM "InvitationPrintLine" p JOIN "InvitationPrintOrder" o ON o."id"=p."orderId"
  WHERE p."bookingId"=NEW."bookingId" AND p."commercialSource" IS NOT NULL
   AND o."status" IN ('APPROVED','IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER') GROUP BY p."commercialSource"->>'offeringId' LOOP
  SELECT (v->>'quantity')::integer INTO agreed FROM jsonb_array_elements(NEW."document"->'afterLines') v
   WHERE v->>'category'='PRINT' AND v->>'sourceId'=l.offering_id;
  IF NOT FOUND OR agreed<l.used THEN RAISE EXCEPTION 'appendix cannot remove allocated print obligations' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_print_obligations_valid BEFORE UPDATE ON "CommercialAppendixRevision" FOR EACH ROW EXECUTE FUNCTION appendix_print_obligations_guard();
COMMIT;
