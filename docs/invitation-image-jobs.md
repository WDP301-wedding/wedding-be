# Durable invitation image jobs

Owner authorized backend option B on 20 October 2026 after reviewing the async
proposal. This is additive Invitation Studio work; legacy synchronous generation,
Manager recovery, commercial history and frontend source remain unchanged.

## Contract and acceptance

- POST `/bookings/{bookingId}/invitation-image-jobs` accepts the existing bounded
  `{prompt, aspectRatio}` and Idempotency-Key. Owning FULL Couple only. Persist the
  job before returning 202, without invoking Gemini in the request.
- GET the collection (bounded cursor pagination, includes completed jobs) and
  GET `/{jobId}` require current owning FULL Couple or Manager authority. Responses
  never contain prompts, session IDs, keys, object keys or provider errors.
- States: QUEUED, RUNNING, RECOVERY_REQUIRED, SUCCEEDED, FAILED. Success means both
  private generation and derived asset are committed. Return mediaAssetId,
  derivedAssetId and an authenticated previewPath; no persisted signed URLs.
- A database claim token and expiry coordinate workers. One local worker performs
  one job at a time; a global database lease serializes background provider work.
  Queued/recovering jobs are bounded per booking. Same-key replay returns the current
  job; a changed body fails. Existing global HTTP throttling stays active.
- No credentials are persisted. The worker rechecks the initiating account, role,
  session and current FULL confirmed Booking authority using an Identity-owned
  reader. Access-token expiry alone does not cancel the accepted job; session
  revocation/expiry, account disablement and access loss do prevent acceptance.
- Reuse durable generation intents, upload journals, quota reservations, cutoff
  checks and receipts. A crash or provider timeout never authorizes another paid
  generation for the same job. Expired RUNNING claims resume only through the
  existing intent recovery path. RECOVERY_REQUIRED jobs do not loop automatically;
  an owning Couple/Manager can request a recovery attempt with the same job ID.
- Manager abandonment remains evidence-backed through the existing reconcile API;
  job reconciliation also covers derive failures and crashes before AI dispatch.
  Do not reinterpret abandonment as provider cancellation or refund.
- Prompts are private operational input, capped at 2000 characters, omitted from
  logs/responses, cleared at terminal completion or after 24 hours. Expired jobs
  retain intent/journal/result evidence but cannot dispatch paid work. Recovery
  after operational-input expiry requires Manager investigation.
- Paid dispatch requires `AI_IMAGE_JOBS_ENABLED=true` and configured AI/Storage.
  The timer runs every 3 seconds when enabled; disabled mode only clears expired
  operational input once per minute. Worker runs outside HTTP deadlines, drains
  before disconnect, and logs only allowlisted IDs/status/error classification.

## Delivery slices

1. Durable enqueue/read and privacy migration, current authorization and replay tests.
2. Worker generation/derive, fenced restart/recovery and session/access-loss tests.
3. Additive HTTP/OpenAPI, runtime lifecycle, operations hand-off and complete gates.

Validation uses a task-owned disposable PostgreSQL database and controlled AI and
Storage. No paid generation, shared database migration or deployment is authorized
by this implementation request. Provider latency and live readiness remain separate.

## Frontend hand-off

All paths below are relative to `/api/v1/bookings/{bookingId}`. They are additive;
the existing synchronous `POST invitation-image-generations` still returns 201.

| Method and path                                      | Authority                      | Result                                                     |
| ---------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| POST `/invitation-image-jobs`                        | Owning FULL Couple             | 202 current job, Location, Retry-After when queued/running |
| GET `/invitation-image-jobs?limit=20&cursor={jobId}` | Current FULL Couple or Manager | All states, newest createdAt then UUID first; nextCursor   |
| GET `/invitation-image-jobs/{jobId}`                 | Current FULL Couple or Manager | 200 current job; Retry-After while queued/running          |
| POST `/invitation-image-jobs/{jobId}/recovery`       | Current FULL Couple or Manager | 202 after explicit same-intent recovery request            |
| POST `/invitation-image-jobs/{jobId}/reconciliation` | Manager                        | 200 after evidence-backed abandonment                      |

POST requires a stable Idempotency-Key. Enqueue body example:

```json
{ "prompt": "A watercolor wedding garden with white flowers", "aspectRatio": "1:1" }
```

Enqueue and status responses use the same strict `{data: job}` envelope. A queued
job contains jobId (UUID), intentDigest (64 hex characters, for Manager recovery),
status `QUEUED`, createdAt/updatedAt (UTC), statusPath (authenticated API-relative
URL), retryAfterSeconds `3`, result `null` and errorCode `null`.

