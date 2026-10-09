BEGIN;

-- Generated Billing-only addition. Existing partial indexes/defaults remain intact.
CREATE TABLE "BillingDepositApplication" (
    "paymentId" UUID NOT NULL,
    "appliedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "BillingDepositApplication_pkey" PRIMARY KEY ("paymentId")
);
ALTER TABLE "BillingDepositApplication" ADD CONSTRAINT "BillingDepositApplication_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "BillingLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE FUNCTION billing_deposit_application_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "BillingLedgerEntry" e
    JOIN "BillingPaymentAttempt" a ON a."id" = e."paymentAttemptId"
    WHERE e."id" = NEW."paymentId" AND e."kind" = 'PAYMENT'
      AND a."purpose" = 'DEPOSIT' AND a."state" = 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'deposit application requires a proven deposit payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_deposit_application_valid BEFORE INSERT ON "BillingDepositApplication"
FOR EACH ROW EXECUTE FUNCTION billing_deposit_application_guard();
CREATE TRIGGER billing_deposit_application_immutable BEFORE UPDATE OR DELETE ON "BillingDepositApplication"
FOR EACH ROW EXECUTE FUNCTION billing_immutable_fact();

COMMIT;
