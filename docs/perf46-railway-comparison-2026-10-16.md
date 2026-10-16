# PR #46 Railway deployment and performance comparison

Owner authorization on 2026-10-16: merge the code and verify its effect on Railway.
The change was reviewed on exact head `88ae2870cf57f6215d1dd0ab9351ed63b90cc8a8`;
both required CI jobs passed and no review conversation was unresolved. The primary
agent's five-axis self-review found no blocking issue. An independent human review
was not claimed or required by the confirmed backend merge policy.

[PR #46](https://github.com/WDP301-wedding/wedding-be/pull/46) was merged as
`03b9a6be46bc11488b3de5bb56270cb008dd884e`. The
[merge-commit CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38895086601)
also passed both jobs, including all 1934 tests, existing per-file coverage,
migration, formatting, lint, typecheck, build, OpenAPI and dependency-audit gates.
No quality threshold was weakened.

Railway's existing main-branch deployment waited for CI, built the image and
successfully activated deployment `0c9f9cd8-1e38-4855-b2a2-84a232bbbdd5` for that
merge commit. Image digest:
`sha256:8f711f2f84401226f3cbdfb2a609ad8341aafaf661eeeff65a9ccd52d6b9261e`.
Health/live and readiness returned 200; tokenless private API probes returned 401.
The deployment kept one replica and the same `sfo`/US West application placement.
No region switch, database endpoint change or application-variable edit was made
by this operator. Diagnostics remained disabled as in the baseline. A private
fingerprint check confirmed all 69 non-Railway application variables matched the
pre-deployment snapshot; their values and hashes are not included in evidence.
The earlier baseline records placement/flags rather than this full fingerprint.

## Measured result

The [complete sanitized receipt](../tasks/evidence/perf46-railway-comparison-2026-10-16.json)
contains exact deployment identities, collection windows, request/log pairs,
pre/post fixture hashes, CI receipts and session cleanup. Each row has twenty
steady samples on the same supplied accounts and initialized booking
`e80c6f1b-a4fc-4674-a4dd-13ef2601206b`. Values below are **backend p95 in seconds**,
from the matching request log, using nearest-rank percentiles.

| GET family           | Before | After | Reduction |
| -------------------- | -----: | ----: | --------: |
| Guest groups         |  5.336 | 4.323 |     19.0% |
| Guests               |  3.890 | 2.807 |     27.8% |
| Guest planning       |  3.890 | 2.806 |     27.9% |
| Current Seating      |  6.906 | 5.782 |     16.3% |
| Compatible layouts   |  5.308 | 4.209 |     20.7% |
| Invitations          |  5.587 | 4.219 |     24.5% |
| Billing              |  3.915 | 3.443 |     12.1% |
| Manager Guest search | 11.071 | 8.287 |     25.2% |
| Identity /auth/me    |  0.616 | 0.153 |     75.2% |
| Couple overview      |  1.097 | 0.627 |     42.8% |

All **200/200 steady reads** and ten separate initial probes returned HTTP 200.
All 211 request IDs, including the expected Staff denial, matched completion logs
of the new deployment. All fifteen recorded fixture tables were unchanged during
the candidate measurement and still matched the original baseline snapshot.
Returned list counts also matched. No check-in, planning change, contract change,
ledger append or invoice was created by measurement. Measurement sessions were
revoked with 204; three explicit post-logout token probes returned 401.

Identity and populated Couple overview exceed the initial 30% same-topology p95
improvement target in this measurement. Existing PostgreSQL tests separately
prove the actor reader's actual driver commands drop from four to one, and cover
expiry, disabled accounts, role removal and concurrent credential/session
revocation with the authoritative post-lock reread. Diagnostics was disabled for
this comparison, so the live query budget is not inferred from latency alone.

## Interpretation and remaining work

This is one before/after pair under light load on a shared service at different
times. Baseline measured the booking families before Identity/overview; candidate
measured Identity/overview first, then booking families. One initial probe is kept
separate per route; it is not called a controlled cold start. The effect is an
observed improvement with the same topology/fixture, not a production SLO,
capacity claim or complete isolation of traffic, cache and database load variance.
Booking routes still take seconds, so these gains do not close the broader
performance backlog.

Staff search still correctly returned `403 CHECK_IN_WINDOW_CLOSED` for the
future event. Successful search timings use Manager authority and cannot satisfy
assigned-Staff success acceptance. Live database diagnostics/container RTT
attribution (PERF-03) and the separately controlled region experiment (PERF-04)
remain open; PERF-02/05 acceptance must retain those outstanding dependencies.
The synthetic accounting fixture does not prove real cash, real-money transfer or
VNPay/provider integration. Existing provider acceptance and NO_GO status remain
unchanged.

Rollback is available to the recorded previous source
`5b2536212e9a6feafbb48d9a71bba1f90ded08ae` and previous successful image
`sha256:d80e12f4f3b25da277b88f4138ac617cc0dee2024e7a645eb800e79781fac375`.
PR #46 adds no database migration; preserve business histories if rollback is
needed. No rollback was needed for these successful probes.