`RUNNING` has the same fields. `SUCCEEDED` sets retryAfterSeconds to null and result
to `{mediaAssetId, derivedAssetId, previewPath}`. The derived asset is ready for the
existing design save flow; it is not automatically attached or published. Fetch
previewPath with current authorization to obtain the existing private media view.
Do not persist its temporary signed URL. Failed/recovery states return null result,
null retryAfterSeconds and an allowlisted errorCode. No prompt or session identifier
is returned. HTTP responses are no-store and use existing authentication/error shapes.

Poll only QUEUED/RUNNING, honor Retry-After and back off on network/429/503 errors.
Reload queries the list including SUCCEEDED results; it does not create a new job.
RECOVERY_REQUIRED stops polling and exposes a deliberate recovery action. POST
recovery sends `{}` and a stable key for that recovery action; it can re-read an
existing uploaded image or retry derive but cannot repeat a paid generation intent.
If the provider output is unavailable, the job remains RECOVERY_REQUIRED.

Manager reconciliation sends
`{"outcome":"ABANDONED","evidenceReference":"operator-case-reference"}` with a
stable key. It is allowed only for RECOVERY_REQUIRED, releases the unresolved-job
limit, clears operational input and retains paid media, journals, intent evidence
and the audit reference. It does not cancel a provider request or imply a refund.
The original generation reconciliation endpoint remains Manager-only; abandoning
a matching unresolved generation also terminates its unresolved job.

## Errors and operating limits

- 400 missing key; 422 invalid/extra fields, invalid cursor/UUID, prohibited prompt
  identifiers or same key with changed body. Prompts reuse existing safe bounded
  validation; no photos or arbitrary URLs are accepted.
- 401/403/404: current account/session, owning FULL confirmed Booking or role denies
  access. A job ID or intentDigest is never authority.
- 429 RATE_LIMIT_EXCEEDED: 2 unresolved jobs or 10 newly accepted jobs per rolling
  24 hours for the booking. Retries/replays do not consume another slot. Honor
  Retry-After; limits are admission controls, not a promised price/spend cap.
- 409 MEDIA_CUTOFF_REACHED at enqueue or current media conflict at acceptance.
  AI_JOB_RECOVERY_UNAVAILABLE when recovery is not eligible or input has expired;
  AI_JOB_RECONCILIATION_STALE for reconciliation of another state.
- 503 AI_IMAGE_PROVIDER_DISABLED when queued dispatch is not enabled/configured.
  Read access to prior results and Manager reconciliation remain available.
- A job can finish FAILED for known validation/safety/authority failures, or
  RECOVERY_REQUIRED for timeout/unavailability/unknown errors. AI_JOB_INTERRUPTED
  never includes raw provider/DB exception text. Retry transport errors with the
  original key; do not silently replace it to purchase another generation.

One local tick and one database admission lane allow only one unexpired background
job globally across Studio instances. The 180-second claim exceeds the cooperative
110-second worker deadline and the existing 120-second external-work claim. Existing
45-second Gemini transport budget and single SDK attempt are retained; async mode
does not promise success for a provider call taking longer than that budget. No
connection or booking lock remains open during Gemini, Storage or Sharp processing.
Legacy synchronous calls are outside the background concurrency/daily limit.

## Migration and rollout

Apply additive migration `20261020130000_invitation_image_jobs`, regenerate Prisma
and deploy the matching application before enabling AI_IMAGE_JOBS_ENABLED. The new
table has RLS enabled and all PUBLIC/anon/authenticated privileges revoked; the
server uses its existing owner connection. No applied migrations are changed.
Existing synchronous intents are not backfilled into the queue or dispatched by
the worker. Their original Manager recovery path remains available.

The flag defaults false. Enabling paid dispatch on an actual provider requires an
authorized environment and bounded provider verification separately from these
controlled tests. Disabling the flag stops new dispatch; an already running job
drains normally. Retain the table and generation journals on rollback. Running
claims from a terminated process become eligible after expiry, using the same
durable generation intent; this is not permission to purchase another image.

Operational prompts are cleared at terminal completion, or by bounded expiry
sweeps after 24 hours (up to 20 rows per tick). Unknown outcomes retain their status
and evidence when the input expires; Manager investigation/reconciliation remains
available. The table's digests, timestamps and results are recovery/history facts.

Database design follows PostgreSQL's
[transaction-level advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS)
and Prisma 7's guidance to keep
[interactive transactions short](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions).
