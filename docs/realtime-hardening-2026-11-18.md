# Realtime reliability revision â€” 2026-11-18

Scope: wedding-be transport, authorization concurrency and outbox observability.
No changes to business commands, financial calculations, payment idempotency,
commercial approvals, schema/migrations or frontend source. Not deployed by this task.

## Implemented

- All three Redis connections retain automatic reconnect with capped delay and jitter;
  commands still have bounded timeouts and offline queuing stays disabled. Explicit
  shutdown stops reconnect; health now includes Pub/Sub connection readiness.
- Pub/Sub recovery emits one local `realtime:resync` after both adapter connections
  become ready. Both current web clients already handle this event by refetching
  authenticated APIs. It carries no business payload and grants no permission.
- Fanout dispatch fails while either Redis adapter connection is unavailable,
  retaining the existing PostgreSQL delivery retry path. A disconnection during
  an emit can still lose a packet: recovery/refetch is required.
- Subscription slots are reserved before asynchronous authority checks. Duplicate
  pending subscriptions coalesce; unsubscribe/disconnect cancels pending work.
- Handshake uses one current credential lookup instead of two; preserves token
  format/status/expiry, connection admission and account/IP reservation checks.
- Concurrent publishes of the same event share one dispatch result. Failures do
  not enter the delivered-ID cache and remain retryable. This is process-local
  deduplication, not an end-to-end exactly-once guarantee.
- Periodic reservation renewal uses bounded groups of 20 concurrent operations
  instead of serializing every Redis round trip. Fresh audience authorization
  remains mandatory; there is no positive authorization cache.
- Staff operations invalidations now include staff event/work-item resources;
  historical guest/check-in records are preserved.
- The protected metrics registry includes `wedding_realtime_delivery_total`
  (stream/outcome), `wedding_realtime_dispatch_lag_seconds` and
  `wedding_realtime_fanout_recoveries_total`. No account, booking, token or socket
  identifiers become metric labels. Dispatch/processing metrics are not client ACKs.

## Verification

- 21 focused tests passed across five files, including real localhost WebSocket
  handshakes, pending-auth admission, simultaneous subscriptions, cancellation
  during authorization, expired/revoked sessions, two-tab authorization/grant
  revocation, concurrent-publish failure/retry, queue finish ordering, recovery
  listener cleanup, Redis retry policy/readiness/shutdown and metric output.
- Redis, database repositories and queue persistence in these focused tests use
  controlled doubles. This does not prove real Redis outage recovery, PostgreSQL
  lease contention or cross-instance delivery on Render.
- Prisma Client regenerated locally from the existing schema; no migration run.
- Focused ESLint on all 12 changed TypeScript files: exit 0, no warnings.
- Final `npm run typecheck`: exit 2. After regenerating Prisma Client, remaining
  diagnostics concern the pre-existing missing `mongodb` dependency and cascading
  unknown-error types in storage/Mongo integration files. No remaining diagnostic
  names a realtime file. `mongodb` is already declared at version 7.8.0; no package,
  lockfile or storage-source workaround was introduced to suppress this problem.
- Focused tests command: `npx vitest run src/core/redis/redis-client.test.ts
src/core/realtime/realtime-reliability.test.ts
src/core/realtime/realtime-relay-reliability.test.ts
tests/integration/realtime-auth-admission.test.ts
tests/integration/realtime-redis-integration.test.ts --maxWorkers=1` — exit 0,
  5 files / 21 tests passed on the final code. Initial sandbox spawn failure was
  resolved by executing the same local checks with approved process permissions.
- Format check on changed files and `git diff --check`: both exit 0.

## Operational acceptance still required

After an authorized deployment, verify with Manager/Couple sessions on staging:
normal mutations update both clients; disconnect/reconnect refetches; a Redis
outage and recovery across two service instances converges; revoked grants and
sessions stop receiving protected events. Observe dispatch lag/retries and inspect
API responses, rather than treating health status as feature acceptance.

Existing outbox leases/backoff remain intact. This revision does not introduce
automatic retention deletion, dead-letter eviction or a replay/ACK protocol.
Those require explicit retention/recovery semantics; silently dropping financial
invalidations after a retry limit would be unsafe. No production Redis outage,
payment, paid provider request, shared-data write, push or deployment was performed.
