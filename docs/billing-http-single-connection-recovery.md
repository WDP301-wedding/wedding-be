# Billing HTTP execution recovery with one database connection

Date: 2026-10-19 (Asia/Saigon). Backend-only correction for checkout creation.

## Incident

Railway received four deposit requests for the reported booking at 02:26–02:28
on 2026-10-19. All returned HTTP 500 after 11.2–12.9 seconds. For example,
request `7eeccef7-8455-423b-9f9a-4223c2ec6666` returned `INTERNAL_ERROR`
after 12,318 ms. The configured Payments pool had one connection and a 10,000 ms
acquisition timeout. The HTTP idempotency transaction held that connection while
the idempotency repository and owner commands requested another from the same pool.
The web client's 10-second timeout displayed the retry state before the API error.

Read-only inspection of the reported booking found an approved commercial contract
with two approvals and a 13,208,400 VND deposit, but no payment attempt, checkout,
deposit intent or ledger entry. Its unpinned slot hold expired at 02:25:07,
before those requests. Fixing connection starvation does not renew that hold:
the Manager must acquire a valid reservation through the normal booking API.

## Execution policy

Billing keeps its existing lifetime `IdempotencyRecord`, canonical request hash,
actor/route namespace and deterministic command ID. It uses the existing `lockedAt`
column as an execution lease; no schema migration or new connection pool is needed.
This interpretation applies only to billing HTTP namespaces.

- Epoch means no execution owner. A short atomic UPDATE acquires an unowned lease
  or takes over one older than five minutes, using database time. It releases the
  connection before running the command. The millisecond timestamp identifies the
  owner and matches Prisma's Date precision.
- Concurrent callers receive `409 REQUEST_IN_PROGRESS` with `Retry-After: 1`.
  An interrupted request releases its own lease for immediate recovery. After a
  process crash or failed cleanup, the same request can recover after five minutes.
- Success and business-error persistence compare the lease timestamp and
  `IN_PROGRESS` status. A stale worker cannot overwrite a newer response or release
  its lease. Exact cached results and changed-payload rejection remain permanent.
- The lease flows through an internal async execution scope. Each monetary owner
  transaction checks and locks the idempotency row using its existing connection,
  after acquiring the booking lock. Takeover waits for active owner work to commit;
  a stale worker resuming outside a transaction cannot start another money write.
  This also protects the gap between deposit creation and checkout preparation.
- Owner command identity, serialization, once-only ledger facts, immutable checkout
  parameters and verified settlement evidence remain authoritative. Lease expiry
  never proves payment failure, releases a deposit pin or confirms a booking.

The five-minute lease is execution recovery policy, independent of the 15-minute
slot reservation and provider checkout validity. All other callers of the shared
idempotency repository retain their existing semantics.

## Verification and rollout boundary

The regression test failed on the original implementation with
`timeout exceeded when trying to connect` using a real PostgreSQL pool of one.
Focused native tests then passed checkout creation/replay with one attempt and
one checkout, concurrent denial, response interruption recovery, durable business
errors, stale worker fencing, and takeover blocked by an active transaction.
Expired slot checkout returns `409 DEPOSIT_NOT_ELIGIBLE` without creating an attempt.
These tests use disposable local databases, controlled VNPay signing settings and
no external provider requests or payment settlement.

Full validation results are recorded with the fix's pull request. Existing
OpenAPI routes, DTOs, role checks and money formulas are unchanged. Rollout requires
the reviewed patch and passing exact-head CI; live checkout/provider confirmation
must be recorded separately. No Railway configuration change, production-money
test or direct modification of the reported booking is part of this patch.
