# SPEC-04 Payments and Billing implementation evidence

Status: **W1-W6 verified; W7 implemented; W8 real-owner backend and browser
acceptance recorded. Android runtime remains unverified; module ACCEPTED pending.**
Authority: approved `SPEC-payments-billing.md`, `WEDDING-CONTRACT-1@1.1.0`,
and the eight-wave plan in `tasks/plan.md` Section 21.

## Branch and scope

All four repositories use `codex/payments-billing` for W1-W8. Verified increments
are committed on that branch. W1-W6 change only the backend. W7 adds billing to
the three clients while retaining their Booking baseline. W6 publishes the seven approved
HTTP routes and immutable OpenAPI artifact. W8 adds the authenticated real-owner
acceptance test. Module ACCEPTED awaits native runtime review and the owner decision.

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

## W5 manual operations, balance and immutable views

Implemented 2026-10-09, continuing the single `codex/payments-billing` branch.
Focused backend increments preserve the approximate five-authored-file limit:

- `24df096`: strict internal money commands and normalized evidence schemas.
- `7986655`: forward operation/approval/reporting storage, SQL guards and real storage tests.
- `925a060`: atomic Manager manual settlement, recorded approval/refund, balance and invoice operations.
- `d4aa9eb`: signed balance checkout and W4 evidence repository expansion.
- `0daad55`: recoverable VNPay BALANCE settlement, immutable proof and recollection guards.
- `56df457`: authorized invoice/history reads, baseline BillingReader and fenced reporting.
- `270bfb3`: owner rollback, independent refund limits, cancellation and W4 upgrade proof.
- `26314e4`: shared produced-reader conformance against controlled fake and real adapters.
- `8694833`: same operation command reused for another authorized booking returns stable 422.

Final implementation source: `8694833004817dc271bca60dfd28e1861479036a`.
Real composition remains `src/modules/payments-billing/payments-billing.providers.ts`.
Booking and Identity versions recorded in W3 remain unchanged. New internal ports:
`application/billing-operations.port.ts`, `billing-operations.service.ts` and
`billing-views.service.ts`; baseline produced reader signatures/DTOs are unchanged.

### Money, authority and replay

Active Manager authority is loaded from the database, never request roles. Manual
DEPOSIT uses the current eligible timeline and accepted commercial deposit amount.
Its receipt, attempt, base/payment facts, reservation, same-account FULL/COUPLE
promotion, application marker, command and audit/outbox commit in the shared Booking
boundary. A forced final command failure rolls all participants back.

Full authorized VNPay BALANCE is server-derived from exact current outstanding;
manual BALANCE may be partial but cannot exceed it. Both require the expected ledger
revision and CONFIRMED/COMPLETED phase. CREATED/PENDING/UNKNOWN attempts block another
collection, as does durable SUCCEEDED proof with no appended payment. UNKNOWN expiry
does not release collection. Controlled query/IPN recovery applies the original
frozen money once, without deposit release or another account promotion. True late
money after credit/cancellation remains recorded as explicit credit.

Operation replay compares actor, kind, booking and normalized submitted intent
before rechecking changing eligibility/revision. Same key and changed intent is 422;
stale revision, active attempt and limit conflicts are 409. Manager mutation denials
are 403; unauthorized private reads/foreign approvals are concealed 404. A same
balance intent preserves checkout amount, dates, IP and URL after restart/replay.

Refund approval is an immutable Manager decision against an owned print credit or
an owned CANCELLED Booking reporting sequence. Fresh IDs cannot reset the summed
basis budget. Refunds load the recorded decision and recheck both remaining source
payment and approved decision caps under the booking lock. Amounts remain positive
safe integer VND; reason/evidence are retained privately. Refund appends a fact/event
and does not mutate original payment, Booking state or Couple access.

### Read models and migration

Immutable invoice issuance freezes server number/time, source ledger revision, exact
totals and line sources and never collects money. Authorized safe reads include
charge/payment/refund/credit kinds, amounts, source revisions, source entry links and
billing revisions. Reasons, receipt references, approval caps and provider material
are omitted. History pagination binds booking and a fixed ledger revision, preserving
both page order and totals after later appends.

The context-bound baseline BillingReader returns only the approved four receivable
totals or a completed deposit proof with the immutable application marker. Manager
reporting uses immutable minimal snapshots and a fixed committed global sequence,
with strict cursors and current database authority.

Migration `20261009001000_billing_operations_reporting` adds four Billing tables and
expands W4 checkout correlation forward for BALANCE. All seventeen prior migrations
remain unchanged. It backfills one safe current report for each historical ledger,
without inventing retrospective commands or approvals. W4 upgrade proof preserves
all original money, attempts, invoices, successful application, checkout/proof/claims,
grants/roles, audit and owner/Billing outbox exactly.

