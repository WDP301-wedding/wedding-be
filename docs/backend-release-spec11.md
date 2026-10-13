# SPEC-11 backend release hand-off

Date: 2026-10-13 (Asia/Saigon). Provider: `BACKEND-RELEASE@3.0.0`.
Scope: wedding-be only. Decision: **NO_GO**, pending Android FCM acceptance and
staging/recovery acceptance. Candidate PR: [#40](https://github.com/WDP301-wedding/wedding-be/pull/40),
based on accepted `main@0fe78677acb145b30ab056c747c81a49a4cf5195`.

Execution order: REL-W1 → REL-W2 → REL-W3 → RV-21 → REL-W4 → REL-W5.
Later hand-off artifacts may be prepared while a prerequisite is pending; their
preparation does not close the prerequisite or mark a release accepted.

## Executable verification

```powershell
npm run release:journey
npm run release:rehearsal
npm run release:manifest -- --output test-results/release/fresh-manifest.json
```

`release:journey` runs native Booking/Venue/Billing/Invitation/Guest/Seating/Staff/
Analytics owners against disposable localhost PostgreSQL. The original foundation
runner deploys Prisma migrations into an independently created database first.
Controlled Storage/VNPay/email adapters and native manual-payment commands are
offline evidence; no provider checkout, paid generation or real email is invoked.

`release:rehearsal` reads only the dedicated `.env.demo` database administrator at
127.0.0.1:55435. It creates its own `rel_*` databases, deploys the accepted SPEC-08
baseline, inserts synthetic account fixtures, upgrades/repeats current migrations,
starts the real backend composition, tests DB outage and graceful restart, creates
and restores a disposable backup, applies a synthetic erasure tombstone before
reopening, and independently deploys from empty. It drops only databases it created.
The report and backup remain in ignored `test-results/release-rehearsal/`.
This verifies local recovery mechanics, not encrypted 30-day hosted backups or a
production privacy/settlement restoration drill.

`release:manifest` validates the on-disk OpenAPI digest, collects source content
hashes, migration names/checksums, declared route security and configuration-only
provider modes, and evaluates all backend prerequisite tasks plus exact-source
gate receipts. It uses exclusive file creation, refusing to overwrite evidence.
NO_GO returns a nonzero exit status. Output is secret-safe: credentials, tokens,
raw PII, signed URLs and payment callback bodies are never included.

The CLI accepts a redacted operator input through `--input path.json`:

```json
{
  "deployment": null,
  "evidence": [],
  "frontendIntegrationStatus": "PENDING"
}
```

For staging, supply `apiOrigin`, `publicWebOrigin`, `managementWebOrigin`,
`sameSiteDomain`, `recoveryOwner`, `backupRetentionDays: 30`,
`encryptedBackups: true` and `restoreReplaysErasureTombstones: true` inside
`deployment`. This is a declared operational plan; runtime receipts must separately
prove it. The validator checks HTTPS/same-site host membership, exact configured
CORS, one replica, stable OTP key and required real-provider/worker/encryption
configuration. Existing environment parsing enforces deployed auth lifetimes,
cookie defaults, proxy policy and database TLS. Domain registration/public-suffix
ownership and actual browser transport remain joint deployment checks.

Each receipt has strict fields `gate`, `status`, `dimension`, `sourceRevision`,
`apiContractSha256`, `target`, `targetOrigin`, `observedAt`, and `evidence`.
The evidence reference is a repository-relative file under `tasks/evidence/` or
`docs/`. Offline gates use `disposable-postgresql` and null origin; runtime and
owner review gates use `authorized-staging` and the exact deployment API origin.
Wrong source/API/target/origin, duplicate/missing receipts, future timestamps,
failed/pending gates, dirty source and open prerequisites block GO.

Required gates: `quality.backend`, `journey.no-names`, `journey.partial-names`,
`migration.empty-upgrade`, `staging.runtime`, `staging.recovery`,
`provider.revised-journey`, `workers.runtime`, and `RV-21` (owner review).
No health 200, configuration presence or historical provider receipt alone can
satisfy the revised journey or actual-worker gates.

## Seed and journey boundaries

Scenario IDs are `no-names` and `partial-names`. Stable seed keys are derived from
provider version plus scenario. `ensureDemoSeed` exposes only owner reads and
create commands with native idempotency keys. It verifies existing current facts
including revision and refuses conflicting edits; it offers no update/upsert port.
The native acceptance harness covers the two journeys. The operator script
`scripts/release-staging-seed.mjs` is fenced to the explicitly authorized separate
Railway resources, uses native HTTP commands/idempotency and a private resumable
checkpoint, verifies existing completed facts, and refuses conflicting edits.
Its persistent staging execution remains pending in REL-W2; do not
use the historical `scripts/demo-seed.ts` direct settlement fixtures as new release
or live-payment proof. The offline journey separately verifies downstream owners.

The no-name journey keeps separate bride/groom contract identity while requiring
no named Guest list. Groups provide seating/PDF labels; NONE reports null/not
recorded. The partial-name journey uses distinct IDs for duplicate names, explicit
mode enable, assigned Staff, one effective check-in, retry, append-only undo and
archive. List edits preserve separately entered planning and monetary facts.

Money is integer VND. Server-calculated line total = quantity × unit price;
deposit = ceil(original contract total × 30 / 100).
Final total = original contract + approved appendix delta + incidental expenses.
Net paid = settled payments − settled refunds; balance = final total − net paid;
outstanding = max(balance, 0), credit = max(−balance, 0). Attendance does not enter
these formulas. Approved contract/appendix/final invoice history stays immutable.
The native commercial suite checks several menus, service/print prices, appendices,
zero/nonzero expenses, amount/version pinning and once-only ledger registration.

## API and frontend integration checklist

Use the exact `openapi/openapi.json` and its SHA-256 from the candidate manifest.
Generated routes are inventoried with their declared security. `NOT_DECLARED`
means inspect the owner contract; it never grants public access. Release adds no
business HTTP routes and never publishes a specification-only endpoint.

| Owner               | Strict schemas, examples, errors, authorization and migration hand-off                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commercial/Payments | [BE-17](be17-extension-handoff.md), [BE-06–10](be06-10-commercial-contracts.md), [BE-11–16](be11-16-commercial-settlement.md)                                                                                                                                                                                                                                                                                               |
| Invitation/print    | [SPEC-05](spec-05-w2-w4-handoff.md), [A5 PDF](invitation-print-files.md)                                                                                                                                                                                                                                                                                                                                                    |
| Guest               | [Group + optional named Guest](guest-management-w1-w4.md)                                                                                                                                                                                                                                                                                                                                                                   |
| Seating             | [SPEC-07](seating-plan-w1-w5.md)                                                                                                                                                                                                                                                                                                                                                                                            |
| Staff               | [SPEC-08](staff-operations-w1-w5.md)                                                                                                                                                                                                                                                                                                                                                                                        |
| Analytics           | [SPEC-10](analytics-dashboard-w1-w4.md)                                                                                                                                                                                                                                                                                                                                                                                     |
| Identity/runtime    | [Identity operations](identity-access-operations.md), [runtime foundation](runtime-foundation-operations.md)                                                                                                                                                                                                                                                                                                                |
| Notifications       | Current native implementation/full coverage verified; latest developer checkboxes recorded, current-source owner hand-off/live acceptance still pending. Strict schemas/errors are in `src/modules/notifications-automation/http/notification.schemas.ts`, policy inputs in `domain/notification-policy.ts`, and route/role examples in the exact OpenAPI. RV-16 and the other worktree's runtime evidence remain separate. |

| Actor          | Backend authority                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Manager        | Managed catalogs; own consultations/contracts; event-end expenses and immutable invoices; assignments; analytics                         |
| Owning Couple  | RESTRICTED timeline/pre-deposit collaboration; FULL post-settlement workflows; mutual commercial approval; explicit plan/check-in enable |
| Assigned Staff | Authorized event operations and listed-person check-in/undo when enabled and within the allowed window                                   |
| Guest/public   | Minimal read-only invitation; generic QR grants no list/contact/billing/attendance-write authority                                       |
| Operator       | Deployment, bounded migration/recovery and Manager bootstrap; no public operator HTTP endpoint                                           |

Frontend team separately records its client commits, exact API digest lock, strict
DTO/error handling, money display, no-list/NONE handling, authorization denials,
cookie/refresh/CORS browser verification, Guest fragment consumption, and native
push/install evidence. `frontendIntegrationStatus` is separate from backendStatus;
backend GO with frontend PENDING still leaves product release pending.

## Proposed Railway staging artifact for owner review

The owner approved deployment to a **separate Railway staging environment** and
named Lê Bá Bách as recovery owner. Use the repository Dockerfile
and serialized migration pre-deploy command; one backend replica and a dedicated
PostgreSQL database. Do not point the candidate at the existing live database.
Use the accepted SPEC-09/10 migration lineage on `origin/main`, including the FCM
extension. The abandoned alternate candidate was stopped while the staging database
was empty; no obsolete migration was applied. Its source/evidence cannot close this
candidate's gates. Existing accepted RV-16, GM-W5 and Analytics evidence is preserved.

Prepare an archive containing only explicit backend runtime/source/test/build
inputs. Record archive/content/API/migration hashes and the base commit plus dirty
state. Before deployment, integrate/accept the correct Notifications implementation,
commit the candidate, pass pinned-runtime CI/full per-file coverage, designate the
recovery owner, and obtain owner approval of the artifact and staging inputs.

Initial staging workers and FCM stay disabled. The owner authorized up to **two**
test emails to `babachkt04@gmail.com` and VNPay sandbox on the isolated test data;
retain booking/recipient allowlists when enabling a bounded worker.
Paid Gemini generation and real-money payments are outside the authorization. Historical
Gemini/sandbox receipts retain their original source/target limits. New provider
tests or reuse of validated compatible evidence require owner review under RV-21.

All 60 accepted migrations have been applied to the separate staging PostgreSQL.
A local operator timeout interrupted the Staff migration before all DDL completed.
The operator compared existing columns, indexes, constraints, functions and triggers
against a fresh database with the unchanged migration, completed only missing DDL,
verified exact equivalence and used `migrate resolve --applied` before deploying
the remaining migrations. No migration file was changed and no business row/history
was overwritten.

The local rehearsal passed empty deployment, populated SPEC-08 upgrade, replay,
readiness outage/recovery, graceful restart and disposable restore. Railway rejected
native backup creation because it requires a Pro workspace. An AES-256-GCM encrypted
dump was created in the operator workspace and its authenticated round trip passed.
It was also restored into a separate disposable database on the staging PostgreSQL;
all 60 migration records and the synthetic account were verified, then that disposable
database was removed. The live staging database was not replaced or reopened from it.
Hosted 30-day retention and native erasure-tombstone recovery remain unverified;
the local rehearsal's synthetic tombstone is not that proof.

An isolated synthetic Couple account has been created; credentials are kept in
`.local-demo/android-test-account.private.json`, excluded from Git. Follow the
[Android FCM setup guide](android-fcm-test-setup-vi.md). A created account or Android
registration does not prove actual worker-to-FCM message acceptance. NTF-FCM-W4
and RV-21 remain open until their own evidence exists.

## Recovery hand-off and NO_GO conditions

1. Record incident/recovery owner, current/previous compatible image/source/API
   digests, ordered migrations, restore point and unknown money/delivery intents.
2. Pause bounded worker scheduling and new money/print writes when needed. Drain
   in-flight operations and retain idempotency, claims and immutable evidence.
3. Restore the last compatible service artifact only after checking its readiness
   against the current migration history. Missing/checksum-mismatched schema means
   keep traffic closed and forward-fix; never edit/reverse applied migrations.
4. For DB restore, use controlled downtime and an authorized encrypted restore
   point, replay actual erasure tombstones, reconcile unknown payments/delivery and
   source revisions, then verify readiness, auth, privacy and ledger invariants.
   Do not blindly replay callbacks or notification intents.
5. Reopen only after owner-reviewed evidence; retain the failed candidate and a new
   immutable correction record. Local synthetic restore proof does not authorize
   shared-data restore or prove hosted backup retention/encryption.

Required module acceptance, stable release identity, full quality/coverage,
exact migration/runtime/target proof and owner-reviewed RV-21 remain hard gates.
The current decision is NO_GO and does not waive any unfinished task.
