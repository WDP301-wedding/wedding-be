# Appendix-authorized multi-design printing — 2026-11-04

Owner instruction in this chat authorizes backend, wedding-web and
wedding-manage-web changes. It supersedes the old pre-deposit print selections
and the separate print quotation/approval flow for new purchases. Mobile is out
of scope. Previously approved contracts, deposits, purchases and invoices retain
their historical facts. No deployment or external paid operation is implied.

## Acceptance and implementation contract

- New initial contracts contain MENU/SERVICE only; deposit is ceil(total * 30/100).
- A post-deposit print request contains 1–20 distinct saved designs, each with
  1–10,000 copies. All use the server price 5,000 integer VND/copy. There are no
  material/type selectors. The restaurant supplies its standard print product.
- Preview freezes design revisions and printable revisions, quantities, prices,
  commercial predecessor and a digest. Confirmation checks exact digest, expiry,
  ownership, settled contract and current content/predecessor. Client totals are
  never accepted. Confirmation atomically creates a request + appendix with Couple
  approval, NOT an InvitationPrintOrder and NOT a receivable.
- Generic appendix approval is the only approval for new requests. The second
  distinct party approval of the same digest atomically registers the appendix
  delta and creates APPROVED production orders (one per request, many lines).
- Later generic appendix quantity/removal changes resolve retained request facts
  on the server. Until mutual approval, orders keep their effective quantities.
  On mutual approval, APPROVED orders synchronize all quantities and prices,
  append a commercial revision, or become CANCELLED if all lines are removed.
  In-production/ready/handed-over orders cannot be changed. Pending changes block
  production of affected orders. No separate PRINT_ORDER charge is registered.
- New financial facts retain the existing booking lock, unresolved-payment pin,
  final-invoice freeze, immutable document and idempotency safeguards.
- Manager print page tracks effective production orders and previews EVERY saved
  printable line. Approval is on the appendix page, which also previews its prints.
  Contract/booking events refresh Manager print data.

## API (all responses wrapped in { data })

POST /bookings/{bookingId}/print-requests/price-preview
body: { lines: [{ designId, designRevisionId, quantity }] }
response 200: { quoteId, digest, expiresAt, document }
document: { predecessorRevisionId, lines: [{ designId, designRevisionId,
title, quantity, printableRevisionId, contentDigest, line }], totalVnd }
line: existing commercial PRINT line shape; source IDs are retained request
sources, never client prices or catalogue material selectors.

POST /bookings/{bookingId}/print-requests/confirm
body: { quoteId, digest, consent: true }; response 201: PrintRequestView
GET /bookings/{bookingId}/print-requests
response 200: { items: PrintRequestView[] }
POST /bookings/{bookingId}/print-requests/{requestId}/withdraw
body: { expectedRevision: number }; response 200: PrintRequestView
Only while its current appendix awaits approval; no order is created.

PrintRequestView: { requestId, bookingId, bookingRevision, appendixRevisionId, state,
orderId: string|null, document }
state: DRAFT | AWAITING_APPROVAL | APPROVED | SUPERSEDED
Appendix views optionally include printRequests: PrintRequestView[].
PrintOrderView optionally includes appendixSource:
{ requestId, appendixRevisionId, pendingAppendixRevisionId?: string|null }.
Existing PDF route previews retained printableRevisionId for both authorized roles.
All POSTs require Idempotency-Key; financial writes retain booking serialization.

## Work slices and checks

- [x] Freeze additive schemas and migration; multi-design/request tests.
- [x] Preview/confirm/withdraw with no premature order or charge.
- [x] Generic appendix approval, request-source resolution and production sync.
- [x] Couple many-design creation/selection and server preview/consent UI.
- [x] Manager appendix approval/print previews and effective-order tracking.
- [x] OpenAPI/client regeneration, integration and authorization/race/money tests.
- [x] Typecheck, changed-file lint, focused suites and desktop/mobile inspection.
- [ ] Full repository suites pass: broad runs still have unresolved failures;
      see the verification evidence. No checks or thresholds were weakened.

Local verification and limitations are recorded in
[the evidence report](../tasks/evidence/print-appendix-2026-11-04.md).

Commands: backend `npm run db:generate`, `npm run api:generate`,
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
Local PostgreSQL acceptance uses `node scripts/staff-operations.verify.mjs` with
explicit test files. Its disposable loopback-only database must never be replaced
with a shared/provider database. Frontends use `npm run api:generate`,
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, including
`npm test -- src/design-system/typography.test.ts`.
