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
The current manifest intentionally remains NO_GO when evidence comes from a
different source, required workers are disabled or review/recovery gates are pending.

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
No upgrade, paid backup service or new cron service was created. The backup method
and 30-day custody decision are pending the owner. If the owner selects manual
custody, Lê Bá Bách must keep ciphertext, separate key and external tombstone ledger
available for the agreed 30 days, take another backup before schema/data changes,
and record disposal/recovery operations. This document does not assert automatic
daily backups or that 30 elapsed days have already been observed.

## Restore sequence

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
