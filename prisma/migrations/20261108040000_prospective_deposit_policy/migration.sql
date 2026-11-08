BEGIN;
ALTER TABLE "RestaurantProfile" ADD COLUMN "depositPercentage" INTEGER NOT NULL DEFAULT 30
  CHECK ("depositPercentage" BETWEEN 10 AND 100);
ALTER TABLE "Booking" ADD COLUMN "depositPercentage" INTEGER NOT NULL DEFAULT 30
  CHECK ("depositPercentage" BETWEEN 10 AND 100);
ALTER TABLE "Booking" ADD COLUMN "depositPolicyRevision" INTEGER
  CHECK ("depositPolicyRevision" IS NULL OR "depositPolicyRevision" > 0);
ALTER TABLE "BookingProposalSnapshot" ADD COLUMN "depositPercentage" INTEGER NOT NULL DEFAULT 30
  CHECK ("depositPercentage" BETWEEN 10 AND 100);
ALTER TABLE "BookingProposalSnapshot" DROP CONSTRAINT "BookingProposalSnapshot_bounds_check";
ALTER TABLE "BookingProposalSnapshot" ADD CONSTRAINT "BookingProposalSnapshot_bounds_check" CHECK (
  "hallMaxGuests" BETWEEN 1 AND 10000 AND "menuVersionNumber" > 0
  AND "tableCount" BETWEEN 1 AND 500 AND "planningHeadcount" BETWEEN 0 AND 10000
  AND "menuPriceVndPerTable" >= 0
  AND ("menus" IS NOT NULL OR "baseChargeVnd" = "menuPriceVndPerTable" * "tableCount")
  AND "depositAmountVnd" = ceil("baseChargeVnd" * "depositPercentage" / 100)
);
ALTER TABLE "CommercialContractRevision" DROP CONSTRAINT "CommercialContractRevision_amount_check";
ALTER TABLE "CommercialContractRevision" ADD CONSTRAINT "CommercialContractRevision_amount_check" CHECK (
  "revisionNumber" > 0 AND "contractTotalVnd" BETWEEN 1 AND 9007199254740991
  AND COALESCE((document->>'depositRate')::numeric,30) BETWEEN 10 AND 100
  AND trunc(COALESCE((document->>'depositRate')::numeric,30)) = COALESCE((document->>'depositRate')::numeric,30)
  AND (NOT document ? 'depositRate' OR jsonb_typeof(document->'depositRate')='number')
  AND "depositAmountVnd" = ceil("contractTotalVnd" * COALESCE((document->>'depositRate')::numeric,30) / 100)
  AND "documentDigest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("document") = 'object'
  AND "document"->>'modelVersion' = 'FULL_CONTRACT_V1'
  AND "document"->>'bookingId' = "bookingId"::text
  AND "document"->>'timelineRevisionId' = "timelineRevisionId"::text
  AND ("document"->>'contractTotalVnd')::numeric = "contractTotalVnd"
  AND ("document"->>'depositAmountVnd')::numeric = "depositAmountVnd"
);

-- Serialize policy capture with the Manager's optimistic profile update. Defaults
-- on existing rows do not change any prior document, proposal or payment amount.
CREATE FUNCTION freeze_booking_deposit_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE percentage INTEGER; policy_revision INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "depositPercentage", revision INTO percentage, policy_revision
      FROM "RestaurantProfile" WHERE "singletonKey"='RESTAURANT' FOR SHARE;
    NEW."depositPercentage" := COALESCE(percentage,30);
    NEW."depositPolicyRevision" := policy_revision;
  ELSIF NEW."depositPercentage" IS DISTINCT FROM OLD."depositPercentage"
     OR NEW."depositPolicyRevision" IS DISTINCT FROM OLD."depositPolicyRevision" THEN
    RAISE EXCEPTION 'Booking deposit policy is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION freeze_booking_deposit_policy() SET search_path FROM CURRENT;
CREATE TRIGGER booking_deposit_policy BEFORE INSERT OR UPDATE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION freeze_booking_deposit_policy();

CREATE FUNCTION apply_proposal_deposit_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE percentage INTEGER; policy_revision INTEGER;
BEGIN
  SELECT "depositPercentage", "depositPolicyRevision" INTO percentage, policy_revision
    FROM "Booking" WHERE id=NEW."bookingId";
  IF policy_revision IS NOT NULL THEN
    NEW."depositPercentage" := percentage;
    NEW."depositAmountVnd" := ceil(NEW."baseChargeVnd" * percentage / 100);
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION apply_proposal_deposit_policy() SET search_path FROM CURRENT;
CREATE TRIGGER booking_proposal_deposit_policy BEFORE INSERT OR UPDATE ON "BookingProposalSnapshot"
  FOR EACH ROW EXECUTE FUNCTION apply_proposal_deposit_policy();

CREATE FUNCTION require_contract_deposit_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE((NEW.document->>'depositRate')::numeric,30) IS DISTINCT FROM
    (SELECT "depositPercentage" FROM "Booking" WHERE id=NEW."bookingId") THEN
    RAISE EXCEPTION 'Contract must use the frozen booking deposit policy' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION require_contract_deposit_policy() SET search_path FROM CURRENT;
CREATE TRIGGER contract_deposit_policy BEFORE INSERT ON "CommercialContractRevision"
  FOR EACH ROW EXECUTE FUNCTION require_contract_deposit_policy();
COMMIT;
