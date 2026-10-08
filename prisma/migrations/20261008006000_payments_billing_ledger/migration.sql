BEGIN;

-- CreateEnum
CREATE TYPE "BillingLedgerKind" AS ENUM ('CHARGE', 'PAYMENT', 'REFUND', 'CREDIT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BillingSourceType" AS ENUM ('BASE_BOOKING', 'PRINT_ORDER', 'PAYMENT_ATTEMPT', 'PRINT_CREDIT', 'MANUAL_REFUND');

-- CreateEnum
CREATE TYPE "BillingPaymentPurpose" AS ENUM ('DEPOSIT', 'BALANCE');

-- CreateEnum
CREATE TYPE "BillingPaymentProvider" AS ENUM ('VNPAY', 'MANUAL');

-- CreateEnum
CREATE TYPE "BillingAttemptState" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "BillingLedgerHead" (
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillingLedgerHead_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "BillingPaymentAttempt" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "purpose" "BillingPaymentPurpose" NOT NULL,
    "provider" "BillingPaymentProvider" NOT NULL,
    "amountVnd" DECIMAL(18,0) NOT NULL,
    "timelineRevisionId" UUID,
    "state" "BillingAttemptState" NOT NULL DEFAULT 'CREATED',
    "terminalEvidenceId" UUID,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BillingPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingLedgerEntry" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" "BillingLedgerKind" NOT NULL,
    "sourceType" "BillingSourceType" NOT NULL,
    "sourceRevisionId" UUID NOT NULL,
    "amountVnd" DECIMAL(18,0) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "sourceEntryId" UUID,
    "paymentAttemptId" UUID,
    "decisionId" UUID,
    "approvedRefundableVnd" DECIMAL(18,0),
    "reason" TEXT,
    "evidenceReference" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "sourceBillingRevision" INTEGER NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingOutboxEvent" (
    "id" UUID NOT NULL,
    "ledgerEntryId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "correlationId" UUID NOT NULL,
    "causationId" UUID,
    "aggregateId" UUID NOT NULL,
    "aggregateRevision" INTEGER NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMPTZ(6),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillingOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingPaymentAttempt_commandId_key" ON "BillingPaymentAttempt"("commandId");

-- CreateIndex
CREATE INDEX "BillingPaymentAttempt_state_expiresAt_idx" ON "BillingPaymentAttempt"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPaymentAttempt_id_bookingId_key" ON "BillingPaymentAttempt"("id", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPaymentAttempt_one_unresolved_key" ON "BillingPaymentAttempt"("bookingId", "purpose") WHERE ("state" IN ('CREATED', 'PENDING', 'UNKNOWN'));

-- CreateIndex
CREATE UNIQUE INDEX "BillingLedgerEntry_paymentAttemptId_key" ON "BillingLedgerEntry"("paymentAttemptId");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_bookingId_occurredAt_idx" ON "BillingLedgerEntry"("bookingId", "occurredAt");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_sourceEntryId_idx" ON "BillingLedgerEntry"("sourceEntryId");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_decisionId_idx" ON "BillingLedgerEntry"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLedgerEntry_id_bookingId_key" ON "BillingLedgerEntry"("id", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLedgerEntry_sourceType_sourceRevisionId_key" ON "BillingLedgerEntry"("sourceType", "sourceRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLedgerEntry_bookingId_revision_key" ON "BillingLedgerEntry"("bookingId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_invoiceNumber_key" ON "BillingInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "BillingInvoice_bookingId_issuedAt_idx" ON "BillingInvoice"("bookingId", "issuedAt");

-- CreateIndex
CREATE INDEX "BillingOutboxEvent_publishedAt_occurredAt_idx" ON "BillingOutboxEvent"("publishedAt", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingOutboxEvent_eventType_ledgerEntryId_key" ON "BillingOutboxEvent"("eventType", "ledgerEntryId");

-- AddForeignKey
ALTER TABLE "BillingLedgerHead" ADD CONSTRAINT "BillingLedgerHead_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPaymentAttempt" ADD CONSTRAINT "BillingPaymentAttempt_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_sourceEntryId_bookingId_fkey" FOREIGN KEY ("sourceEntryId", "bookingId") REFERENCES "BillingLedgerEntry"("id", "bookingId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_paymentAttemptId_bookingId_fkey" FOREIGN KEY ("paymentAttemptId", "bookingId") REFERENCES "BillingPaymentAttempt"("id", "bookingId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_bookingId_sourceBillingRevision_fkey" FOREIGN KEY ("bookingId", "sourceBillingRevision") REFERENCES "BillingLedgerEntry"("bookingId", "revision") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BillingOutboxEvent" ADD CONSTRAINT "BillingOutboxEvent_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "BillingLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money uses Decimal(18,0), bounded to exact API integer VND.
ALTER TABLE "BillingLedgerHead" ADD CONSTRAINT "BillingLedgerHead_revision_check" CHECK ("revision" >= 0);
ALTER TABLE "BillingPaymentAttempt" ADD CONSTRAINT "BillingPaymentAttempt_snapshot_check" CHECK (
  "amountVnd" BETWEEN 1 AND 9007199254740991 AND "expiresAt" > "createdAt"
  AND (("purpose" = 'DEPOSIT' AND "timelineRevisionId" IS NOT NULL) OR ("purpose" = 'BALANCE' AND "timelineRevisionId" IS NULL))
  AND (("state" IN ('SUCCEEDED','FAILED') AND "terminalEvidenceId" IS NOT NULL) OR ("state" NOT IN ('SUCCEEDED','FAILED') AND "terminalEvidenceId" IS NULL))
);
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_fact_check" CHECK (
  "amountVnd" BETWEEN 1 AND 9007199254740991 AND "revision" > 0
  AND ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500)
  AND ("evidenceReference" IS NULL OR char_length(btrim("evidenceReference")) BETWEEN 1 AND 120)
  AND (
    ("kind" = 'CHARGE' AND "sourceType" IN ('BASE_BOOKING','PRINT_ORDER') AND "sourceEntryId" IS NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL)
    OR ("kind" = 'PAYMENT' AND "sourceType" = 'PAYMENT_ATTEMPT' AND "paymentAttemptId" IS NOT NULL AND "sourceRevisionId" = "paymentAttemptId" AND "sourceEntryId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL)
    OR ("kind" = 'CREDIT_ADJUSTMENT' AND "sourceType" = 'PRINT_CREDIT' AND "sourceEntryId" IS NOT NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NULL AND "approvedRefundableVnd" IS NULL AND "reason" IS NOT NULL AND "reason" IN ('PRINT_CANCELLED','PRINT_REPLACED'))
    OR ("kind" = 'REFUND' AND "sourceType" = 'MANUAL_REFUND' AND "sourceEntryId" IS NOT NULL AND "paymentAttemptId" IS NULL AND "decisionId" IS NOT NULL AND "approvedRefundableVnd" IS NOT NULL AND "approvedRefundableVnd" BETWEEN 1 AND 9007199254740991 AND "reason" IS NOT NULL AND "evidenceReference" IS NOT NULL)
  )
);
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_snapshot_check" CHECK (
  "sourceBillingRevision" > 0 AND char_length(btrim("invoiceNumber")) BETWEEN 1 AND 120 AND jsonb_typeof("snapshot") = 'object'
);
ALTER TABLE "BillingOutboxEvent" ADD CONSTRAINT "BillingOutboxEvent_envelope_check" CHECK (
  "eventVersion" = 1 AND "aggregateRevision" > 0 AND "attemptCount" >= 0
  AND "eventType" IN ('billing.payment-succeeded','billing.receivable-charge-accepted','billing.refund-recorded')
  AND jsonb_typeof("payload") = 'object'
);

CREATE FUNCTION billing_immutable_fact() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing facts and invoice snapshots are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER billing_ledger_immutable BEFORE UPDATE OR DELETE ON "BillingLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();
CREATE TRIGGER billing_invoice_immutable BEFORE UPDATE OR DELETE ON "BillingInvoice"
FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();

CREATE FUNCTION billing_attempt_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'CREATED' THEN
      RAISE EXCEPTION 'persist payment intent before evidence' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment attempt history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','terminalEvidenceId','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['state','terminalEvidenceId','updatedAt']) THEN
    RAISE EXCEPTION 'payment attempt snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."state" IN ('SUCCEEDED','FAILED') AND
     (NEW."state" <> OLD."state" OR NEW."terminalEvidenceId" IS DISTINCT FROM OLD."terminalEvidenceId") THEN
    RAISE EXCEPTION 'terminal payment evidence conflicts' USING ERRCODE = '23514';
  END IF;
  IF NEW."state" <> OLD."state" AND NOT (
    (OLD."state" = 'CREATED' AND NEW."state" = 'PENDING') OR
    (OLD."state" IN ('PENDING','UNKNOWN') AND NEW."state" IN ('SUCCEEDED','FAILED','UNKNOWN'))
  ) THEN
    RAISE EXCEPTION 'invalid payment attempt transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_attempt_snapshot BEFORE INSERT OR UPDATE OR DELETE ON "BillingPaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION billing_attempt_guard();

-- Serialize every fact on its Booking boundary, including direct SQL writes.
-- Head increments and all constraints roll back if insertion fails.
CREATE FUNCTION billing_append_fact() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
  ELSIF NEW."kind" IN ('REFUND','CREDIT_ADJUSTMENT') THEN
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
CREATE TRIGGER billing_ledger_append BEFORE INSERT ON "BillingLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION billing_append_fact();

CREATE FUNCTION billing_outbox_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR
     (to_jsonb(NEW) - ARRAY['publishedAt','attemptCount']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['publishedAt','attemptCount']) THEN
    RAISE EXCEPTION 'billing outbox evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_outbox_immutable BEFORE UPDATE OR DELETE ON "BillingOutboxEvent"
FOR EACH ROW EXECUTE FUNCTION billing_outbox_guard();

COMMIT;
