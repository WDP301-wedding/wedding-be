BEGIN;

-- CreateTable
CREATE TABLE "BillingOperationCommand" (
    "commandId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "completedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingOperationCommand_pkey" PRIMARY KEY ("commandId")
);

-- CreateTable
CREATE TABLE "BillingRefundApproval" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "basisKind" TEXT NOT NULL,
    "basisId" UUID NOT NULL,
    "cancellationSequence" INTEGER,
    "approvedRefundableVnd" DECIMAL(18,0) NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "approvedByAccountId" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BillingRefundApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingReportingSequence" (
    "owner" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillingReportingSequence_pkey" PRIMARY KEY ("owner")
);

-- CreateTable
CREATE TABLE "BillingReportingSnapshot" (
    "sequence" INTEGER NOT NULL,
    "bookingId" UUID NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "BillingReportingSnapshot_pkey" PRIMARY KEY ("sequence")
);

-- CreateIndex
CREATE INDEX "BillingRefundApproval_basisKind_basisId_idx" ON "BillingRefundApproval"("basisKind", "basisId");

-- CreateIndex
CREATE INDEX "BillingRefundApproval_bookingId_idx" ON "BillingRefundApproval"("bookingId");

-- CreateIndex
CREATE INDEX "BillingReportingSnapshot_bookingId_sequence_idx" ON "BillingReportingSnapshot"("bookingId", "sequence");

-- AddForeignKey
ALTER TABLE "BillingOperationCommand" ADD CONSTRAINT "BillingOperationCommand_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BillingRefundApproval" ADD CONSTRAINT "BillingRefundApproval_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "BillingOperationCommand" ADD CHECK (
  "kind" IN ('BALANCE_INTENT','MANUAL_PAYMENT','REFUND_APPROVAL','REFUND','INVOICE')
  AND "bodyHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("result") = 'object'
  AND "result" ? 'resourceId'
);
ALTER TABLE "BillingRefundApproval" ADD CHECK (
  "approvedRefundableVnd" BETWEEN 1 AND 9007199254740991
  AND char_length(btrim("reason")) BETWEEN 1 AND 500
  AND char_length(btrim("evidenceReference")) BETWEEN 1 AND 120
  AND (("basisKind" = 'CREDIT' AND "cancellationSequence" IS NULL)
    OR ("basisKind" = 'CANCELLATION' AND "basisId" = "bookingId"
      AND "cancellationSequence" IS NOT NULL AND "cancellationSequence" > 0))
);
ALTER TABLE "BillingReportingSequence" ADD CHECK ("owner" = 'billing' AND "value" >= 0);
ALTER TABLE "BillingReportingSnapshot" ADD CHECK ("sequence" > 0 AND jsonb_typeof("value") = 'object');
CREATE TRIGGER billing_command_immutable BEFORE UPDATE OR DELETE ON "BillingOperationCommand"
FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();
CREATE TRIGGER billing_refund_approval_immutable BEFORE UPDATE OR DELETE ON "BillingRefundApproval"
FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();
CREATE TRIGGER billing_reporting_immutable BEFORE UPDATE OR DELETE ON "BillingReportingSnapshot"
FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();

CREATE FUNCTION billing_refund_approval_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE approved NUMERIC; budget NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
  IF NOT EXISTS (SELECT 1 FROM "Account" a JOIN "AccountRole" r ON r."accountId" = a."id"
    WHERE a."id" = NEW."approvedByAccountId" AND a."status" = 'ACTIVE' AND r."role" = 'MANAGER') THEN
    RAISE EXCEPTION 'refund approval requires an active Manager' USING ERRCODE = '23514';
  END IF;
  IF NEW."basisKind" = 'CREDIT' THEN
    SELECT "amountVnd" INTO budget FROM "BillingLedgerEntry"
      WHERE "id" = NEW."basisId" AND "bookingId" = NEW."bookingId" AND "kind" = 'CREDIT_ADJUSTMENT';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "BookingReportingSnapshot" s WHERE s."sequence" = NEW."cancellationSequence"
      AND s."bookingId" = NEW."bookingId" AND s."value"->>'phase' = 'CANCELLED') THEN
      RAISE EXCEPTION 'refund requires recorded cancellation evidence' USING ERRCODE = '23514';
    END IF;
    SELECT SUM("amountVnd") INTO budget FROM "BillingLedgerEntry" WHERE "bookingId" = NEW."bookingId" AND "kind" = 'PAYMENT';
  END IF;
  SELECT COALESCE(SUM("approvedRefundableVnd"),0) INTO approved FROM "BillingRefundApproval"
    WHERE "basisKind" = NEW."basisKind" AND "basisId" = NEW."basisId";
  IF budget IS NULL OR approved + NEW."approvedRefundableVnd" > budget THEN
    RAISE EXCEPTION 'refund approvals exceed their cancellation or credit basis' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_refund_approval_valid BEFORE INSERT ON "BillingRefundApproval"
