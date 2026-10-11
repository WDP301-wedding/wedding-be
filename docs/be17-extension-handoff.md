# BE-17: commercial extension backend hand-off

Delivered 2026-10-12 (Asia/Saigon) against source
`054d670d6a7edd4d8028004271b02fab5c60973f`. This package covers BE-01–16
implementation, API contracts and evidence. It does not approve a production
release. [Acceptance and remaining gates](../tasks/evidence/be17-extension-handoff-2026-10-12.md)
and the [active backlog](../tasks/backend-revision-todo.md) distinguish delivered
code, offline verification, configuration and live developer verification.

## Exact artifacts and runtime

The [machine-readable manifest](../tasks/evidence/be17-extension-manifest-2026-10-12.json)
pins 21 runtime/provider/model source files by SHA-256, all 44 forward migration
checksums, the dependency lock digest and 49 commercial/related payment/print
operations extracted from the actual OpenAPI. It includes six fresh read-only
deployed checks and the exact-source CI reference. Paths in that manifest are
relative to this repository; resolve them at its pinned commit.

- [Canonical OpenAPI](../openapi/openapi.json): OpenAPI 3.1.0, 144 paths,
  166 operations, 73 schemas; SHA-256
  `55c15733cdc25a9151c724e311cb5753f9b41124a15c879cf73cc3c90c108b9e`.
  All 1,525 local schema references resolve; operation IDs are unique.
