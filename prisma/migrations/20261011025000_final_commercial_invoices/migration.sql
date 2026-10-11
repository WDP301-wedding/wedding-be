BEGIN;
-- CreateTable
CREATE TABLE "IncidentalExpenseDraft" (
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IncidentalExpenseDraft_pkey" PRIMARY KEY ("bookingId")
);


-- CreateTable
CREATE TABLE "IncidentalExpenseLine" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPriceVnd" DECIMAL(18,0) NOT NULL,
    "totalVnd" DECIMAL(18,0) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "IncidentalExpenseLine_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "FinalInvoiceHead" (
    "bookingId" UUID NOT NULL,
    "currentRevisionId" UUID,

    CONSTRAINT "FinalInvoiceHead_pkey" PRIMARY KEY ("bookingId")
);


-- CreateTable
CREATE TABLE "FinalInvoiceRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "predecessorRevisionId" UUID,
    "invoiceNumber" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "documentDigest" TEXT NOT NULL,
    "totalVnd" DECIMAL(18,0) NOT NULL,
    "deltaVnd" DECIMAL(18,0) NOT NULL,
    "sourceBillingRevision" INTEGER NOT NULL,
    "issuedByAccountId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "FinalInvoiceRevision_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "IncidentalExpenseLine_bookingId_id_idx" ON "IncidentalExpenseLine"("bookingId", "id");


-- CreateIndex
CREATE UNIQUE INDEX "FinalInvoiceHead_currentRevisionId_key" ON "FinalInvoiceHead"("currentRevisionId");


-- CreateIndex
CREATE UNIQUE INDEX "FinalInvoiceRevision_invoiceNumber_key" ON "FinalInvoiceRevision"("invoiceNumber");


-- CreateIndex
CREATE UNIQUE INDEX "FinalInvoiceRevision_bookingId_revisionNumber_key" ON "FinalInvoiceRevision"("bookingId", "revisionNumber");


-- CreateIndex
CREATE UNIQUE INDEX "FinalInvoiceRevision_id_bookingId_key" ON "FinalInvoiceRevision"("id", "bookingId");


