BEGIN;
-- CreateEnum
CREATE TYPE "CommercialContractState" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CommercialLineCategory" AS ENUM ('MENU', 'PRINT', 'SERVICE');


-- AlterTable
ALTER TABLE "BookingDepositIntent" ADD COLUMN     "contractRevisionId" UUID,
ADD COLUMN     "documentDigest" TEXT;

-- AlterTable
ALTER TABLE "BookingDepositSettlement" ADD COLUMN     "contractRevisionId" UUID,
ADD COLUMN     "documentDigest" TEXT;

-- AlterTable
ALTER TABLE "BillingPaymentAttempt" ADD COLUMN     "contractRevisionId" UUID,
ADD COLUMN     "documentDigest" TEXT;

-- CreateTable
CREATE TABLE "CommercialContract" (
    "bookingId" UUID NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'FULL_CONTRACT_V1',
    "currentRevisionId" UUID,

    CONSTRAINT "CommercialContract_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "CommercialContractRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "predecessorRevisionId" UUID,
    "timelineRevisionId" UUID NOT NULL,
    "state" "CommercialContractState" NOT NULL DEFAULT 'DRAFT',
    "document" JSONB NOT NULL,
    "documentDigest" TEXT NOT NULL,
    "contractTotalVnd" DECIMAL(18,0) NOT NULL,
    "depositAmountVnd" DECIMAL(18,0) NOT NULL,
    "createdByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "submittedAt" TIMESTAMPTZ(6),
    "approvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "CommercialContractRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialContractLine" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "category" "CommercialLineCategory" NOT NULL,
    "sourceId" UUID NOT NULL,
    "sourceRevisionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceVnd" DECIMAL(18,0) NOT NULL,
    "lineTotalVnd" DECIMAL(18,0) NOT NULL,

    CONSTRAINT "CommercialContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialContractApproval" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "party" "BookingTimelineParty" NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "documentDigest" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CommercialContractApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialContractPdf" (
    "revisionId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CommercialContractPdf_pkey" PRIMARY KEY ("revisionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialContract_currentRevisionId_key" ON "CommercialContract"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialContractRevision_bookingId_revisionNumber_key" ON "CommercialContractRevision"("bookingId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialContractRevision_id_bookingId_key" ON "CommercialContractRevision"("id", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialContractLine_revisionId_displayOrder_key" ON "CommercialContractLine"("revisionId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialContractLine_revisionId_category_sourceId_key" ON "CommercialContractLine"("revisionId", "category", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialContractApproval_revisionId_party_key" ON "CommercialContractApproval"("revisionId", "party");

-- AddForeignKey
ALTER TABLE "CommercialContract" ADD CONSTRAINT "CommercialContract_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialContract" ADD CONSTRAINT "CommercialContract_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "CommercialContractRevision"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommercialContractRevision" ADD CONSTRAINT "CommercialContractRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "CommercialContract"("bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialContractLine" ADD CONSTRAINT "CommercialContractLine_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CommercialContractRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialContractApproval" ADD CONSTRAINT "CommercialContractApproval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CommercialContractRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialContractPdf" ADD CONSTRAINT "CommercialContractPdf_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CommercialContractRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Contract source is added in the preceding migration so PostgreSQL can use it
-- safely inside this transaction. Historical migrations remain untouched.


ALTER TABLE "CommercialContract" ADD CONSTRAINT "CommercialContract_model_check"
  CHECK ("modelVersion" = 'FULL_CONTRACT_V1');
ALTER TABLE "CommercialContractRevision" ADD CONSTRAINT "CommercialContractRevision_amount_check" CHECK (
  "revisionNumber" > 0 AND "contractTotalVnd" BETWEEN 1 AND 9007199254740991
  AND "depositAmountVnd" = ceil("contractTotalVnd" * 30 / 100)
  AND "documentDigest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("document") = 'object'
  AND "document"->>'modelVersion' = 'FULL_CONTRACT_V1'
  AND "document"->>'bookingId' = "bookingId"::text
  AND "document"->>'timelineRevisionId' = "timelineRevisionId"::text
  AND ("document"->>'contractTotalVnd')::numeric = "contractTotalVnd"
  AND ("document"->>'depositAmountVnd')::numeric = "depositAmountVnd"
);
ALTER TABLE "CommercialContractLine" ADD CONSTRAINT "CommercialContractLine_value_check" CHECK (
  "displayOrder" >= 0 AND "quantity" BETWEEN 1 AND 10000
  AND "unitPriceVnd" BETWEEN 0 AND 9007199254740991
  AND "lineTotalVnd" = "quantity"::numeric * "unitPriceVnd"
  AND "lineTotalVnd" <= 9007199254740991
  AND char_length(btrim("name")) BETWEEN 1 AND 120
  AND char_length("description") <= 2400 AND char_length(btrim("unit")) BETWEEN 1 AND 80
);
ALTER TABLE "CommercialContractRevision" ADD CONSTRAINT "CommercialContractRevision_predecessor_fkey"
 FOREIGN KEY ("predecessorRevisionId", "bookingId") REFERENCES "CommercialContractRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "CommercialContractRevision" ADD CONSTRAINT "CommercialContractRevision_timeline_fkey"
 FOREIGN KEY ("timelineRevisionId") REFERENCES "BookingTimelineRevision"("id") ON DELETE RESTRICT;
ALTER TABLE "CommercialContract" ADD CONSTRAINT "CommercialContract_current_scope_fkey"
 FOREIGN KEY ("currentRevisionId", "bookingId") REFERENCES "CommercialContractRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "CommercialContractApproval" ADD CONSTRAINT "CommercialContractApproval_distinct_actor_key"
 UNIQUE ("revisionId", "actorAccountId");
ALTER TABLE "CommercialContractPdf" ADD CONSTRAINT "CommercialContractPdf_content_check" CHECK (
  octet_length("bytes") BETWEEN 1 AND 8388608 AND "sha256" = encode(sha256("bytes"), 'hex')
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['BookingDepositIntent','BookingDepositSettlement','BillingPaymentAttempt'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (("contractRevisionId" IS NULL AND "documentDigest" IS NULL) OR ("contractRevisionId" IS NOT NULL AND "documentDigest" IS NOT NULL AND "documentDigest" ~ ''^[a-f0-9]{64}$''))', t, t || '_commercial_pair_check');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("contractRevisionId","bookingId") REFERENCES "CommercialContractRevision"("id","bookingId") ON DELETE RESTRICT', t, t || '_commercial_scope_fkey');
 END LOOP;
END $$;
ALTER TABLE "BillingPaymentAttempt" ADD CONSTRAINT "BillingPaymentAttempt_contract_purpose_check"
 CHECK ("contractRevisionId" IS NULL OR "purpose" = 'DEPOSIT');

CREATE FUNCTION commercial_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(COALESCE(NEW."bookingId",OLD."bookingId")::text));
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'commercial history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP = 'UPDATE' AND (NEW."bookingId" <> OLD."bookingId" OR NEW."modelVersion" <> OLD."modelVersion") THEN
  RAISE EXCEPTION 'commercial model is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW."currentRevisionId" IS DISTINCT FROM OLD."currentRevisionId" AND (
  NOT EXISTS(SELECT 1 FROM "Booking" WHERE "id"=NEW."bookingId" AND "phase"='DRAFT')
  OR EXISTS(SELECT 1 FROM "BookingDepositIntent" WHERE "bookingId"=NEW."bookingId" AND "status" IN ('ACTIVE','UNKNOWN','SETTLED'))
  OR EXISTS(SELECT 1 FROM "BookingDepositSettlement" WHERE "bookingId"=NEW."bookingId")
 ) THEN RAISE EXCEPTION 'monetary evidence pins commercial head' USING ERRCODE='23514'; END IF;
 IF TG_OP = 'INSERT' AND (
  EXISTS(SELECT 1 FROM "BillingLedgerEntry" WHERE "bookingId"=NEW."bookingId" AND "sourceType" IN ('BASE_BOOKING','PRINT_ORDER','CONTRACT'))
  OR EXISTS(SELECT 1 FROM "BookingDepositSettlement" WHERE "bookingId"=NEW."bookingId")
  OR EXISTS(SELECT 1 FROM "BillingPaymentAttempt" WHERE "bookingId"=NEW."bookingId" AND "purpose"='DEPOSIT' AND "state" IN ('CREATED','PENDING','UNKNOWN','SUCCEEDED'))
 ) THEN RAISE EXCEPTION 'legacy monetary evidence blocks conversion' USING ERRCODE='23514'; END IF;
 IF NEW."currentRevisionId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "CommercialContractRevision" WHERE "id"=NEW."currentRevisionId" AND "bookingId"=NEW."bookingId" AND "state"<>'SUPERSEDED'
 ) THEN RAISE EXCEPTION 'current commercial revision conflicts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER commercial_head_valid BEFORE INSERT OR UPDATE OR DELETE ON "CommercialContract"
 FOR EACH ROW EXECUTE FUNCTION commercial_head_guard();

CREATE FUNCTION commercial_head_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "CommercialContract" h JOIN "CommercialContractRevision" r
  ON r."id"=h."currentRevisionId" AND r."bookingId"=h."bookingId"
  WHERE h."bookingId"=NEW."bookingId" AND r."state"<>'SUPERSEDED') THEN
  RAISE EXCEPTION 'commercial head requires its current revision at commit' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commercial_head_commit_valid AFTER INSERT OR UPDATE ON "CommercialContract"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commercial_head_commit_guard();

CREATE FUNCTION commercial_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor uuid; predecessor_number integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'commercial revisions cannot be deleted' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 IF NOT EXISTS(SELECT 1 FROM "Booking" WHERE "id"=NEW."bookingId" AND "phase"='DRAFT')
  OR EXISTS(SELECT 1 FROM "BookingDepositIntent" WHERE "bookingId"=NEW."bookingId" AND "status" IN ('ACTIVE','UNKNOWN','SETTLED')) THEN
  RAISE EXCEPTION 'deposit pins commercial history' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "BookingTimelineRevision" WHERE "id"=NEW."timelineRevisionId" AND "bookingId"=NEW."bookingId") THEN
  RAISE EXCEPTION 'commercial timeline belongs to another booking' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT "currentRevisionId" INTO predecessor FROM "CommercialContract" WHERE "bookingId"=NEW."bookingId";
  SELECT "revisionNumber" INTO predecessor_number FROM "CommercialContractRevision" WHERE "id"=predecessor;
  IF NEW."state"<>'DRAFT' OR NEW."submittedAt" IS NOT NULL OR NEW."approvedAt" IS NOT NULL
   OR NEW."predecessorRevisionId" IS DISTINCT FROM predecessor
   OR NEW."revisionNumber"<>COALESCE(predecessor_number,0)+1 THEN
   RAISE EXCEPTION 'invalid commercial successor' USING ERRCODE='23514';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','submittedAt','approvedAt']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','submittedAt','approvedAt']) THEN
   RAISE EXCEPTION 'commercial document content is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."state"<>OLD."state" AND NOT (
   (OLD."state"='DRAFT' AND NEW."state" IN ('AWAITING_APPROVAL','SUPERSEDED')) OR
   (OLD."state"='AWAITING_APPROVAL' AND NEW."state" IN ('APPROVED','SUPERSEDED')) OR
   (OLD."state"='APPROVED' AND NEW."state"='SUPERSEDED')
  ) THEN RAISE EXCEPTION 'invalid commercial transition' USING ERRCODE='23514'; END IF;
  IF OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
   OR OLD."approvedAt" IS NOT NULL AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" THEN
   RAISE EXCEPTION 'commercial approval dates are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER commercial_revision_valid BEFORE INSERT OR UPDATE OR DELETE ON "CommercialContractRevision"
 FOR EACH ROW EXECUTE FUNCTION commercial_revision_guard();

