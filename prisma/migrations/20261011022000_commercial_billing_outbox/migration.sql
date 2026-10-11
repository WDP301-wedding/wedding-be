BEGIN;
ALTER TABLE "BillingOutboxEvent" DROP CONSTRAINT "BillingOutboxEvent_envelope_check";
ALTER TABLE "BillingOutboxEvent" ADD CONSTRAINT "BillingOutboxEvent_envelope_check" CHECK (
 "eventVersion"=1 AND "aggregateRevision">0 AND "attemptCount">=0
 AND "eventType" IN ('billing.payment-succeeded','billing.receivable-charge-accepted','billing.refund-recorded','billing.commercial-obligation-recorded')
 AND jsonb_typeof("payload")='object'
);
COMMIT;
