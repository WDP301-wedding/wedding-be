# SPEC-11 staging recovery operator hand-off

Recovery owner: **Lê Bá Bách**. Scope: the dedicated `spec11-staging` Railway
environment, backend `wedding-be-spec11` and its independent PostgreSQL only.
No shared/production data restore is authorized by the staging rehearsal.

The immutable checkpoint and manifest are in
`tasks/evidence/spec11-staging-checkpoint-2026-10-13.*` and
`tasks/evidence/spec11-release-manifest-candidate-2026-10-13.json`.
Use their exact source, API, ordered migration and archive hashes. Runtime source
`e8e7945548ac40d8308a5e4841fc0314c2d40276` passed CI and was deployed to staging;
later evidence-only commit identities must not be presented as a runtime test.
The final [owner acceptance and NO_GO decision](../tasks/evidence/spec11-final-no-go-handoff-2026-10-13.md)
completes RV-21/REL-W4/REL-W5. Recovery is the selected synthetic-demo rebuild below.
The release intentionally remains NO_GO while exact-candidate evidence is missing
or required workers are disabled; completed hand-off is not production readiness.

## Recovery material

The operator workspace contains authenticated AES-256-GCM ciphertext under
`test-results/release-staging-backup/`. Decryption key, IV, tag and associated data
are in ignored `.local-demo/rel-journey-backup-key.private.json`, stored separately
from ciphertext. Neither may be published in a PR; restrict host access and place
the key in the owner's secret store before transferring a backup to another host.
The ciphertext is a custom-format PostgreSQL dump from the isolated staging DB.

Retain an external erasure/audit export taken **after** the backup. The test
`.local-demo/rel-privacy-erase-receipt.json` references the native anonymization
audit for one synthetic account. A database backup predating erasure does not
contain that later tombstone and cannot be used as its own deletion authority.
Exports needed for real recovery must cover all erasures since the restore point,
retain identity references without original PII, and be protected with the backup key
and audit permissions. The rehearsal proves the native replay mechanism on one
synthetic identity; it does not invent retention policy for Guest/media fields.

Native Railway backup creation was rejected because the workspace lacks Pro.
The owner explicitly selected **rebuild from migrations and seed for synthetic
staging/demo** on 2026-10-13, replacing the 30-day retention requirement. No upgrade,
paid backup service or new cron service was created. Existing encrypted rehearsal
artifacts are preserved as evidence; no new 30-day custody obligation is asserted.

## Selected demo rebuild procedure

This mode accepts loss of transient synthetic data; it does not restore a historical
snapshot. It is permitted only while this dedicated environment contains no real
customer/contract/payment data. The release validator rejects production use.

1. Verify the exact project/environment/service/database IDs and synthetic-only
   scope. Stop demo traffic and keep worker/FCM disabled. Retain diagnostic and
   signed sandbox/provider evidence independently of the database.
2. Provision a new isolated database; preserve the prior failed demo database until
   recovery is reviewed. Do not reset the existing/shared database or rewrite SQL.
3. Deploy the pinned complete migration history from empty with `npm run db:migrate:deploy`.
   Compare all migration names/checksums and run readiness. This operation does not
   reconstruct a real payment settlement or restore erased data from a backup.
4. Prepare private bootstrap/seed configuration fenced to the new approved database
   and API target. `scripts/release-staging-seed.mjs` currently refuses any target
   other than the recorded staging resources; do not bypass that guard by pointing
   an unfenced historical seed at a different database. The operator must review
   and pin a new target before running the native migration-and-seed recipe.
5. Use a **new private checkpoint** for the new database, then execute the two native
   journeys. The script uses native idempotency and refuses conflicting existing
   facts. Never reuse a completed checkpoint from a lost/different database.
   Recreate synthetic manual payments only, explicitly labeled as fixtures. They
   do not prove or reconstruct a VNPay transaction.
6. Verify auth, scope denials, explicit planning, NONE/partial-name semantics,
   Group seating, contracted print, immutable invoice and once-only ledger effects.
   Keep email worker off because the two-email authorization is exhausted; FCM
   remains deferred. Do not resend external emails or replay provider checkout
   actions merely to rebuild demo fixtures. Reopen the demo after owner review.

Evidence combines empty deployment/readiness and disposable recovery rehearsals
with persistent native staging migration/seed journeys. It does not claim that
the live staging database was reset during acceptance. Production/historical-data
recovery uses the protected backup/erasure procedure below and needs its own scope.

## Protected historical-data restore procedure (separate scope)

1. Verify the exact target IDs and close traffic/write entry points. Keep notification
   worker and FCM off. Preserve provider UNKNOWN states; do not retry ambiguous sends
   or invent payment failures. Take a pre-recovery encrypted snapshot when possible.
2. Verify ciphertext SHA-256, decrypt with AES-GCM authenticated metadata, then
   restore into a **new isolated database** first. Never replace the live database
   merely to test restoration. `pg_restore --exit-on-error --no-owner` must succeed.
3. Check every `_prisma_migrations` checksum against the selected source; incomplete
   or mismatched migration history fails readiness. Never rewrite applied SQL.
   Use an additive correction or the documented failed-migration reconciliation.
4. Verify externally retained erasure facts. Replay eligible identities through
   the native Identity retention owner using the approved 180/30/90/365-day policy.
   Confirm PII anonymization, credential revocation and an append-only audit before
   opening readiness/traffic. Repeating replay must anonymize zero additional accounts.
5. Preserve and verify immutable contract/appendix/invoice, payment/refund/settlement,
   print and attendance journals. Reconcile actual provider transactions through
   their native signed evidence paths, retaining unresolved UNKNOWN for investigation.
   Compare ledger entries and source revisions; never directly set payment SUCCEEDED.
6. Run native migration readiness, auth/authorization checks and backend smoke
   journeys against the restored isolated DB. Reopen only after the owner reviews
   the correction evidence and intended target. Keep a recoverable prior artifact.

Verified rehearsal: decrypt/authenticate, restore a pre-erasure staging dump, native
erasure before readiness, harmless replay, retained eight ledger entries and migration
readiness pass. The temporary restore DB was removed. The staging database was not
replaced and no traffic was opened against a pre-erasure restore.

## Test-budget and feature controls

The two authorized Brevo emails are exhausted. Do not enable a mailbox recipient or
requeue an email without a new explicit sending scope. Keep worker test booking/email
allowlists when preparing any further rehearsal. In-app worker execution and real
email provider acceptance are recorded separately.

VNPay runs in sandbox only; one native balance succeeded and replay retained one
ledger entry. QueryDR code 94 is duplicate/rate-limited evidence, not a failed payment.
The earlier expired exploratory checkout has no fabricated terminal result and remains
an isolated investigation item. Signed browser return values are display hints only;
native server-to-provider signed QueryDR settled the successful test. Future checkout
ReturnURL now points to the existing `/docs` landing, while previous signed checkouts
remain immutable. A frontend payment-result landing is separately owned.

FCM is disabled and live push testing is deferred by the owner to app integration.
The prepared backend adapter, persistence/retry, config and OpenAPI remain accepted.
Do not downgrade to an old schema/source that cannot understand retained notification
states. Paid Gemini generation and real-money merchant launch remain separate scopes.
