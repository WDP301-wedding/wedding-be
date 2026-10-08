# SPEC-04 Payments and Billing implementation evidence

Status: **W1-W4 technical evidence; module implementation acceptance pending.**
Authority: approved `SPEC-payments-billing.md`, `WEDDING-CONTRACT-1@1.1.0`,
and the eight-wave plan in `tasks/plan.md` Section 21.

## Branch and scope

All four repositories use `codex/payments-billing` for W1-W8. Verified increments
are committed on that branch. W1-W4 change only the backend; the three client
branches retain their existing Booking baseline. These checkpoints do not mark
the module ACCEPTED or publish a new HTTP/OpenAPI contract.

W1 accounting policy and owner ports: backend commit `5018c66`.
W1 plan/branch/evidence record: backend commit `293e982`.
W2 schema/contracts/upgrade evidence: backend commit `1952a8d`.
W2 transaction adapter/concurrency evidence: backend commit `b9fa8d8`.

## W2 storage and transaction design

- `BillingLedgerEntry` stores immutable charge, payment, refund and credit facts.
  Integer VND is stored as `Decimal(18,0)` and bounded to `Number.MAX_SAFE_INTEGER`.
  Every source type/revision and booking/revision is unique. Adjustments reference
  their original fact in the same booking; proven payments reference their attempt.
- `BillingPaymentAttempt` preserves command identity, amount, purpose, provider,
  timeline and expiry snapshots. One unresolved attempt per booking/purpose is
  allowed. UNKNOWN remains unresolved after expiry. Only verified evidence may
  resolve it; terminal state/evidence cannot change.
- `BillingInvoice` freezes its number, issue time, totals, lines and source ledger
  revision. A composite foreign key binds that revision to an existing fact.
  Issuance derives the snapshot from the ledger and does not collect money. Replay
  reads the persisted snapshot through a strict readonly schema, even after later
  ledger entries are appended.
- SQL checks and triggers protect positive safe amounts, source linkage, refund
  source/decision caps, aggregate bounds, revision allocation and immutable history.
  Nullable evidence is checked explicitly; SQL NULL cannot bypass the required
  refund approval or credit reason.
- The internal application port contains no Prisma imports. The infrastructure
  adapter reuses the existing Booking boundary/opaque transaction context. Ledger,
  owner writes, durable idempotency, audit and outbox can enlist together. Standalone
  serialization/unique-source races retry at most three times; enlisted failures
  propagate to the outer transaction so every participant rolls back together.
- Audit stores identifiers, amounts, revisions and state only. Outbox stores the
  three approved v1 event payloads, correlation and causation; source replay creates
  no second audit/outbox fact. Only publication bookkeeping may update an outbox row.

The persistence port accepts facts from authorized owner orchestration. W3/W5 must
perform real eligibility, authorization, commercial snapshot and refund-decision
checks before calling it. A storage test is not evidence of end-to-end deposit
confirmation, access promotion or VNPay verification.

## W2 migration rehearsal

New forward migration: `20261008006000_payments_billing_ledger`.
Existing migration files remain unchanged. No existing business tables, defaults,
indexes or data are changed by this migration.

The noninteractive `migrate dev --create-only` command declined migration creation.
The migration was generated using the pinned Prisma CLI's `migrate diff`; unrelated
changes inferred from existing manually authored SQL were removed before application.
Only the new Billing objects and their constraints/triggers were retained.

All rehearsals use the disposable PostgreSQL 17 container `wedding-pbw2-postgres`
on loopback port 55434, with process-scoped test/runtime/migration URLs. The existing
Booking container and shared database are outside this rehearsal.
The W2 container is stopped and automatically removed after verification; all its
temporary databases are disposed of. The portable pinned Node runtime is retained
locally for subsequent module waves.

- The migration-policy test deploys all 15 committed migrations through Prisma into
  an empty isolated schema, verifies successful migration history and rehearses a
  forward compensating change.
- The Billing upgrade test captures an existing confirmed Booking, immutable proposal
  with base/deposit amounts, audit, outbox and successful idempotency result immediately
  before the new migration. All remain identical afterward; no historical payment or
  charge is inferred. Existing proposal immutability remains enforced.
- The ledger tests create separate temporary databases from the complete migration
  history, then drop them after each suite.

## W2 evidence map

