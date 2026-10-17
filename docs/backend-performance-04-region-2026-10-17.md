# PERF-04 application-region experiment — 2026-10-17

**Aborted at the required fail-stop gate; PERF-04 remains open by the owner's decision.** Investigate/fix the pool and Seating failure before a fresh comparison. The original US West service is unchanged. Singapore is not approved for rollout, and no region winner is selected. Three complete pairs and twenty successful Singapore samples per family were not achieved.

The [sealed receipt](../tasks/evidence/perf04-region-comparison-2026-10-17.json) retains all 509 attempted business reads, 508 successful reads, the failed request, matching logs, container/provider probes, configuration identity and cleanup. All 541 selected HTTP operations, including session controls and recovery, match completion logs. No application source, schema, OpenAPI, dependency, migration or frontend file changed.

## Controlled target and stopping result

The owner selected the existing synthetic demo in Railway production, preserved wedding-be and explicitly extended the runtime ceiling first to 90 and then to 120 minutes. Actual temporary runtime stopped at 14:59:41 UTC, before the authorized 16:13:08 UTC limit. Source was f2012acfba830adc2704f60b5b561eabe867eda1; both measured cohorts used immutable image sha256:a809e7d2e30e96d3981b134a615a33f519f0a933dd63c4bc4015be66284b2d46.

Supabase Management API confirmed project zjibuegbbwzvdqrnujjf in Sydney (ap-southeast-2). The same direct DB endpoint/TLS, sixty migrations and retained initialized fixture were used. One temporary application ran at a time, at one vCPU / 1 GB, with six common pools of one, Catalog three, Analytics two, one readiness slot and reserve 36: 12 * 2 + 36 = 60. Workers were disabled on the temporary runtime; the original worker remained enabled. Mail/AI/VNPay credentials were omitted or replaced with non-delivery dummy configuration. Storage reads remained enabled. No pre-deploy migration ran.

A second empty service was created but never deployed. The measured build was reused on one temporary service sequentially to preserve the image. Config-as-Code is rejected for new Railway services; direct temporary settings were used. Historical redeploy manifests differed from selected runtime metadata during setup. The runtime receipts record region and deployment identity; /proc/1 metadata was denied with EACCES, and an additional upstream-zone fence was not reached before the abort. Excluded setup builds and failures are retained and do not count as regional measurements.

US West completed 16 initial and 320 steady reads, all 200. Singapore completed 16 initial and 156 steady successful reads before Current Seating returned 500 at round 10. The campaign stopped, revoked sessions and stopped the container; there was no blind retry or attempt to fill the missing denominator.

## Container DB and provider observations

Twenty SELECT 1 samples gave US West median/p95 **147.973 / 150.455 ms**, versus Singapore **200.578 / 200.779 ms**. These are actual runtime-container observations, not desktop RTT. Connection establishment was 1076.6 versus 1447.6 ms. This bounded probe did not demonstrate a Singapore advantage; it does not establish why the network path was slower.

Both native probes reported DB TLS 1.3 / 256 bits and PostgreSQL 17.6. Each signed and downloaded the same existing 237-byte Storage object over HTTPS with the exact persisted checksum, without upload or deletion. The Singapore loopback CORS preflight returned 204 with the configured allowed origin and credentials flag. Login/recovery cookies retained Secure, HttpOnly and SameSite=Lax. A real browser cookie journey was outside backend acceptance.

## Partial descriptive HTTP timings

Client milliseconds; p50 / p95 use nearest-rank successful steady samples only. Counts are unequal and Singapore is incomplete. These rows are preliminary observations, not the planned three-pair acceptance or an SLA. Initial probes, mixed Analytics refresh generations and the failed Seating attempt remain separately retained.

