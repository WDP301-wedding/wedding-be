# Booking-frozen incidental prices and mutual approval

Owner approved implementation on 2026-11-08 after the two advice messages in this
chat. This amendment authorizes backend, Manager/Couple Web and PRM-app changes
for this feature and supersedes Manager-only finalization of incidental expenses
for newly created bookings. Existing bookings, contracts, PDFs, invoices, payments
and their workflow retain their prior behavior. No deployment is included.

## Accepted behavior

- Venue owns Manager-managed incidental offerings: name, description/specification,
  unit, integer VND unit price, charging rule, active status and revision. Archive
  instead of deleting. Changes affect future bookings only.
- New booking creation freezes all active incidental prices. Contracts and retained
  PDFs include that exact schedule and approval rules; these are conditional prices,
  excluded from contract totals and deposits. No automatic repricing or new items.
- COMPLETED events only: Manager creates/edits expense drafts. Catalog items use
  frozen prices; OTHER requires a specific description and reason, with no images
  or supporting-document requirement. Quantities remain positive integers.
- Manager submits and approves one immutable snapshot of the complete expense
  table. Owning FULL Couple approves that exact revision/digest or requests changes
  with a reason. Manager edits create a successor and invalidate prior approval.
- Explicit Manager NO_EXPENSES confirmation (only with an empty draft) allows
  finalization without Couple approval. An empty unconfirmed draft does not.
  Reopening requires a reason and keeps prior evidence.
- Final invoices require current mutual approval or explicit NO_EXPENSES.
  Subsequent invoice adjustments require mutual approval on the exact proposed
  debit/credit lines, reason, predecessor invoice and billing revision. They cannot
  bypass the approval gate. Unresolved payment attempts continue to pin money.
- Existing booking workflows retain their previous behavior. Current-policy final
  invoices use the new approval gate. Server checks,
  booking serialization, expected revisions, idempotency and append-only evidence
  remain authoritative. Staff cannot author or approve financial statements.

## Capability map and build order

| Module            | Responsibility                                             | Depends on        |
| ----------------- | ---------------------------------------------------------- | ----------------- |
| venue-catalog     | Versioned incidental catalog and freeze on booking insert  | —                 |
| booking-lifecycle | Frozen prices in contract and PDF                          | venue-catalog     |
| payments-billing  | Expense review, zero declaration, invoice/adjustment gates | booking-lifecycle |
| clients           | Manager catalog/authoring; Couple Web/mobile decisions     | payments-billing  |

Implement catalog/snapshots → contracts → approval/settlement → clients.
Use current Prisma/PostgreSQL, Zod, Express, Vitest and Next/Flutter conventions.
Do not add dependencies, rewrite applied migrations, or execute real payments.

## Verification and task list

- [x] Add forward migration; rehearse on disposable loopback PostgreSQL.
- [x] Verify prices and contract bytes remain fixed across catalog edits/archives.
- [x] Verify exact-version approvals, change requests, zero/reopen, foreign/Staff
      denial, stale writes, concurrent finalization and no duplicate ledger posts.
- [x] Verify adjustments cannot bypass approval or unresolved-payment pins.
- [x] Generate strict OpenAPI and clients; include examples and error/role details.
- [x] Backend static/contract checks: `npm run typecheck`, `npm run lint`, `npm run build`,
      `npm run test:contract`, `npm run api:generate`, `npm run api:check`.
- [ ] Whole backend suite green; broad fixture failures remain documented below.
- [x] Web: typecheck, lint, relevant tests, build and typography tests; inspect at
      desktop/narrow widths in a real browser.
- [x] PRM-app: `flutter analyze` and relevant tests. No APK/Gradle build.

Provider protocol is unchanged. Local tests are not live payment/deployment proof.

## API and authorization hand-off

All routes are authenticated and no-store. Every writer requires an
`Idempotency-Key`; cache replays recheck the actor's current authority. Manager
review commands additionally verify the booking's assigned Manager. Couple
decisions require an owning FULL grant and the COUPLE role. Staff cannot author
or approve financial statements. The first review is always Manager-created.

| Route                                                                       | Method         | Purpose                                                             |
| --------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| `/management/incidental-offerings`                                          | GET / POST     | Paginated catalog / create                                          |
| `/management/incidental-offerings/{id}`                                     | PATCH          | Full replacement facts, expectedRevision; active=false archives     |
| `/catalog/incidental-offerings`                                             | GET            | Authenticated active catalog facts                                  |
| `/management/bookings/{bookingId}/incidental-expenses`                      | GET / POST     | Frozen prices, draft, reviews / add a draft line                    |
| `/management/bookings/{bookingId}/incidental-expenses/{lineId}`             | PATCH / DELETE | Edit/remove at expected draft revision                              |
| `/management/bookings/{bookingId}/incidental-expenses/submit`               | POST           | Manager approves and sends the complete nonempty table              |
| `/management/bookings/{bookingId}/incidental-expenses/no-expenses`          | POST           | Explicit empty-table Manager confirmation                           |
| `/management/bookings/{bookingId}/incidental-expenses/reopen`               | POST           | Exact review ID/digest and reason; preserves prior evidence         |
| `/management/bookings/{bookingId}/incidental-expenses/adjustment-proposals` | POST           | Propose reasoned signed lines on exact invoice/billing versions     |
| `/bookings/{bookingId}/incidental-expenses`                                 | GET            | Owning FULL Couple reads current table and last 50 review snapshots |
| `/bookings/{bookingId}/incidental-expenses/decisions`                       | POST           | Couple approves exact review or requests changes with reason        |

