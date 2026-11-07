# Event completion before final settlement — 2026-11-07

Owner authorized wedding-manage-web and wedding-be changes after reviewing the
proposed flow. Payment here means the post-event BALANCE, not the deposit.

## Rules and client behavior

- The Manager's event-completion action precedes the settlement action. A confirmed
  booking shows the latter disabled with an explanation; COMPLETED opens it.
- The current DRAFT/AWAITING_APPROVAL appendix blocks both manual completion and
  the automatic completion job. An APPROVED appendix requires MANAGER and COUPLE
  approvals matching its document digest. No appendix, or retained SUPERSEDED
  proposal history, does not block. Amount/delta alone never determines approval.
- Proposal GET adds optional `completion` evidence: `canComplete`, `pending`,
  `appendixRevisionNumber`, `managerApproved`, `coupleApproved`. Old clients can
  ignore it; the new Manager UI disables completion if evidence is absent.
- Recording-context GET adds optional `bookingPhase`. Direct billing navigation
  retains history, deposits and refunds; settlement writers stay disabled until
  verified COMPLETED evidence is loaded. Backend checks remain authoritative.
- COMPLETED is required for incidental-expense CRUD, final-invoice finalization and
  adjustments, legacy invoice issuance, VNPay BALANCE and manual BALANCE receipts.
  Settled-payment reconciliation is retained, including older unresolved attempts. Reopening an old BALANCE attempt does not expose a checkout URL before completion; already-issued external URLs still require reconciliation rather than erasing provider evidence.
  Completion does not mean invoice finalization or debt settlement.
- Creating/submitting/approving commercial and print appendices requires CONFIRMED.
  Cancel an unapplied proposal instead of deleting it. Legacy completed bookings
  may discard a pending proposal without changing their effective agreement.
- Default demo date bypass remains. Strict mode retains completion's end + 12h
  check and financial writers' authoritative event-end check.

## Private API and concurrency

The VNPay protocol remains 2.1.0; this change adds admission checks and does not
change its signing, reconciliation or provider adapters. All affected booking,
appendix, billing and invoice routes are authenticated/private. No public or
guest route is added. Assigned Manager completes events and writes settlement;
owning FULL Couple approves/cancels proposed appendices and may pay an eligible
balance; Staff cannot perform these writes.

`POST /bookings/{bookingId}/contract-appendices/{revisionId}/cancellations`
accepts `{ expectedRevision, reason }` with an Idempotency-Key. The assigned Manager
or owning FULL Couple may discard the current DRAFT/AWAITING_APPROVAL revision.
Reason is trimmed NFC, 1–500 characters. Content, approvals and effective total
remain unchanged; revision becomes SUPERSEDED, Booking revision increments and
audit/outbox evidence is appended. Approved/stale revisions conflict; foreign
resources are concealed. Legacy pending print purchases retain their existing
withdrawal flow instead of bypassing its purchase guards.

Completion conflicts use `APPENDIX_APPROVAL_REQUIRED`; financial commands use
`INVOICE_NOT_ELIGIBLE` or `BALANCE_NOT_ELIGIBLE`; late appendix edits use
`APPENDIX_NOT_EDITABLE`. Existing revision, authorization and payment-pin errors
remain. OpenAPI contains exact schemas and the regenerated Manager client follows
the backend digest. Local OpenAPI SHA-256: `518c27b580b415f98363d4ede9331df4830e43b9beb0c32d3c35efaa9b08feef`.

Manual completion now holds the same booking advisory lock used by appendix and
financial commands, in a serializable transaction. Automatic completion uses the
same check and returns NOT_DUE without writing its journal while pending. The
forward migration `20261107010000_completion_before_settlement` adds database
completion/appendix guards and requires COMPLETED in `require_event_ended`.
It does not backfill, delete or reprice existing financial history.

## Verification

Local tests use disposable PostgreSQL databases and controlled providers. New API
cases cover both approval orders, manual/automatic completion blocks, direct SQL
guard, cancellation/replay/reason/history, post-completion edit rejection, both
BALANCE payment methods, and concurrent completion/appendix creation.

Verified locally:

- Backend booking/balance/contract run: 64 files, 412 tests passed. Typecheck,
  build and lint passed; the final changed-file lint also passed.
- Disposable PostgreSQL applied all 82 migrations, including the new guard. The
  six new completion/cancellation/concurrency cases passed, as did demo settlement,
  strict dates, invoice revision/payment pinning, rollback and expense races.
  The final isolated expense/invoice and Analytics journeys both passed after
  adapting their fixtures to complete the event first.
- Manager production build passed with temporary HTTPS example URLs to satisfy
  the existing production configuration policy; source .env files were unchanged.
  Typecheck passed. The final frontend regression had 62/63 passing; its unrelated
  date-selection case timed out at 15s and then passed unchanged in isolation.
  The seven new UI cases passed, including fail-closed direct billing navigation.
  Typography assertions passed in the final scoped run.
- Playwright exercised the local application with controlled API responses at
  1440px and 390px. Pending Couple approval disabled both actions; same-version
  dual approval enabled completion; successful completion exposed the settlement
  link. Vietnamese uses Be Vietnam Pro and the mobile card did not overflow.
  Captures are in `test-results/completion/desktop-pending.png` and
  `test-results/completion/mobile-pending.png`. Realtime connection errors were
  expected with the synthetic API fixture, not live-provider evidence.

Broader suites are not claimed green: the final unit run passed 176 files / 1,592 tests but a Windows worker exited while loading identity.router.test.ts; that file then passed all 23 tests unchanged in isolation. a larger commercial run was interrupted by
worker resource failure, and older provider/ledger fixtures reported
CONTRACT_FULFILLMENT_REQUIRED. Those runs are not release acceptance. Local logs
are retained under `test-results/completion/` and the ignored .completion logs.
Deployment, shared database migration, exact-head CI and live-provider payment
acceptance remain separate gates. No production readiness is inferred from these
local tests.