### Executable W5 requirement mapping

| W5 microtask | Executable proof |
| --- | --- |
| Manager manual evidence and bounded balance | `operations.port.test.ts`; `operations.test.ts`; `operations-safety.test.ts` |
| Locked source/approved manual refund | Two-refund race and independent cap tests; approval-budget race; real Booking cancellation; SQL immutable decisions |
| Immutable invoice/receivable history | `views.test.ts`: exact 4,000,001 charge, 1,000,001 credit/refund, revision/source links, print replay, frozen invoice and fixed history/report fence |
| Real races, replay and redaction | `balance-vnpay.test.ts`, `operations.test.ts`, `operations-safety.test.ts` and fake/real `readers-conformance.test.ts` |
| Fresh/upgrade storage and authority | `operations-storage.test.ts`, `operations-upgrade.test.ts`, complete migration policy rehearsal |

The balance limit sensitivity experiment temporarily inverts the new manual limit
condition. The bounded partial balance test fails immediately; the original source
is restored byte-for-byte before the final gates. A separate regression reproduces
409 on cross-booking command reuse, then passes with the required 422 error.

Early focused runs exposed strict DTO spreads and a TypeScript union narrowing
issue; explicit persistence inputs and a narrowed credit source fix those failures.
Fixture corrections use a real Identity Manager account, relation-based application
counts and an existing owned restricted grant. No database grant constraint is
weakened to accommodate a test.

The first full backend attempt fails twelve foundation tests because its disposable
main database had no deployed schema; module fixtures had independently deployed all
eighteen migrations. That attempt is not accepted. Deploy/status then initializes
the pinned main rehearsal database, and all fourteen targeted foundation/storage
tests pass before repeating the full gate. No actual/shared database is involved.

### W5 final verification

Pinned Node 24.21.0/npm 11.19.0 and disposable PostgreSQL 17 on loopback 55434 are
used. All three database variables are process-scoped to this rehearsal container;
no live provider credential, actual environment database or network VNPay call is used.

- Full backend coverage: **1,052/1,052 tests in 134 files**, 96.86% lines and 93.18%
  branches. Every included source file meets both unchanged per-file 80% thresholds;
  the coverage summary is checked for all 136 included source records.
- Separate real integration gate: **162/162 tests in 43 files**.
- Separate contract gate: **22/22 tests in six files**.
- Full `format:check`, `lint`, `typecheck`, `api:generate`, `api:check`, `build`
  and `audit:ci` pass. Audit retains only the two preexisting documented, unexpired
  exceptions 1145093 and 1153173; no package or lockfile change is introduced.
- `db:migrate:deploy` succeeds on empty PostgreSQL and migration status confirms all
  eighteen migrations current. Complete migration-policy and W4 upgrade tests pass.
  Only the new forward migration differs from W4.
- `git diff --check` and the targeted private/live-key source scan pass. No sensitive
  environment/key file is changed. The contract baseline, generated OpenAPI and all
  three client locks remain unchanged.

As in W4, a temporary Vitest profile imports the original repository configuration.
It retains the complete 134-file inventory and original coverage include/exclude,
reporters and thresholds. One fork worker shares modules for 129 regular suites and
isolates the same five module-mock suites listed in the W4 section. `extends: false`
keeps the inline project file sets disjoint. Discovery matches the physical inventory;
no test, timeout, assertion, repository configuration or numeric threshold is weakened.
Full coverage, standalone integration and contracts run sequentially with this profile,
`--maxWorkers=1 --pool=forks`; other gates use the installed repository tools.

The disposable `wedding-pbw5-postgres` container, temporary Vitest profile and old
schema copy are removed. The existing `wedding-bk17-postgres` on loopback 55433 remains
running and untouched. The portable pinned Node runtime remains available for the
next wave. All four repositories keep the single `codex/payments-billing` branch,
and client working trees are unchanged. Focused local commits only; no push or PR.

All four W5 microtasks are closed. Progress: **5/8 waves and 20/32 microtasks**.
PB-C3 and immutable API publication await W6; this does not mark SPEC-04 ACCEPTED.

### W5 hand-off to W6 and remaining acceptance

Design rationale and recovery details:
[ADR-007](../../docs/decisions/0007-manual-billing-approval-and-ledger-views.md).
W5 exposes internal owner operations; it adds no runtime HTTP route, new OpenAPI
digest, dependency, contract amendment or client lock. W6 must keep the approved
public DTOs, resolve timeline/ledger head/recorded refund decision/server time from
authoritative data and replay the stable public intent before deriving new metadata.
Recovery after committed money but missing HTTP response must reuse the committed
source attempt, decision and timestamp. Unavailable VNPay fails before a new intent.

