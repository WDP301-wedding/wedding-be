-- Add evidence for new cancellations only. Do not infer origin or rewrite old money/history.
ALTER TABLE "Booking" ADD COLUMN "cancellationRefundPolicy" jsonb;
CREATE FUNCTION retain_cancellation_refund_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."cancellationRefundPolicy" IS NOT NULL AND NEW."cancellationRefundPolicy" IS DISTINCT FROM OLD."cancellationRefundPolicy" THEN
  RAISE EXCEPTION 'cancellation refund policy is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."cancellationRefundPolicy" IS NULL AND NEW."cancellationRefundPolicy" IS NOT NULL AND NEW.phase<>'CANCELLED' THEN
  RAISE EXCEPTION 'cancellation refund policy requires accepted cancellation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_cancellation_refund_policy BEFORE UPDATE ON "Booking"
 FOR EACH ROW EXECUTE FUNCTION retain_cancellation_refund_policy();

CREATE FUNCTION enforce_cancellation_refund_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy jsonb; refunded numeric;
BEGIN
 IF NEW.kind<>'REFUND' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 SELECT "cancellationRefundPolicy" INTO policy FROM "Booking" WHERE id=NEW."bookingId";
 IF policy IS NULL THEN RETURN NEW; END IF;
 IF policy->>'entitledVnd' IS NULL OR policy->>'depositPaymentId' IS DISTINCT FROM NEW."sourceEntryId"::text THEN
  RAISE EXCEPTION 'cancellation refund requires supported deposit policy' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(SUM("amountVnd"),0) INTO refunded FROM "BillingLedgerEntry"
  WHERE "bookingId"=NEW."bookingId" AND kind='REFUND' AND "sourceEntryId"=NEW."sourceEntryId";
 IF refunded+NEW."amountVnd"> (policy->>'entitledVnd')::numeric THEN
  RAISE EXCEPTION 'cancellation refund exceeds frozen entitlement' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_cancellation_refund_cap BEFORE INSERT ON "BillingLedgerEntry"
 FOR EACH ROW EXECUTE FUNCTION enforce_cancellation_refund_cap();
