# PERF-08 notification read verification

Date: 2026-10-18 (Asia/Saigon). Backend-only scope: GET notification inbox and
unread count. The owner authorizes a temporary SSH key and one read-only connection
for at most 45 minutes on the existing Manager and Couple demo accounts, plus full
local populated-inbox and revocation checks. Both live inboxes are empty. No live
notification fixture, provider send, mark-read, requeue or financial command is used.

## Problem and resulting behavior

The deployed implementation still needs six driver commands for inbox and five
for unread. An initial same-container 20-pair comparison confirms that its original
optimization misses the 30% target: inbox improves only 24.670–25.092%, unread
28.275–28.630%. Keep this attempt and every sample; local modeled gains alone do
not close that live gate.

The new implementation captures the Booking-owned audience and Notification-owned
page/count in one parameterized statement. Booking exposes its existing audience
predicate as an internal read-only SQL fragment, also reused by its existing ID
reader. Notifications compose that predicate with their own tables; Identity
resolution stays in its owner. Both endpoints then perform fresh Identity and
Booking audience checks after the captured data read, including empty results.

Manager/Couple HTTP reads now use **four commands**, including valid-cursor pages:
initial Identity, captured audience/data, final Identity and final Booking audience.
Roleless consultation accounts retain their additional eligibility gate. Commands
keep their transaction locks, idempotency and revalidation. No permission is cached
between requests and no public API, migration, dependency, pool or provider setting
changes. The CTE is one statement snapshot, not a persistent authorization cache.

Inbox snapshots join only the intent purpose, owner and template data required by
the existing strict DTO. They retain descending createdAt/id order, limit+1 lookahead,
visible-cursor validation, global/account isolation, read flags, UTC timestamps and
existing template rendering. Missing/foreign cursors return 404. Missing, malformed,
expired or revoked identity returns 401; unauthorized roles return 403; a changed
audience or Manager scope during a read returns 404. Limit validation still returns 422. Empty successful responses remain:

```json
{ "data": { "items": [], "nextCursor": null } }
```

```json
{ "data": { "count": 0 } }
```

The query ceilings tighten inbox 6 → 4 and unread 5 → 4 for empty/populated native
cases. Existing modeled investigation bands and all other quality thresholds stay
unchanged. Source identifiers come from the constructed client's quoted schema;
account, Manager flag, cursor and limit remain bound values.

## Controlled native comparison

The sole active deployment remains `f100e2bd-1ad5-497b-989b-28f2f2e2f705`, source
`873aa4c56eca6ef80563768554d726e5bae9eb46`, image
`sha256:cb99729e156b0d563c2463a92589cc65597bdb6f449092a353b67fa442dc0388`.
The candidate is executed in memory inside that same SFO container through the real
Express notification router. It is not yet the public deployed implementation.

The original baseline pins settings, Booking reader and router to
`3c6e8984c547d92f25dc4959c44503321e5f5528`, the original PERF-06–10 source. Shared
Identity/foundation modules use the current implementation in every variant.
Candidate sources and compiled modules have separate SHA-256 records; imports of
the new reader resolve to its in-memory module, not an absent deployed file.

Twenty alternating matched triplets per case, plus one retained initial triplet,
use the same two sessions, records, container and maximum-one connection pool.
Requests are sequential with 750 ms spacing. P95 is nearest rank; no retry, discarded
sample, live fixture write, permission cache or general diagnostic flag is used.
All **240 steady and 12 initial responses** return 200, retain no-store/no-referrer,
match complete response hashes and record zero driver errors. The separate pilot
and initial below-target 20-pair experiment are also retained.

| Empty live case | Original p95 ms | Deployed p95 ms | Candidate p95 ms | Original → candidate | Deployed → candidate | Commands  |
| --------------- | --------------: | --------------: | ---------------: | -------------------: | -------------------: | --------- |
| Manager inbox   |       1,208.285 |         902.715 |          608.894 |              49.607% |              32.549% | 8 → 6 → 4 |
| Manager unread  |       1,053.480 |         752.044 |          604.320 |              42.636% |              19.643% | 7 → 5 → 4 |
| Couple inbox    |       1,207.012 |         903.113 |          605.402 |              49.843% |              32.965% | 8 → 6 → 4 |
| Couple unread   |       1,062.628 |         755.152 |          604.227 |              43.138% |              19.986% | 7 → 5 → 4 |

The original task target passes for both endpoints in the explicitly selected empty
live scope. Incremental unread gain over the already optimized deployment is about
20%, below 30%; do not relabel that increment as a 30% gain. These are same-container
loopback timings and exclude public ingress, workload capacity and provider delivery.

## Local correctness and modeled timings

A dedicated loopback PostgreSQL 18.6 cluster applies all 61 migrations to disposable
databases. The 71-test notification/measurement suite passes across 15 files; the
twenty read cases are rechecked after strict-response and cursor-budget assertions.
Coverage includes empty/1/20 pages for Couple and Manager, tied timestamps, cursor
continuity, hidden/missing cursors, global and foreign-booking isolation, read flags,
unchanged inbox/intent records and complete template fields.