W6-W8 remain open: authenticated HTTP/OpenAPI publication, generated clients,
Management Web/Public Web/Android billing experiences and final four-repository
acceptance. PB-C3 completes after W6, and owner ACCEPTED remains with W8.

## W6 authenticated HTTP and immutable OpenAPI

Completed 2026-10-09. The preceding W5 hand-off records its historical checkpoint;
this W6 record supersedes its pending HTTP/OpenAPI status.

### Exact backend hand-off

- Final tested source commit: `40bc1d279cc6514f2cadbb17fdd6a393e2e3b0f4`.
- Latest generated artifact commit: `3d561ad`; that exact artifact is included in
  the final source commit above. W7 must read the committed artifact from that source.
- `openapi/openapi.sha256`:
  `056df7eb37bc9ff8892bdd1271791e0919f8b03db3c6ddb9d4891a5b869c3408`.
- Focused local commits: `274fe35` strict schemas; `580c488` durable HTTP intents;
  `1297553` authorized routes and owner recovery; `a1082e6` OpenAPI publication;
  `89e55eb` runtime/lifecycle; `4172277` recovery/race tests; `3d561ad` shared IPN
  query documentation; `40bc1d2` current Staff-only authority correction.

No dependency, lockfile, Prisma schema, migration or active contract-baseline change
is introduced in W6. All three client trees and contract locks remain unchanged;
their generated-client updates and UI work belong to W7.

### Published routes and authority

Paths below are mounted under `/api/v1` and retain SPEC-04 Section 9's public DTOs.

| Method | Path | Authority |
| --- | --- | --- |
| POST | `/bookings/{bookingId}/payments/deposit` | Eligible owned RESTRICTED/FULL grant; amount derived by server. |
| POST | `/bookings/{bookingId}/payments/balance` | Owned FULL grant or Manager; server derives full outstanding. |
| POST | `/management/billing/payments/manual` | Current Manager; existing deposit/balance rules apply. |
| POST | `/management/billing/refunds` | Current Manager; recorded approval and source caps apply. |
| GET | `/bookings/{bookingId}/payments/{attemptId}` | Manager or owned grant; RESTRICTED sees its deposit attempt only. |
| GET | `/bookings/{bookingId}/billing` | Current Manager or owned FULL grant; fixed-revision paginated history. |
| GET | `/billing/callbacks/vnpay` | Verified raw provider signature/correlation; provider acknowledgment. |

- Strict shared request/response schemas reject authority overrides, client amounts
  on checkout, client approval limits/decision IDs and derived booking metadata.
  Safe integer VND, bounded evidence/reason, query limits and revision fences are
  validated. Response whitelists conceal provider proof, bank/signature material.
- Real Identity sessions and current active database roles/grants govern requests
  and cached replays. Foreign resources return concealed 404; missing authentication
  returns 401; insufficient own access returns 403. Staff-only accounts are denied
  even with an erroneous grant. Legitimate Staff/Couple dual roles preserve owned
  Couple access. Real session revocation and removal of Manager/Couple authority
  cannot reuse a cached success. Private responses use `Cache-Control: no-store`;
  denial audit contains identifiers and stable codes without submitted evidence.
- Mutations use core durable idempotency and a separate two-integer PostgreSQL
  advisory request mutex. Same-key concurrency returns canonical core
  `409 REQUEST_IN_PROGRESS` with `Retry-After: 1`; changed public intent returns 422.
  Stable actor/route/key command identity excludes processing clock. The durable
  claim is persisted before the owner commits; terminal replay is exact, 4xx is
  retained, and 5xx remains recoverable. Money and Booking/Identity/audit/outbox still
  commit atomically inside the existing booking owner boundary.
- Recovery checks the committed owner result before resolving a new timeline,
  billing head, server timestamp or refund approval. Injected failures immediately
  after committed manual deposit/refund recover the original IDs despite changed
  booking state, ledger head or consumed approval. New refunds select a stored
  approved decision with sufficient remaining cap; the owner rechecks revision,
  source and approval limits transactionally. No automatic refund approval is added.
- Billing pagination stays at its original revision after later money is recorded.
  UNKNOWN never becomes a guessed failure; repeated balance collection is blocked.
  Attempt status separates verified settlement from downstream application status.
  ReturnURL is display-only. Disabled VNPay fails before creating a claim/attempt.
- IPN preserves the raw query, rejects duplicate/unknown fields, and documents its
  provider parameters from the existing verifier schema. HTTP 200 acknowledgment
  classes 00/02/01/04/97/99 are proved. It has no bearer or client idempotency-key
  requirement and keeps the provider body outside the application error envelope.