- [Deployed canonical API](https://wedding-be-production-e1dc.up.railway.app/api/v1/openapi.json)
  matches those bytes. [Swagger](https://wedding-be-production-e1dc.up.railway.app/docs)
  uses same-origin `/api/v1` paths, with `/health` preserved.
- Target: owner-authorized developer staging on Railway/Supabase, although the
  Railway environment label is `production`. Last recorded deployment:
  `2fd330bc-cc72-43f3-9506-90bf5fd62c2b` from the source above.
  Fresh API/health/unauthenticated checks confirm reachability and the published
  contract; feature-level live evidence remains the separate receipts below.
- Existing owner port version is `v1`, identified by exact source commit/file
  digest. Persisted document discriminators are `FULL_CONTRACT_V1` and
  `FINAL_INVOICE_V1`. No new version constant is invented for this documentation.

`server.ts` constructs the real Venue, Booking, Payments and Invitation runtimes
and mounts their routers through `app.ts`. Booking mounts profile, contract and
appendix services with the commercial catalog reader, financial registrar and
print-entitlement reader. Payments mounts expenses, final invoices and adjustments
with the real effective-commercial/event-end readers and ledger unit of work.
Invitation uses actual contracted-print obligations and retained template versions.
Runtime factories and providers are individually pinned in the manifest; declarations
or registry doubles alone are not the evidence for this composition.

External versions: Brevo REST v3; private Supabase Storage SDK 2.116.0; Gemini SDK
2.24.0 with recorded model `gemini-3.1-flash-lite-image`; VNPay 2.1.0 sandbox;
Prisma/client/adapter 7.10.0; PDFKit 0.20.2. Exact installed dependency versions
are in the manifest/lockfile. Gemini and sandbox receipts identify their historical
tested source/configuration; this hand-off does not purchase another generation
or execute another payment. Metrics/OTLP are optional and disabled.

## HTTP inventory and authority

All business paths below use `/api/v1`. The manifest contains each exact method,
path, operation ID, OpenAPI security requirement and response status inventory.
Strict request/response schemas are embedded in the canonical OpenAPI.

| Surface                   | Routes                                                                                                                                             | Authority                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Profile                   | GET/PATCH `/consultations/{consultationId}/couple-profile`                                                                                         | Owning account or scoped Manager; no inferred couple identity                                                     |
| Selectable catalog        | GET `/catalog/services`, `/catalog/print-offerings`                                                                                                | Public eligible catalog facts only; no private template drafts/media                                              |
| Catalog administration    | GET/POST `/management/services`, `/management/print-offerings`; PATCH each `/{id}`                                                                 | Manager; edits/archive create retained versions                                                                   |
| Contracts                 | GET/POST `/bookings/{bookingId}/contracts`; POST `/{revisionId}/submissions`, `/approvals`, `/withdrawals`; GET `/{revisionId}/pdf`                | Scoped Manager or owning consultation account, including restricted pre-deposit prospect; approvals use own party |
| Appendices                | GET/POST `/bookings/{bookingId}/contract-appendices`; POST `/{revisionId}/submissions`, `/approvals`                                               | Scoped Manager or owning FULL Couple; distinct approvals on exact current revision                                |
| Expenses                  | GET `/bookings/{bookingId}/incidental-expenses`; GET/POST `/management/bookings/{bookingId}/incidental-expenses`; PATCH/DELETE `/{lineId}`         | Manager writes after event end; owning FULL Couple reads; Staff cannot write                                      |
| Final invoices            | GET `/bookings/{bookingId}/final-invoices`, `/{invoiceRevisionId}`; POST `/management/bookings/{bookingId}/final-invoices`, `/invoice-adjustments` | Manager finalizes/adjusts; owning FULL Couple reads; no Couple expense approval                                   |
| Print/payment integration | Existing print-order and payment routes enumerated in manifest                                                                                     | Existing scoped post-deposit authority and idempotency; public callbacks require verified provider evidence       |

Private reads are authenticated and `Cache-Control: no-store`. UUID possession
does not authorize access. Current scope is rechecked before an idempotent private
response is replayed. Cross-booking resources remain concealed; Staff has no new
commercial/expense authority. Public catalog or invitation/QR views confer neither
private invoice access nor attendance-write authority.

See [foundations](be01-05-commercial-foundations.md),
[contract/deposit API](be06-10-commercial-contracts.md),
[appendix/invoice API](be11-16-commercial-settlement.md) and
[accepted printable files](invitation-print-files.md) for the owner-specific contracts.
Their older checkpoint paragraphs are historical; use the current acceptance
matrix linked at the top for completion status.

## Consumer examples and conflicts

Send bearer authentication and a distinct `Idempotency-Key` for each new command;
retry the same intent with its original key and unchanged body. A conflict requires
reading authoritative revisions and choosing a new intent, rather than silently
replacing the expected version. Successful JSON responses use `{ "data": ... }`.
Read the returned revision before another command; do not assume all resources
share a revision counter.

Profile PATCH example:

```json
{ "expectedRevision": 4, "brideName": "An", "groomName": "Minh" }
```

Both names are trimmed NFC text, 1–120 characters when supplied. Legacy nullable
names remain unset until an authorized edit. Account display labels are not names.
Commercial submission requires both names. Names frozen into approved documents
do not change when the profile is edited later.

Appendix creation requires the full desired after-selection, reason, current
effective predecessor and current Booking revision. Example IDs below are
placeholders; use actual scoped current catalog versions, keeping unchanged frozen
lines as required by the owner service:

```json
{
  "expectedRevision": 12,
  "predecessorRevisionId": "00000000-0000-4000-8000-000000000001",
  "reason": "Bổ sung bàn theo thỏa thuận",
  "lines": [
    {
      "category": "MENU",
      "sourceId": "00000000-0000-4000-8000-000000000002",
      "sourceRevisionId": "00000000-0000-4000-8000-000000000003",
      "quantity": 21
    }
  ]
}
```

Selections require 1–50 distinct sources, at least one MENU, positive integer
quantities <=10,000 and aggregate tables <=500 plus authoritative hall/planning
capacity checks. Client prices/totals, names or approval actors are not inputs.
Submit and each own-party approval use `{ "expectedRevision": 13 }`, replacing
13 with the actual returned Booking revision. Approval two atomically activates
the new effective agreement and once-only signed ledger delta. An active allocated
print source cannot be removed, repriced or replaced while production obligations
remain. Changing material/template/quantity uses an approved appendix and eligible
new fulfillment, never rewriting a retained batch or contract.

Manager expense POST example after authoritative event end:

```json
{
  "expectedRevision": 0,
  "name": "Bia phát sinh",
  "quantity": 2,
  "unit": "thùng",
  "unitPriceVnd": 1000,
  "note": null
}
```

Server response contains the generated line ID, `totalVnd: 2000`, the updated
expense-draft `revision`, full `lines` and `finalized: false` inside `data`.
Names/units/notes have respective bounds 1–120, 1–80 and 1–2,000 characters;
note may be null/omitted. Quantity is 1–2,147,483,647; unit price is nonnegative
safe integer VND. Overflow and client-supplied totals fail. PATCH/DELETE use
the current expense-draft `expectedRevision`, including DELETE's JSON body.

Finalization POST example:

```json
{
  "expectedDraftRevision": 1,
  "expectedCommercialRevisionId": "00000000-0000-4000-8000-000000000004",
  "expectedBillingRevision": 3
}
```

Response contains `invoiceRevisionId`, `documentDigest`, `revisionNumber`,
`sourceBillingRevision` and the immutable itemized `document`, including
`modelVersion: "FINAL_INVOICE_V1"`. Zero expenses are valid. Later adjustment POST:

```json
{
  "expectedInvoiceRevisionId": "00000000-0000-4000-8000-000000000005",
  "expectedBillingRevision": 4,
  "reason": "Điều chỉnh phát sinh đã đối soát",
  "lines": [
    {
      "kind": "CREDIT",
      "name": "Giảm phát sinh",
      "quantity": 1,
      "unit": "lần",
      "unitPriceVnd": 1000
    }
  ]
}
```

An adjustment creates a successor invoice, retaining predecessor/reason/actor/time
and immutable sources. CREDIT is not a bank refund. Finalization/adjustment do
not overwrite previous documents. Client examples are schema-valid templates,
not evidence that those illustrative versions currently exist.

Errors use the standard envelope:

```json
{
  "error": {
    "code": "EVENT_NOT_ENDED",
    "message": "Illustrative message; handle the stable code.",
    "requestId": "00000000-0000-4000-8000-000000000006"
  }
}
```

| Case                                                                 | Status / consumer action                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Missing/expired authentication                                       | 401 `AUTHENTICATION_REQUIRED`; refresh/login through Identity                                                |
| Forbidden actor or concealed wrong owner/ID                          | 403/404; do not retry as a version conflict                                                                  |
| Unknown properties, fractional/overflowing money, invalid quantities | 422 validation; correct payload                                                                              |
| Changed catalog selection                                            | 409 `COMMERCIAL_PRICE_REVISION_STALE` / `OFFERING_NOT_SELECTABLE`; explicitly reselect                       |
| Missing names / stale commercial head                                | 409 `COUPLE_NAMES_INCOMPLETE`, `CONTRACT_REVISION_STALE`, `COMMERCIAL_PREDECESSOR_STALE`; read current facts |
| Allocated print source/quantity conflict                             | 409 `CONTRACT_PRINT_SOURCE_ALLOCATED`, `CONTRACT_PRINT_QUANTITY_ALLOCATED`; preserve allocated facts         |
| Before event end / stale expense / finalized expense                 | 409 `EVENT_NOT_ENDED`, `EXPENSE_REVISION_STALE`, `INVOICE_FINALIZED`                                         |
| Invoice/billing mismatch or required finalization                    | 409 `INVOICE_REVISION_STALE`, `STALE_BILLING_REVISION`, `INVOICE_FINALIZATION_REQUIRED`                      |
| Pending/UNKNOWN payment                                              | 409 `PAYMENT_ATTEMPT_ACTIVE` / `DEPOSIT_INTENT_ACTIVE`; reconcile existing attempt                           |
| Same intent retry / changed intent under old key                     | Original idempotent response / 409 conflict; never create a second charge                                    |
| Unavailable provider or rejected retained file                       | Use endpoint's published error contract; never infer success from a redirect/health response                 |

The exact per-operation response statuses/schemas are authoritative in OpenAPI.
Zod/service refinements (capacity, distinct sources, state and allocated obligations)
remain enforced even when not expressible as generated JSON Schema.

## Money, migrations and recovery

```text
lineTotalVnd = quantity * unitPriceVnd (checked integer arithmetic)
depositVnd = ceil(originalContractTotalVnd * 30 / 100)
invoiceTotalVnd = originalContractTotalVnd + approvedAppendixDeltaVnd
                + incidentalTotalVnd + invoiceAdjustmentDeltaVnd
netPaidVnd = settledPaymentsVnd - completedRefundsVnd
balanceVnd = invoiceTotalVnd - netPaidVnd
outstandingVnd = max(balanceVnd, 0)
creditVnd = max(-balanceVnd, 0)
```

Deposit binds exact mutually approved contract/timeline revisions and slot. Verified
settlement promotes the same identity once. Contracted print is already included
in the original receivable; fulfillment adds no second PRINT_ORDER charge.
Appendix/expense/adjustment postings have unique source revisions. Unresolved
attempts pin money and block conflicting revisions until reconciliation; expiry
does not erase unknown provider effects. Legacy settled evidence is retained.
Attendance, Guest counts and public invitation views are never billing sources.

| Forward migration group                                                                                            | Purpose / evidence                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261010010000_couple_profile`, `20261010020000_restaurant_services`, `20261010030000_print_commercial_offerings` | Nullable explicit couple names, service and print catalogs; [BE-01–05 evidence](../tasks/evidence/be01-05-commercial-foundations.md)                          |
| `20261011009000_billing_contract_source`, `20261011010000_commercial_contracts`                                    | Billing enum committed before contract tables/immutable snapshots/pins; [BE-06–10 acceptance](../tasks/evidence/be06-10-acceptance-2026-10-11.md)             |
| `20261011019000_billing_extension_sources` through `20261011029000_invoice_outbox_identity`                        | Appendix/ledger/print provenance, final invoice integrity/outbox and balance pins; [step-six evidence](../tasks/evidence/be11-16-step6-results-2026-10-11.md) |
| `20261011030000_preserve_allocated_print_sources`, `20261011031000_contracted_print_quote_bounds`                  | Preserve allocated print sources and allow safe contracted quote bounds; [repair evidence](../tasks/evidence/be11-16-repairs-2026-10-11.md)                   |

Full directory names/checksums are in the manifest. Exact-source CI applied all
44 migrations to empty PostgreSQL 17; integration tests cover populated historical
upgrade, persistence, rollback, concurrent approvals/finalization and replay.
Recorded deployment reported no unapplied migration. No shared migration or new
database write was executed during this hand-off audit.

Deploy schema before matching runtime. Recover by stopping affected writes and
using a reviewed forward repair/application rollback compatible with retained data.
Never rewrite applied SQL, remove approved PDFs/invoices, seed provider success,
or free UNKNOWN money/slot pins on timeout. Use existing payment reconciliation,
audited manual accounting and [runtime operations](runtime-foundation-operations.md).
Retention has a manual bounded operator procedure; it is not an installed scheduler.
Production recovery acceptance remains RV-21/REL-W3–5.

## Handoff boundary

Frontend teams can implement against these exact schemas/digests, revision scopes,
authorization rules, errors and examples. UI/client generation, browser/native
acceptance and frontend deployment are separate deliverables. Groups, optional
named Guests, independent planning and opt-in check-in remain SPEC-06 onward;
no companion-count assumption or response workflow is added by this extension.

BE-11–16 technical and authorized developer-runtime evidence is complete, while
the previously recorded independent team-member approval gate is still unrecorded.
BE-17 delivers the evidence package without representing that approval as present.
RV-16, RV-19 and RV-21 remain open for real workers, real Seating print integration
and owner-reviewed release/recovery checkpoint. Production-money VNPay/merchant
acceptance remains separately authorized work.