-- AddForeignKey
ALTER TABLE "IncidentalExpenseDraft" ADD CONSTRAINT "IncidentalExpenseDraft_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "IncidentalExpenseLine" ADD CONSTRAINT "IncidentalExpenseLine_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "IncidentalExpenseDraft"("bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "FinalInvoiceHead" ADD CONSTRAINT "FinalInvoiceHead_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "FinalInvoiceHead" ADD CONSTRAINT "FinalInvoiceHead_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "FinalInvoiceRevision"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "FinalInvoiceRevision" ADD CONSTRAINT "FinalInvoiceRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "FinalInvoiceHead"("bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinalInvoiceHead" ADD FOREIGN KEY ("currentRevisionId","bookingId") REFERENCES "FinalInvoiceRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "FinalInvoiceRevision" ADD FOREIGN KEY ("predecessorRevisionId","bookingId") REFERENCES "FinalInvoiceRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "IncidentalExpenseDraft" ADD CHECK ("revision">=0);
ALTER TABLE "IncidentalExpenseLine" ADD CHECK (char_length(btrim("name")) BETWEEN 1 AND 120 AND char_length(btrim("unit")) BETWEEN 1 AND 80
 AND "quantity">0 AND "unitPriceVnd" BETWEEN 0 AND 9007199254740991 AND "totalVnd"="quantity"::numeric*"unitPriceVnd" AND "totalVnd"<=9007199254740991
 AND ("note" IS NULL OR char_length(btrim("note")) BETWEEN 1 AND 2000));
ALTER TABLE "FinalInvoiceRevision" ADD CHECK ("revisionNumber">0 AND "sourceBillingRevision">0 AND "totalVnd" BETWEEN 0 AND 9007199254740991
 AND "deltaVnd" BETWEEN -9007199254740991 AND 9007199254740991 AND "documentDigest" ~ '^[a-f0-9]{64}$'
 AND "document" ?& ARRAY['modelVersion','bookingId','contract','appendices','effectiveCommercialRevisionId','commercialTotalVnd','expenseDraftRevision','incidentalLines','incidentalTotalVnd','adjustments','totalVnd']
 AND "document"->>'modelVersion'='FINAL_INVOICE_V1' AND "document"->>'bookingId'="bookingId"::text AND ("document"->>'totalVnd')::numeric="totalVnd");
CREATE TRIGGER final_invoice_immutable BEFORE UPDATE OR DELETE ON "FinalInvoiceRevision" FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();

CREATE FUNCTION require_financial_unpinned(bid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "BillingPaymentAttempt" a WHERE a."bookingId"=bid AND (a."state" IN ('CREATED','PENDING','UNKNOWN')
  OR a."state"='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM "BillingLedgerEntry" e WHERE e."paymentAttemptId"=a."id"))) THEN
  RAISE EXCEPTION 'unresolved payment pins monetary revisions' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION require_event_ended(bid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Booking" b JOIN "BookingProposalSnapshot" p ON p."bookingId"=b."id"
  WHERE b."id"=bid AND b."phase" IN ('CONFIRMED','COMPLETED') AND (b."eventDate"+p."shiftEndTime") AT TIME ZONE 'Asia/Ho_Chi_Minh'<=CURRENT_TIMESTAMP) THEN
  RAISE EXCEPTION 'commercial invoice requires authoritative event end' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION expense_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid;
BEGIN
 bid:=CASE WHEN TG_OP='DELETE' THEN OLD."bookingId" ELSE NEW."bookingId" END;
 PERFORM pg_advisory_xact_lock(hashtext(bid::text));
 PERFORM require_event_ended(bid);
 IF EXISTS(SELECT 1 FROM "FinalInvoiceHead" WHERE "bookingId"=bid AND "currentRevisionId" IS NOT NULL) THEN
  RAISE EXCEPTION 'finalized expenses are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."id"<>OLD."id" OR NEW."bookingId"<>OLD."bookingId" OR NEW."createdAt"<>OLD."createdAt") THEN
  RAISE EXCEPTION 'expense identity is immutable' USING ERRCODE='23514'; END IF;
 UPDATE "IncidentalExpenseDraft" SET "revision"="revision"+1 WHERE "bookingId"=bid;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_draft_valid BEFORE INSERT OR UPDATE OR DELETE ON "IncidentalExpenseLine" FOR EACH ROW EXECUTE FUNCTION expense_draft_guard();

CREATE FUNCTION appendix_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 IF EXISTS(SELECT 1 FROM "FinalInvoiceHead" WHERE "bookingId"=NEW."bookingId" AND "currentRevisionId" IS NOT NULL) THEN
  RAISE EXCEPTION 'finalized contract uses invoice adjustment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_invoice_valid BEFORE INSERT OR UPDATE ON "CommercialAppendixRevision" FOR EACH ROW EXECUTE FUNCTION appendix_invoice_guard();

CREATE FUNCTION final_invoice_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior "FinalInvoiceRevision"%ROWTYPE; current_id uuid; root "CommercialContractRevision"%ROWTYPE; effective_id uuid;
 agreed numeric; incidental numeric; draft_revision integer; expense_lines jsonb; appendix_lines jsonb; adjustment jsonb; delta numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 PERFORM require_event_ended(NEW."bookingId"); PERFORM require_financial_unpinned(NEW."bookingId");
 SELECT "currentRevisionId" INTO current_id FROM "FinalInvoiceHead" WHERE "bookingId"=NEW."bookingId";
 IF NEW."predecessorRevisionId" IS DISTINCT FROM current_id THEN RAISE EXCEPTION 'invoice predecessor is stale' USING ERRCODE='23514'; END IF;
 IF current_id IS NULL THEN
  SELECT r.* INTO root FROM "BookingDepositSettlement" s JOIN "CommercialContractRevision" r ON r."id"=s."contractRevisionId" WHERE s."bookingId"=NEW."bookingId";
  IF NOT FOUND OR NEW."document"->'contract' IS DISTINCT FROM jsonb_build_object('revisionId',root."id",'documentDigest',root."documentDigest",'document',root."document") THEN
   RAISE EXCEPTION 'invoice original contract conflicts' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(h."effectiveRevisionId",root."id") INTO effective_id FROM "CommercialAppendixHead" h WHERE h."bookingId"=NEW."bookingId";
  effective_id:=COALESCE(effective_id,root."id");
  SELECT COALESCE(jsonb_agg(jsonb_build_object('revisionId',r."id",'documentDigest',r."documentDigest",'document',r."document") ORDER BY r."revisionNumber"),'[]'::jsonb)
   INTO appendix_lines FROM "CommercialAppendixRevision" r WHERE r."bookingId"=NEW."bookingId" AND r."state"='APPROVED';
  SELECT COALESCE(sum("deltaVnd"),0)+root."contractTotalVnd" INTO agreed FROM "CommercialAppendixRevision" WHERE "bookingId"=NEW."bookingId" AND "state"='APPROVED';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l."id",'name',l."name",'quantity',l."quantity",'unit',l."unit",'unitPriceVnd',l."unitPriceVnd",'totalVnd',l."totalVnd",'note',l."note") ORDER BY l."id"),'[]'::jsonb),COALESCE(sum(l."totalVnd"),0)
   INTO expense_lines,incidental FROM "IncidentalExpenseLine" l WHERE l."bookingId"=NEW."bookingId";
  SELECT "revision" INTO draft_revision FROM "IncidentalExpenseDraft" WHERE "bookingId"=NEW."bookingId";
  IF NEW."revisionNumber"<>1 OR NEW."document"->'adjustments'<>'[]'::jsonb OR NEW."document"->'appendices' IS DISTINCT FROM appendix_lines
   OR NEW."document"->'incidentalLines' IS DISTINCT FROM expense_lines OR (NEW."document"->>'expenseDraftRevision')::integer IS DISTINCT FROM COALESCE(draft_revision,0)
   OR (NEW."document"->>'incidentalTotalVnd')::numeric IS DISTINCT FROM incidental OR (NEW."document"->>'commercialTotalVnd')::numeric IS DISTINCT FROM agreed
   OR NEW."document"->>'effectiveCommercialRevisionId' IS DISTINCT FROM effective_id::text OR NEW."deltaVnd"<>incidental OR NEW."totalVnd"<>agreed+incidental THEN
   RAISE EXCEPTION 'final invoice source snapshot conflicts' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO prior FROM "FinalInvoiceRevision" WHERE "id"=current_id AND "bookingId"=NEW."bookingId";
  adjustment:=NEW."document"->'adjustments'->-1;
  SELECT COALESCE(sum(CASE WHEN l->>'kind'='DEBIT' THEN (l->>'totalVnd')::numeric ELSE -(l->>'totalVnd')::numeric END),0) INTO delta FROM jsonb_array_elements(adjustment->'lines') l;
  IF NEW."revisionNumber"<>prior."revisionNumber"+1 OR (NEW."document"-ARRAY['adjustments','totalVnd']) IS DISTINCT FROM (prior."document"-ARRAY['adjustments','totalVnd'])
   OR (NEW."document"->'adjustments'-(jsonb_array_length(NEW."document"->'adjustments')-1)) IS DISTINCT FROM prior."document"->'adjustments'
   OR adjustment->>'id' IS DISTINCT FROM NEW."id"::text OR adjustment->>'predecessorRevisionId' IS DISTINCT FROM current_id::text
   OR adjustment->>'actorAccountId' IS DISTINCT FROM NEW."issuedByAccountId"::text OR (adjustment->>'occurredAt')::timestamptz IS DISTINCT FROM NEW."issuedAt"
   OR char_length(btrim(adjustment->>'reason')) NOT BETWEEN 1 AND 500 OR jsonb_array_length(adjustment->'lines') NOT BETWEEN 1 AND 50
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(adjustment->'lines') l WHERE l->>'kind' NOT IN ('DEBIT','CREDIT') OR (l->>'quantity')::numeric<1
      OR (l->>'unitPriceVnd')::numeric<0 OR (l->>'totalVnd')::numeric IS DISTINCT FROM (l->>'quantity')::numeric*(l->>'unitPriceVnd')::numeric)
   OR NEW."deltaVnd" IS DISTINCT FROM delta OR (adjustment->>'deltaVnd')::numeric IS DISTINCT FROM delta OR NEW."totalVnd"<>prior."totalVnd"+delta THEN
   RAISE EXCEPTION 'invoice adjustment successor conflicts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER final_invoice_insert_valid BEFORE INSERT ON "FinalInvoiceRevision" FOR EACH ROW EXECUTE FUNCTION final_invoice_insert_guard();

