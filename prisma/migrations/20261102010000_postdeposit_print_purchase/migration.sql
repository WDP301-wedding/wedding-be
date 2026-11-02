BEGIN;
CREATE TABLE "InvitationPrintPurchaseQuote" (
  "id" uuid PRIMARY KEY, "bookingId" uuid NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
  "actorId" uuid NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT,
  "document" jsonb NOT NULL, "digest" text NOT NULL,
  "expiresAt" timestamptz(6) NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX "InvitationPrintPurchaseQuote_bookingId_createdAt_idx" ON "InvitationPrintPurchaseQuote"("bookingId", "createdAt");
CREATE TABLE "InvitationPrintPurchase" (
  "orderId" uuid PRIMARY KEY REFERENCES "InvitationPrintOrder"("id") ON DELETE RESTRICT,
  "bookingId" uuid NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
  "quoteId" uuid NOT NULL UNIQUE REFERENCES "InvitationPrintPurchaseQuote"("id") ON DELETE RESTRICT,
  "appendixRevisionId" uuid NOT NULL UNIQUE REFERENCES "CommercialAppendixRevision"("id") ON DELETE RESTRICT,
  "cancellationAppendixRevisionId" uuid UNIQUE REFERENCES "CommercialAppendixRevision"("id") ON DELETE RESTRICT,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX "InvitationPrintPurchase_bookingId_idx" ON "InvitationPrintPurchase"("bookingId");
-- Separate offerings preserve already allocated sources/prices on historical contracts.
DO $$
DECLARE old record; successor uuid;
BEGIN
 FOR old IN SELECT h."restaurantId",r.* FROM "PrintOffering" h
   JOIN "PrintOfferingRevision" r ON r."offeringId"=h.id AND r.revision=h.revision
   WHERE h.active AND r."unitPriceVnd"<>5000 FOR UPDATE OF h LOOP
   successor:=gen_random_uuid();
   INSERT INTO "PrintOffering" (id,"restaurantId",revision,active) VALUES (successor,old."restaurantId",1,true);
   INSERT INTO "PrintOfferingRevision" (id,"offeringId",revision,name,"printType",material,"templateId","templateVersionId","templateTitle","unitPriceVnd",active,"actorId","createdAt")
    VALUES (gen_random_uuid(),successor,1,old.name,old."printType",old.material,old."templateId",old."templateVersionId",old."templateTitle",5000,true,old."actorId",now());
   INSERT INTO "PrintOfferingRevision" (id,"offeringId",revision,name,"printType",material,"templateId","templateVersionId","templateTitle","unitPriceVnd",active,"actorId","createdAt")
    VALUES (gen_random_uuid(),old."offeringId",old.revision+1,old.name,old."printType",old.material,old."templateId",old."templateVersionId",old."templateTitle",old."unitPriceVnd",false,old."actorId",now());
   UPDATE "PrintOffering" SET active=false,revision=old.revision+1 WHERE id=old."offeringId";
 END LOOP;
END $$;
ALTER TABLE "InvitationCommercialRevision" ALTER COLUMN "estimatedHandoverAt" DROP NOT NULL;
CREATE OR REPLACE FUNCTION contracted_print_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
   WHERE d."id"=l."designId" AND d."bookingId"=bid AND r."sourceTemplateVersionId"::text=offered."templateVersionId"::text)
   AND NOT EXISTS(SELECT 1 FROM "InvitationPrintPurchase" p JOIN "InvitationPrintPurchaseQuote" q ON q.id=p."quoteId"
     JOIN "InvitationPrintableRevision" v ON v.id=l."printableRevisionId" AND v."bookingId"=bid
     WHERE p."orderId"=NEW.id AND p."bookingId"=bid AND q."bookingId"=bid
       AND q.document->>'printableRevisionId'=v.id::text AND q.document->>'contentDigest'=v."contentDigest"
       AND q.document->>'templateVersionId'=offered."templateVersionId"::text) THEN
   RAISE EXCEPTION 'contracted print template conflicts' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(p."quantity"),0) INTO quantity_used FROM "InvitationPrintLine" p JOIN "InvitationPrintOrder" o ON o."id"=p."orderId"
   WHERE p."bookingId"=bid AND p."commercialSource"->>'offeringId'=l."commercialSource"->>'offeringId'
   AND (o."id"=NEW."id" OR o."status" IN ('APPROVED','IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER'));
  IF quantity_used>quantity_agreed THEN RAISE EXCEPTION 'contracted print quantity exceeds agreement' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (NOT EXISTS(SELECT 1 FROM "InvitationPrintPurchase" WHERE "orderId"=NEW.id)
  AND NOT EXISTS(SELECT 1 FROM "BillingLedgerEntry" WHERE "id"=NEW."receivableChargeId" AND "bookingId"=bid AND "sourceType"='CONTRACT'))
  OR (EXISTS(SELECT 1 FROM "InvitationPrintPurchase" WHERE "orderId"=NEW.id)
  AND NOT EXISTS(SELECT 1 FROM "InvitationPrintPurchase" p JOIN "CommercialAppendixRevision" a ON a.id=p."appendixRevisionId"
    JOIN "BillingLedgerEntry" e ON e."sourceRevisionId"=a.id AND e."sourceType"='CONTRACT_APPENDIX' AND e."kind"='CHARGE'
    WHERE p."orderId"=NEW.id AND p."bookingId"=bid AND a."bookingId"=bid AND a.state='APPROVED'
      AND e.id=NEW."receivableChargeId" AND e."bookingId"=bid AND e."amountVnd"=a."deltaVnd")) THEN
  RAISE EXCEPTION 'contract fulfillment must reference original obligation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER print_purchase_quote_immutable BEFORE UPDATE OR DELETE ON "InvitationPrintPurchaseQuote"
 FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();