| Family                 | US West n | US West p50 / p95 ms | Singapore successful n | Singapore p50 / p95 ms |
| ---------------------- | --------: | -------------------: | ---------------------: | ---------------------: |
| identity               |        20 |        394.7 / 580.7 |                     10 |          248.8 / 365.0 |
| overview               |        20 |       984.6 / 1148.2 |                     10 |        1062.9 / 1181.1 |
| inbox                  |        20 |      1130.2 / 1259.1 |                     10 |        1259.1 / 1369.8 |
| unread                 |        20 |       979.6 / 1212.8 |                     10 |        1052.7 / 1059.2 |
| templates              |        20 |      1134.7 / 1800.2 |                     10 |        1236.7 / 1277.5 |
| print-orders           |        20 |      1133.8 / 1393.9 |                     10 |        1238.7 / 1313.7 |
| analytics              |        20 |      1584.0 / 9348.3 |                     10 |        1932.7 / 4964.6 |
| halls                  |        20 |      1230.5 / 1411.7 |                     10 |         916.0 / 2090.6 |
| dishes                 |        20 |      1359.1 / 1589.7 |                     10 |        1100.4 / 1421.9 |
| guest-groups           |        20 |      2923.9 / 3043.0 |                     10 |        3895.0 / 5995.3 |
| guests                 |        20 |      2921.8 / 3085.4 |                     10 |        3894.6 / 3960.5 |
| guest-plan             |        20 |      2916.1 / 3081.7 |                     10 |        3895.6 / 3948.9 |
| seating-plans/current  |        20 |      4723.2 / 5380.2 |           9 + 1 failed |        5992.2 / 6181.9 |
| seating-layout-options |        20 |      4265.3 / 4382.4 |                      9 |        5393.4 / 5407.1 |
| invitations            |        20 |      3669.0 / 3783.0 |                      9 |        4610.8 / 4638.9 |
| billing                |        20 |      2469.2 / 2671.8 |                      9 |        3045.9 / 3179.1 |

## Failed acquisition and follow-up

Current Seating request 8c8206ee-8adf-46c9-8080-f70644ddf56b returned INTERNAL_ERROR / HTTP 500. Its exact completion log reports 2004.191 ms backend time, acquire 2001.050 ms, one acquire, zero submitted SQL, and pool observations active 1 / idle 0 / waiting 1. The generic Error event has no Prisma/driver code. This establishes failed connection acquisition, including any connection establishment, but does not identify the holder or prove a root cause. Lock-command and query RTT were zero for this request; do not relabel acquisition as SQL execution or pure row-lock blocking.

PERF-13 already retains an earlier intermittent US West Seating 500. This new failure is additional regression evidence, not proof of a Singapore-only bug. No pool cap, reserve, deadline, authority check or business rule was weakened. A future fix and fresh complete comparison require separate implementation/review and new measurements; this run is not resumed after the safety abort.

## Connectivity consequences and cleanup

Keep US West and the original callback/public invitation origins. A future rollout must separately review VNPay merchant egress allowlists and the configured query IP; no payment callback or gateway operation was exercised here. Region movement can change outbound IPs, and a configured query-IP value does not prove actual egress. Private Storage signed URLs keep their provider origin and short validity; CORS remains an explicit frontend-origin allowlist, and host-only secure cookies do not migrate between temporary domains. These reviews authorize no production switch. See [Railway outbound networking](https://docs.railway.com/networking/outbound-networking), [static outbound IPs](https://docs.railway.com/networking/static-outbound-ips) and [edge versus upstream region](https://docs.railway.com/networking/edge-networking).

Both temporary services are archived, stopped resources: copied credentials were removed, diagnostics set false and the source detached. They were not deleted after the connector refused deletion; no alternative delete route was attempted. Railway may retain a historical SUCCESS status for a stopped deployment; the receipt separately verifies deploymentStopped. The dedicated SSH key was revoked, a new connection was denied, and only its owned local key/discovery files were removed.

All fifteen selected business-table digests and sixty migration checksums match before/after; no owned probe connection remains. The original deployment e12f82d4-c247-41ac-9b46-7417c260254a, SFO placement, image, service commands, worker and full non-Railway variable digest are unchanged. Live/readiness/OpenAPI returned 200, anonymous Identity 401 and metrics 404; all five match original-deployment logs with diagnostics absent. OpenAPI SHA-256 remains 68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694.

Verification: exact request/log correlation, artifact/retention/cleanup assertions, operator JavaScript syntax checks, JSON parse, changed-document formatting and git diff whitespace checks. No new application test/CI or provider-readiness claim is made; tested application bytes and existing source-CI evidence are preserved. Product production readiness remains NO_GO.