Both endpoints reject session/access removal during empty and populated reads,
Manager reassignment/downgrade, account disablement and exact credential expiry.
Roleless consultation eligibility is preserved, and its removal is rejected.
Repeated reads after removal/regrant prove there is no cross-request audience cache.
A schema containing a quote exercises both the Booking and Notification predicates,
with different public/scoped data to catch accidental fallback. Removing both final
checks deliberately makes **14 revocation tests fail**; source is restored byte-for-byte.
Existing settings/device, delivery/retry, worker, event and idempotency tests pass.

Twenty modeled samples per variant use one connection and 40 ms per real driver
submission, with excluded initial reads and alternating execution. These are local
service measurements, not provider RTT or public latency:

| Local case       | Original p95 ms | Candidate p95 ms | Reduction | Commands |
| ---------------- | --------------: | ---------------: | --------: | -------- |
| Empty inbox      |         376.725 |          190.076 |   49.545% | 8 → 4    |
| Empty unread     |         330.449 |          189.340 |   42.702% | 7 → 4    |
| Populated inbox  |         376.619 |          188.715 |   49.892% | 8 → 4    |
| Populated unread |         331.214 |          188.087 |   43.213% | 7 → 4    |

## Public baseline, preservation and cleanup

The separate current-public baseline retains **84/84 successful reads**, one initial
and twenty steady reads per role/endpoint. Login/logout and revoked reuse on Identity,
inbox and unread also pass. All **128 recorded discovery/session/public operations**
match exactly one completion log in the pinned deployment. This is a before baseline;
candidate public behavior and public before/after gains await reviewed rollout.

Steady public backend/client p95 is 1,553.553/1,782.568 ms for Manager inbox,
1,702.095/1,930.471 for Manager unread, 2,138.155/2,376.690 for Couple inbox, and
1,688.070/1,932.120 for Couple unread. Their backend medians are approximately 896 ms
and 747 ms respectively. Preserve these tails; do not discard them or attribute them
to an unestablished network, provider or pool cause. PERF-13 remains open.

All **32 selected business/authority/notification table digests** and all **61 applied
migration checksums** match before/after. The budget allocates one ordinary spare
slot, leaving one spare; existing provider/pooler utility allocation and capacity 60
stay unchanged. Operator inventory and native pools do not overlap. General
diagnostics and DB safe-read deadlines remain off. Session/audit lifecycle writes are
the operational exception. There is no live business, notification, payment, email,
push or paid-generation command and no frontend change.

Native pools/servers close. The dedicated SSH key is revoked at
`2026-10-18T07:07:55.489Z`, reuse is denied and only owned key/discovery files are
removed, before the authorized deadline `2026-10-18T07:34:34.139Z`. The local cluster
is stopped with zero test databases remaining. The
[sealed verification receipt](../tasks/evidence/perf08-verification-2026-10-18.json)
retains raw measurements, source hashes, log pairs, preservation and cleanup.

## Preserved failures and release gate

- The preliminary operator uses an invalid limit of 100 and receives 422; the valid
  maximum stays 50. Its session is revoked by cleanup. Its unsaved request IDs are
  excluded from the 128 correlated operations. An initial local startup omits the
  dedicated port; it is corrected to loopback 55441.
- New fixtures initially omit required promotion metadata, null a mandatory Manager
  reference, or violate credential expiry ordering. Fixtures are corrected using
  captured access data, a real successor Manager and a clock transition. Constraints
  and expected denials remain intact.
- The first candidate omits intent owner in its projection; populated response tests
  fail and the projection is corrected. Optional-property typing and lint issues are
  fixed without suppression or relaxed assertions.
- A quoted-schema setup hits an ORM identifier limitation; fixture setup uses quoted
  SQL with bound values, while actual read paths still test the quoted schema.
- The historical measurement pool lacks the runtime UTC setting and strict timestamp
  equality fails. The canonical benchmark now uses UTC like createPrismaClient; no
  timestamp normalization is added and the failed comparison remains preserved.

Typecheck, focused lint/format, production build and OpenAPI checks pass locally.
Exact-head CI, owner-authorized merge/deployment and after-rollout public probes are
the remaining release gate; the canonical PERF-08 checkbox stays open until then.
Rollback is the preceding reviewed source/image; no schema rollback or historical
rewrite is involved. Provider acceptance and production **NO_GO** remain unchanged.

The design follows PostgreSQL's [statement/CTE snapshot semantics](https://www.postgresql.org/docs/current/queries-with.html)
and [transaction read-only defaults](https://www.postgresql.org/docs/current/runtime-config-client.html),
while retaining the existing [Supabase connection mode](https://supabase.com/docs/guides/database/connecting-to-postgres).
