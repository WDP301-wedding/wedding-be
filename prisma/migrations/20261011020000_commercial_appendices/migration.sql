BEGIN;
-- CreateTable
CREATE TABLE "CommercialAppendixHead" (
    "bookingId" UUID NOT NULL,
    "currentRevisionId" UUID,
    "effectiveRevisionId" UUID,

    CONSTRAINT "CommercialAppendixHead_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "CommercialAppendixRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "predecessorRevisionId" UUID NOT NULL,
    "contractRevisionId" UUID NOT NULL,
    "state" "CommercialContractState" NOT NULL DEFAULT 'DRAFT',
    "document" JSONB NOT NULL,
    "documentDigest" TEXT NOT NULL,
    "deltaVnd" DECIMAL(18,0) NOT NULL,
    "effectiveTotalVnd" DECIMAL(18,0) NOT NULL,
    "createdByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "submittedAt" TIMESTAMPTZ(6),
    "approvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "CommercialAppendixRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialAppendixApproval" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "party" "BookingTimelineParty" NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "documentDigest" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CommercialAppendixApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAppendixHead_currentRevisionId_key" ON "CommercialAppendixHead"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAppendixHead_effectiveRevisionId_key" ON "CommercialAppendixHead"("effectiveRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAppendixRevision_bookingId_revisionNumber_key" ON "CommercialAppendixRevision"("bookingId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAppendixRevision_id_bookingId_key" ON "CommercialAppendixRevision"("id", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAppendixApproval_revisionId_party_key" ON "CommercialAppendixApproval"("revisionId", "party");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAppendixApproval_revisionId_actorAccountId_key" ON "CommercialAppendixApproval"("revisionId", "actorAccountId");

-- AddForeignKey
ALTER TABLE "CommercialAppendixHead" ADD CONSTRAINT "CommercialAppendixHead_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialAppendixHead" ADD CONSTRAINT "CommercialAppendixHead_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "CommercialAppendixRevision"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommercialAppendixHead" ADD CONSTRAINT "CommercialAppendixHead_effectiveRevisionId_fkey" FOREIGN KEY ("effectiveRevisionId") REFERENCES "CommercialAppendixRevision"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommercialAppendixRevision" ADD CONSTRAINT "CommercialAppendixRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "CommercialAppendixHead"("bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialAppendixApproval" ADD CONSTRAINT "CommercialAppendixApproval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CommercialAppendixRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "CommercialAppendixHead" ADD CONSTRAINT "CommercialAppendixHead_current_scope"
 FOREIGN KEY ("currentRevisionId","bookingId") REFERENCES "CommercialAppendixRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "CommercialAppendixHead" ADD CONSTRAINT "CommercialAppendixHead_effective_scope"
 FOREIGN KEY ("effectiveRevisionId","bookingId") REFERENCES "CommercialAppendixRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "CommercialAppendixRevision" ADD CONSTRAINT "CommercialAppendixRevision_contract_scope"
 FOREIGN KEY ("contractRevisionId","bookingId") REFERENCES "CommercialContractRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "CommercialAppendixRevision" ADD CHECK (
 "revisionNumber">0 AND "documentDigest" ~ '^[a-f0-9]{64}$'
 AND "deltaVnd" BETWEEN -9007199254740991 AND 9007199254740991
 AND "effectiveTotalVnd" BETWEEN 0 AND 9007199254740991
 AND jsonb_typeof("document")='object'
 AND "document"->>'bookingId'="bookingId"::text
 AND "document"->>'contractRevisionId'="contractRevisionId"::text
 AND "document"->>'predecessorRevisionId'="predecessorRevisionId"::text
 AND char_length(btrim("document"->>'reason')) BETWEEN 1 AND 500
 AND ("document"->>'deltaVnd')::numeric="deltaVnd"
 AND ("document"->>'afterTotalVnd')::numeric="effectiveTotalVnd"
);
CREATE TRIGGER appendix_approval_immutable BEFORE UPDATE OR DELETE ON "CommercialAppendixApproval"
 FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();

CREATE FUNCTION appendix_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "CommercialContractRevision"%ROWTYPE; prior "CommercialAppendixRevision"%ROWTYPE;
 effective_id uuid; before_lines jsonb; before_total numeric; after_total numeric; tables numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'appendix history is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 IF NOT EXISTS(SELECT 1 FROM "Booking" WHERE "id"=NEW."bookingId" AND "phase" IN ('CONFIRMED','COMPLETED'))
  OR EXISTS(SELECT 1 FROM "BillingPaymentAttempt" a WHERE a."bookingId"=NEW."bookingId" AND
   (a."state" IN ('CREATED','PENDING','UNKNOWN') OR a."state"='SUCCEEDED' AND NOT EXISTS(
     SELECT 1 FROM "BillingLedgerEntry" e WHERE e."paymentAttemptId"=a."id"))) THEN
  RAISE EXCEPTION 'appendix booking or payment pin conflicts' USING ERRCODE='23514'; END IF;
 SELECT r.* INTO original FROM "CommercialContractRevision" r JOIN "BookingDepositSettlement" s
  ON s."contractRevisionId"=r."id" AND s."bookingId"=r."bookingId"
  WHERE r."id"=NEW."contractRevisionId" AND r."bookingId"=NEW."bookingId";
 IF NOT FOUND OR original."approvedAt" IS NULL THEN
  RAISE EXCEPTION 'appendix requires settled full contract' USING ERRCODE='23514'; END IF;
 IF NEW."document"->>'brideName' IS DISTINCT FROM original."document"->>'brideName'
  OR NEW."document"->>'groomName' IS DISTINCT FROM original."document"->>'groomName' THEN
  RAISE EXCEPTION 'appendix must retain original parties' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','submittedAt','approvedAt']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','submittedAt','approvedAt'])
   OR OLD."state" IN ('APPROVED','SUPERSEDED')
   OR (OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt")
   OR NOT ((OLD."state"=NEW."state") OR (OLD."state"='DRAFT' AND NEW."state" IN ('AWAITING_APPROVAL','SUPERSEDED'))
     OR (OLD."state"='AWAITING_APPROVAL' AND NEW."state" IN ('APPROVED','SUPERSEDED'))) THEN
   RAISE EXCEPTION 'appendix content or transition is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."state"<>'DRAFT' OR NEW."submittedAt" IS NOT NULL OR NEW."approvedAt" IS NOT NULL THEN
   RAISE EXCEPTION 'appendix starts as unapproved draft' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."state"='SUPERSEDED' THEN RETURN NEW; END IF;
 SELECT "effectiveRevisionId" INTO effective_id FROM "CommercialAppendixHead" WHERE "bookingId"=NEW."bookingId";
 IF NEW."predecessorRevisionId" IS DISTINCT FROM COALESCE(effective_id,original."id") THEN
  RAISE EXCEPTION 'appendix predecessor is stale' USING ERRCODE='23514'; END IF;
 IF effective_id IS NULL THEN before_lines:=original."document"->'lines'; before_total:=original."contractTotalVnd";
 ELSE
  SELECT * INTO prior FROM "CommercialAppendixRevision" WHERE "id"=effective_id AND "state"='APPROVED';
  before_lines:=prior."document"->'afterLines'; before_total:=prior."effectiveTotalVnd";
 END IF;
 IF NEW."document"->'beforeLines' IS DISTINCT FROM before_lines
  OR (NEW."document"->>'beforeTotalVnd')::numeric IS DISTINCT FROM before_total
  OR jsonb_array_length(NEW."document"->'afterLines') NOT BETWEEN 1 AND 50
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."document"->'afterLines') l
    WHERE (l->>'quantity')::numeric NOT BETWEEN 1 AND 10000
    OR (l->>'unitPriceVnd')::numeric NOT BETWEEN 0 AND 9007199254740991
    OR (l->>'lineTotalVnd')::numeric IS DISTINCT FROM (l->>'quantity')::numeric*(l->>'unitPriceVnd')::numeric)
 THEN RAISE EXCEPTION 'appendix lines conflict' USING ERRCODE='23514'; END IF;
 SELECT sum((l->>'lineTotalVnd')::numeric),sum(CASE WHEN l->>'category'='MENU' THEN (l->>'quantity')::numeric ELSE 0 END)
  INTO after_total,tables FROM jsonb_array_elements(NEW."document"->'afterLines') l;
 IF after_total IS DISTINCT FROM NEW."effectiveTotalVnd" OR NEW."deltaVnd"<>after_total-before_total
  OR tables NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'appendix totals conflict' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_revision_valid BEFORE INSERT OR UPDATE OR DELETE ON "CommercialAppendixRevision"
 FOR EACH ROW EXECUTE FUNCTION appendix_revision_guard();

