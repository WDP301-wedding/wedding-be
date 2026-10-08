# SPEC-04 Payments and Billing implementation evidence

Status: **W1-W2 technical evidence; module implementation acceptance pending.**
Authority: approved `SPEC-payments-billing.md`, `WEDDING-CONTRACT-1@1.1.0`,
and the eight-wave plan in `tasks/plan.md` Section 21.

## Branch and scope

All four repositories use `codex/payments-billing` for W1-W8. Verified increments
are committed on that branch. W1-W2 change only the backend; the three client
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

## Remaining acceptance

W3-W8 remain open: real charge/deposit orchestration, verified provider callbacks and
reconciliation, Manager manual/refund approval flows, safe invoice/reporting reads,
HTTP/OpenAPI publication, generated clients, three client UIs and final four-repository
acceptance. Real Booking/Identity providers must be proved at the integration gate;
storage fixtures do not replace that evidence.
