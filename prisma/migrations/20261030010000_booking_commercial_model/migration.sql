-- Commercial policy belongs to the booking, not to an empty contract head.
-- PostgreSQL's column default preserves existing rows as legacy without UPDATE
-- backfills or firing historical reporting/financial triggers. Existing contract
-- heads still identify full-contract records in application readers.
BEGIN;
CREATE TYPE "BookingCommercialModelVersion" AS ENUM ('LEGACY_PROPOSAL_V1', 'FULL_CONTRACT_V1');
ALTER TABLE "Booking" ADD COLUMN "commercialModelVersion" "BookingCommercialModelVersion"
  NOT NULL DEFAULT 'LEGACY_PROPOSAL_V1';
ALTER TABLE "Booking" ALTER COLUMN "commercialModelVersion" SET DEFAULT 'FULL_CONTRACT_V1';
COMMIT;
