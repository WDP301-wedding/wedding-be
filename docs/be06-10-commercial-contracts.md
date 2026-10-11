# BE-06–10: Full commercial contract backend handoff

Implementation date: 2026-10-11. Branch: `codex/commercial-contracts-step-4`.
Scope: wedding-be only. Authoritative scope remains
[2026-10-10 backend scope](./backend-scope-2026-10-10.md) and
[SPEC-commercial-contracts](../SPEC-commercial-contracts.md).
[ADR-010](./decisions/0010-freeze-full-commercial-contracts-before-deposit.md)
records transaction, receivable and PDF decisions.

## Implementation and acceptance status

The following matrix records the initial implementation checkpoint. See the API
verification follow-up below for the subsequently completed HTTP, migration and
sample PDF checks; unchecked acceptance items require the remaining broader proof.

| Task  | Code implemented                                                                                                       | Acceptance still required                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| BE-06 | Contract head, immutable revisions/lines, multi-menu snapshots, checked totals/capacity, explicit legacy discriminator | Unit arithmetic/eligibility and actual serialized forward migration proof                       |
| BE-07 | Scoped draft/successor, submit/revalidate, two party approvals, own withdrawal, idempotent HTTP, revision/audit/outbox | HTTP/owner conformance, stale/replay/authorization and concurrent price/approval/pinning proofs |
| BE-08 | Private Vietnamese PDF, retained approved bytes/digest, complete itemization and required clause                       | Rendered glyph/page inspection, digest/authorization tests                                      |
| BE-09 | Full-total 30% deposit, exact contract+timeline pins in attempt/reserve/settlement, verified-money recovery            | Payment regressions and real reserve/edit/settle/unknown races                                  |
| BE-10 | Unique CONTRACT obligation, PAYMENT reduces balance, legacy BASE/PRINT denied for full-model Booking                   | Real ledger replay/conflict/rollback and no duplicate source proof                              |

No new automated tests were added or run in this implementation turn. The acceptance
checkboxes stay open until required test, migration and rendering evidence exists.
No shared Supabase migration, real email, Storage upload, Gemini generation or
VNPay checkout was executed. RV-13 must be rerun against a full contract separately.

## HTTP contract

Prefix: `/api/v1`. All routes require current bearer authentication and private
`Cache-Control: no-store`. Owning Manager or owning consultation account (including
restricted prospect before deposit) can read/create/submit. Party authority is
derived from current ownership; Staff-only actors and cross-booking IDs are concealed.
No body can provide its own actor, party, names, price, total or approval timestamps.

| Method | Path                                                     | Purpose                                                                                |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | /bookings/{bookingId}/contracts                          | Current identity, Booking revision and newest 50 history records; optional UUID cursor |
| POST   | /bookings/{bookingId}/contracts                          | First explicit conversion/draft or complete replacement successor                      |
| POST   | /bookings/{bookingId}/contracts/{revisionId}/submissions | Revalidate and freeze for review                                                       |
| POST   | /bookings/{bookingId}/contracts/{revisionId}/approvals   | Approve exact current digest as own party                                              |
| POST   | /bookings/{bookingId}/contracts/{revisionId}/withdrawals | Withdraw own approval into a new DRAFT, with reason                                    |
| GET    | /bookings/{bookingId}/contracts/{revisionId}/pdf         | Exact private revision PDF; X-Content-SHA256 identifies returned bytes                 |

Writes require `Idempotency-Key` and `expectedRevision` = current **Booking** revision.
Current scope is rechecked before replaying a cached private response. Successful
mutations increment Booking revision, except an already-recorded identical own
approval. Read the returned Booking revision for the next distinct operation.

Draft example (IDs are placeholders for actual scoped catalog/Booking records):

