# PERF-04 PR #63 merge and Railway deployment

Verified 2026-10-18 Asia/Saigon. Owner explicitly authorized merge and deployment.

[PR #63](https://github.com/WDP301-wedding/wedding-be/pull/63) merged head `7fcca6e56c40b57ea19cb15f450f07977fc54801` into main as `cc2999acdd24dc87e713806328022b160585c599`. Exact-head and [merge-commit CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39061098652) pass all required gates, including 1,440 unit, 58 contract, 546 integration and the full 2,044-test PostgreSQL coverage suite. No unresolved review conversation or migration change preceded merge. The merged tree matches the reviewed head.

Railway deployment `86d2addb-b0dd-4e1f-a3cd-4ed2717eb075`, image `sha256:d201a414b903413b28724591c52f2ab3a3cc0492818dd42d58ed2af370d55892`, now serves the merged commit. Automatic deployment retained GitHub main and Wait for CI. The previous deployment is stopped; both PERF-04 temporary services remain stopped. US West/SFO, one replica, pool caps/reserve/timeouts, provider variables and commands are unchanged. Diagnostics, safe-read deadline and startup probe remain false. Seating reconciliation uses its true default and Notifications remains enabled; the startup manifest confirms both configurations. This does not prove completed background sweeps or delivery.

All **20/20 smoke operations** returned their expected status and match completion logs from the exact new deployment with diagnostics absent. Health/live, health/ready, Swagger and canonical OpenAPI return 200; OpenAPI checksum matches the reviewed artifact. Anonymous Identity returns 401 and metrics 404. Existing synthetic Couple/Manager sessions authenticate; eight Identity/overview/Guest-plan/Seating/billing/templates/Analytics reads return 200. Both sessions revoke normally and token reuse returns 401. There are no 5xx among these operations. All checked upstream headers remain railway/us-west2.

All fifteen selected business-table digests and sixty migration checksums match before/after; no perf04 probe connection remains. Session rows and derived Analytics projections are separate from retained business history. The earlier 67 and rerun 177 sealed operator hashes remain valid. No extra region comparison or paid/provider mutation was run.

PERF-13 and broader production NO_GO remain unchanged. This is deployment and bounded smoke evidence, not production-capacity or full-provider acceptance.

[Sanitized detailed receipt](perf04-pr63-merge-railway-2026-10-18.json).