- Server composition initializes and closes the real billing runtime. An actual
  database query verifies startup after Prisma's lazy adapter connection; failed
  billing startup closes previously initialized owner resources.

Recovery, error naming and mutex rationale:
[ADR-008](../../docs/decisions/0008-recover-billing-http-intents-before-metadata-resolution.md).
Canonical in-progress naming follows inherited SPEC-core-platform Section 10.4;
SPEC-04's earlier `IDEMPOTENCY_REQUEST_IN_PROGRESS` wording describes that condition.

### Requirement and proof trace

| W6 obligation | Final-source proof |
| --- | --- |
| Strict seven-route schemas and safe output | `payments-billing.schemas.test.ts`; `payments-billing-openapi.test.ts`; authenticated HTTP tests. |
| Deposit/promotion and manual balance/refund authority | `http.test.ts`; real session/database authority in `runtime.test.ts`; W3/W5 owner suites retained in the full gate. |
| Retry, changed-body keys, concurrency and post-commit recovery | `http-idempotency.test.ts`; `http-recovery.test.ts`; W4/W5 callback, balance/refund and transaction suites retained. |
| Provider acknowledgment, UNKNOWN and disabled integration | `http.test.ts`; existing verified VNPay callback/reconciliation suites. |
| Immutable invoice arithmetic and redacted effects | W5 invoice/accounting/audit/outbox integration suites retained and passing. |
| Deterministic publication and runtime lifecycle | OpenAPI contract tests and `api:check`; real billing runtime tests; core lifecycle tests. |

The Staff-only regression first failed with actual 201 versus expected 403; its
correction passes while proving legitimate dual-role behavior. The unreachable
database startup test first exposed lazy connection success, then passed after
the explicit query. A temporary inverted Manager predicate caused the intended
manual-payment test failure; original source bytes were restored before final gates.
Earlier intermediate test runs are superseded by the final source results below.

### W6 final verification

Pinned Node 24.21.0/npm 11.19.0 and disposable PostgreSQL 17.11 on loopback 55434
are used. Database URLs are process-scoped to `wedding-pbw6-postgres`; environment
files are unchanged. Eighteen migrations deploy successfully onto the empty rehearsal
database, and final migration status confirms all eighteen current. Schema/migrations
are unchanged from W5. Automated tests use controlled provider doubles and signed
sandbox fixtures, with no network VNPay call or live merchant credentials.

- Full coverage: **1,077/1,077 tests in 140 files**, **96.93% lines**, **93.22%
  branches**, 98.65% functions and 96.38% statements; duration 287.38 seconds.
  All **142 source coverage records** meet unchanged per-file 80% line/branch bars.
- Separate real integration: **180/180 tests in 47 files**, 272.74 seconds.
- Separate contract gate: **25/25 tests in seven files**, 4.83 seconds.
- Full `format:check`, zero-warning typed `lint`, `typecheck`, `api:generate`,
  `api:check`, production `build`, `audit:ci` and `git diff --check` pass.
  Audit retains only preexisting documented, unexpired exceptions 1145093/1153173.
- Working and committed generated artifact digests match the exact value above.
  Final source has no uncommitted code/test/artifact changes after the gates.

The temporary runner imports the original Vitest configuration and retains the
complete 140-file inventory and original coverage include/exclude/reporters/thresholds.
One fork worker shares modules for 135 regular suites and isolates all five module-mock
suites: core HTTP lifecycle; Venue runtime; both core observability suites; integration
security. Disjoint inline projects use `extends: false`; discovery matches the physical
inventory with no omitted file. Assertions, deadlines and numeric thresholds are
unchanged. Coverage, standalone integration and contracts run sequentially using
`--maxWorkers=1 --pool=forks`; other gates use the installed repository tools.
Ignored local logs are retained under `test-results/pbw6/`.

The owned disposable `wedding-pbw6-postgres` container is stopped and auto-removed;
the exact temporary runner file and its empty directory are removed. No other
database/container is operated on. The portable pinned Node runtime is retained.

All four W6 microtasks and the **PB-C3 technical checkpoint** are closed. Progress:
**6/8 waves and 24/32 microtasks**. W7/W8 retain eight open microtasks for generated
clients, billing experiences and four-repository owner acceptance. This does not mark
SPEC-04 ACCEPTED. All work remains on the single `codex/payments-billing` branch per
repository, with local commits only and no push or PR.

## W7 generated clients and billing experiences

W7 implements the three client experiences on 2026-10-09. Backend runtime, schema,
migrations, baseline and OpenAPI remain unchanged. The first three microtasks are
closed. The fourth has automated/browser proof, with Android runtime explicitly
deferred by the owner as recorded below. W8 and module ACCEPTED are not claimed.

### Immutable hand-off and commits