```json
{
  "expectedRevision": 4,
  "predecessorRevisionId": null,
  "timelineRevisionId": "de17a04b-5b4b-477c-824e-273a0b600d51",
  "lines": [
    {
      "category": "MENU",
      "sourceId": "a36e62e0-e1f8-4193-a14e-cf604908bb43",
      "sourceRevisionId": "4dc8d785-cb08-4bc9-bf34-851510391f02",
      "quantity": 20
    },
    {
      "category": "SERVICE",
      "sourceId": "88a3e2dc-8d14-428c-9a94-002c6b5e2891",
      "sourceRevisionId": "c82b3bae-d5cf-4980-b7ed-282c05f569a9",
      "quantity": 1
    }
  ]
}
```

Add further distinct MENU/PRINT/SERVICE selections with current exact versions.
MENU quantity is tables; PRINT copies; SERVICE its catalog unit. At least one menu,
1–50 distinct sources, positive quantities, aggregate tables <=500 and independently
entered planning headcount within hall capacity. Totals use checked integer VND.

Creating a successor requires `predecessorRevisionId` equal to current contract
revision. Immutable draft content is revised by another POST, not in-place PATCH.
Both profile names must have been supplied before submission; missing or changed
draft facts require a new draft. Catalog changes before submission conflict; after
submission/approval they cannot reprice the retained document.

Submit/approve body: `{ "expectedRevision": 5 }`.
Withdrawal additionally requires `reason`. Withdrawal retains old approvals/PDF
and creates a successor with zero approvals. Any active/unknown/settled deposit
blocks changes. A new timeline requires a newly bound contract revision and approvals.

The PDF freezes restaurant/hall/date/shift, both names, timeline content, itemized
prices/totals, approval actor/party/UTC time and “Các chi phí phát sinh sẽ được tính sau”.
System confirmation is not a digital signature. Approved bytes survive supersession;
draft previews are marked as drafts. Document digest and PDF byte digest are distinct.
Shift bounds match the Booking proposal used by existing operational timeline/event
readers; later Venue shift edits cannot create a different promised event schedule.

## Deposit and financial ownership

For FULL_CONTRACT_V1, the existing VNPay deposit body now includes:

