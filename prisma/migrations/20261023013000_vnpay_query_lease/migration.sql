-- Read-only provider requests need a durable cooldown across API instances.
-- This coordination row is separate from immutable checkout/provider/ledger facts.
CREATE TABLE "BillingVnpayQueryLease" (
  "paymentAttemptId" UUID PRIMARY KEY REFERENCES "BillingPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  "nextQueryAt" TIMESTAMPTZ(6) NOT NULL
);