All three `api-contract.lock.json` files pin backend source
`40bc1d279cc6514f2cadbb17fdd6a393e2e3b0f4`, path `openapi/openapi.json`, SHA-256:

`056df7eb37bc9ff8892bdd1271791e0919f8b03db3c6ddb9d4891a5b869c3408`.

Generated declarations are reviewed separately from authored feature files.
Each client passes `api:check` before network integration and again on final source.
No dependency, environment, baseline or public contract changes are introduced.

| Repository | Generated contract | Gateway, journal and UI increments | Final client source |
| --- | --- | --- | --- |
| Management Web | `27579a1` | `216ed20`, `23e891d`, `c71195a`, `44a121d`, `0990918`, `39d51af`, `bae87c2` | `0b573a9` |
| Public Web | `2481d1a` | `ed8665c`, `0a46b9b`, `6fa8191`, `ca0f2e3`, `fbc03ca` | `c5e6e0a` |
| Android | `209b06b` | `99102ee`, `3d84157`, `3604844`, `e15be7b`, `b33368e` | `3866846` |

All commits remain on the same `codex/payments-billing` branch per repository.
No branch split, push, PR, merge or deployment occurs.

### Delivered behavior and proof

- Management Web adds `/billing`, Manager navigation, six returned totals, immutable
  history and safe attempt status. Staff and anonymous presentations have no billing
  controls. Manual evidence includes purpose, positive integer VND, settled time,
  reason and receipt reference, followed by confirmation. Refund selects a loaded
  PAYMENT source and confirms evidence plus original expected billing revision.
  The server checks recorded approval/caps; the UI never creates approval or sends
  a bank transfer. Successful money recording stays successful if its refresh fails.
- Public Web adds `/billing` and workspace navigation. Current per-booking FULL
  access permits totals/history and balance collection; RESTRICTED permits the
  proposal's deposit amount, authorized deposit initiation and deposit status only.
  Access downgrade and 401/403/404 remove private billing/attempt data. Checkout
  bodies contain only the generated timeline UUID or expected billing revision.
- Android adds its billing route and Home navigation. It retains CONTRACT-BASELINE
  Section 8.3's FULL grant plus CONFIRMED/COMPLETED booking gate. Prospects are
  directed to Public Web. Totals, balance confirmation and verified status use the
  same generated contract. Fixed-revision history holds one page with next/previous
  navigation. Actions use the installed native `@expo/ui` components and existing
  theme; opening a browser alone never marks money as received.
- Each client journals an actor/operation/booking-scoped command UUID, hashes and
  minimal original replay metadata. Receipt/reason text, amounts and tokens are not
  persisted there. Network/timeout/5xx/REQUEST_IN_PROGRESS retains the command;
  changed evidence is blocked; exact retry/reload restores the original revision
  even after the current head advances or outstanding reaches zero. Corrupt or
  unavailable storage fails before money execution.
- Checkout/attempt IDs survive navigation as nonsecret IDs only. Provider return
  fields are ignored. A restored attempt must be read authoritatively before another
  collection is enabled; failed status reads keep collection blocked. UNKNOWN hides
  the continuation link and never becomes failure due to expiry. Settlement success
  and downstream application completion are displayed separately.
- Responsive screens preserve the existing ivory/forest visual system, sentence-case
  Vietnamese, 44px controls, visible focus and contained horizontal history scrolling.
  UUIDs do not stretch the page. Browser screenshots are inspected directly.

[ADR-009](../../docs/decisions/0009-preserve-client-billing-intents-and-authoritative-status.md)
records retry persistence and platform/access decisions. Gateway, journal, display,
form and page/screen test suites prove the exact DTOs, authorization, fixed fences,
confirmation, uncertain retry, stale response, post-success read failure, denial,
restricted privacy, reload recovery and settlement/application separation.

The original revision regression first fails before the pending-metadata helper
exists, then passes with recovery. Temporarily reversing metadata precedence in
Android's helper fails its recovery test; original bytes are restored before final
gates. Thresholds, assertions and deadlines are not reduced. Coverage is expanded
to include the new billing source in each client.

### W7 final local verification

Pinned Node 24.21.0/npm 11.19.0 are used. Every client passes full `format:check`,
zero-warning `lint`, `typecheck`, `api:check`, `test:coverage`, `build`, `audit:ci`
and `git diff --check` on the final committed source.

| Client | Full tests | Lines | Branches |
| --- | --- | --- | --- |
| Management Web | 124/124 in 18 files | 97.43% | 92.84% |
| Public Web | 85/85 in 11 files | 98.16% | 95.88% |
| Android | 54/54 in six suites | 97.92% | 90.47% |

