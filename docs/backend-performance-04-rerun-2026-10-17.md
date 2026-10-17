# PERF-04 matched application-region comparison

Measured 2026-10-17 UTC (17–18 October in Asia/Saigon). **PERF-04 is complete for the authorized synthetic backend comparison:** three complete pairs, sixteen families, twenty steady samples per family per cohort. Keep the original US West deployment. This result authorizes no production-region switch and does not change the broader production NO_GO.

The [sealed rerun receipt](../tasks/evidence/perf04-region-rerun-2026-10-17.json) retains all samples, request/log matches, native probes, configuration identity and cleanup. The [earlier aborted run](backend-performance-04-region-2026-10-17.md) remains separate, including its Seating 500. [Reconciler isolation and its limits](backend-performance-04-reconciler-2026-10-17.md) explain the correction before this fresh comparison.

## Controlled comparison

Source 11a0d8cf3846e292b9b35373ad6af338cfd4d463. The first five cohorts used immutable image sha256:ce789a21cac59cbf14d44c3d0dbca438c47108179dbc1f333f7af4375cec8032; final Singapore used sha256:4c8927ca07ee244b9583ee85f9df95f9214b0a15b910fd4dfdad29b8d1c3c6a8, under explicit owner approval. Railway could not consistently combine the first digest with Singapore placement. All 27,115 application files, dist/dependency trees, Node binary/version, OS package-version list/release and CA hashes match between the two images. OS file contents outside the explicitly hashed artifacts and image configuration were not exhaustively compared; this is an approved artifact-equivalence exception, not identical image digests. All cohorts used one temporary app at a time, one replica, 1 vCPU/1 GB, the same DB endpoint/TLS, schema and initialized booking fixture. The provider confirms Supabase Sydney ap-southeast-2; the DB was not moved.

Both Notifications delivery and Seating reconciliation were explicitly disabled, with separate runtime-manifest declarations and container checks. Diagnostics were enabled; safe-read deadlines and startup probes stayed disabled. Six common pools of one, Catalog three, Analytics two and readiness one remained within the original 60-slot budget: original plus one temporary app and reserve 36. Acquisition 2,000 ms and idle 60,000 ms were unchanged. No migration command ran on temporary deployments.

Only compare regions within this new worker mode. The change from the earlier aborted cohort is not attributed to region placement, and disabling reconciliation is not a general production pool-contention fix. The historical live holder and enabled-worker capacity remain PERF-13.

The operator invoked business GETs and normal session login/revocation controls. Analytics GETs can publish derived projections, and the unchanged original service retains its own background work. Unchanged selected business-table digests do not mean that every table or session row in the shared synthetic database was frozen. No new business fixture or migration was created by this campaign.

Region order: west-1 → singapore-1 → singapore-2 → west-2 → west-3 → singapore-3. Each cohort has 16 initial and 320 steady reads: **2016/2016 business reads returned 200**, including 1,920 steady and 96 initial. All **2112/2112** selected HTTP operations match exact-deployment completion logs. Normal session login/revocation and denied-reuse checks are included separately.

Requests were sequential round-robin with at least 750 ms start spacing. Any unexpected status, transport failure or 25 s request would stop the campaign. Initial probes are excluded from percentiles. The ranges below show three independent cohort percentiles; they are not a pooled SLA or confidence interval. Analytics includes naturally occurring generation refresh work; raw query counts and the lower-query-count subset stay separate. The receipt field warmOnly uses at most 20 recorded driver commands; that filter alone does not prove a pure cache hit.

The cohorts ran sequentially across different times, with operator pauses. Regional paths and refresh/cache state can vary over time; three pairs do not remove those effects. The approved final image exception is another explicit limitation. Retain each cohort and native RTT separately; this experiment supports a conservative placement decision, not a precise causal allocation or broad production claim.

Operator verification pauses were retained: transition validation, delayed ingestion of final logout/token-denial logs, redeployments in the wrong region, conflicting HTTP/container region metadata, and a changed image digest. All such deployments stopped before business measurements. No redeploy method is assumed to guarantee image or placement. The final digest exception and extension from 120 to 150 minutes were explicitly approved after artifact comparison; source/config/native/upstream checks still passed before admitting its reads. No failed business sample was discarded or replaced. Original journals and the incomplete log snapshot remain alongside the eventual complete match.

## Repeated latency results

