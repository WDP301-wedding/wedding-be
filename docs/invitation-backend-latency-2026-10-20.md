# Invitation backend latency changes — 20 October 2026

Scope: the owner requested backend items 2 and 3 from the
[latency audit](invitation-print-latency-audit-2026-10-20.md), with Gemini **45 seconds**
and backend HTTP **60 seconds**. Frontend changes are owned by another developer.
This document is a hand-off for WEB-BE-06/09; the canonical website task status stays
in wedding-web/tasks/todo.md. Audit evidence is retained separately.

## Behavior

The Couple print list batches lines, accepted commercial revisions and latest
unexpired replacement proposals through the same mapper used by the Manager list.
It preserves timestamp/UUID pagination, contracted source references, frozen prices
and totals. The response rechecks current Couple/session/booking access, including
empty pages. No print charge, agreement or invoice behavior changes.

AI generation and derived-image processing use three stages:

1. A short booking transaction checks current authority, binds the idempotency
   payload, persists a generation intent and claims a durable expiring token.
2. Gemini, complete image validation, Storage downloads/uploads and Sharp processing
   run outside the transaction. A short fenced journal transaction records the
   expected content-addressed object before upload.
3. A short acceptance transaction checks the token/expiry, current authority and
   original-file revision. AI acceptance also rereads cutoff and media quota, then
   atomically commits media history, audit, intent outcome and replay receipt.

The new `InvitationExternalWork` table stores only booking/intent digests, a random
token, expiry and reserved file/byte amounts. It contains no prompts, credentials
or images. A new generation reserves one file and at most 10 MiB; recovery reserves
the journaled image's known byte size. Ordinary media quota
checks include active reservations, preventing concurrent uploads from consuming a
reserved slot. Acceptance excludes its own reservation and replaces it with the
actual file. Claims expire after 120 seconds; token checks fence stale processes.
Cleanup only deletes the owning token, so an old process cannot delete a successor.

The paid intent commits before Gemini. Retrying a pending intent never calls
Gemini again: it recovers a verified journaled PNG if present, otherwise returns
`AI_GENERATION_PENDING`. Existing known failures and Manager abandonment stay
terminal for that intent. Acceptance rollback, request disconnect or deadline cannot
erase the intent/journal. A completed paid output may finish uploading privately
after disconnect, but acceptance stops; an authorized same-key retry can recover it.
No background worker or new job/status endpoint is introduced.

These HTTP-facing orchestration methods require an unscoped server request context.
They reject being called inside an already-open booking transaction, which would
reintroduce provider work under that transaction. Both existing runtime callers are
HTTP router handlers with unscoped contexts. The previous nested-transaction derive
test now injects failure at the actual acceptance audit boundary: it still proves
rollback leaves no derived asset and retry uses the journal's exact original asset ID.

During scoped authorization failure, the durable denial audit is deferred until
the transaction has rolled back. This avoids requesting a second connection just
to record revocation and works with a single-connection pool.

This revision moves external work in **AI generation and derived assets**. Ordinary
original-file upload and signed-preview workflows retain their existing transaction
structure; their quota checks now honor generation reservations. Printable PDF
rendering/caching is separate follow-up scope. Invitation list authority projections
are not weakened or cached; timings now identify remaining read costs.

## Configuration and rollout

- Invitation runtime passes `timeoutMs: 45000` to Gemini. SDK retries remain one
  attempt. The adapter's general validation ceiling stays 60 seconds.
- `HTTP_REQUEST_TIMEOUT_MS` defaults to **60000**, and `.env.example` and the
  standalone app fallback agree. An explicit environment value still takes precedence:
  a deployment with `HTTP_REQUEST_TIMEOUT_MS=30000` must explicitly change it to
  `60000` during rollout.
- Database transactions remain **30 seconds**, with their existing acquisition and
  pool budgets. This is not a pool increase or a 60-second database transaction.
- The 60-second HTTP budget includes authorization, Gemini, Storage and acceptance.
  Gemini completing at 45 seconds does not guarantee the whole request finishes in
  60 seconds. Existing frontend clients that stop at 10 seconds must use the longer
  AI budget; frontend work is separate.
- Apply additive migration `20261020030000_invitation_external_work` before the new
  application starts. Existing migration files and business history are unchanged.
- Drain old/new in-flight requests during rollout/rollback. Roll back to the prior
  application image if needed; retain the additive table and durable intents/journals.
  Do not drop recovery evidence, expire claims to trigger paid regeneration or
  increase pool limits to mask a regression.