Web per-file 80% line/branch bars and Android's original global bars remain unchanged.
Fully covered gateway files are present in JSON summaries even when the text reporter
hides them. Android's production export succeeds. Expo Doctor 1.20.4 passes all
**21/21** checks on the final retry; earlier network/metadata fetch errors are
superseded and are not counted as green checks.

### Browser runtime review and Android exception

An isolated headless Edge context runs each web client against a loopback HTTP
fixture matching W6 DTOs, using fixture-only accounts and inputs. The fixture and
process-only development base URL do not change production sources or environment
files. No live VNPay call, merchant credential or real money operation is involved.
Existing personal browser sessions are not used.

The review captures **21 screens**, with 1440px and 390px viewports. It exercises
anonymous/Staff denial, loading, server totals, fixed-revision pagination, manual
confirmation, uncertain manual retry with identical key/body, refund confirmation
and success, empty history, cached background error, FULL Couple balance,
checkout pending, UNKNOWN, settlement/application pending, success, denied access,
and RESTRICTED deposit/status. Reloading a remembered UNKNOWN attempt still blocks
collection. No page-level horizontal overflow, unexpected console error or page
exception is recorded.

Ignored local artifacts are retained in backend `test-results/pbw7/`:
`browser-review.json`, `browser-review.txt`, `browser-review.cjs`,
`runtime-fixture.mjs` and 21 screenshots. Client final logs use
`test-results/pbw7-final-*.txt`; coverage summaries remain in each ignored
`coverage/` directory. These fixtures prove client transport/display behavior;
W8 must still prove the real Booking/Identity/Billing/database/provider journeys.

**Android runtime is not verified.** The owned emulator booted and Expo Go 57.0.9
was available, but automatic approval review rejected both Expo startup attempts
(including localhost/offline), without a specific reason. On 2026-10-09 the owner
explicitly selected **“Ghi rõ Android runtime chưa kiểm tra”**. No alternate startup
is used to bypass that rejection. No native rendered-screen, keyboard, font-scale,
dark-mode, back-navigation or provider-browser claim is made from Jest or export.
This remaining W7 check is carried into W8 by that owner decision.

Owned fixture/web processes and emulator are stopped. The portable Node runtime
and ignored proof artifacts are retained. Next's automatically changed mode-specific
`next-env.d.ts` imports are restored to the original committed mode; API declarations
retain the verified frozen artifact. Backend code and all eighteen migrations stay
at W6. Documentation receives only W7 evidence, checklist status and ADR-009.

W7 implementation is complete with three closed microtasks and a partially verified
fourth. **27/32 microtasks are closed**; Android runtime plus all four W8 tasks
remain. PB-C4, owner ACCEPTED and dependent print acceptance stay pending.

## W8 cross-repository acceptance

Date: 2026-10-09. The owner requested W8 on the existing shared feature branch.
No production code, migration, API contract, dependency or accounting policy changes
are needed by this acceptance increment.

### Source and contract trace

| Repository | Verified source commit | W8 change |
| --- | --- | --- |
| Backend | `3eb58e581b4476e653d3d567acac7c00c5ec2319` | Authenticated acceptance fixture and cross-owner journey test. |
| Public Web | `c5e6e0a56d8274bd09abbca3c592a00472f732aa` | Existing W7 implementation verified with real API. |
| Management Web | `0b573a98d3263de0a53bf4350a88e61c1d56176f` | Existing W7 implementation verified with real API. |
| Android | `3866846079da2c44d6be0ab6a318ac2f36a03b52` | Automated gates/export verified; native runtime unverified. |

All repositories retain `codex/payments-billing`. All three client locks still pin
backend artifact source `40bc1d279cc6514f2cadbb17fdd6a393e2e3b0f4`, with OpenAPI
SHA-256 `056df7eb37bc9ff8892bdd1271791e0919f8b03db3c6ddb9d4891a5b869c3408`.
Backend regeneration is byte-stable and every `api:check` passes. Generated declaration
hashes are `e3af6b73127a480c6261e6467aafc31038bce0c1c48ab86439dae9fb1a1c83b1`
for Public Web/Android and `75f2f1167098150171ff9631b69a48f8f47bf559e4bf297fb091e7c86a41a286`
for Management Web; differing declarations preserve each consumer's generation options.

### Acceptance boundary and requirement matrix

`tests/integration/payments-billing/acceptance-fixture.ts` composes the production
Identity and Booking runtimes, actual billing services/router, actual PostgreSQL
session resolver and the real Booking/Identity/Billing owner adapters. Credentials
are random fixture-only passwords. Initial catalog/approved booking facts are seeded;
all session, settlement, access, charge, credit, refund and invoice transitions use
their production owners. The external transport is controlled: timeout responses and
independently signed VNPay fixtures pass through the production verifier. No live
VNPay request, merchant credential or real money transaction is used.

