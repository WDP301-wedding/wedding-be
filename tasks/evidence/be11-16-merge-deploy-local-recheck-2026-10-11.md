# BE-11–16: merge, deployment and local recheck — 2026-10-11

Source tested: `0d3a7fab224985d9bef5927d5c5bc2ef2fdf1986`, the merge of
[PR #29](https://github.com/WDP301-wedding/wedding-be/pull/29).
Current scope is local verification of that source. No revert, push, new deployment,
or Supabase mutation was performed by this recheck. No business-code fix was needed.

## CI and deployment already completed

- The post-logging-fix feature CI run
  [38135479028](https://github.com/WDP301-wedding/wedding-be/actions/runs/38135479028)
  passed both quality and PostgreSQL gates: 209 files / 1,617 tests, including
  367 integration tests. Historical pre-fix results of 1,616 tests remain in
  [the original checkpoint](be11-16-step6-results-2026-10-11.md).
- Merge-source CI run
  [38135978972](https://github.com/WDP301-wedding/wedding-be/actions/runs/38135978972)
  passed both required jobs. Its success and deployment status were read again
  during this recheck. No failed check was waived.
- The owner explicitly authorized merge, then deployment with 11 Supabase
  migrations. This is owner authorization; no independent team-member approval
  was recorded. CONTRIBUTING's normal review requirement remains documented.
- GitHub deployment `6994915873` succeeded at **18:41:24 Asia/Saigon** on
  2026-10-11. Existing Railway automatic deployment and Wait for CI were used.
- Historical HTTP observations at 18:41:39 Asia/Saigon: live/ready 200; Swagger,
  canonical/browser OpenAPI and catalog reads 200; anonymous appendix/expense/
  invoice reads 401 `AUTHENTICATION_REQUIRED`. All 13 step-six operations were
  present. Canonical OpenAPI matched committed bytes, SHA-256
  `c32331f01a560bc50371c802af485a89752c22897e869b265bfbc6515ec74a65`.
- Readiness verified completed migration history and checksums for 42 shipped
  migrations. This does not prove a full business journey or arbitrary schema drift.

These deployment observations were previously retained only in ignored
`test-results/step6-deployment-results-2026-10-11.md`. They are recorded here so the
handoff survives publication of this documentation. They are historical observations,
not a new authenticated runtime acceptance test.

## Local recheck

Started **19:14:38 Asia/Saigon**, duration **45.76 seconds**. Node 24.19.0,
PostgreSQL 17 in dedicated Docker container `wedding-step6-postgres`, loopback
`127.0.0.1:55436`. All three database environment variables were explicitly set to
this local target before Vitest started; the HTTP suite additionally rejects a
non-loopback migration target.

Result: **11 files / 36 tests passed, no skips**. This was a focused recheck,
not a new run of the complete 1,617-test suite or coverage measurement.

| Area | Actual local verification |
| --- | --- |
| BE-11 | Distinct-party second approval; stale/private sources; signed and zero deltas; original deposit/history retained; approval and ledger rollback together |
| BE-12 | Exact contracted print sources and quantity limits; no second charge; changed price/over-allocation denied; contracted replacement requires an appendix/new order; legacy behavior retained |
| BE-13–14 | Authoritative Vietnam event-end gate; Manager-only writes; server totals/overflow; expense CRUD, revisions, replay and concurrent edits; freeze after finalization |
| BE-15 | Itemized and zero-expense invoices; once-only source registration; finalization races/replay; rollback when outbox posting fails |
| BE-16 | Immutable debit/credit successors; over-credit and forged pins denied; adjustment/payment races; UNKNOWN reconciliation; separate approved manual refund and exact credit totals |
| Baseline regression | BE-06–10 contract, approval, retained PDF, authorization, full-total deposit and idempotent manual posting |
| Migration/API | Empty deployment of all committed migrations plus forward-compensation rehearsal; mounted step-six OpenAPI contract |

The Express HTTP harness captured **415 requests**. Status distribution: 200 = 174,
201 = 152, 400 = 2, 401 = 7, 403 = 5, 404 = 26, 409 = 40, 422 = 7, 500 = 2.
Both 500 responses are intentional rollback fault-injection cases, asserted by the
passing tests. Raw capture SHA-256:
`7630ae762b2284393cf100baec6e5694f8fd874b78d4372967cfd2c8e54df0b6`.
Local files: `test-results/step6-api/responses.json` and
`test-results/step6-recheck-2026-10-11/local-business.log`. The earlier capture was
preserved as `test-results/step6-recheck-2026-10-11/prior-responses.json`; prior
committed API observations were not overwritten.

The suite uses controlled VNPay/Storage transports and synthetic accounts/sessions.
Past-event fixtures are prepared before commercial approval/payment, and use manual
test-deposit evidence. This proves the expense/invoice handlers with historical
fixtures; it does not prove a real event elapsed after provider-hosted checkout.
The PostgreSQL driver emitted a pg@9 deprecation warning about concurrent queries;
the current locked pg@8 suite passed. No dependency or CI policy was changed.

## Remaining verification

- Full authenticated BE-11–16 journey on Railway/Supabase is still pending.
- Invoice-backed provider-hosted BALANCE checkout/settlement remains RV-14 in step 7.
  The actual VNPay deposit evidence from step 5 remains valid for that deposit flow.
- Local controlled callbacks do not constitute live VNPay balance evidence.
- No new live payment, email, Storage or paid generation was performed here.
- No code failure was found in this run, so there is no business-code correction
  to commit. Documentation corrections record the actual acceptance boundaries.