CREATE FUNCTION commercial_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision "CommercialContractRevision"%ROWTYPE; consultation "Consultation"%ROWTYPE;
BEGIN
 SELECT * INTO revision FROM "CommercialContractRevision" WHERE "id"=NEW."revisionId";
 IF revision."state"<>'AWAITING_APPROVAL' OR NEW."documentDigest"<>revision."documentDigest"
  OR revision."document"->>'brideName' IS NULL OR revision."document"->>'groomName' IS NULL
  OR NOT EXISTS(SELECT 1 FROM "CommercialContract" WHERE "bookingId"=revision."bookingId" AND "currentRevisionId"=revision."id")
  OR NOT EXISTS(SELECT 1 FROM "Booking" WHERE "id"=revision."bookingId" AND "currentTimelineRevisionId"=revision."timelineRevisionId" AND "phase"='DRAFT') THEN
  RAISE EXCEPTION 'approval must bind current complete document' USING ERRCODE='23514';
 END IF;
 SELECT c.* INTO consultation FROM "Consultation" c JOIN "Booking" b ON b."consultationId"=c."id" WHERE b."id"=revision."bookingId";
 IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "id"=NEW."actorAccountId" AND "status"='ACTIVE') THEN
  RAISE EXCEPTION 'approval actor is inactive' USING ERRCODE='23514';
 END IF;
 IF NEW."party"='MANAGER' THEN
  IF NEW."actorAccountId"<>consultation."managerAccountId" OR NOT EXISTS(
   SELECT 1 FROM "AccountRole" WHERE "accountId"=NEW."actorAccountId" AND "role"='MANAGER'
  ) THEN RAISE EXCEPTION 'manager approval scope conflicts' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."actorAccountId"=consultation."managerAccountId" OR NOT EXISTS(
   SELECT 1 FROM "ConsultationAccess" WHERE "accountId"=NEW."actorAccountId" AND "consultationId"=consultation."id"
  ) THEN RAISE EXCEPTION 'couple approval scope conflicts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER commercial_approval_valid BEFORE INSERT ON "CommercialContractApproval"
 FOR EACH ROW EXECUTE FUNCTION commercial_approval_guard();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['CommercialContractLine','CommercialContractApproval','CommercialContractPdf'] LOOP
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact()',t);
 END LOOP;