CREATE FUNCTION appendix_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision "CommercialAppendixRevision"%ROWTYPE; consultation "Consultation"%ROWTYPE;
BEGIN
 SELECT * INTO revision FROM "CommercialAppendixRevision" WHERE "id"=NEW."revisionId";
 PERFORM pg_advisory_xact_lock(hashtext(revision."bookingId"::text));
 IF revision."state"<>'AWAITING_APPROVAL' OR NEW."documentDigest"<>revision."documentDigest"
  OR NOT EXISTS(SELECT 1 FROM "CommercialAppendixHead" WHERE "bookingId"=revision."bookingId" AND "currentRevisionId"=revision."id")
  OR NOT EXISTS(SELECT 1 FROM "Account" WHERE "id"=NEW."actorAccountId" AND "status"='ACTIVE') THEN
  RAISE EXCEPTION 'appendix approval requires current submitted revision and active actor' USING ERRCODE='23514'; END IF;
 SELECT c.* INTO consultation FROM "Consultation" c JOIN "Booking" b ON b."consultationId"=c."id" WHERE b."id"=revision."bookingId";
 IF NEW."party"='MANAGER' THEN
  IF NEW."actorAccountId"<>consultation."managerAccountId" OR NOT EXISTS(
   SELECT 1 FROM "AccountRole" WHERE "accountId"=NEW."actorAccountId" AND "role"='MANAGER') THEN
   RAISE EXCEPTION 'appendix manager scope conflicts' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."actorAccountId"=consultation."managerAccountId" OR NOT EXISTS(
   SELECT 1 FROM "ConsultationAccess" WHERE "accountId"=NEW."actorAccountId" AND "consultationId"=consultation."id" AND "level"='FULL') THEN
   RAISE EXCEPTION 'appendix couple scope conflicts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appendix_approval_valid BEFORE INSERT ON "CommercialAppendixApproval"
 FOR EACH ROW EXECUTE FUNCTION appendix_approval_guard();