CREATE FUNCTION final_invoice_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE successor "FinalInvoiceRevision"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'invoice head history is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 IF TG_OP='INSERT' AND NEW."currentRevisionId" IS NOT NULL THEN RAISE EXCEPTION 'invoice head must start empty' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW."currentRevisionId" IS DISTINCT FROM OLD."currentRevisionId" THEN
  SELECT * INTO successor FROM "FinalInvoiceRevision" WHERE "id"=NEW."currentRevisionId" AND "bookingId"=NEW."bookingId";
  IF NOT FOUND OR successor."predecessorRevisionId" IS DISTINCT FROM OLD."currentRevisionId" THEN RAISE EXCEPTION 'invoice head must activate exact successor' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER final_invoice_head_valid BEFORE INSERT OR UPDATE OR DELETE ON "FinalInvoiceHead" FOR EACH ROW EXECUTE FUNCTION final_invoice_head_guard();

CREATE FUNCTION invoice_commercial_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "FinalInvoiceRevision"%ROWTYPE; reason text;
BEGIN
 IF NEW."sourceType" NOT IN ('INCIDENTAL_FINALIZATION','INVOICE_ADJUSTMENT') THEN RETURN NEW; END IF;
 SELECT * INTO r FROM "FinalInvoiceRevision" WHERE "id"=NEW."sourceRevisionId" AND "bookingId"=NEW."bookingId";
 reason:=CASE WHEN NEW."sourceType"='INVOICE_ADJUSTMENT' THEN r."document"->'adjustments'->-1->>'reason' ELSE NULL END;
 IF NOT FOUND OR r."deltaVnd"=0 OR NEW."amountVnd"<>abs(r."deltaVnd") OR NEW."occurredAt"<>r."issuedAt" OR NEW."reason" IS DISTINCT FROM reason
  OR NEW."kind"<>(CASE WHEN r."deltaVnd">0 THEN 'CHARGE'::"BillingLedgerKind" ELSE 'CREDIT_ADJUSTMENT'::"BillingLedgerKind" END)
  OR (NEW."sourceType"='INCIDENTAL_FINALIZATION') IS DISTINCT FROM (r."predecessorRevisionId" IS NULL) THEN
  RAISE EXCEPTION 'invoice ledger source conflicts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_commercial_source_valid BEFORE INSERT ON "BillingLedgerEntry" FOR EACH ROW EXECUTE FUNCTION invoice_commercial_source_guard();

