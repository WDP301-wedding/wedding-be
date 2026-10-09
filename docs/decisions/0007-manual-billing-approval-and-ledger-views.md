# ADR-007: Manual billing approval and immutable ledger views

## Status

Implemented technical realization of SPEC-04 Sections 7, 9 and 10 on 2026-10-09.
W5 implements the internal operations and readers. W6 owns their authenticated HTTP
and OpenAPI publication; W7 and W8 retain client integration and final acceptance.
The approved contract baseline and monetary policies are unchanged.

## Context

A Manager can record a verified receipt or an approved manual refund. Repeated
commands and simultaneous collections must not duplicate money. Refund authority
comes from a recorded cancellation or credit decision; a refund request cannot
choose its own limit. Invoices and reporting must remain reproducible after later
payments, refunds and print adjustments.

## Decision

- Keep immutable operation commands with booking, actor, kind, normalized intent
  hash and minimal result IDs. Authorize the current active database account before
  replay. The same actor/key/intent returns the stored result before rechecking
  changing business state; changed intent is 422. Processing clock and generated
  resource IDs are excluded from the hash.
- Enlist manual receipt, attempt, ledger, command, audit/outbox and any deposit
  reservation/Booking/Identity promotion in the existing shared booking boundary.
  A manual deposit uses the accepted commercial amount and current timeline
  eligibility. Promotion targets the reserved couple account. A failure at the last
  command write rolls back all owner and money effects.
- Initiate VNPay BALANCE only for a CONFIRMED or COMPLETED booking with own FULL
  access or active Manager authority. Compare the billing revision under the
  booking lock and collect the full current outstanding amount. Manual BALANCE
  permits a positive partial amount up to that outstanding amount.
- Block another balance collection while an attempt is CREATED, PENDING or UNKNOWN,
  including an expired UNKNOWN attempt. Also block SUCCEEDED attempts whose proven
  money has not yet been appended. Reuse W4 checkout/evidence/query verification for
  BALANCE. Balance failure/UNKNOWN does not call deposit reservation operations.
  Recovery records the frozen successful amount and original settlement date once;
  later credit or cancellation cannot erase true money or trigger another promotion.
- Store an immutable Manager refund approval against either an owned print credit
  entry or an owned CANCELLED Booking reporting sequence. Sum approvals against the
  same basis so fresh command IDs cannot replenish its budget. Bound approval by
  the basis and current net settled money. Under the same booking boundary, a refund
  loads its stored approval and checks both the unrefunded source payment and the
  unconsumed approved decision. SQL protects source/decision correlation and caps.
  Refunds append facts and events without changing the payment or access grant.
- Issue an invoice without collecting money. Freeze its number, issued time, source
  billing revision, exact integer totals and ledger sources. Read invoice/history
  DTOs with a whitelist of IDs, amounts, dates, kinds, source links and revisions;
  omit private reasons, receipt references, approval limits and provider material.
  History cursors bind booking and an immutable billing revision. Later appends
  cannot move totals or page boundaries during that traversal.
- Capture a minimal immutable Billing reporting snapshot in the same transaction
  as each ledger append. Serialize the committed global reporting counter before
  publishing a sequence. Paginate at a fixed committed fence with current active
  Manager authorization. The forward migration backfills one safe current snapshot
  for each historical ledger without modifying money, proof, grants or old events.
- Bind authorized context when constructing the baseline `BillingReader`; keep
  both approved method signatures and minimum fields unchanged. Deposit settlement
  requires the completed deposit application marker, not just a terminal attempt.
  `BillingReportingReader` retains the approved source page and row schemas.

## HTTP hand-off

These are internal owner commands, not additional public request fields or routes.
W6 must retain SPEC-04 Section 9's strict public DTOs. Resolve deposit timeline,
manual balance revision, refund booking/recorded decision and server recording time
from authoritative stored data. Neither role nor approved refund amount is a refund
request override.

W6's durable HTTP idempotency layer must replay the stable submitted public intent
before resolving changing metadata. For recovery after an operation committed but
its HTTP response did not, reuse the committed command's resource, source attempt,
decision and ledger timestamp; do not fingerprint a newly generated clock or current
timeline as a changed original intent. Authorization remains current on every read.
Unavailable VNPay configuration must fail before claiming a new checkout intent.

## Consequences and proof

Migration `20261009001000_billing_operations_reporting` adds operation commands,
refund approvals and reporting tables and expands the existing checkout guard
forward. All seventeen earlier migrations remain immutable. Historical refunds
remain readable without fabricated retrospective approval records; new W5 refund
operations always load a recorded approval.

Proof uses real PostgreSQL with Booking and Identity adapters: manual rollback
after promotion, two balance intents, two manual balances, two refunds, approval
budget races, independent source/decision limits, cancelled Booking evidence,
UNKNOWN and successful-proof recovery, true late money, invoice freeze, print replay,
fixed reporting/history fences, database authority, redacted audit/views and W4
upgrade preservation. The same produced-reader conformance assertions run against
a controlled fake and the real adapter.

See `operations.test.ts`, `operations-safety.test.ts`, `operations-storage.test.ts`,
`balance-vnpay.test.ts`, `views.test.ts`, `readers-conformance.test.ts` and
`operations-upgrade.test.ts` in `tests/integration/payments-billing/`.

Authority: [SPEC-04](../../SPEC-payments-billing.md),
[contract baseline](../../CONTRACT-BASELINE.md),
[ADR-005](0005-recover-deposit-application-after-durable-settlement.md),
[ADR-006](0006-durable-vnpay-evidence-and-reconciliation.md), and
[Billing evidence](../../tasks/evidence/payments-billing.md).