| Family                 | US West p50 range (ms) | US West p95 range (ms) | Singapore p50 range (ms) | Singapore p95 range (ms) | p95 range relationship        |
| ---------------------- | ---------------------: | ---------------------: | -----------------------: | -----------------------: | ----------------------------- |
| identity               |            374.2–385.2 |            400.5–411.8 |              249.4–329.7 |             274.6–2157.6 | Ranges overlap                |
| overview               |            976.1–999.8 |           991.9–1051.0 |            1037.7–1320.0 |            1048.0–3117.0 | Ranges overlap                |
| inbox                  |          1114.9–1157.4 |          1178.3–1228.7 |            1239.9–1578.6 |            1254.0–3428.9 | Singapore range above US West |
| unread                 |            968.5–997.8 |           979.2–1011.2 |            1040.3–1269.6 |            1054.3–1352.9 | Singapore range above US West |
| templates              |          1130.9–1170.7 |          1161.4–1207.3 |            1286.1–1594.0 |            1307.6–1675.4 | Singapore range above US West |
| print-orders           |          1133.2–1173.1 |          1150.1–1468.6 |            1290.7–1593.4 |            1303.7–1672.4 | Ranges overlap                |
| analytics              |          1570.5–1597.0 |          1602.6–2934.9 |            1827.9–9847.0 |           3271.9–10401.9 | Singapore range above US West |
| halls                  |          1226.9–1236.5 |          1348.7–1483.6 |             937.7–1203.4 |            1434.9–2948.4 | Ranges overlap                |
| dishes                 |          1328.2–1354.6 |          1370.6–1455.5 |            1078.5–1331.2 |            1440.9–1730.2 | Ranges overlap                |
| guest-groups           |          2928.4–3041.4 |          2997.4–3073.6 |            3663.2–4466.0 |            3705.0–4671.4 | Singapore range above US West |
| guests                 |          2924.1–3043.0 |          2963.3–3072.6 |            3664.7–4490.4 |            3681.7–4676.5 | Singapore range above US West |
| guest-plan             |          2924.8–3041.8 |          2948.4–3082.9 |            3664.5–4471.4 |            3682.0–4679.3 | Singapore range above US West |
| seating-plans/current  |          4742.0–4905.1 |          4785.6–4934.6 |            6203.5–7750.4 |            6219.3–8146.0 | Singapore range above US West |
| seating-layout-options |          4285.7–4436.7 |          4346.1–4461.4 |            5589.1–7000.2 |            5603.5–7302.4 | Singapore range above US West |
| invitations            |          3687.2–3817.8 |          3752.4–3841.0 |            4773.0–5975.1 |            4790.0–6251.5 | Singapore range above US West |
| billing                |          2447.5–2479.4 |          2472.9–2567.3 |            3159.8–3887.3 |            3171.7–5706.0 | Singapore range above US West |

Native 20-read DB RTT medians were **148.8 / 149.0 / 147.8 ms in US West** and **209.2 / 200.6 / 252.3 ms in Singapore**. Connection establishment is retained separately. This explains why geographic proximity to Vietnam alone cannot select the better app-to-Sydney path. It does not allocate an exact percentage of business latency to network or SQL.

Retain US West for the current deployment. The receipt preserves per-pair directions, overlapping ranges and route-specific exceptions; it does not claim one region is faster for every route. A future move needs representative workload and enabled-worker acceptance, with separate callback/egress review. No runtime configuration of the original service was switched.

## Placement and provider verification

Every cohort verified its exact deployment/image/source and the actual Railway runtime region before business reads. An HTTP X-Railway-Debug:1 control confirmed X-Railway-Upstream-Zone for railway/us-west2 or railway/asia-southeast1-eqsg3a. The edge POP is recorded separately. Historical redeploy manifests can retain old region values. Reading /proc/1/environ was denied; that denial remains explicit and is not treated as successful init-process verification.

All six native probes verified TLS and downloaded the same existing 237-byte private Hall fixture, matching its checksum without uploads/deletes/generation. This proves connectivity/content, not media throughput. Loopback CORS checks matched the explicit configured origin; login cookies retained Secure/HttpOnly/SameSite=Lax. Original callback/public invitation origins were retained. A future region rollout must review VNPay outbound IP/allowlist and query-IP implications; no gateway/callback/payment operation was tested here.

See [Railway upstream versus edge headers](https://docs.railway.com/networking/edge-networking), [region identifiers](https://docs.railway.com/deployments/regions) and [outbound IP implications](https://docs.railway.com/networking/static-outbound-ips).

## Retention and cleanup

The campaign verified its final deployment stopped by 2026-10-17T18:53:21.196Z, within the owner-extended 150-minute ceiling expiring 2026-10-17T19:11:42.431Z; credential cleanup started at 2026-10-17T18:53:26.773Z. Both owned temporary services are stopped archives; copied credentials were removed, diagnostics disabled and the source disconnected. The final dedicated SSH key and four prior keys were revoked, transport denial verified, and only their owned local key/discovery files removed. No service deletion or business cleanup was performed.

All fifteen selected business-table digests and sixty migration checksums match before/after; no owned probe connection remains. The original deployment e12f82d4-c247-41ac-9b46-7417c260254a, image, SFO placement, commands, worker settings and full non-Railway variable digest are unchanged. Its live/readiness/OpenAPI checks returned 200, anonymous Identity 401 and metrics 404; all five match its logs with diagnostics absent. OpenAPI checksum is unchanged.

Source validation: [exact-head Linux CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39048233109) passed 1,440 unit, 58 contract and 546 integration tests, then the full 2,044-test PostgreSQL coverage suite. Formatting, lint, typecheck, build, OpenAPI and dependency-audit gates passed unchanged. The separate [fix receipt](../tasks/evidence/perf04-reconciler-isolation-2026-10-17.json) retains TDD evidence and the first fixture-related CI failure before correction.

PERF-04 completion is an experiment/decision receipt. It is not an SLA, concurrent load test, enabled-worker production-capacity claim, provider-readiness approval or frontend acceptance.
