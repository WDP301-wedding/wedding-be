BEGIN;
CREATE OR REPLACE FUNCTION billing_append_fact() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source "BillingLedgerEntry"%ROWTYPE;
  attempt "BillingPaymentAttempt"%ROWTYPE;
  already_applied NUMERIC;
  category_total NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
  INSERT INTO "BillingLedgerHead" ("bookingId") VALUES (NEW."bookingId") ON CONFLICT DO NOTHING;
  UPDATE "BillingLedgerHead" SET "revision" = "revision" + 1 WHERE "bookingId" = NEW."bookingId"
    RETURNING "revision" INTO NEW."revision";
  SELECT COALESCE(SUM("amountVnd"),0) INTO category_total FROM "BillingLedgerEntry"
    WHERE "bookingId" = NEW."bookingId" AND "kind" = NEW."kind";
  IF category_total + NEW."amountVnd" > 9007199254740991 THEN
    RAISE EXCEPTION 'billing aggregate exceeds safe VND' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'PAYMENT' THEN
    SELECT * INTO attempt FROM "BillingPaymentAttempt" WHERE "id" = NEW."paymentAttemptId" AND "bookingId" = NEW."bookingId";
    IF NOT FOUND OR attempt."state" <> 'SUCCEEDED' OR attempt."amountVnd" <> NEW."amountVnd"
      OR (attempt."provider" = 'MANUAL' AND (NEW."reason" IS NULL OR NEW."evidenceReference" IS NULL)) THEN
      RAISE EXCEPTION 'payment requires matching proven attempt evidence' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."kind" IN ('REFUND','CREDIT_ADJUSTMENT') AND NEW."sourceType" NOT IN ('CONTRACT_APPENDIX','INVOICE_ADJUSTMENT') THEN
    SELECT * INTO source FROM "BillingLedgerEntry" WHERE "id" = NEW."sourceEntryId" AND "bookingId" = NEW."bookingId";
    IF NOT FOUND OR (NEW."kind" = 'REFUND' AND source."kind" <> 'PAYMENT') OR
       (NEW."kind" = 'CREDIT_ADJUSTMENT' AND (source."kind" <> 'CHARGE' OR source."sourceType" <> 'PRINT_ORDER')) THEN
      RAISE EXCEPTION 'billing adjustment source does not match' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM("amountVnd"),0) INTO already_applied FROM "BillingLedgerEntry"
      WHERE "sourceEntryId" = source."id" AND "kind" = NEW."kind";
    IF already_applied + NEW."amountVnd" > source."amountVnd" THEN
      RAISE EXCEPTION 'billing adjustment exceeds source' USING ERRCODE = '23514';
    END IF;
    IF NEW."kind" = 'REFUND' THEN
      PERFORM pg_advisory_xact_lock(hashtext('billing-refund-decision:' || NEW."decisionId"::text));
      IF EXISTS (SELECT 1 FROM "BillingLedgerEntry" WHERE "decisionId" = NEW."decisionId"
        AND ("bookingId" <> NEW."bookingId" OR "approvedRefundableVnd" <> NEW."approvedRefundableVnd")) THEN
        RAISE EXCEPTION 'refund decision evidence conflicts' USING ERRCODE = '23514';
      END IF;
      SELECT COALESCE(SUM("amountVnd"),0) INTO already_applied FROM "BillingLedgerEntry" WHERE "decisionId" = NEW."decisionId";
      IF already_applied + NEW."amountVnd" > NEW."approvedRefundableVnd" THEN
        RAISE EXCEPTION 'refund exceeds approved decision' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER TABLE "BillingLedgerEntry" DROP CONSTRAINT "BillingLedgerEntry_fact_check";
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_fact_check" CHECK (
 "amountVnd" BETWEEN 1 AND 9007199254740991 AND "revision">0
 AND ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500)
 AND ("evidenceReference" IS NULL OR char_length(btrim("evidenceReference")) BETWEEN 1 AND 120)
 AND (
 ("kind"='CHARGE' AND "sourceType" IN ('BASE_BOOKING','PRINT_ORDER','CONTRACT','CONTRACT_APPENDIX','INCIDENTAL_FINALIZATION','INVOICE_ADJUSTMENT') AND "sourceEntryId" IS NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL)
 OR ("kind"='CREDIT_ADJUSTMENT' AND "sourceType" IN ('CONTRACT_APPENDIX','INVOICE_ADJUSTMENT') AND "sourceEntryId" IS NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL AND "reason" IS NOT NULL)
 OR ("kind"='PAYMENT' AND "sourceType"='PAYMENT_ATTEMPT' AND "paymentAttemptId" IS NOT NULL AND "sourceRevisionId"="paymentAttemptId" AND "sourceEntryId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL)
 OR ("kind"='CREDIT_ADJUSTMENT' AND "sourceType"='PRINT_CREDIT' AND "sourceEntryId" IS NOT NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL AND "reason" IS NOT NULL AND "reason" IN ('PRINT_CANCELLED','PRINT_REPLACED'))
 OR ("kind"='REFUND' AND "sourceType"='MANUAL_REFUND' AND "sourceEntryId" IS NOT NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NOT NULL AND "approvedRefundableVnd" IS NOT NULL AND "approvedRefundableVnd" BETWEEN 1 AND 9007199254740991 AND "reason" IS NOT NULL AND "evidenceReference" IS NOT NULL)
 )
);