CREATE FUNCTION print_purchase_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q "InvitationPrintPurchaseQuote"%ROWTYPE; a "CommercialAppendixRevision"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'print purchase history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'cancellationAppendixRevisionId') IS DISTINCT FROM (to_jsonb(OLD)-'cancellationAppendixRevisionId')
   OR OLD."cancellationAppendixRevisionId" IS NOT NULL AND NEW."cancellationAppendixRevisionId" IS DISTINCT FROM OLD."cancellationAppendixRevisionId") THEN
   RAISE EXCEPTION 'print purchase source cannot change' USING ERRCODE='23514'; END IF;
 SELECT * INTO q FROM "InvitationPrintPurchaseQuote" WHERE id=NEW."quoteId" AND "bookingId"=NEW."bookingId";
 IF NOT FOUND THEN RAISE EXCEPTION 'print quote scope conflicts' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM "CommercialAppendixRevision" WHERE id=NEW."appendixRevisionId" AND "bookingId"=NEW."bookingId";
 IF NOT FOUND OR a."deltaVnd" IS DISTINCT FROM (q.document->'line'->>'lineTotalVnd')::numeric
   OR a."predecessorRevisionId"::text IS DISTINCT FROM q.document->>'predecessorRevisionId'
   OR NOT EXISTS(SELECT 1 FROM "CommercialAppendixApproval" WHERE "revisionId"=a.id AND party='COUPLE' AND "actorAccountId"=q."actorId" AND "documentDigest"=a."documentDigest") THEN
   RAISE EXCEPTION 'print appendix must retain exact customer consent' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "InvitationPrintOrder" WHERE id=NEW."orderId" AND "bookingId"=NEW."bookingId")
   OR (SELECT count(*) FROM "InvitationPrintLine" WHERE "orderId"=NEW."orderId")<>1
   OR NOT EXISTS(SELECT 1 FROM "InvitationPrintLine" l WHERE l."orderId"=NEW."orderId" AND l."bookingId"=NEW."bookingId"
      AND l."designId"::text=q.document->>'designId' AND l.quantity=(q.document->>'quantity')::integer
      AND l."printableRevisionId"::text=q.document->>'printableRevisionId'
      AND l."commercialSource"->>'agreementRevisionId'=a.id::text
      AND l."commercialSource"->>'offeringId'=q.document->>'offeringId'
      AND l."commercialSource"->>'sourceRevisionId'=q.document->>'sourceRevisionId') THEN
   RAISE EXCEPTION 'print order must retain quoted content and quantity' USING ERRCODE='23514'; END IF;
 IF NEW."cancellationAppendixRevisionId" IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM "CommercialAppendixRevision" c WHERE c.id=NEW."cancellationAppendixRevisionId" AND c."bookingId"=NEW."bookingId"
    AND c.state='APPROVED' AND c."deltaVnd"=-a."deltaVnd") THEN
   RAISE EXCEPTION 'print cancellation requires exact approved credit appendix' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER print_purchase_link_valid BEFORE INSERT OR UPDATE OR DELETE ON "InvitationPrintPurchase"
 FOR EACH ROW EXECUTE FUNCTION print_purchase_link_guard();
COMMIT;