Catalog POST requires `name`, `description`, `unit`, integer `unitPriceVnd`,
`chargingRule` and `active`. Catalog PATCH adds `expectedRevision`. Catalog records
are retained; booking copies retain offering ID/revision and every display/price
fact. The restaurant lock serializes new booking capture with price changes,
including an empty catalog. No catalog backfill is applied to existing bookings.

Example selected expense (name/unit/price are resolved again from the booking's
frozen schedule; submitted values are never the pricing authority):

```json
{
  "expectedRevision": 0,
  "sourceType": "CATALOG",
  "offeringId": "11111111-1111-4111-8111-111111111111",
  "name": "Bia A",
  "quantity": 5,
  "unit": "thùng",
  "unitPriceVnd": 300000
}
```

OTHER uses `sourceType: "OTHER"`, a specific `name`, `reason`, positive integer
quantity, unit and nonnegative integer VND price. No attachment field is accepted.
An agreed catalog name cannot be entered as OTHER to replace its agreed price.
`quantity * unitPriceVnd` and checked sums are calculated on the server.

Submit/no-expenses use `{ expectedRevision }`. Reopen additionally requires
`reviewId`, `documentDigest` and `reason`. A Couple decision sends:

```json
{
  "expectedRevision": 1,
  "reviewId": "22222222-2222-4222-8222-222222222222",
  "documentDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "decision": "REQUEST_CHANGES",
  "reason": "Cần đối soát lại số thùng đã mở"
}
```

APPROVE omits the reason. Reopening requires an exact current review even when no
line changed, so a stale tab cannot withdraw a successor. Draft line edits are
locked while a sent/approved review is current. Prior Couple change-request reasons
remain in the review; each reopening's reason is separately retained in audit.
Final invoices retain `incidentalReviewId`; adjustment snapshots retain `reviewId`.
Reviews referenced by an invoice cannot subsequently be changed or withdrawn.

Adjustments use the existing invoice-adjustment body to create a proposal, then
the Couple decision route. Applying it uses the same body plus its approved
`reviewId`; any differing source, reason, quantity or price fails. Pending or
approved-but-unapplied current-invoice adjustments block new BALANCE commands.
Existing payment reconciliation and refund evidence remain separate.

The audit stream queues `billing.updated` invalidations for review transitions and
`catalog.updated` for offerings. Realtime payloads contain resource identifiers,
not financial lines or reasons. Web/mobile reread their authorized snapshots.

409 errors include `EXPENSE_APPROVAL_REQUIRED`, `EXPENSE_REOPEN_REQUIRED`,
`EXPENSE_REVIEW_STALE`, `EXPENSE_REVIEW_NOT_EDITABLE`,
`EXPENSE_DECLARATION_INVALID`, `INCIDENTAL_OFFERING_NOT_AGREED` and
`INCIDENTAL_OTHER_REASON_REQUIRED`. Existing stale billing/invoice, completion and
payment-pin errors remain authoritative. Cross-booking reads are concealed; revoked
FULL Couple access is denied before an idempotency cache response can be returned.

## Local evidence and limits

- Forward migration: `20261108050000_incidental_catalog_approval`; all 87 migrations
  rehearsed on disposable loopback PostgreSQL. No shared database was migrated.
- Full commercial HTTP regression: 60/60 passed before the final targeted additions.
- Final price/history/authority/payment-pin proof: 2/2 passed in
  `.incidental-final-proof.log`. A later complete rerun exited before producing
  a result summary and is not counted as passing.
- Final zero-expense/reopen/finalization-race proof: 2/2 passed in
  `.incidental-zero-race-proof.log`; the four current-policy cases passed in two
  isolated batches.
- Final focused unit/PDF checks: 14/14 passed. A temporary mutant of the approval
  revision comparison caused two regression tests to fail; the production source
  was not changed by that experiment. Evidence: `test-results/incidental/mutation-check.log`.
- OpenAPI SHA-256: `50216b1e31cff2ba8bb78033bfaa1a80d226fedbf95a82a5d4c390258773d6fa`.
- Manager Web: 58 files / 335 tests passed. Couple Web: 60 files / 381 tests passed.
  Both production builds passed with temporary HTTPS example URLs; source environment
  files were unchanged. Typecheck/lint and typography checks passed.
- PRM-app: Flutter analysis reported no issues; 32 relevant model/widget tests passed.
  No APK or Gradle packaging was run.
- Browser QA used temporary component previews and synthetic fixtures at 1440px
  and 390px. Retained screenshots are under `test-results/incidental/`; preview
  routes were removed after inspection. This was local rendering/interaction QA,
  not a deployed authenticated end-to-end or live-provider test.
- A synthetic six-item contract PDF was rendered and all four pages visually
  inspected, including the frozen price/rule schedule and both signature areas.
  Evidence: `test-results/incidental/contract-preview.pdf` and `contract-page-*.png`.
- The whole backend suite is not claimed green. An isolated pre-change worktree
  at `56372ce9f683735d9dfea87016cd2b898f0225fd` reproduced 11 failures / 1 pass in
  `tests/integration/payments-billing/http.test.ts`, including
  `CONTRACT_APPROVAL_REQUIRED` and `DEPOSIT_NOT_ELIGIBLE`. Baseline evidence is
  retained at `test-results/incidental/baseline-payments-http.log`. Other broad-suite
  failures are recorded separately and are not automatically classified as baseline.
- Broad disposable backend run: 336 files, 290 passed / 46 failed; 2,375 tests passed,
  143 failed and 9 skipped. Full output is retained in `.incidental-all-tests-safe.log`.
  Unit/contract failures were not reported; failures were in older integration suites.

Legacy settlement regression fixtures seed pre-amendment nullable policy facts
before any contract/payment in the disposable database. New-policy acceptance
explicitly uses current-policy bookings and verifies the immutable-price guard.
Deployment, shared migration, exact-head CI and live provider acceptance remain
separate work.
