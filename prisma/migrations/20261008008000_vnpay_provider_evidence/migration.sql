BEGIN;

-- Generated Billing-only tables; keep existing indexes/defaults and migration history.
CREATE TABLE "BillingVnpayCheckout" (
  "paymentAttemptId" UUID NOT NULL PRIMARY KEY,
  "parameters" JSONB NOT NULL,
  CONSTRAINT "BillingVnpayCheckout_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "BillingPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE TABLE "BillingProviderEvidence" (
  "id" UUID NOT NULL PRIMARY KEY,
  "paymentAttemptId" UUID NOT NULL,
  "merchantCode" TEXT NOT NULL CHECK ("merchantCode" ~ '^[A-Za-z0-9]{8}$'),
  "transactionId" TEXT NOT NULL CHECK ("transactionId" ~ '^(0|[1-9][0-9]{0,14})$'),
  "channel" TEXT NOT NULL CHECK ("channel" IN ('IPN', 'QUERY')),
  "payloadHash" TEXT NOT NULL CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  "amountVnd" DECIMAL(18,0) NOT NULL CHECK ("amountVnd" > 0 AND "amountVnd" <= 9999999999),
  "outcome" "BillingAttemptState" NOT NULL CHECK ("outcome" IN ('SUCCEEDED', 'FAILED', 'UNKNOWN')),
  "settledAt" TIMESTAMPTZ(6),
  "decision" TEXT NOT NULL CHECK ("decision" IN ('ACCEPTED', 'CONFLICT', 'AMOUNT_MISMATCH')),
  "observedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("outcome" = 'SUCCEEDED') = ("settledAt" IS NOT NULL)),
  CHECK ("outcome" <> 'SUCCEEDED' OR "transactionId" <> '0'),
  CONSTRAINT "BillingProviderEvidence_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "BillingPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "BillingProviderEvidence_paymentAttemptId_channel_payloadHas_key" ON "BillingProviderEvidence"("paymentAttemptId", "channel", "payloadHash");
CREATE TABLE "BillingProviderTransaction" (
  "merchantCode" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "paymentAttemptId" UUID NOT NULL,
  "evidenceId" UUID NOT NULL,
  CONSTRAINT "BillingProviderTransaction_pkey" PRIMARY KEY ("merchantCode", "transactionId"),
  CONSTRAINT "BillingProviderTransaction_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "BillingPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "BillingProviderTransaction_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "BillingProviderEvidence"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE FUNCTION billing_vnpay_checkout_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(NEW."parameters") <> 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."parameters")) <> 13 OR
     EXISTS (SELECT 1 FROM jsonb_object_keys(NEW."parameters") k WHERE k NOT IN (
       'vnp_Version','vnp_Command','vnp_TmnCode','vnp_Amount','vnp_CurrCode','vnp_TxnRef',
       'vnp_OrderInfo','vnp_OrderType','vnp_Locale','vnp_IpAddr','vnp_ReturnUrl','vnp_CreateDate','vnp_ExpireDate')) OR
     NOT EXISTS (SELECT 1 FROM "BillingPaymentAttempt" a WHERE a."id" = NEW."paymentAttemptId"
       AND a."provider" = 'VNPAY' AND a."purpose" = 'DEPOSIT'
       AND NEW."parameters"->>'vnp_TxnRef' = a."id"::text
       AND NEW."parameters"->>'vnp_CurrCode' = 'VND'
       AND (NEW."parameters"->>'vnp_Amount')::numeric = a."amountVnd" * 100) THEN
    RAISE EXCEPTION 'checkout snapshot does not match its payment intent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION billing_vnpay_claim_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "BillingProviderEvidence" e WHERE e."id" = NEW."evidenceId"
    AND e."paymentAttemptId" = NEW."paymentAttemptId" AND e."merchantCode" = NEW."merchantCode"
    AND e."transactionId" = NEW."transactionId" AND e."transactionId" <> '0' AND e."decision" = 'ACCEPTED') THEN
    RAISE EXCEPTION 'provider transaction claim requires matching accepted evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_vnpay_checkout_valid BEFORE INSERT ON "BillingVnpayCheckout" FOR EACH ROW EXECUTE FUNCTION billing_vnpay_checkout_guard();
CREATE TRIGGER billing_vnpay_claim_valid BEFORE INSERT ON "BillingProviderTransaction" FOR EACH ROW EXECUTE FUNCTION billing_vnpay_claim_guard();
CREATE TRIGGER billing_vnpay_checkout_immutable BEFORE UPDATE OR DELETE ON "BillingVnpayCheckout" FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();
CREATE TRIGGER billing_provider_evidence_immutable BEFORE UPDATE OR DELETE ON "BillingProviderEvidence" FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();
CREATE TRIGGER billing_provider_transaction_immutable BEFORE UPDATE OR DELETE ON "BillingProviderTransaction" FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();

COMMIT;