FOR EACH ROW EXECUTE FUNCTION billing_refund_approval_guard();

CREATE FUNCTION billing_approved_refund_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision "BillingRefundApproval"%ROWTYPE;
BEGIN
  IF NEW."kind" = 'REFUND' THEN
    SELECT * INTO decision FROM "BillingRefundApproval" WHERE "id" = NEW."decisionId";
    IF FOUND AND (decision."bookingId" <> NEW."bookingId" OR decision."approvedRefundableVnd" <> NEW."approvedRefundableVnd") THEN
      RAISE EXCEPTION 'refund does not match its recorded approval' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_approved_refund_valid BEFORE INSERT ON "BillingLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION billing_approved_refund_guard();

INSERT INTO "BillingReportingSequence" ("owner","value") VALUES ('billing',0);
CREATE FUNCTION billing_capture_report(booking_uuid UUID, changed_at TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE report_sequence INTEGER; charges NUMERIC; credits NUMERIC; paid NUMERIC; refunded NUMERIC; net NUMERIC; history JSONB;
BEGIN
  SELECT COALESCE(SUM("amountVnd") FILTER (WHERE "kind"='CHARGE'),0),
    COALESCE(SUM("amountVnd") FILTER (WHERE "kind"='CREDIT_ADJUSTMENT'),0),
    COALESCE(SUM("amountVnd") FILTER (WHERE "kind"='PAYMENT'),0),
    COALESCE(SUM("amountVnd") FILTER (WHERE "kind"='REFUND'),0),
    jsonb_agg(jsonb_build_object('ledgerEntryId',"id",'kind',"kind",'amountVnd',"amountVnd",
      'occurredAt',to_char("occurredAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'sourceRevisionId',"sourceRevisionId") ORDER BY "revision")
    INTO charges,credits,paid,refunded,history FROM "BillingLedgerEntry" WHERE "bookingId"=booking_uuid;
  charges := GREATEST(charges-credits,0); net := paid-refunded;
  UPDATE "BillingReportingSequence" SET "value"="value"+1 WHERE "owner"='billing' RETURNING "value" INTO report_sequence;
  INSERT INTO "BillingReportingSnapshot" ("sequence","bookingId","changedAt","value") VALUES (
    report_sequence,booking_uuid,changed_at,jsonb_build_object('bookingId',booking_uuid,'acceptedChargesVnd',charges,
      'paidVnd',paid,'refundedVnd',refunded,'outstandingVnd',GREATEST(charges-net,0),'creditVnd',GREATEST(net-charges,0),'ledger',history));
END;
$$;
-- Backfill a safe current view only; preserve all prior facts, grants, audit and events.
DO $$ DECLARE previous RECORD; BEGIN
  FOR previous IN SELECT "bookingId",MAX("createdAt") AS changed_at FROM "BillingLedgerEntry" GROUP BY "bookingId" ORDER BY "bookingId" LOOP
    PERFORM billing_capture_report(previous."bookingId",previous.changed_at);
  END LOOP;
END $$;
CREATE FUNCTION billing_reporting_after_append() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM billing_capture_report(NEW."bookingId",CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_reporting_append AFTER INSERT ON "BillingLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION billing_reporting_after_append();

-- Forward expansion of W4 checkout correlation for the BALANCE purpose.
CREATE OR REPLACE FUNCTION billing_vnpay_checkout_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(NEW."parameters") <> 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."parameters")) <> 13 OR
     EXISTS (SELECT 1 FROM jsonb_object_keys(NEW."parameters") k WHERE k NOT IN (
       'vnp_Version','vnp_Command','vnp_TmnCode','vnp_Amount','vnp_CurrCode','vnp_TxnRef',
       'vnp_OrderInfo','vnp_OrderType','vnp_Locale','vnp_IpAddr','vnp_ReturnUrl','vnp_CreateDate','vnp_ExpireDate')) OR
     NOT EXISTS (SELECT 1 FROM "BillingPaymentAttempt" a WHERE a."id" = NEW."paymentAttemptId"
       AND a."provider" = 'VNPAY' AND a."purpose" IN ('DEPOSIT','BALANCE')
       AND NEW."parameters"->>'vnp_TxnRef' = a."id"::text AND NEW."parameters"->>'vnp_CurrCode' = 'VND'
       AND (NEW."parameters"->>'vnp_Amount')::numeric = a."amountVnd" * 100) THEN
    RAISE EXCEPTION 'checkout snapshot does not match its payment intent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