| Concern | Evidence |
| --- | --- |
| Exact accounting / PRN-006 source ownership | W1 accounting tests plus `application/billing-ledger.port.test.ts` and `tests/integration/payments-billing/ledger.test.ts` |
| Source replay / changed booking, amount or date | Concurrent accepted-source test: one row, one audit, one event; changed evidence conflicts |
| Atomic rollback | Ledger/head, Booking participant, idempotency claim, audit and outbox roll back on downstream failure |
| Source and approved refund caps | Two concurrent refunds produce one winner; excess refund is rejected without extra event |
| Immutable ledger / invoice / outbox | Direct database updates/deletes fail; only outbox publication fields may change |
| Attempt durability / state | A fresh repository instance reads persisted UNKNOWN and replays the same command; later expiry does not permit another attempt |
| SQL validation | Invalid/null evidence, cross-booking adjustment, unproven settlement, invalid amount and aggregate overflow are rejected |
| Forward compatibility | Existing Booking data and historical evidence remain identical across migration |
| Test sensitivity | Inverting the new source replay guard makes its concurrent replay test fail; the original source is restored |

Verification commands and final commit references are recorded in the W2 checkpoint
in `tasks/todo.md`. An initial legacy idempotency check read an unintended environment
URL and failed on a missing TLS CA file; both database URLs were then explicitly
pinned to the temporary database. A Windows fork-worker invocation crashed; the
unchanged idempotency tests both pass in a single-thread rerun. A combined thread
run exited without a result and a later fork run also aborted. These runner failures
are recorded, not counted as successful checks. No project test configuration or
test was changed to suppress them.

Initial runtime: Node 24.15.0 and npm 11.6.0. Final checks use the pinned Node 24.21.0
and npm 11.19.0 from a portable official distribution, whose archive SHA-256 is
verified against Node's published checksum. PATH changes are process-scoped; the
machine installation, repository pins and dependency lockfile remain unchanged.
Two consecutive 57-test focused/integration/migration runs pass on this runtime.

Final W2 gates: 47 focused tests in six files, all 819 unit tests in 79 files,
eight existing Booking integration tests and two legacy idempotency integration
tests pass. Typecheck, build, changed-file ESLint/Prettier and diff checks pass.

Portable runtime verification source:
[Node 24.21.0 published archive checksums](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt).