No deployment, live environment-variable write, real-money operation or paid AI
call is part of the implementation checks. Live provider readiness and the RV gates
remain independent. This hand-off does not claim a deployed latency improvement.

## API and frontend hand-off

Paths, request/response schemas, authentication and payload examples are unchanged.
OpenAPI generation/check must preserve the pinned artifact/digest. The existing
errors cover the behavior:

| Status/code                                                                | Meaning and client action                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 201 generation/derive                                                      | Accepted private asset; proceed to the next existing step                                                  |
| 409 `REQUEST_IN_PROGRESS`                                                  | Same intent has an active claim or a stale worker lost ownership; retain key/body and honor Retry-After    |
| 422 `IDEMPOTENCY_KEY_REUSED`                                               | Same key with changed payload; do not reinterpret it as a transport retry                                  |
| 503 `AI_GENERATION_PENDING`                                                | Paid effect/output is unresolved; retain the key for recovery or Manager reconciliation; do not regenerate |
| 503 `SERVICE_UNAVAILABLE`                                                  | Classified database acquisition/transaction failure; log phase identifies the category                     |
| 504 `PROVIDER_TIMEOUT`                                                     | Gemini/Storage timeout; retain key/body and do not automatically buy another generation                    |
| 408 `REQUEST_TIMEOUT`                                                      | HTTP request budget/disconnect fence; outcome may require same-key recovery                                |
| 401/403/404                                                                | Current authorization/ownership no longer permits acceptance                                               |
| 409 `MEDIA_CUTOFF_REACHED`, `MEDIA_QUOTA_EXCEEDED`, `MEDIA_REVISION_STALE` | Current cutoff/quota/source revision changed; refresh current state before a new intent                    |

For a timeout after generation succeeds, retry the failed derive/preview step with
its own stable key. Keep the already returned generation result. Do not submit a
new generation key merely because a later step or preview failed.

## Diagnostics

Structured `invitation_studio_phase` logs carry request ID, operation, phase,
duration, success/error and an allowlisted error classification. Operations include
AI, derive, invitation lists and Couple print lists. Phases distinguish authority,
page/revisions, claim, provider, decode, journal, upload, acceptance and release.
No prompts, bytes, raw SQL, provider exceptions, token or actor/booking identity are
logged by this helper. Existing route HTTP metrics remain the overall latency/error
source.

With existing `DB_DIAGNOSTICS_ENABLED=true` on the relevant runtime pool, each phase
also carries deltas for SQL commands, acquisitions, acquire time, query round-trip
time, lock round-trip time and error count. This uses existing opt-in diagnostics;
it does not enable an extra pool, log SQL text or change connection budgets.

On-call questions: did a request fail before provider dispatch; was time spent in
database admission/SQL or Gemini/Storage; and did paid output exist before failed
acceptance? Query by request ID, compare phase timings and inspect authorized
pending-intent/journal evidence without submitting another generation.

## Verification record

The new Couple list tests failed on the previous code (unbatched revisions and
missing final authorization recheck), then passed with the shared batch mapper.
The single-connection generation test failed before the change with
`timeout exceeded when trying to connect`, before provider dispatch.

Native PostgreSQL tests use fresh random-name disposable databases on local test
clusters and controlled AI/Storage only. They cover one connection,
concurrent same-key/changed-body requests, quota reservations shared with ordinary
uploads, cutoff/revocation/source changes during external work, token takeover and
expiry, disconnect recovery, rollback, immutable history and no second paid call.
The existing generation/print/provider suites remain acceptance gates. Final check
counts and any limitations are recorded in the
[implementation evidence](../tasks/evidence/invitation-backend-latency-2026-10-20.json).

Typecheck, lint, build, formatting, unchanged OpenAPI and the dependency audit passed
in the isolated worktree. The latter found no high/critical advisories. The review
mutation inverted the ownership predicate, correctly failed the single-connection
regression, and restored the original file with its exact SHA-256 digest. Earlier
environment failures and the final full-suite/coverage result remain separate in
the receipt; no deadline, coverage threshold or existing assertion was weakened.

The final complete run passed **2,100 tests in 291 files**, with no skipped tests
or failed suites. Coverage passed the existing **80% lines/branches per-file**
thresholds: total lines **97.55%**, branches **93.47%**. The command exited **0**;
these are local controlled-provider results, not deployed measurements or live
provider evidence.

The full suite also uses the base `DATABASE_URL` for database/idempotency tests.
Run `npm run db:migrate:deploy` against that disposable target before
`npm run test:coverage -- --maxWorkers=2`; fixture helpers migrating their own
random-name targets do not initialize the base database.
