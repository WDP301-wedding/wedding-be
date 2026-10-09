-- One terminal business record may be linked to several accounts. Evidence is
-- unique for each account and source, while consultation completeness still gates erasure.
DROP INDEX "AccountRetentionEligibilityFact_sourceBusinessRecordId_key";
CREATE UNIQUE INDEX "AccountRetentionEligibilityFact_accountId_sourceBusinessRecordId_key"
  ON "AccountRetentionEligibilityFact" ("accountId", "sourceBusinessRecordId");
