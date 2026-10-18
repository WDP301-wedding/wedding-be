# PERF-06 completion after reviewed Railway rollout

Completed on 2026-10-18 (Asia/Saigon), in the owner-approved scope of four
existing live templates and 1/4/20-item local checks. The original implementation,
test failures, native comparison and source hashes remain in the
[verification checkpoint](backend-performance-06-verification-2026-10-18.md)
and its immutable receipt. This closure supersedes that checkpoint's pending
rollout status; it does not rewrite measurements or expand provider acceptance.

## Reviewed code and CI

[PR #66](https://github.com/WDP301-wedding/wedding-be/pull/66) merges reviewed head
`834398f4d9569e849460c89c762086cacb118d78` as
`df945b6f4ad10a44f37134e76a662f041283325b` after the owner explicitly approves
merge, deployment and after-rollout verification. Both Git trees match exactly;
there are zero unresolved review threads. Five-axis self-review is recorded,
with no independent human review claimed or required by backend policy.

[Exact-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39098978173)
and [merge CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39099474660)
both pass on their first attempt: 1,461 unit, 59 contract, 556 integration tests
and the full **2,076-test PostgreSQL coverage suite**. Coverage is 96.65% statements,
93.51% branches and 97.56% lines, with the existing per-file 80% thresholds intact.
Formatting, lint, typecheck, build, OpenAPI, immutable migration checks and dependency
audit pass. No high/critical advisory or weakened gate is accepted.

The change reads the bounded template head page and its captured immutable
versions in one parameterized statement. Version ownership, missing-version
denials, active/archive selection, schema quoting, cursor order and both fresh
authority checks remain. Native service work decreases **4 → 3 commands** and
the management HTTP flow **6 → 5**. The regression ceiling tightens to three
service commands for twenty templates. No schema/API or provider change occurs.

## Active deployment and public result

Railway waits for merge CI, then activates deployment
`f0332652-cf57-4b46-807a-d0d92e75d5e3`, exact source `df945b6…`, image
`sha256:cb99729e156b0d563c2463a92589cc65597bdb6f449092a353b67fa442dc0388`.
The previous deployment `ba3a5b90-fa14-4ff6-9f30-5f364af57b6e` stops before
measurement; only the new deployment runs. Service/application-variable
fingerprints match the premerge snapshot. Pools, reserve, acquire/idle settings,
workers, one-SFO placement, commands and provider configuration are unchanged.
General diagnostics and safe-read DB deadlines stay off. OpenAPI SHA-256 remains
`19da7dafc991d316f7f048a58c6446deabb2e724edb3a49d55e4709ce14d04e2`.

Each public case has one separately retained initial read and twenty steady
samples, alternating cases sequentially. Every complete response hash matches
its native/before result; successful reads retain `Cache-Control: no-store`.
There are no measurement retries or discarded tail samples. P95 is nearest rank.

| Returned case    | Before backend p95 ms | After backend p95 ms | Backend reduction | Before client p95 ms | After client p95 ms |
| ---------------- | --------------------: | -------------------: | ----------------: | -------------------: | ------------------: |
| One template     |               908.412 |              749.898 |           17.450% |            1,153.443 |           1,239.131 |
| Four templates   |               907.372 |              748.492 |           17.510% |            1,152.532 |           1,461.839 |
| One after cursor |               906.535 |              750.580 |           17.203% |            1,157.288 |           1,272.215 |

All **60/60 steady and 3/3 initial reads return 200**. Login returns 201, logout
204, and revoked token reuse returns 401 on both Identity and the template route.
Anonymous template access returns 401; live/readiness/OpenAPI checks return 200.
All **71/71 after-rollout operations** match exactly one completion log in the new
deployment, while all 66 before operations retain their old-deployment matches.

**Client p95 worsens by 7.4%, 26.8% and 9.9% in this cohort**, despite the lower
backend p95. Client medians improve, but that does not erase the tail regressions.
No specific network/ingress/provider stage is established as their cause. Retain
all samples and investigate end-to-end tails under PERF-13; this is not a blanket
client-latency improvement, capacity/SLO proof or reason to change pool/deadline
settings. The public comparison is one before/after pair at different times on
the same selected service/fixture and may include shared-load variance.

The original at-least-30% target is met by the separate same-container native
comparison against the pinned pre-PERF-06 source: 43.9–44.3% lower p95 across
twenty matched triplets per case. That experiment excludes public ingress.
Incremental native gain over the already optimized deployed batching version is
16–16.5%; the public table above measures that newer baseline separately. No
twenty-item live result is claimed: four live templates and 1/4/20 local coverage
are the explicitly selected scope.

## Preservation and disposition

All nineteen selected business/profile/template table digests and all 61 applied
migration checksums match before/after and the source files. Template/version
histories and response snapshots remain unchanged. Session/audit lifecycle writes
are the operational exception. No booking, contract, invoice, ledger, planning or
check-in mutation is submitted by the campaign; no companion rule is introduced.

The temporary native pool and loopback servers are closed, the dedicated SSH key
is revoked with failed reuse, and only its owned local key/discovery files are
removed. The dedicated local PostgreSQL cluster is stopped with zero remaining
test databases or schemas. No paid generation, provider write, live template
fixture creation, business-history cleanup or frontend work occurs.

The [sealed closure receipt](../tasks/evidence/perf06-closure-2026-10-18.json)
retains exact CI/deployment identities, source continuity, public request/log pairs,
raw before/after measurements, preservation/cleanup and artifact checksums. The
original verification receipt and all 35 pinned operator artifacts stay unchanged.
PERF-06 is complete in this stated backend scope. **PERF-13 remains open**, including
the client-tail regressions above; provider acceptance and production **NO_GO**
remain unchanged. Rollback is the preceding reviewed source/image, without schema
rollback or rewriting any business history; it was not needed for these checks.
