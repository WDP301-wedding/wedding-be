# SPEC-11 authorized backend staging checkpoint

Date: 2026-10-13, Asia/Saigon. Candidate: [PR #40](https://github.com/WDP301-wedding/wedding-be/pull/40).
Executable source: `e8e7945548ac40d8308a5e4841fc0314c2d40276`, accepted base
`0fe78677acb145b30ab056c747c81a49a4cf5195`. No frontend repository was modified.
API SHA-256: `6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`.
The public staging OpenAPI bytes matched this hash.

[Machine-readable checkpoint](spec11-staging-checkpoint-2026-10-13.json) preserves
redacted facts. It records the state when written; subsequent deployment/correction
receipts are additive. It is not a GO receipt or independent human approval.

## Authorization and target

The owner approved a separate Railway staging deployment, two test emails to the
explicitly named mailbox, VNPay sandbox, and Lê Bá Bách as recovery owner.
Paid Gemini generation and real-money payment were not authorized or executed.
Only the new `spec11-staging` environment and dedicated PostgreSQL were mutated.
An earlier alternate-source upload was removed while its database was empty;
no obsolete migration was applied. Accepted SPEC-09/10 owner evidence stays closed.

API: `https://wedding-be-spec11-spec11-staging.up.railway.app`.
Project/environment/service IDs are in the JSON checkpoint. Database passwords,
session/device tokens, encryption keys and signed payment URLs remain ignored/private.
Runtime uses verified PostgreSQL TLS and a dedicated public CA, one replica,
stable OTP key, serialized pre-deploy migrations and readiness checks. A scoped
IaC partial configures only `wedding-be-spec11`; the existing service is untouched.

## Backend verification

| Check | Result and boundary |
| --- | --- |
| Linux CI | [Exact source run](https://github.com/WDP301-wedding/wedding-be/actions/runs/38333838506): both jobs pass; 1,876 tests / 265 files, including 490 PostgreSQL integration tests. Coverage statements 96.59%, branches 93.44%, functions 98.43%, lines 97.5%; per-file threshold retained. |
| Dependency audit | Existing unexpired exception 1145093; no new waiver or weakened gate. |
| Release unit regression | New live-FCM scope test failed before the policy correction and passed afterward; 16 release-policy tests pass. |
| Local journey | `npm run release:journey`: 36 tests pass against disposable PostgreSQL and native owners. |
| Local recovery | `npm run release:rehearsal`: empty and populated upgrade/replay, readiness 503 during controlled DB outage/live 200, graceful restart, disposable restore pass. |
| Staging migrations | All 60 accepted migrations applied. A timeout interrupted Staff DDL; existing objects were compared with a fresh reference, only missing unchanged DDL completed, exact schema equality checked, then Prisma bookkeeping resolved. No applied migration file changed. |
| Persistent journeys | `node --import tsx scripts/release-staging-seed.mjs <private-target> <private-checkpoint>`: both scenarios pass, 65 native HTTP requests, no overwritten business facts. |
| Seed replay/conflict | Initial complete checkpoint replay returns VERIFIED_EXISTING with zero writes. After adding a native payment attempt, the completed fingerprint refuses replay with DEMO_SEED_CONFLICT, preserving changed facts. |
| Android session | Isolated synthetic Couple account login through `/auth/android-sessions`: 201, ANDROID. Credentials remain private. This is backend auth proof only. |

The two journeys freeze server-calculated MENU, SERVICE and PRINT lines: total
8,100,000 VND, deposit 2,430,000 VND. Synthetic manual deposit commands use the
native Manager ledger, not direct settlement row insertion; they are explicitly
not provider payment proof. Each journey confirms Group seating, publishes a
template-based seating invitation, reads retained PDF bytes, requests contracted
printing, accepts the pinned quote and Couple approval, completes the historical
event and finalizes a zero-expense invoice. Contracted print creates no second
charge. Historical event setup is fenced to a synthetic booking before commercial
approval/payment; Staff check-in uses an explicitly historical native-owner clock.

The no-name journey has zero named Guests and NONE attendance `NOT_RECORDED/null`.
The partial-name journey has distinct IDs for duplicate names, explicit mode enable,
assigned Staff check-in/retry/undo and archive; effective named attendance is zero
after undo, with ledger revision 2. Both keep planningHeadcount 20 and fixed money.
This measures listed names only and introduces no companion-count assumptions.

## Provider and recovery evidence

The actual Railway worker consumed the two native deposit outbox events. It was
restricted to those two booking IDs and one permitted operational PAYMENT recipient.
Exactly two Brevo emails reached DELIVERED, each with one dispatch, retained
CLAIMED/ACCEPTED/DELIVERED attempts and a provider message ID (hashed in public evidence).
Other email destinations were skipped by the allowlist. The worker was disabled
after the authorized budget, and FCM stayed disabled.

VNPay sandbox balance checkout used the official test card only. QueryDR initially
returned a valid, correlated success; repeated requests returned code 94, so the
native owner retained UNKNOWN until a later fresh signed response. It then recorded
SUCCEEDED/application SUCCEEDED, one PAYMENT ledger entry, and identical replay
without another charge. The return URL landed on a missing route; it did not settle
money. The signed server-to-provider QueryDR supplied settlement authority.
An expired earlier checkout remains isolated pending/unknown investigation and
must not be fabricated into a failure. Production merchant/IPN acceptance is separate.

An AES-256-GCM encrypted `pg_dump` was restored into an independent disposable
database on the dedicated staging PostgreSQL. A separately retained erasure audit
identified a synthetic disabled account anonymized by the native Identity owner
under the approved 365-day policy. On the pre-erasure restore, that native erasure
was replayed before readiness, replay returned zero additional erasures, and all
eight ledger entries remained. Native migration readiness passed, traffic was not
opened, the live database was not replaced, and the temporary restore DB was removed.
Keys are separated from ciphertext and excluded from Git. Hosted automated 30-day
backup remains unverified because Railway native backups require Pro; the owner's
backup operating-method choice is pending.

## Current scope and gates

The owner explicitly clarified that **push requires backend preparation only now**.
NTF-FCM-W1/2/3/5 stay required and complete. NTF-FCM-W4 live config/device test/acceptance
is **deferred to the app team's integration phase**, excluded from the current release
gate and not marked passed. No Android build, screenshot or device-display test is
a backend acceptance gate. [Future app instructions](../../docs/android-fcm-test-setup-vi.md)
are retained for that later phase.

REL-W1 and REL-W2 have executable backend evidence. REL-W3 has migration, runtime
and recovery proof, with backup operation/retention closure still pending. RV-21
needs owner review of the immutable feature/evidence manifest. REL-W4/5 documents
and a NO_GO manifest can be prepared without claiming that predecessor acceptance.
Human PR review/merge policy and full product/frontend integration remain separate.
