# PERF-04: reviewed application-region experiment

Prepared 2026-10-16. **Not deployed or measured.** These profiles are inputs for
temporary test services; they do not alter the active `railway.json` or the
production service. Current source placement remains US West.

## Concrete rollout awaiting authorization

Create two temporary services in an owner-selected test environment, using the
same immutable image/build digest, one replica, identical CPU/memory, connection
settings and unchanged database. Use
[US West profile](../ops/performance/railway-us-west.json) and
[Singapore profile](../ops/performance/railway-singapore.json). Do not run both
measurement clients concurrently. Limit the experiment to 60 minutes, then stop
both temporary services. Hosting/build/network usage may incur Railway charges;
no AI generation, email delivery or payment operation is included.

The profiles intentionally have no pre-deploy migration command. Verify the
effective service configuration, including dashboard overrides, before starting.
Use the same baseline source for both regions; compare the Identity optimization
separately at one fixed topology. Do not interpret a code-and-region combined
change as a region-only gain.

## Preconditions

1. Owner selects the test environment, approves the temporary service runtime and
   confirms that the selected data is synthetic. No shared fixture creation or
   production-region switch follows from this document.
2. Confirm the Supabase project region using Management API/dashboard metadata.
   `ap-southeast-2` in the saved matching pooler is an inference, not provider
   confirmation. Save region, project reference and timestamp, without credentials.
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

Sources checked 2026-10-16:
[Railway region identifiers](https://docs.railway.com/deployments/regions),
[per-service region configuration](https://docs.railway.com/config-as-code/reference),
[upstream versus edge header](https://docs.railway.com/networking/edge-networking).
The legacy config-as-code format remains the repository's current format; a future
Railway IaC migration is separate from this experiment.