```json
{
  "timelineRevisionId": "de17a04b-5b4b-477c-824e-273a0b600d51",
  "contractRevisionId": "ebfbb303-e1eb-4700-bb1a-858c3187e75a",
  "documentDigest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

Use the actual returned digest, never the illustrative value. Both current approvals,
slot and intended active account are rechecked. Server amount is
`ceil(contractTotalVnd * 30 / 100)`. Provider amount limits remain enforced. VNPay
return redirects do not prove settlement. An identical command keeps its original
attempt identity even after later Booking changes.

Manager manual DEPOSIT evidence also includes the exact contract revision and digest;
existing reason/receipt/time rules and server amount checks still apply. BALANCE
commands keep their existing API and do not take commercial deposit metadata.

The internal `CommercialContractReader` resolves an exact approved immutable snapshot
with documentDigest, lines, names, total, deposit and timeline identity. Its historical
resolution remains valid after supersession; deposit eligibility separately checks
current state. Future appendix IDs/deltas are not fabricated before BE-11 exists.

At verified deposit settlement, the shared UoW posts one CONTRACT charge for the approved
total and one PAYMENT for the verified deposit. Source date is immutable approvedAt.
Matching source replay returns the prior ledger entry; changed amount/date/booking
conflicts. No new BASE_BOOKING or PRINT_ORDER charge is added to a full-model Booking.
Failed new-model checkouts leave no stale obligation, so a later permitted predeposit
revision does not stack charges. Proven provider evidence/money remains separate
from retryable Booking confirmation/same-identity access promotion.

Legacy proposals/settlements retain their previous amounts, sources and bodies.
Only uncharged/unsettled DRAFT bookings without unresolved/succeeded attempts can
convert explicitly. Charged legacy drafts are denied rather than rewritten. Contract
print production requires BE-12; until then legacy print charging on FULL_CONTRACT_V1
returns CONTRACT_FULFILLMENT_REQUIRED. Appendices, expenses, final invoices and
adjustments remain BE-11–16.

## Errors

Standard envelope includes requestId. Relevant conflicts: COUPLE_NAMES_INCOMPLETE,
COMMERCIAL_PRICE_REVISION_STALE, OFFERING_NOT_SELECTABLE, CONTRACT_REVISION_STALE,
COMMERCIAL_PREDECESSOR_STALE, CONTRACT_APPROVAL_REQUIRED,
CONTRACT_DISTINCT_APPROVERS_REQUIRED, CONTRACT_NOT_EDITABLE,
CONTRACT_CAPACITY_EXCEEDED, COMMERCIAL_AMOUNT_OVERFLOW,
LEGACY_COMMERCIAL_CONVERSION_BLOCKED, DEPOSIT_INTENT_ACTIVE,
FINANCIAL_SOURCE_CONFLICT and CONTRACT_FULFILLMENT_REQUIRED.
Existing authorization, slot, payment evidence/idempotency and provider errors remain.

## Migrations and deployment

New forward migrations, in order:

1. 20261011009000_billing_contract_source: commit enum extension before constraint use.
2. 20261011010000_commercial_contracts: atomic tables, immutable content/approval/PDF
   guards, same-Booking references, exact pin pairs, checked snapshots and source uniqueness.

Neither has been applied to the shared database in this turn. Deploy schema before
running new routes. Historical migrations remain byte-for-byte unchanged. Do not
delete/rewrite monetary history for rollback; use forward repair and suspend affected
full-model writes if temporarily reverting the application.

Fonts under assets/fonts ship in the runtime image and work without new environment
variables or an external PDF service. Retained PDFs are private database bytea records,
not public Storage objects. Package versions and font/license hashes are included
in this change.

## Static checks

- Toolchain: Node 24.21.0 / npm 11.19.0; clean `npm ci` reproduced the lockfile.
- Prisma schema formatting/client generation: passed.
- Typecheck: passed after review.
- Build: passed after review.
- OpenAPI generation/artifact digest check: passed; regenerated after API edits.
- Full lint: passed after corrections.
- Repository formatting and `git diff --check`: passed.
- Independent read-only review: three findings corrected and corrections confirmed.
- Automated tests/coverage, actual migration, PDF render inspection and live
  full-total sandbox settlement: pending; none claimed by the checks above.

## API verification follow-up — 2026-10-11

The owner subsequently requested testing each API. A repeatable real HTTP/Identity/
PostgreSQL suite is now in `tests/integration/commercial-contracts-api.test.ts`.
Its five scenarios capture 102 requests, including fixture preparation, all six
contract routes and deposit/attempt/callback/billing/manual-payment paths.
[Actual requests and responses](../tasks/evidence/be06-10-api-results-2026-10-11.md)
include expected authorization/validation/conflict failures, replay after access
revocation, UNKNOWN deposit pinning, retained PDF bytes and once-only money.

The disposable PostgreSQL 17 database applied all forward migrations in order.
The API-produced two-page Vietnamese PDF was extracted, rendered and visually
inspected; names/clause/totals and byte digest were verified. No shared database
was changed. VNPay uses controlled signed evidence and an offline gateway: no
real checkout or QueryDr was performed. This follow-up supersedes the initial
implementation turn's lack of API/migration/PDF proof for those tested scenarios;
full acceptance still requires the remaining coverage/concurrency/provider gates.

The final backend regression passed all 192 files and 1,530 tests (302.71 seconds),
with no failing tests. Typecheck, lint, OpenAPI artifact checks and changed-test
formatting also passed. The disposable base database applied 31 migrations.
The initial regression failures were repaired in test setup/legacy mocks and
historical-schema upgrade fixtures without changing production behavior. See
`test-results/step4-full-suite-final.log` for the final run. Coverage and complete
concurrency/live-provider acceptance remain pending.
