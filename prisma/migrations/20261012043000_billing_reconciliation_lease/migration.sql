CREATE TABLE "BillingReconciliationLease" (
 "paymentAttemptId" UUID PRIMARY KEY REFERENCES "BillingPaymentAttempt"("id") ON DELETE RESTRICT,
 "leaseUntil" TIMESTAMPTZ NOT NULL, "nextAttemptAt" TIMESTAMPTZ NOT NULL
);
