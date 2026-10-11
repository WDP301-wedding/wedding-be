# BE-17 delivery and BE/RV completion reconciliation

Date: 2026-10-12, Asia/Saigon. Source audited:
`054d670d6a7edd4d8028004271b02fab5c60973f` (main, PR #32).
Documentation branch: `codex/be17-extension-handoff`. Existing untracked merge
and review reports were preserved and read, not silently discarded.

## Delivered package

[Consumer hand-off](../../docs/be17-extension-handoff.md) consolidates mounted
runtime, strict schemas, private/public routes, role/revision/idempotency rules,
JSON examples/errors, monetary formulas, forward migrations and recovery limits.
[Exact manifest](be17-extension-manifest-2026-10-12.json) pins source, dependency
lockfile, 21 runtime/provider/model file digests, all 44 migration checksums and
49 relevant OpenAPI operations. No application source, applied migration,
frontend code, provider configuration or shared business data changed.

BE-17 is complete as an extension hand-off: every required implementation is
mounted and verified, and its exact consumer/evidence package is delivered.
Final acceptance of BE-11–16 still requires the previously recorded independent
team-member approval. This audit does not waive that gate or equate an agent
review/owner-authorized merge with a team-member approval. Their six acceptance
checkboxes remain open for that precise reason, rather than stale claims that
their runtime/CI is untested. Completing the hand-off does not close those gates.

## BE acceptance matrix

| Task | Implemented and verified behavior | Evidence / acceptance status |
| --- | --- | --- |
| BE-01 | Nullable explicit NFC bride/groom names, no guessed legacy backfill | [Foundations](be01-05-commercial-foundations.md); accepted |
| BE-02 | Scoped profile commands/readers, preserved conversion and audit | Foundations; accepted |
| BE-03 | Versioned service catalog, immutable history | Foundations; accepted |
| BE-04 | Manager service price/archive API and exact historical selections | Foundations; accepted |
| BE-05 | Commercial print facts and safe exact template selection | Foundations and [provider runtime follow-up](be05-railway-template-batch-2026-10-11.md); accepted |
| BE-06 | Multi-menu immutable snapshots, checked totals/capacity | [BE-06–10 acceptance](be06-10-acceptance-2026-10-11.md); accepted |
| BE-07 | Exact dual approvals, stale/duplicate/serialization proofs | BE-06–10 acceptance; accepted |
| BE-08 | Retained authorized Vietnamese PDF/digest/clause | BE-06–10 acceptance and [HTTP/PDF proof](be06-10-api-results-2026-10-11.md); accepted |
| BE-09 | Full-total 30% deposit, exact revisions/slot/UNKNOWN pins | [Revised genuine sandbox deposit](rv13-media-ai-runtime-2026-10-11.md); accepted |
| BE-10 | Once-only CONTRACT charge and retained legacy settlements | BE-06–10 acceptance; accepted |
| BE-11 | Appendices with predecessor/reason/signed delta and print-source preservation | [Repairs/DB races](be11-16-repairs-2026-10-11.md), [deployed dual appendices](rv14-15-runtime-2026-10-12.md); technical verification passed, team approval unrecorded |
| BE-12 | Contracted fulfillment billed once, allocation/cancellation/replacement protection | Repairs and [actual print/unchanged ledger](rv14-20-runtime-2026-10-12.md); technical verification passed, team approval unrecorded |
| BE-13 | Event-end Manager expenses, integer/overflow policy/schema | [Step-six tests/migrations](be11-16-step6-results-2026-10-11.md), repairs, authorized isolated future-event native harness; technical verification passed, team approval unrecorded |
| BE-14 | HTTP CRUD/retry/revision/audit/finalized lock | Repairs' 511-request capture and deployed controlled-clock Manager/Couple/stale denials; technical verification passed, team approval unrecorded |
| BE-15 | Immutable itemized/zero-expense invoice, atomic once-only posting/finalize races | Real PostgreSQL tests and [authorized native invoice](rv14-15-runtime-2026-10-12.md); technical verification passed, team approval unrecorded |
| BE-16 | Immutable adjustments, net paid/refund/credit, invoice-pinned BALANCE/UNKNOWN | Repairs' adjustment/UNKNOWN/race tests and genuine invoice-linked sandbox BALANCE; technical verification passed, team approval unrecorded |
| BE-17 | Consolidated exact API/provider/migration/evidence and consumer hand-off | Complete; package records the BE-11–16 team-review gate without waiving it |

The initial BE-11/12 P1 finding is historical, not an unresolved bug on this
source. PR #30 added forward migrations `20261011030000`/`031000` and regression
proof for preserved allocated source/price and contracted zero/large quotations.
The [merge/CI/Swagger report](be11-16-pr30-merge-swagger-2026-10-11.md) confirms
the fixed source reached main/deployment. Subsequent native live receipts replace
the old pending-online notes for the tested journey. They do not supply a missing
independent team-member approval, production merchant acceptance or crash recovery.

## RV reconciliation

| Tasks | Result / evidence |
| --- | --- |
| RV-01–03 | Already checked; [runtime foundation](rv01-03-runtime-foundation-2026-10-10.md) |
| RV-04/05/07 | Missing todo ticks repaired using [recovered sanitized receipts](rv04-05-07-12-runtime-2026-10-11.md): real mailbox/OTP, backend proxied session transport/restart, real catalog Storage |
| RV-06 | Already checked; [populated disposable retention/operator procedure](rv06-retention-2026-10-12.md), manual daily review, no installed automatic job |
| RV-08–11 | Already checked; [media/public/QR/one authorized Gemini/recovery](rv13-media-ai-runtime-2026-10-11.md) |
| RV-12/13 | Already checked; [genuine sandbox receipts](rv12-13-vnpay-railway-2026-10-11.md) and revised full-contract rerun |
| RV-14/15 | Already checked; [genuine legacy/revised BALANCE and native journey](rv14-15-runtime-2026-10-12.md); future-event invoice used only owner-authorized isolated clock |
| RV-17/18/20 | Already checked; [accepted two-sided A5 PDF and runtime observability](rv14-20-runtime-2026-10-12.md), [final CORS file metadata](rv18-cors-followup-2026-10-12.md) |
| RV-16 | Open: actual NTF-W1/3/4 worker/outbox/retry/due-command consumers; ports/rows/manual retention cannot close it |
| RV-19 | Open: real SEA-W3/5 fixed-layout/group printable output; accepted A5 files currently have no Seating rendering |
| RV-21 | Open: owner-reviewed enabled-feature/runtime/recovery release checkpoint, including REL-W3 and unresolved required-feature gates; BE-17 manifest is input, not final release acceptance |

After reconciliation, **18/21 RV tasks are checked**, with only RV-16/19/21 open.
**11/17 BE tasks are checked**; BE-11–16 implementation, offline gates
and the authorized developer journey are verified, while independent team review
is unrecorded. BE-17's completed hand-off records that remaining acceptance gate.
No missing evidence is presented as a code defect. Future SPEC-06–11 tasks stay open.

## Verification provenance

This is documentation/evidence-only work. Runtime code, lockfile, migrations and
OpenAPI bytes are unchanged from the exact CI-passing source above, so the
existing complete database/full-coverage run remains the backend quality evidence.
New local checks are recorded separately; no skipped database suite is counted.

| Command / environment | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run build` on Windows, Node 24.15.0 / npm 11.7.0 | Fresh local pass; logs `test-results/be17/` |
| `npm run test:unit -- --maxWorkers=2` | Fresh local 134 files / 1,234 tests pass, no skips; 39.79 seconds |
| `npm run test:contract` | Fresh local 12 files / 37 tests pass, no skips; 4.53 seconds |
| `npm run api:generate`, `npm run api:check` | Fresh local pass; no artifact diff |
| `npm run test:integration` on exact-source PostgreSQL 17 CI | Historical exact-source 68 files / 382 tests pass |
| `npm run test:coverage -- --maxWorkers=2` on exact-source CI | Historical 214 files / 1,653 tests pass; statements 96.51%, branches 93.56%, functions 98.48%, lines 97.33%; each file lines/branches >=80% |
| `npm run db:migrate:deploy` / populated upgrade suites on exact-source CI | Historical 44 empty-install migrations; real upgrade/persistence/rollback/race tests pass |
| Format/lint/typecheck/unit/contract/API/build/audit on exact-source CI | Historical pass under unchanged policy, including current advisory exception; no claim of zero advisories |
| Fresh anonymous GETs, six requests on deployed HTTPS | Canonical API byte digest matches; live/ready 200; contracts/invoices/management-expenses 401 `AUTHENTICATION_REQUIRED` |

[Exact-source CI 38172405227](https://github.com/WDP301-wedding/wedding-be/actions/runs/38172405227)
and [deployment/Swagger metadata](rv14-20-pr32-merge-swagger-2026-10-12.md)
record the full quality run, source and deployed API. This audit reads those
records; it does not claim another fresh full-suite/provider rehearsal or verify
feature readiness from health alone.

Recovered receipt publication used a file-only local script reading existing
sanitized results and selecting startup facts from private logs. No private raw
log or test mailbox value was copied. Historical source/API identities and
controlled-expiry/browser limitations are retained. The manifest generator
read local source and sent only six public/anonymous HTTPS GETs. Changed-file
formatting, relative-link/schema/hash/secret-pattern checks and `git diff --check`
passed at final publication: 12 package files, 72 valid relative links, all pinned
provider/migration/source hashes unchanged, valid JSON and no credential/PII
patterns. All six fenced JSON examples passed the actual runtime Zod schemas.
Changed docs passed Prettier; `tasks/` retains the repository's manual formatting
convention. `git diff --check` passed. The five pre-existing untracked review/merge
reports are included unchanged so every evidence link exists in the package.
