BEGIN;
ALTER TABLE "BillingOutboxEvent" ADD COLUMN "invoiceRevisionId" UUID;
UPDATE "BillingOutboxEvent" SET "invoiceRevisionId"=(payload->>'invoiceRevisionId')::uuid
 WHERE "eventType"='billing.final-invoice-issued';
ALTER TABLE "BillingOutboxEvent" ADD CONSTRAINT "BillingOutboxEvent_invoiceRevisionId_fkey"
 FOREIGN KEY ("invoiceRevisionId","aggregateId") REFERENCES "FinalInvoiceRevision"("id","bookingId") ON DELETE RESTRICT;
ALTER TABLE "BillingOutboxEvent" ADD CONSTRAINT "BillingOutboxEvent_invoice_identity_check" CHECK (
 ("eventType"='billing.final-invoice-issued' AND "invoiceRevisionId" IS NOT NULL
  AND payload->>'invoiceRevisionId' IS NOT DISTINCT FROM "invoiceRevisionId"::text)
 OR ("eventType"<>'billing.final-invoice-issued' AND "invoiceRevisionId" IS NULL));
DROP INDEX "BillingOutboxEvent_eventType_ledgerEntryId_key";
CREATE UNIQUE INDEX "BillingOutboxEvent_eventType_ledgerEntryId_key" ON "BillingOutboxEvent"("eventType","ledgerEntryId")
 WHERE "eventType"<>'billing.final-invoice-issued';
CREATE UNIQUE INDEX "BillingOutboxEvent_eventType_invoiceRevisionId_key" ON "BillingOutboxEvent"("eventType","invoiceRevisionId");
COMMIT;
