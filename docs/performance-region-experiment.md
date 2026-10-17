# PERF-04: reviewed application-region experiment

Latest acceptance: the [fresh matched comparison](backend-performance-04-rerun-2026-10-17.md)
completed six cohorts / three pairs with 2,016 successful business reads. The
owner explicitly accepted a different final Singapore image digest after all
27,115 application files and listed runtime fingerprints matched, and extended
the total ceiling to 150 minutes. This is an artifact-equivalence exception to
the same-image procedure below; the first five cohorts retain the original
comparison digest. DB, source, configuration, placement, samples, fail-stop and
cleanup gates remain intact. Keep the original US West service. The
[rerun receipt](../tasks/evidence/perf04-region-rerun-2026-10-17.json) records the
approval, limits and completed cleanup. PERF-13 and production NO_GO stay open.

Historical first execution: executed 2026-10-17 in the owner-authorized synthetic demo. **Aborted at the
required fail-stop gate after a Singapore Seating 500.** The full three-pair
acceptance was not achieved. [Results, limits and completed cleanup](backend-performance-04-region-2026-10-17.md)
and the [sealed receipt](../tasks/evidence/perf04-region-comparison-2026-10-17.json)
retain the negative result. The original production service remains in US West.

## Read-only preflight — 2026-10-17

The connected Supabase Management API confirmed project
`zjibuegbbwzvdqrnujjf` in **`ap-southeast-2` (Sydney)**, with database
`17.6.1.166`, status `ACTIVE_HEALTHY`. This closes the provider-region metadata
precondition; it is not a measured application-region comparison. The
[sanitized preflight receipt](../tasks/evidence/perf04-region-preflight-2026-10-17.json)
records the exact active deployment/image and remaining acceptance work.

Railway currently has `production` and `spec11-staging` environments. The retained
PERF-03 target is `production` / `wedding-be`, deployment
`e12f82d4-c247-41ac-9b46-7417c260254a`, one SFO replica, source
`f2012acfba830adc2704f60b5b561eabe867eda1`, image
`sha256:a029e36681f1b24950eabe022bd2a0cdc9c6b8d866658fd8a5faf516d6518460`.
At that preflight, no changes were staged, its worker was enabled and
diagnostics/deadline/startup probe were false. Environment selection and runtime
authorization were pending. The later owner-approved execution and cleanup are
recorded separately above; the preflight receipt remains historical.

The current pool allocation is six common pools of one, Catalog three, Analytics
two and one readiness connection: **12 connections per application**. With a
60-connection budget and reserve 36, the original app plus one temporary app fits
exactly (`12 * 2 + 36 = 60`); the original plus two temporary apps does not
(`12 * 3 + 36 = 72`). Keep at most one temporary app running, and verify the
other deployment has stopped before starting the next region. Preserve the
original app, caps and reserve. This constrains the procedure below, including
startup/rollout overlap and any observer connections charged to the reserve.

## Authorized procedure and execution adjustment

The owner selected the existing `production` synthetic demo, preserving the
original service, and extended the runtime ceiling first to 90 and then to 120
total minutes to retain sixteen families and three pairs. Two temporary services
were created; the second stayed empty. The measured application reused one
immutable image on the first service sequentially across regions, at one replica
and identical CPU/memory, connection settings and unchanged DB. The original
planned inputs were
[US West profile](../ops/performance/railway-us-west.json) and
[Singapore profile](../ops/performance/railway-singapore.json). Do not run both
temporary applications or measurement clients concurrently. The authorized limit
was 120 minutes; the actual run stopped early at the required 5xx gate, then
archived both temporary services. Hosting/build/network usage may incur Railway charges;
no AI generation, email delivery or payment operation is included.

The profiles intentionally have no pre-deploy migration command. Railway rejected
Config-as-Code for these new services, so equivalent direct temporary settings
were used. Historical redeploy manifests differed from runtime-region metadata;
retain exact image identity and verify actual placement instead of assuming the
historical manifest is current. Verify effective configuration before starting.
Use the same baseline source for both regions; compare the Identity optimization
separately at one fixed topology. Do not interpret a code-and-region combined
change as a region-only gain.

## Preconditions

1. Owner selects the test environment, approves the temporary service runtime and
   confirms that the selected data is synthetic. No shared fixture creation or
   production-region switch follows from this document.
2. Revalidate the provider-confirmed Supabase project metadata above against the
   selected runtime DB endpoint before deployment. A saved pooler hostname alone
   remains insufficient. Save region, project reference and timestamp, without credentials.
3. Obtain the PERF-02 initialized FULL booking and assigned Staff session through
   normal owner workflows. Existing genuine settlement/access facts may be used;
   never insert a settled payment or grant FULL directly for this experiment.
   If no such fixture exists, stop here; local fixture proof does not satisfy it.
4. Ensure both test services use the same DB endpoint, TLS mode, DB version,
   schema and fixture. Keep secrets in Railway variables. Record only configuration
   fingerprints, build/deployment identity and non-sensitive setting values.
5. Disable Notifications workers, provider writes, paid generation and outbound
   email for both services. Confirm workers are stopped in runtime logs; do not
   disable the active production workers. No payment checkout/callback test is
   part of this performance run.
6. Use `DB_DIAGNOSTICS_ENABLED=true` on both temporary services. Keep existing
   metrics token protection; this flag creates no new HTTP endpoint. Review the
   aggregate pool demand across the active deployment and test service before
   starting. Stop on pool pressure, lock backlog, 429 or any 5xx.

## Measurement receipts

For each region, record exact deployment/image/commit identity before and after.
Run `scripts/performance-db-probe.mjs --container` inside that container with its
existing environment; save 20 `SELECT 1` round trips and the separately measured
connection establishment. Never replace these with desktop DB measurements.

Run `scripts/backend-performance.mjs` with the same private configuration and
fixtures, changing only the target origin/deployment receipt. Take one initial
probe plus 20 steady samples per route, repeat the complete pair three times,
and match every request ID with its application log. Record counts, errors,
p50/p95, pool acquire, driver/locking round trips and event-loop observations.
Preserve failures and incomplete runs. Compare repeated differences with run
variance before choosing a location; do not create an SLA from these samples.

Read-only provider checks: verify TLS/readiness and an existing authorized Storage
download without generating/uploading anything. Document callback origins, signed
URLs, CORS, secure cookies and VNPay egress-IP allowlist consequences. An egress IP
can change on deployment and must not be presented as production payment approval.

## Rollback and cleanup

Stop the temporary services, revoke measurement sessions through the session API,
disable diagnostics on those services and retain sanitized receipts. Confirm the
original production deployment, region, worker settings, DB/schema and callback
configuration still match the starting snapshot. Archive temporary service
configuration after recording its identity. Do not delete business fixtures,
payment evidence, retained snapshots or any database as cleanup.

Sources rechecked 2026-10-17:
[Railway region identifiers](https://docs.railway.com/deployments/regions),
[per-service region configuration](https://docs.railway.com/config-as-code/reference),
[upstream versus edge header](https://docs.railway.com/networking/edge-networking).
The legacy config-as-code format remains on the original service, which was not
migrated. New services cannot opt into it; see [Railway IaC migration rules](https://docs.railway.com/infrastructure-as-code).