END $$;

CREATE FUNCTION commercial_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; revision "CommercialContractRevision"%ROWTYPE; line_count integer; total numeric; tables numeric;
BEGIN
 rid := COALESCE(to_jsonb(NEW)->>'revisionId', to_jsonb(NEW)->>'id')::uuid;
 SELECT * INTO revision FROM "CommercialContractRevision" WHERE "id"=rid;
 SELECT count(*), sum("lineTotalVnd"), sum(CASE WHEN "category"='MENU' THEN "quantity" ELSE 0 END)
  INTO line_count,total,tables FROM "CommercialContractLine" WHERE "revisionId"=rid;
 IF line_count NOT BETWEEN 1 AND 50 OR total<>revision."contractTotalVnd" OR tables NOT BETWEEN 1 AND 500
  OR line_count<>jsonb_array_length(revision."document"->'lines')
  OR tables<>(revision."document"->>'tableCount')::numeric
  OR EXISTS(SELECT 1 FROM "CommercialContractLine" l WHERE l."revisionId"=rid AND
    (to_jsonb(l)-ARRAY['id','revisionId','displayOrder']) IS DISTINCT FROM revision."document"->'lines'->l."displayOrder") THEN
  RAISE EXCEPTION 'commercial line snapshot conflicts' USING ERRCODE='23514';
 END IF;
 IF revision."state" IN ('AWAITING_APPROVAL','APPROVED') AND (
  revision."submittedAt" IS NULL OR revision."document"->>'brideName' IS NULL OR revision."document"->>'groomName' IS NULL
 ) THEN RAISE EXCEPTION 'submitted contract needs names and submission date' USING ERRCODE='23514'; END IF;
 IF revision."state"='APPROVED' AND revision."approvedAt" IS NULL THEN
  RAISE EXCEPTION 'approved contract requires approval date' USING ERRCODE='23514';
 END IF;
 IF revision."approvedAt" IS NOT NULL AND (
   (SELECT count(*) FROM "CommercialContractApproval" WHERE "revisionId"=rid)<>2 OR
   NOT EXISTS(SELECT 1 FROM "CommercialContractPdf" WHERE "revisionId"=rid)
 ) THEN RAISE EXCEPTION 'approved contract requires dual decisions and retained PDF' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commercial_snapshot_valid AFTER INSERT OR UPDATE ON "CommercialContractRevision"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commercial_snapshot_guard();