CREATE FUNCTION billing_appendix_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "CommercialAppendixRevision"%ROWTYPE; balance numeric;
BEGIN
 IF NEW."sourceType"='CONTRACT_APPENDIX' THEN
  SELECT * INTO r FROM "CommercialAppendixRevision" WHERE "id"=NEW."sourceRevisionId" AND "bookingId"=NEW."bookingId";
  IF NOT FOUND OR r."state"<>'APPROVED' OR r."approvedAt" IS NULL
   OR NEW."amountVnd"<>abs(r."deltaVnd") OR NEW."occurredAt"<>r."approvedAt" OR NEW."reason" IS DISTINCT FROM r."document"->>'reason'
   OR NEW."kind"<>(CASE WHEN r."deltaVnd">0 THEN 'CHARGE'::"BillingLedgerKind" ELSE 'CREDIT_ADJUSTMENT'::"BillingLedgerKind" END)
   OR (SELECT count(*) FROM "CommercialAppendixApproval" WHERE "revisionId"=r."id" AND "documentDigest"=r."documentDigest")<>2 THEN
   RAISE EXCEPTION 'appendix obligation requires exact approved source' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."sourceType" IN ('CONTRACT_APPENDIX','INCIDENTAL_FINALIZATION','INVOICE_ADJUSTMENT') THEN
  SELECT COALESCE(sum(CASE WHEN "kind"='CHARGE' THEN "amountVnd" WHEN "kind"='CREDIT_ADJUSTMENT' THEN -"amountVnd" ELSE 0 END),0)
   INTO balance FROM "BillingLedgerEntry" WHERE "bookingId"=NEW."bookingId";
  balance:=balance+CASE WHEN NEW."kind"='CHARGE' THEN NEW."amountVnd" ELSE -NEW."amountVnd" END;
  IF balance NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'commercial obligation total is outside safe bounds' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_appendix_source_valid BEFORE INSERT ON "BillingLedgerEntry" FOR EACH ROW EXECUTE FUNCTION billing_appendix_source_guard();

CREATE FUNCTION appendix_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "CommercialAppendixRevision"%ROWTYPE; original_id uuid; latest integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'appendix head history cannot be removed' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 IF TG_OP='INSERT' AND (NEW."currentRevisionId" IS NOT NULL OR NEW."effectiveRevisionId" IS NOT NULL) THEN
  RAISE EXCEPTION 'appendix head must start empty' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW."bookingId"<>OLD."bookingId" OR (OLD."currentRevisionId" IS NOT NULL AND NEW."currentRevisionId" IS NULL) THEN
   RAISE EXCEPTION 'appendix head identity cannot be changed' USING ERRCODE='23514'; END IF;
  IF NEW."currentRevisionId" IS DISTINCT FROM OLD."currentRevisionId" THEN
   SELECT * INTO r FROM "CommercialAppendixRevision" WHERE "id"=NEW."currentRevisionId" AND "bookingId"=NEW."bookingId";
   SELECT max("revisionNumber") INTO latest FROM "CommercialAppendixRevision" WHERE "bookingId"=NEW."bookingId";
   IF r."state"<>'DRAFT' OR r."revisionNumber" IS DISTINCT FROM latest THEN
    RAISE EXCEPTION 'appendix current pointer requires latest draft' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW."effectiveRevisionId" IS DISTINCT FROM OLD."effectiveRevisionId" THEN
   SELECT "contractRevisionId" INTO original_id FROM "BookingDepositSettlement" WHERE "bookingId"=NEW."bookingId";
   SELECT * INTO r FROM "CommercialAppendixRevision" WHERE "id"=NEW."effectiveRevisionId" AND "bookingId"=NEW."bookingId";
   IF NOT FOUND OR r."state"<>'APPROVED' OR r."id" IS DISTINCT FROM NEW."currentRevisionId"
    OR r."predecessorRevisionId" IS DISTINCT FROM COALESCE(OLD."effectiveRevisionId",original_id) THEN
    RAISE EXCEPTION 'appendix effective pointer requires exact approved successor' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_head_valid BEFORE INSERT OR UPDATE OR DELETE ON "CommercialAppendixHead" FOR EACH ROW EXECUTE FUNCTION appendix_head_guard();
ALTER TABLE "CommercialAppendixRevision" ADD CHECK (
 "document" ?& ARRAY['bookingId','contractRevisionId','predecessorRevisionId','reason','beforeLines','afterLines','beforeTotalVnd','afterTotalVnd','deltaVnd','tableCount','brideName','groomName']
 AND jsonb_typeof("document"->'beforeLines')='array' AND jsonb_typeof("document"->'afterLines')='array'
 AND ("state" NOT IN ('AWAITING_APPROVAL','APPROVED') OR "submittedAt" IS NOT NULL)
 AND ("state"<>'APPROVED' OR "approvedAt" IS NOT NULL)
);
CREATE FUNCTION appendix_distinct_sources_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."document"->'afterLines') l GROUP BY l->>'category',l->>'sourceId' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."document"->'afterLines') l WHERE l->>'category' NOT IN ('MENU','PRINT','SERVICE')) THEN
  RAISE EXCEPTION 'appendix selections must be distinct known categories' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_distinct_sources_valid BEFORE INSERT ON "CommercialAppendixRevision" FOR EACH ROW EXECUTE FUNCTION appendix_distinct_sources_guard();
COMMIT;

