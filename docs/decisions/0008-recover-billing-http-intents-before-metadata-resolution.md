# ADR-008: Recover billing HTTP intents before metadata resolution

## Status

Technical implementation of SPEC-04 Section 9 and the PB-W6 plan, 2026-10-09.
The active contract baseline, public request fields, monetary policies and eighteen
existing migrations are unchanged. PB-C3 proof and the immutable API hand-off are
recorded in the Billing evidence. Client integration and owner acceptance remain W7/W8.

## Context

An HTTP request can fail after an owner transaction committed its payment or refund.
Recalculating the manual deposit timeline, balance revision, refund approval or
processing clock during retry would falsely change the original intent. An unresolved
HTTP claim also needs a safe recovery path after its original process exits.

## Decision

- Publish the seven approved deposit, balance, manual payment, refund, attempt,
  billing and authoritative GET IPN routes under `/api/v1`. Use strict shared Zod
  request and response schemas and generate the committed OpenAPI artifact from them.
  Reuse the VNPay parser's field schemas for documented provider query parameters.
  Do not parse the callback through Express's query object: preserve the original
  query so signature verification can reject duplicate and unknown keys.
- Resolve identity from the real session repository. Check the current active
  database account, Manager role and owned consultation grant before every private
  read, command and cached response. Eligible own RESTRICTED access can initiate
  deposit and read deposit status; billing and balance require FULL or Manager.
  Foreign resources are concealed 404. Audit denials with request/actor IDs, operation
  and stable error code, without submitted receipt or provider material.
  Staff-only accounts cannot use billing, even with an erroneously assigned grant.
  A legitimate owned Couple role may coexist with Staff; current database roles
  determine authority, rather than actor claims cached by a caller.
- Use core durable idempotency records and canonical submitted public intent,
  including actor, method, normalized route, booking and validated body. Retain
  billing intent records through the supported year-9999 horizon; business owner
  commands, attempts and facts remain immutable for the record lifetime.
- Hold a PostgreSQL transaction advisory request mutex in a separate two-integer
  namespace. A concurrent same-key call receives core's canonical
  `409 REQUEST_IN_PROGRESS` and `Retry-After: 1` without executing money. This follows
  SPEC-core-platform Section 10.4's inherited error contract; SPEC-04's earlier
  `IDEMPOTENCY_REQUEST_IN_PROGRESS` wording names the same condition.
- Persist the core claim before invoking an owner. Owner transactions commit money,
  Booking/Identity effects and audit/outbox atomically in their existing booking
  boundary. The request-mutex transaction holds no owner write or booking lock.
  A process/connection failure releases that mutex; it does not erase the durable
  claim. Retries can recover an IN_PROGRESS claim only after acquiring the mutex.
- Derive a stable UUID command from the actor/route/key independently of request
  body and processing time. Changed body or booking under that key is core 422.
  Exact completed responses replay unchanged. Persist 4xx business errors; keep
  5xx failures unresolved and recoverable with the original intent identity.
- For a committed manual payment/refund, load its immutable owner command result
  before resolving new metadata. Validate its booking, actor and operation kind.
  Otherwise resolve the deposit timeline and balance revision from stored state.
  Refund resolves its booking from the source PAYMENT and chooses the oldest
  recorded approval with sufficient remaining budget. The owner transaction still
  checks approval ownership, decision and source limits and expected revision.
  Request input cannot provide decision, approved limit, role or processing clock.
- Fail disabled VNPay before creating a core claim or payment attempt. An unavailable
  callback returns provider acknowledgment 99. Attempt reads authorize before invoking
  the internal SYSTEM reconciliation port and again before returning its whitelist.
  Unproven provider responses retain UNKNOWN; successful settlement and downstream
  application status remain distinct. ReturnURL is not settlement evidence.
- Wire the runtime into server startup and shutdown. Verify a real database query
  after Prisma's lazy adapter connection. A billing startup failure closes already
  initialized owner runtimes; normal shutdown closes the billing client.

## Consequences and proof

The request mutex consumes one database connection while owner work uses another.
It has a bounded 30-second transaction timeout and does not wait for competing keys.
Hash collisions can conservatively report in-progress; the durable namespace/key
and payload hash remain the authoritative identities.

PostgreSQL HTTP tests prove real promotion, manual balance and refund rules, safe
pagination, current database authority, revoked real Identity sessions, all IPN
acknowledgment classes, unknown outcomes, disabled configuration, in-progress commands
and changed-body keys. Injected failures after committed deposit/refund prove retries
return the original IDs despite changed booking/ledger/approval state. New tables,
dependencies and schema migrations are not needed for this HTTP publication.

Authority: [SPEC-04](../../SPEC-payments-billing.md),
[core specification](../../SPEC-core-platform.md),
[contract baseline](../../CONTRACT-BASELINE.md),
[ADR-007](0007-manual-billing-approval-and-ledger-views.md), and
[Billing evidence](../../tasks/evidence/payments-billing.md).