SQL trigger behavior was checked against the
[PostgreSQL 17 trigger documentation](https://www.postgresql.org/docs/17/trigger-definition.html).
ORM calls follow this repository's installed Prisma 7.10.0 and existing owner adapters.

## W3 charge and deposit orchestration

Commits on the same module branch:

- `b7f0fa4`: print charge/decision-credit services and fake/real conformance.
- `8d95c4a`: durable deposit application marker, owner-scope requirement and migration.
- `1dd5237`: authoritative deposit intent and recoverable settlement orchestration.
- `7a5ac1f`: real provider composition, owner race/recovery and upgrade tests.
- `7021228`: changed credit amount/date/booking/source rejection.

The print registrar maps an accepted immutable PRINT_ORDER revision to one charge.
Concurrent replay returns the same ID; changed booking/amount/date conflicts.
Cancellation/replacement credits reference the original charge and immutable
`sourceAdjustmentId`, preserve the approved reason, and cannot exceed that charge.
Changed credit evidence conflicts. The original source appears in an immutable
invoice snapshot. These tests invoke the real Billing port; SPEC-05's actual
commercial approval workflow is still a later consumer integration requirement.

Deposit creation accepts only booking/timeline/command identity. It authorizes the
own RESTRICTED or FULL grant without requiring a COUPLE role, checks fresh Booking
eligibility and the exact commercial snapshot, and ensures the reserved account
is the requesting account. The amount comes from Booking. A single shared scope
commits the attempt, reservation, base charge and evidence before returning.
Expiry is fifteen minutes. Same-command replay preserves the original snapshot;
changed timeline is 422 and a different unresolved command conflicts. No checkout
or provider network call is made by this W3 service.

The internal SYSTEM settlement worker requires a persisted SUCCEEDED VNPAY deposit
attempt with terminal evidence. It rechecks Booking immediately before first money
recording, preserves true late money when the booking is no longer payable, and
appends payment/audit/outbox once. Another shared transaction applies Booking's
recorder and its Identity promotion, then commits the completion marker. Failure
returns application PENDING with the payment retained. A new provider instance can
recover the same payment; completed replay skips fresh payability and creates no
second promotion, marker, payment or event. A changed settlement date conflicts.
An unavailable mandatory reader leaves the successful attempt durable for retry.

Technical rationale and the two transaction boundaries are recorded in
[ADR-005](../../docs/decisions/0005-recover-deposit-application-after-durable-settlement.md).
The new forward migration `20261008007000_billing_deposit_application` adds only the
immutable completion table and its proof/FK guards. It preserves all previous
migrations, indexes/defaults and business data. Prisma diff generated the new table
and FK; unrelated old-index/default/retention-name differences were removed before
application to the disposable database. Upgrade preserves W2 attempts, payments,
audit and outbox exactly and does not infer historical application success.

### Real provider gate and hand-off

- Inherited Booking baseline: `8ede8e5`; relevant provider implementation:
  `486638b7f9dbb7f6da00560cbabed2bf347ef933`,
  `src/modules/booking-lifecycle/booking-lifecycle.providers.ts`.
- Real Identity promotion implementation:
  `9a2c48b39520539b789ad3ac854d82d7f6ce8637`,
  `src/modules/identity-access/authorization/couple-access-promotion.ts`.
- Billing composition: `src/modules/payments-billing/payments-billing.providers.ts`
  at `7a5ac1f`. It injects one core transaction scope into Booking/Billing; Booking's
  recorder invokes the existing Identity promoter with the reserved account/payment.
- Booking/Identity PROVIDER_READY prerequisites are proved by their existing
  PostgreSQL conformance and these consumer tests. HTTP remains unwired. Full
  INTEGRATION_READY publication requires W6's committed API digest; module ACCEPTED
  remains pending. W3's trusted success fixtures are not VNPay signature evidence.
- Sequential owner/steward lane remains as approved in Section 21; this wave creates
  no concurrent writer, extra branch, API artifact or client lock change.

| W3 concern | Executable proof |
| --- | --- |
| PRN-006, print replay and immutable decision credits | `application/charge-registration.service.test.ts`; `tests/integration/payments-billing/charge-registration.test.ts` |
| Server amount, current timeline, concealed denial, restricted account | `application/deposit-orchestration.service.test.ts`; `tests/integration/payments-billing/deposit-orchestration.test.ts` |
| Same and distinct concurrent commands | Real deposit suite: one attempt/reservation/base charge; conflicts create no second intent |
| Reservation/provider failure | PostgreSQL trigger failure leaves no attempt, base charge, reservation or request audit; Booking remains DRAFT |
| Failure after real promotion and restart | Trigger at completion insertion rolls back Booking settlement/phase, Identity grant/role and owner evidence; retains one proven payment/event; concurrent restart retries complete once |
| Superseding timeline race | Exactly one of deposit reservation and actual owner timeline save wins |
| Late money and terminal replay | Ineligible booking keeps paid amount and RESTRICTED access, application PENDING; completed exact replay succeeds; changed date conflicts |
| Completion persistence and immutability | Added W3 ledger test rejects unscoped completion, proves rollback/reload and rejects marker update/delete |
| Empty and W2 upgrade | `migration-policy.test.ts` deploys all sixteen migrations; `application-upgrade.test.ts` preserves existing Billing history with no inferred marker |

### W3 verification

Pinned Node 24.21.0/npm 11.19.0 and an independent disposable PostgreSQL 17 container
`wedding-pbw3-postgres` on loopback 55434 are used. All three database variables are
process-scoped to that database. The previous Booking container is untouched.

- Initial combined Billing/migration gate: 70 tests in eleven files pass. A later
  base-revision retention unit test is included in the full unit gate below.
- Final PostgreSQL gate: 29 tests in nine files pass (twenty Billing integration/
  upgrade tests, eight existing Booking tests and one migration-policy test).
- Changed-module ESLint/Prettier, backend typecheck/build, diff check and targeted
  secret-pattern scan pass. The forward migration deploy/status check is current.
- Inverting the eligibility guard fails eight deposit unit tests; the original is
  restored before final checks. Initial implementation/fixture/typing/lint failures
  were fixed; no test or gate was skipped, removed or weakened.

The full unit result and final cleanup are recorded in the W3 checkpoint in
`tasks/todo.md`. Provider IPN verification/reconciliation stays with W4, Manager
manual/balance/refund flows with W5, and route/API publication with W6.

## W4 VNPay verification and reconciliation

Source commits on the same module branch:

- `a8973f0`: official PAY/IPN canonical form and querydr pipe signatures.
- `21b2b84`: immutable checkout, normalized proof and transaction claim storage.
- `06f42ad`: complete backend-only merchant configuration and validation.
- `6775dfc`: checkout, durable callback acknowledgement and reconciliation services.
- `5381af0`: bounded sandbox transport, real composition and provider amount bound.
- `28af844`: real Booking/Identity concurrency, fault recovery and upgrade fixtures.
- `17ea68d`: strict streamed response bytes and test typing.
- `071ffa5`: signed foreign-currency evidence quarantine.
- `4810f29`: expired UNKNOWN reservation and conflicting ReturnURL hint proof.
- `09c9c35`: completed historical W3 application status without invented provider proof.

### Protocol and durable decisions

The mapping follows the official
[PAY/IPN documentation](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html)
and [querydr documentation](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html),
checked 2026-10-08. Controlled fixtures adapt the published sandbox response shape,
use an independently assembled checksum and a test-only merchant key, and never
contact VNPay. PAY uses sorted encoded parameters; querydr uses the separately
specified request/response pipe order, including empty optional fields. HMAC-SHA512
comparison is constant-time. Duplicate decoded keys, unsupported fields, invalid
amount scaling, merchant/order mismatch and invalid calendar dates are rejected.

Checkout derives the amount and fifteen-minute window from the persisted Booking
deposit attempt. Provider amount is limited to twelve scaled digits before claiming
the intent. Checkout saves thirteen safe parameters without hash/signature/secret,
then commits PENDING before returning the locally signed URL. Replay preserves its
original IP, return URL, create date and expiry. ReturnURL verification writes no
money or owner state and rejects a signed currency conflict.

IPN runs as internal SYSTEM, without a trusted client account or role. The shared
boundary commits normalized proof, its deduplication decision and attempt/Booking
transition before acknowledgement. Amount mismatch returns 04, invalid signature
97, missing order 01, conflict/storage failure 99, first accepted receipt 00 and
accepted replay 02. A signed unsupported currency is retained as CONFLICT with a
minimal CURRENCY reason; no raw provider payload, bank/card data or signature enters
storage/audit. Merchant/normalized positive transaction claims prevent reuse across
attempts; transaction zero remains unclaimed. Contradictory terminal proof and
changed positive-transaction IPN payloads cannot replace terminal evidence.

Only response/status 00/00 proves success. Verified status 02 can prove failure with
the appropriate IPN/query response. Other statuses, invalid query evidence, missing
orders and transport timeout remain UNKNOWN. Expiry never releases that reservation.
Queries run outside the transaction against the fixed sandbox endpoint with a fresh
request ID, original transaction date, five-second abort deadline, no redirects and
a 16 KiB response cap. An IPN winning during a timed-out query remains terminal.

Accepted success invokes ADR-005's recoverable real-owner worker. A money-write or
owner failure retains the committed proof for retry. Reconciliation skips provider
queries for terminal attempts and records the same payment/application once. True
late money on a cancelled booking remains retained with application PENDING and
RESTRICTED access. Historical terminal attempts with no stored VNPay proof are not
invented or queried again: unapplied history stays PENDING, while a preexisting
immutable completion marker still returns application SUCCEEDED.

Configuration uses four server variables, all blank to disable or all valid to
enable. Errors disclose variable names only. The real factory returns `vnpay: null`
when disabled; W6 must reject unavailable checkout before claiming an intent.

### Migration and PB-C2 provider review

Forward migration `20261008008000_vnpay_provider_evidence` adds three immutable
Billing tables, unique proof/transaction identities and SQL claim/checkout guards.
All sixteen earlier migrations remain unchanged. Fresh and W3 upgrade rehearsals
preserve money, completion markers, grants, audit, outbox and idempotency history;
no historical checkout or provider proof is inferred.

The real Billing factory at `5381af0` retains W3's shared Booking/Billing scope and
Identity promotion. Booking and Identity provider references in the W3 hand-off
remain applicable. Source review checks transaction boundaries, bounded transport,
exact VND arithmetic, replay/claim uniqueness, audit minimization, disabled settings
and historical compatibility. No new public owner contract, event, route, OpenAPI
artifact, dependency or client lock is changed. PB-C2 proves the internal real money
and access composition; W6's immutable API digest and W8 owner acceptance remain
required for INTEGRATION_READY publication and ACCEPTED respectively.

| W4 concern | Executable proof |
| --- | --- |
| Official canonical/pipe signatures, decoded aliases, amounts and dates | `infrastructure/vnpay.protocol.test.ts` |
| Backend config completeness and secret-safe failures | `src/config/env.test.ts` |
| Fixed endpoint, timeout, response byte cap and malformed responses | `infrastructure/vnpay.gateway.test.ts` |
| Durable acknowledgement and invalid signature without owner reads | `application/vnpay.service.test.ts`; real proof-insert fault in `vnpay.test.ts` |
| Concurrent duplicate IPNs/query, reordered proof and transaction reuse | `tests/integration/payments-billing/vnpay.test.ts` |
| UNKNOWN expiry pinning, query recovery and timeout-after-IPN race | Real VNPay suite with controlled transport and clock |
| Money-write failure, restart, one payment/promotion/event/marker | Real VNPay suite through actual Booking and Identity providers |
| Late cancellation and historical status | Real VNPay suite; `vnpay-upgrade.test.ts` |
| Immutability, scoped rollback, changed proof and audit redaction | `vnpay-evidence.test.ts` |
| Fresh/upgrade history | `migration-policy.test.ts`; `vnpay-upgrade.test.ts` |

Design rationale: [ADR-006](../../docs/decisions/0006-durable-vnpay-evidence-and-reconciliation.md).

### W4 final verification

Pinned Node 24.21.0/npm 11.19.0 and disposable PostgreSQL 17 on loopback 55434 are
used. `DATABASE_URL`, `MIGRATION_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL`
are all process-scoped to this container. No test reads the actual environment's
database implicitly or uses a live merchant credential.

An isolated full coverage run at `4810f29` passed all 1,016 tests in 126 files
(96.83% lines, 93.20% branches). After the historical compatibility fix, final
checks use a temporary Vitest execution profile importing the unchanged repository
configuration. It retains the full test inventory, coverage include/exclude/reporters
and 80% line/branch thresholds per file. One fork worker reuses modules for 121 files;
the five files declaring module mocks run isolated:

- `src/core/http/lifecycle.test.ts`
- `src/modules/venue-catalog/venue-catalog.runtime.test.ts`
- `src/core/observability/observability.test.ts`
- `src/core/observability/instrumentation-observability.test.ts`
- `tests/integration/security.test.ts`

Discovery confirms 126 unique files without duplicate or omitted suites. The
profile sets `extends: false` on each inline project to avoid Vitest 5 merging the
root include list into the isolated subset; each project copies the original test
options, with only its isolation and file selection differing. Root coverage remains
the original configuration. Repository configuration and baseline tests are unchanged.

Parallel early gates encountered migration/test timeouts under load and were stopped.
A later separate fully isolated integration run timed out in two five-second tests
(VNPay concurrency and existing Booking collaboration), despite both passing in the
preceding full isolated coverage run. Fully shared workers exposed cached-module
mock conflicts in existing server/runtime tests. Those attempts are not counted as
successful gates. The final profile isolates every module-mock suite; no test,
production transaction deadline, timeout, coverage target or assertion is weakened.

Final source: `09c9c35084f1eb784ff538534a78227db00c49ce`.

- Full coverage: 1,016/1,016 tests in 126 files; 96.82% lines, 93.19% branches.
  Every included source file meets both unchanged 80% thresholds.
- Separate real integration gate: 133/133 tests in 36 files.
- Separate contract gate: 22/22 tests in six files.
- Commands: `vitest run --coverage --config <temporary-profile> --maxWorkers=1
  --pool=forks`, then the same profile/worker options with `run tests/integration`
  and `run tests/contract`. Coverage and those suites run sequentially.
- Targeted source scan finds no private-key/live-key patterns or sensitive-file
  changes. Controlled fixture keys are explicitly test-only; persisted proof and
  audit redaction are exercised by real PostgreSQL tests.

- Full backend `format:check`, `lint`, `typecheck`, `api:generate`, `api:check`,
  `build` and `audit:ci` pass. Audit uses the two preexisting documented, unexpired
  exceptions 1145093 and 1153173; no dependency/lockfile change is made.
- `db:migrate:deploy` applies the W4 migration to the independent rehearsal database;
  `prisma migrate status --config prisma.config.ts` confirms all seventeen migrations
  are current. The complete-history and W3 upgrade tests above also pass.
- `git diff --check` passes. Generated OpenAPI and the contract baseline remain
  identical to W3. Approved planning/evidence Markdown stays manually formatted
  under the existing Prettier ignore policy.
- The disposable `wedding-pbw4-postgres` container and its temporary databases are
  stopped/removed. The temporary Vitest profile is removed. The preexisting Booking
  container on loopback 55433 is untouched. All four repos retain the same
  `codex/payments-billing` branch; client working trees are unchanged. Local commits
  only; no push, PR, HTTP publication or owner acceptance is performed.

PB-C2 technical checkpoint complete. Progress: W1-W4 complete, 4/8 waves and 16/32
microtasks; final SPEC-04 acceptance remains pending W5-W8.

## Remaining acceptance

W5-W8 remain open: Manager manual/refund approval flows, safe invoice/reporting reads,
HTTP/OpenAPI publication, generated clients, three client UIs and final four-repository
acceptance. Real Booking/Identity providers must be proved at the integration gate;
storage fixtures do not replace that evidence.

The W4 provider orchestration and checkout guards currently target DEPOSIT. W5
owns BALANCE eligibility/outstanding checks and the corresponding provider intent,
settlement and forward storage changes before W6 exposes those routes.