CREATE FUNCTION final_invoice_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "FinalInvoiceRevision"%ROWTYPE; accepted numeric; source text; current_id uuid;
BEGIN
 SELECT * INTO r FROM "FinalInvoiceRevision" WHERE "id"=NEW."id";
 SELECT "currentRevisionId" INTO current_id FROM "FinalInvoiceHead" WHERE "bookingId"=r."bookingId";
 SELECT COALESCE(sum(CASE WHEN "kind"='CHARGE' THEN "amountVnd" WHEN "kind"='CREDIT_ADJUSTMENT' THEN -"amountVnd" ELSE 0 END),0) INTO accepted FROM "BillingLedgerEntry" WHERE "bookingId"=r."bookingId";
 source:=CASE WHEN r."predecessorRevisionId" IS NULL THEN 'INCIDENTAL_FINALIZATION' ELSE 'INVOICE_ADJUSTMENT' END;
 IF current_id IS DISTINCT FROM r."id" OR accepted IS DISTINCT FROM r."totalVnd" OR NOT EXISTS(SELECT 1 FROM "BillingLedgerHead" WHERE "bookingId"=r."bookingId" AND "revision"=r."sourceBillingRevision")
  OR r."deltaVnd"<>0 AND NOT EXISTS(SELECT 1 FROM "BillingLedgerEntry" WHERE "bookingId"=r."bookingId" AND "sourceType"::text=source AND "sourceRevisionId"=r."id" AND "amountVnd"=abs(r."deltaVnd")) THEN
  RAISE EXCEPTION 'invoice activation and ledger must commit together' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER final_invoice_commit AFTER INSERT ON "FinalInvoiceRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION final_invoice_commit_guard();
ALTER TABLE "BillingOutboxEvent" DROP CONSTRAINT "BillingOutboxEvent_envelope_check";
ALTER TABLE "BillingOutboxEvent" ADD CONSTRAINT "BillingOutboxEvent_envelope_check" CHECK (
 "eventVersion"=1 AND "aggregateRevision">0 AND "attemptCount">=0 AND "eventType" IN ('billing.payment-succeeded','billing.receivable-charge-accepted','billing.refund-recorded','billing.commercial-obligation-recorded','billing.final-invoice-issued') AND jsonb_typeof("payload")='object');
COMMIT;


