# PERF-03 controlled measurement

Prepared 2026-10-17. This is a measurement procedure, not an acceptance receipt.

## Selected target and controls

Read-only preflight observed deployment `63ed03dd-fce3-46c1-ace3-28a25a8893dd`,
source `13fa708252a9e3d11a6a76998f60709b2e58166d`, one SFO replica. Use this exact
reviewed image for the experiment. Preserve the PERF-11 owner-specific pool caps:
common 1, Catalog 3 and Analytics 2, acquire 2000 ms and idle 60000 ms.
Safe-read deadlines and the startup DB probe remain disabled.

The proposed temporary service change is only `DB_DIAGNOSTICS_ENABLED=true`,
followed by redeployment of the same image. Restore the original `false` and
redeploy that image after measurement. Keep region, workers, migration history,
provider settings, pool allocation, commands and deployment triggers unchanged.
Abort if the selected source/image or controls change unexpectedly.

## Campaign

1. Save sanitized deployment/configuration identity and business-table digests.
2. Reuse the initialized synthetic fixture and existing test credentials. Record
   initial probes separately; measure Identity, Couple overview, inbox/unread,
   templates, print orders, public catalog, Analytics and booking read families.
   Record every attempt; stop on unexpected status, transport failure or 25 seconds.
   Space request starts by at least 750 ms. Revoke measurement sessions and verify 401.
3. Match request IDs to exact-deployment completion logs. Retain bounded numeric
   driver counts, acquisition timing, lock-command round trips, pool observations
   and process event-loop maximum. No SQL text/values, payloads, tokens or PII.
4. Through a dedicated temporary SSH key, run the existing twenty-sample read-only
   DB probe inside the actual runtime container. Record its deployment and region.
   A bounded read-only observer may sample DB wait categories without query text;
   these samples are process/database observations, not exact request lock durations.
5. Measure opt-in wrapper overhead with alternating instrumented/uninstrumented
   fixed read-only queries inside that same container. Include warm-up, raw samples
   and both ordering directions. Keep microbenchmark and HTTP comparisons separate.
6. Verify anonymous/invalid-token metrics access remains denied. Compare business
   and migration digests, restore diagnostics, confirm a single healthy replica,
   unchanged OpenAPI/configuration and disabled deadlines. Revoke the dedicated SSH
   key, verify it cannot connect and remove only its owned temporary files.

Session/audit writes and normal Analytics derived publication are expected. No new
business fixture, check-in, provider generation/delivery/payment, data deletion,
artificial business locks or region change is included.

## Interpretation

`acquireMs` includes connection establishment, not just queue time.
`queryRoundTripMs` includes network/server/lock/client-queue time and concurrent
commands can overlap. `lockRoundTripMs` is a subset of that sum, not pure lock wait.
Pool maxima describe one touched pool at acquisition points, not aggregate live
connections. Event-loop maximum is process-wide since middleware creation.
Sampled absence of Lock waits cannot establish that no short lock ever occurred.
Do not subtract summed parallel durations from wall time to invent execution time.

PERF-03 closes only after actual family attribution, overhead, container RTT and
protected-metrics evidence have been recorded. A prepared script is not a pass.

## Reproduce the fixed probe

The exported worker is [performance-diagnostics-runtime-worker.mjs](../scripts/performance-diagnostics-runtime-worker.mjs).
It requires a built `dist/` and an explicitly supplied private `DATABASE_URL`.
For a disposable loopback PostgreSQL, run from the repository root:

```powershell
node --input-type=module -e "import('./scripts/performance-diagnostics-runtime-worker.mjs').then(m => m.runDiagnosticsRuntimeWorker({mode:'operator',deploymentId:null,region:null,pairs:20,sharedPool:true}))"
```

Operator mode refuses a non-loopback database and labels its output accordingly.
Runtime mode requires an exact pinned deployment ID matching Railway metadata and
region `sfo`; use `operation: 'waits'` for 180 bounded database-wait snapshots or
`operation: 'explain'` for twenty fixed SELECT execution observations. The default
operation compares two probe pools; `sharedPool: true` controls connection latency
while measuring active aggregation over an inactive installed proxy.

The current runtime image does not package this new worker. For the recorded
experiment its source was streamed to `node --input-type=module` through the
dedicated authorized SSH channel, with the export removed, a JSON configuration
and explicit awaited invocation appended. Program hashes and configuration are
retained in the receipt's native provenance. No remote file, worker scheduler or
second full application process is installed by that procedure.