CREATE CONSTRAINT TRIGGER commercial_line_snapshot_valid AFTER INSERT ON "CommercialContractLine"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commercial_snapshot_guard();

CREATE FUNCTION commercial_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision "CommercialContractRevision"%ROWTYPE; mutable_fields text[];
BEGIN
 IF TG_OP='UPDATE' THEN
  mutable_fields := CASE TG_TABLE_NAME
   WHEN 'BookingDepositIntent' THEN ARRAY['status','providerEvidenceId','releasedAt','settledAt','updatedAt']
   WHEN 'BookingDepositSettlement' THEN ARRAY['promotionStatus','promotedAt']
   ELSE ARRAY['state','terminalEvidenceId','updatedAt'] END;
  IF (to_jsonb(NEW)-mutable_fields) IS DISTINCT FROM (to_jsonb(OLD)-mutable_fields) THEN
   RAISE EXCEPTION 'deposit intent and settlement snapshot are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW."contractRevisionId" IS NULL THEN
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM "CommercialContract" WHERE "bookingId"=NEW."bookingId")
   AND (TG_TABLE_NAME<>'BillingPaymentAttempt' OR to_jsonb(NEW)->>'purpose'='DEPOSIT') THEN
   RAISE EXCEPTION 'full-contract deposit needs exact commercial identity' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO revision FROM "CommercialContractRevision" WHERE "id"=NEW."contractRevisionId";
 IF revision."bookingId" IS DISTINCT FROM NEW."bookingId" OR revision."documentDigest" IS DISTINCT FROM NEW."documentDigest"
  OR revision."timelineRevisionId" IS DISTINCT FROM NEW."timelineRevisionId" OR revision."depositAmountVnd" IS DISTINCT FROM NEW."amountVnd"
  OR revision."approvedAt" IS NULL THEN
  RAISE EXCEPTION 'pinned commercial evidence conflicts' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM "CommercialContract" WHERE "bookingId"=NEW."bookingId" AND "currentRevisionId"=revision."id") THEN
  RAISE EXCEPTION 'cannot reserve superseded contract' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['BookingDepositIntent','BookingDepositSettlement','BillingPaymentAttempt'] LOOP
  EXECUTE format('CREATE TRIGGER commercial_pin_valid BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION commercial_pin_guard()',t);
 END LOOP;
