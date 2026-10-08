# Booking lifecycle checkpoint evidence

Status: **SPEC-03 ACCEPTED; BK-W1–BK-W8 complete and BK-C4 passed on 2026-10-08.**

This file presents the final accepted checkpoint. Earlier pending-acceptance statements,
interrupted-work notes, test/migration traces, runtime screenshots, and review remediation
are preserved in the [checkpoint history](../../docs/archive/2026-10-09/evidence/booking-lifecycle.md).
The historical measurements below describe that acceptance run, not a fresh verification
of later repository changes.

## BK-C4 implementation acceptance — 2026-10-08

The project owner instructed: “vậy có thể merge nhánh này vào main và đánh dấu đã
hoàn thành SPEC-03 chưa? nếu có hãy merge giúp tôi”. This authorizes SPEC-03
acceptance and merge once the technical gates pass, superseding the earlier
commits-only instruction. Those gates now pass; BK-C4 is closed and SPEC-03 is
ACCEPTED. This acceptance does not mark SPEC-04 complete.

Verified implementation heads selected for merge into main:

| Repository | Verified feature head | Tests | Line / branch coverage |
| --- | --- | --- | --- |
| wedding-be | baff3d5 (includes c5f5efa, 32484db, 73fc007 review fixes) | 917 / 111 files | 96.85% / 92.81% |
| wedding-manage-web | 3e9d833 | 91 / 13 files | 97.50% / 93.30% |
| wedding-web | 7d1826a | 50 / 7 files | 98.13% / 96.49% |
| wedding-app | ef7f6c8 | 30 / 3 suites | 96.66% / 88.55% |

Backend main advanced to 6bb247b while review was in progress. It changes lockfile
metadata only: package membership, versions, resolved URLs and integrity hashes are
unchanged. Merge baff3d5 integrates it without conflicts or source changes. The
917-test PostgreSQL coverage proof at c5f5efa therefore still applies; backend
format, lint, typecheck, OpenAPI, production build and audit were refreshed after
integration. Clean/upgrade migrations, real-provider conformance, concurrency,
authorization, immutable evidence and the six new regression tests are covered by
the recorded PostgreSQL runs above.

Both Web consumers were clean-installed with npm ci and verified on the locked
Next 16.3.8. All three consumers passed format, lint, typecheck, api:check, full
coverage, build/export and dependency-audit policy. Web coverage used one worker.
The initial Android run had one UI-test timeout during parallel validation; a
separate rerun passed all 30 tests with the unchanged default timeout. No test,
coverage threshold or audit exception was weakened.

All consumers retain backend artifact commit
168f61dd16fa58760b0d6238b7ebfd73503471c7 and SHA-256
cc57e41c60f5e8e4edf9c5c835f986a7e4b17bfd64bbb3853888b29a9968ff40.
The review fixes do not change the frozen HTTP contract. The earlier real-provider
browser and Android runtime proof remains applicable to these unchanged consumer
heads; no new runtime rendering is claimed for this merge checkpoint.

Merge-gate logs and client coverage summaries are saved outside the repositories at
C:/Users/DELL/.codex/visualizations/2026/10/08/01a11b1c-efb9-7cf2-a865-fc59b93e139c/booking-lifecycle-merge/.
The backend full-coverage log and summary remain in the sibling
booking-lifecycle-fixes/ directory. Audit gates pass with the previously reviewed,
unexpired exceptions; passing policy does not mean zero dependency vulnerabilities.

Acceptance closes ACC-001 and TML-001–008 and authorizes downstream integration
against the implemented Booking provider contract. Deployment must apply migration
20261008007000_booking_commercial_acceptance through the normal migration process.
No production database is modified by this merge.
