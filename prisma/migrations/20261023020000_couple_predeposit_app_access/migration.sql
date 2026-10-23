BEGIN;

-- COUPLE identifies a workspace participant, not a successful deposit.
-- Backfill existing grant owners without changing access levels, payment evidence,
-- account status, existing roles or sessions. New acceptances grant the role atomically.
INSERT INTO "AccountRole" ("id", "accountId", "role")
SELECT gen_random_uuid(), owners."accountId", 'COUPLE'::"AccountRoleType"
FROM (SELECT DISTINCT "accountId" FROM "ConsultationAccess") AS owners
ON CONFLICT ("accountId", "role") DO NOTHING;

COMMIT;