END $$;

-- Keep the existing ledger guard/sequence/refund protections; widen CHARGE source only.
ALTER TABLE "BillingLedgerEntry" DROP CONSTRAINT "BillingLedgerEntry_fact_check";
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_fact_check" CHECK (
 "amountVnd" BETWEEN 1 AND 9007199254740991 AND "revision">0
 AND ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500)
 AND ("evidenceReference" IS NULL OR char_length(btrim("evidenceReference")) BETWEEN 1 AND 120)
 AND (
 ("kind"='CHARGE' AND "sourceType" IN ('BASE_BOOKING','PRINT_ORDER','CONTRACT') AND "sourceEntryId" IS NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL)
 OR ("kind"='PAYMENT' AND "sourceType"='PAYMENT_ATTEMPT' AND "paymentAttemptId" IS NOT NULL AND "sourceRevisionId"="paymentAttemptId" AND "sourceEntryId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL)
 OR ("kind"='CREDIT_ADJUSTMENT' AND "sourceType"='PRINT_CREDIT' AND "sourceEntryId" IS NOT NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL AND "reason" IS NOT NULL AND "reason" IN ('PRINT_CANCELLED','PRINT_REPLACED'))
 OR ("kind"='REFUND' AND "sourceType"='MANUAL_REFUND' AND "sourceEntryId" IS NOT NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NOT NULL AND "approvedRefundableVnd" IS NOT NULL AND "approvedRefundableVnd" BETWEEN 1 AND 9007199254740991 AND "reason" IS NOT NULL AND "evidenceReference" IS NOT NULL)
 )
);
CREATE UNIQUE INDEX "BillingLedgerEntry_one_contract_obligation_key" ON "BillingLedgerEntry"("bookingId") WHERE "sourceType"='CONTRACT';
CREATE FUNCTION billing_contract_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision "CommercialContractRevision"%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 IF NEW."sourceType" IN ('BASE_BOOKING','PRINT_ORDER') AND EXISTS(SELECT 1 FROM "CommercialContract" WHERE "bookingId"=NEW."bookingId") THEN
  RAISE EXCEPTION 'full contract includes menu service and print; no legacy charge' USING ERRCODE='23514';
 END IF;
 IF NEW."sourceType"='CONTRACT' THEN
  SELECT * INTO revision FROM "CommercialContractRevision" WHERE "id"=NEW."sourceRevisionId" AND "bookingId"=NEW."bookingId";
  IF NOT FOUND OR revision."approvedAt" IS NULL OR NEW."amountVnd"<>revision."contractTotalVnd" OR NEW."occurredAt"<>revision."approvedAt"
   OR EXISTS(SELECT 1 FROM "BillingLedgerEntry" WHERE "bookingId"=NEW."bookingId" AND "sourceType" IN ('BASE_BOOKING','PRINT_ORDER','CONTRACT')) THEN
   RAISE EXCEPTION 'contract obligation source conflicts' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_contract_source_valid BEFORE INSERT ON "BillingLedgerEntry"
 FOR EACH ROW EXECUTE FUNCTION billing_contract_source_guard();
COMMIT;