CREATE FUNCTION appendix_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; revision "CommercialAppendixRevision"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='CommercialAppendixHead' THEN
  IF NEW."effectiveRevisionId" IS NULL THEN RETURN NEW; END IF;
  rid:=NEW."effectiveRevisionId";
 ELSE rid:=NEW."id"; END IF;
 SELECT * INTO revision FROM "CommercialAppendixRevision" WHERE "id"=rid;
 IF revision."state"='APPROVED' THEN
  IF revision."submittedAt" IS NULL OR revision."approvedAt" IS NULL
   OR (SELECT count(*) FROM "CommercialAppendixApproval" WHERE "revisionId"=rid)<>2
   OR (revision."deltaVnd"<>0 AND NOT EXISTS(SELECT 1 FROM "BillingLedgerEntry" WHERE
     "bookingId"=revision."bookingId" AND "sourceType"='CONTRACT_APPENDIX' AND "sourceRevisionId"=rid
     AND "amountVnd"=abs(revision."deltaVnd") AND "kind"=CASE WHEN revision."deltaVnd">0 THEN 'CHARGE'::"BillingLedgerKind" ELSE 'CREDIT_ADJUSTMENT'::"BillingLedgerKind" END)) THEN
   RAISE EXCEPTION 'approved appendix needs dual decisions and exact ledger delta' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='CommercialAppendixHead' THEN
  RAISE EXCEPTION 'effective appendix must be approved' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER appendix_revision_commit AFTER INSERT OR UPDATE ON "CommercialAppendixRevision"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION appendix_commit_guard();
CREATE CONSTRAINT TRIGGER appendix_head_commit AFTER INSERT OR UPDATE ON "CommercialAppendixHead"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION appendix_commit_guard();
COMMIT;