The PRN-006 evidence covers the published `BookingChargeRegistrar` and accepted-source
boundary. The source is a frozen print commercial fixture; the future invitation-studio
editor/quotation/approval implementation is not represented as completed.

| Requirement / invariant | Real acceptance evidence |
| --- | --- |
| PRN-006: one accepted print source in receivables/invoice | `acceptance.test.ts` delivers one source concurrently, checks one charge/history line, derives 54m accepted charges and freezes the same line into the invoice; `charge-registration.test.ts` rejects changed source identity. |
| Deposit amount and eligibility; same restricted account becomes FULL | `acceptance.test.ts` logs in through Identity, denies restricted full billing, checks 15m signed checkout amount, repeats exact IPN and proves one application plus CONFIRMED/FULL; `deposit-orchestration.test.ts` and `operations-safety.test.ts` cover stale timeline/amount/current role and invalidating edit races. |
| Base + print + deposit/balance + credit/refund arithmetic | `acceptance.test.ts` settles 15m deposit and 39m balance, applies 1m print credit, approves/refunds 1m and checks all six final totals. Browser proof also collects a real 2m manual balance before the 37m remaining checkout. |
| Duplicate/reordered evidence, UNKNOWN, reconciliation | `vnpay.test.ts`, `vnpay-evidence.test.ts` and `balance-vnpay.test.ts` exercise independent signatures, correlated evidence, reordered/contradictory delivery, timeout beyond expiry, signed query recovery and concurrent query/IPN success. |
| Crash recovery and current authority on replay | `deposit-orchestration.test.ts`, `http-recovery.test.ts` and `operations-safety.test.ts` inject real SQL/boundary failures and restart providers; the new journey revokes a real session and denies its cached refund replay. |
| Refund/balance concurrency and immutable snapshots | `operations.test.ts`, `operations-safety.test.ts`, `balance-vnpay.test.ts` and `views.test.ts` use PostgreSQL serialization/constraints. The new journey proves an issued invoice stays identical after credit/refund and replays without recollecting money. |
| Privacy and bounded history | The journey excludes private reason/evidence/provider payloads from customer history and billing audit. Existing HTTP/storage/reporting suites verify authorization, current roles, immutable revision fences, private evidence and bounded pagination. |

### Real API browser review

The two Next development servers use process-only loopback API configuration.
An isolated Edge context logs in through the real Identity HTTP API; fixture-control
requests invoke the actual registrar/approval ports and deliver signed callbacks
through the actual billing HTTP route. There are no stubbed financial HTTP responses.
Only the external sandbox navigation is blocked to prevent a provider request.

The final browser run passes **17 screenshots** at 1440px and 390px, covering anonymous
access, restricted deposit, confirmation, UNKNOWN, recovery after reload, verified
deposit/FULL promotion, print receivable, manual balance, remaining checkout, settlement,
approved refund and final totals. No page-level horizontal overflow, unexpected console
error or page exception is recorded. Representative screenshots are inspected. Final
customer screenshots are recaptured after loading finishes and checked against the
settled totals through a fresh authenticated session.

The UI and database both show: accepted charges **53,000,000 VND**, paid **54,000,000**,
refunded **1,000,000**, net paid **53,000,000**, outstanding **0**, credit **0**. Exactly
one deposit application and one print-source charge remain. The account retains FULL.

### Quality, migration and review evidence

| Repository | Full tests | Line / branch coverage | Gates |
| --- | --- | --- | --- |
| Backend | **1,078 / 1,078**, 141 files | **96.93% / 93.22%** | Format, lint, typecheck, deterministic API generation/check, coverage, build and audit pass. |
| Public Web | **85 / 85**, 11 files | **98.16% / 95.88%** | Format, lint, typecheck, API check, coverage, build, audit and real browser journey pass. |
| Management Web | **124 / 124**, 18 files | **97.43% / 92.84%** | Same web gates pass. |
| Android | **54 / 54**, six suites | **97.92% / 90.47%** | Format, lint, typecheck, API check, coverage, Android export and audit pass; Expo Doctor **21 / 21**. |

Pinned Node 24.21.0/npm 11.19.0 and the owned disposable PostgreSQL 17.11 container on
loopback 55435 are used. All **18 migrations** deploy onto the empty main acceptance
database; migration status reports up to date. Catalog seed reruns report ALREADY_PRESENT.
The full suite executes all five billing upgrade suites (ledger, application, VNPay,
operations and their retained historical evidence) against separately owned databases.
The separate integration run passes **181/181 tests in 48 files**; the separate
contract run passes **25/25 tests in seven files**. No PostgreSQL suite is skipped.

