BEGIN;
ALTER TABLE "BillingPaymentAttempt" ADD COLUMN "invoiceRevisionId" UUID,
 ADD COLUMN "invoiceDigest" TEXT, ADD COLUMN "sourceBillingRevision" INTEGER;
ALTER TABLE "BillingPaymentAttempt" ADD CONSTRAINT "BillingPaymentAttempt_invoiceRevisionId_bookingId_fkey"
 FOREIGN KEY ("invoiceRevisionId","bookingId") REFERENCES "FinalInvoiceRevision"("id","bookingId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "BillingPaymentAttempt" ADD CONSTRAINT invoice_pin_shape CHECK (
 ("invoiceRevisionId" IS NULL AND "invoiceDigest" IS NULL AND "sourceBillingRevision" IS NULL) OR
 ("purpose"='BALANCE' AND "invoiceRevisionId" IS NOT NULL AND "invoiceDigest" IS NOT NULL
  AND "invoiceDigest" ~ '^[a-f0-9]{64}$' AND "sourceBillingRevision" IS NOT NULL AND "sourceBillingRevision">0));
CREATE FUNCTION invoice_balance_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv "FinalInvoiceRevision"%ROWTYPE; head_revision INTEGER; accepted NUMERIC; net_paid NUMERIC; due NUMERIC;
BEGIN
 PERFORM 1 FROM "Booking" WHERE id=NEW."bookingId" FOR UPDATE;
 IF NEW.purpose <> 'BALANCE' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM "CommercialContract" WHERE "bookingId"=NEW."bookingId") THEN
  IF NEW."invoiceRevisionId" IS NOT NULL THEN RAISE EXCEPTION 'legacy balance must not invent an invoice source'; END IF;
  RETURN NEW;
 END IF;
 SELECT r.* INTO inv FROM "FinalInvoiceHead" h JOIN "FinalInvoiceRevision" r ON r.id=h."currentRevisionId"
  WHERE h."bookingId"=NEW."bookingId";
 SELECT revision INTO head_revision FROM "BillingLedgerHead" WHERE "bookingId"=NEW."bookingId";
 SELECT COALESCE(sum(CASE WHEN kind='CHARGE' THEN "amountVnd" WHEN kind='CREDIT_ADJUSTMENT' THEN -"amountVnd" ELSE 0 END),0),
 COALESCE(sum(CASE WHEN kind='PAYMENT' THEN "amountVnd" WHEN kind='REFUND' THEN -"amountVnd" ELSE 0 END),0)
 INTO accepted,net_paid FROM "BillingLedgerEntry" WHERE "bookingId"=NEW."bookingId";
 due:=GREATEST(accepted-net_paid,0);
 IF inv.id IS NULL OR NEW."invoiceRevisionId" IS DISTINCT FROM inv.id
  OR NEW."invoiceDigest" IS DISTINCT FROM inv."documentDigest"
  OR NEW."sourceBillingRevision" IS DISTINCT FROM head_revision OR accepted<>inv."totalVnd"
  OR NEW."amountVnd">due OR (NEW.provider='VNPAY' AND NEW."amountVnd"<>due)
 THEN RAISE EXCEPTION 'balance must pin the current invoice, billing revision and outstanding amount'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_balance_pin BEFORE INSERT ON "BillingPaymentAttempt" FOR EACH ROW EXECUTE FUNCTION invoice_balance_pin_guard();
-- Existing attempts retain their recorded source. No guessed backfill or historical rewrite.
COMMIT;