The temporary runner imports the unchanged repository configuration. One fork worker
shares modules for 136 ordinary suites and isolates the same five module-mock suites
documented in W6. Discovery matches all 141 physical test files without missing,
duplicate or extra files. All 142 covered source records satisfy the unchanged 80%
line and branch thresholds per file. Assertions and timeouts are unchanged.

Review covers correctness, readability, module ownership, security and bounded work.
A controlled inversion of ledger existing-record checks makes the new journey fail;
the source is restored exactly before the passing full run. Backend audit uses only
the two existing documented exceptions 1145093/1153173. Client audit uses only its
existing lockfile-scoped development-tool exceptions, expiring 2026-10-15; no new
exception is added and audit is not represented as zero vulnerabilities.

Credential-pattern scanning covers **525 tracked text files** in all four repositories;
**66 public JS/export artifacts** are checked for fixture-secret/private-evidence sentinels.
There are no findings. This is a scoped heuristic scan; privacy assertions and real
authorization/redaction suites provide the behavior evidence. Logs and reproducible
local helpers remain ignored under `test-results/pbw8/`.

### Failed attempts and remaining acceptance

The first temporary runner attempt stalls and is stopped; the final profile explicitly
uses fork workers and retains all original test options. An earlier coverage run has
one new-journey timeout under concurrent load. Expensive runtime creation and password
login move into the existing setup hook; the test deadline is unchanged and the final
full run passes. Earlier fixture mistakes (invoice command fields, login labels and
new provider transaction numbers for a purported duplicate callback) are corrected.
Production builds correctly reject HTTP API configuration; loopback browser proof uses
development mode while production build gates remain separate. These failed attempts
are preserved locally and are not counted as successful evidence.

**Android runtime is still not verified.** W8's normal localhost/offline Expo startup
is again rejected by automatic review with only "blocked by policy" and no reason.
The owner's W7 instruction "Ghi rõ Android runtime chưa kiểm tra" remains explicit.
No alternate command bypasses the rejection. Export/Jest/Doctor do not prove native
keyboard, font scale, dark mode, back navigation or provider-browser behavior.

W8's first two microtasks are verified. The quality/runtime microtask stays open for
the native review required by PB-C4; its automated, migration and browser portions
have passed. The evidence/ACCEPTED microtask stays open for the project-owner decision.
W7's remaining runtime microtask is also open: **29/32 microtasks closed**, three
checklist entries still open across W7/W8. PB-C4, SPEC-04 ACCEPTED and dependent print
acceptance remain pending. Commits are local; no push, PR, merge or deployment occurs.

Owned API/fixture-control and Next processes are stopped. The disposable PostgreSQL
container is stopped and auto-removed. The exact temporary runner is removed after
saving its execution profile with the ignored proof logs; fixture credentials are
removed. Other databases, containers and browser profiles are untouched. All four
working trees are clean after the acceptance documentation commit.

## Owner UI wording revision — 2026-10-09

The owner requests plain Vietnamese payment labels after reviewing the screenshot
gallery. This follow-up is implemented on the existing `codex/payments-billing`
branch in all three clients:

- Management Web `2e94e71`: "Quản lý thanh toán", "Tổng hợp tiền đặt tiệc",
  "Lịch sử giao dịch" and "Tra cứu trạng thái giao dịch". The lookup now explains
  that a payment transaction ID retrieves its result and booking update status.
- Public Web `4b20ef9` and Android source `57ac677`: matching history, transaction
  ID and uncertainty wording; totals use customer-facing payment terminology.
- Technical revision/credit notes under totals are removed. Net paid is named
  explicitly as paid after refunds; positive credit is named excess payment,
  without promising a refund. Ledger reference IDs remain distinct from payment
  transaction IDs. Existing test selectors are aligned with the new labels.

No money calculation, permission gate, revision guard, request identity or provider
verification logic is changed. Backend code and the frozen API contract are unchanged.

All three clients pass lint, typecheck and focused Prettier checks. Unit, integration,
coverage and build suites are not rerun for this wording-only follow-up; the earlier
W8 results describe the earlier commits.

Four fresh screenshots render the updated Next.js applications using the existing
controlled DTO fixture, at 1440px and 390px. Each page reports document width equal
to viewport width. The screenshots are visually inspected; they are copy review
evidence, not real API/provider acceptance evidence. Local files are under
`test-results/ui-review/copy/`; the gallery at `http://127.0.0.1:8019/#N`
identifies N1–N4 as the new images and A/B as the archived pre-edit W8 images.

**Android runtime is still not verified.** No native screenshot is claimed, and the
archived C0 image remains dated and labeled as an older version. Owner acceptance
and W7/W8 native review remain pending. Commits are local; nothing is pushed.
The owned fixture and Next.js processes are stopped after capture; the screenshot
gallery remains available for owner review.
