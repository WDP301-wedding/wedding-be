# SPEC-06 backend hand-off: GM-W1–GM-W4

Implementation date: 2026-10-12. Provider contract: `guest-management@1.0.0`.
API prefix: `/api/v1`; OpenAPI 3.1 artifact: `openapi/openapi.json`, with its exact
SHA-256 in `openapi/openapi.sha256`. New migration:
`20261012010000_guest_management`. Applied migrations are unchanged.

## Ownership and consumers

Guest owns stable Groups, optional named one-person Guests, import previews and
immutable explicit planning revisions. Booking owns confirmation, access,
settlement prerequisites and ordered planning synchronization; Venue owns capacity;
Invitation owns the current public publication. The runtime uses their real local
adapters with one booking transaction boundary. No named list is required to
initialize Groups or preserve an existing Booking total.

Companion-count fields remain awaiting the owner's narrow clarification. A named
Guest may bring companions. Adding, importing, archiving or restoring names does
not change planning, enable check-in, infer attendance or change financial history.
There are no Household, response or Guest check-in endpoints.

## Mounted HTTP

All schemas are strict Zod objects. Request and response schemas, examples,
security schemes and common error envelopes are generated in OpenAPI. Successful
responses use `{ "data": ... }`. UUIDs are canonicalized to lowercase; timestamps
are UTC ISO strings. Every Guest endpoint sets `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`.

| Method     | Path after `/api/v1`                                              | Authorization and behavior                                                 |
| ---------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| GET, POST  | `/bookings/{bookingId}/guest-groups`                              | Owning FULL Couple or Manager; initialize/list or create Group             |
| PATCH      | `/bookings/{bookingId}/guest-groups/{groupId}`                    | Same ownership; expected revision; rename/color/archive/restore            |
| GET, POST  | `/bookings/{bookingId}/guests`                                    | Same ownership; bounded private list or create named person                |
| PATCH      | `/bookings/{bookingId}/guests/{guestId}`                          | Same ownership; expected revision; edit/archive/restore                    |
| POST       | `/bookings/{bookingId}/guests/import-previews`                    | Same ownership; exact rows, stable keys and preview delta                  |
| POST       | `/bookings/{bookingId}/guests/imports`                            | Same ownership; commit exact preview/digest atomically                     |
| GET, PATCH | `/bookings/{bookingId}/guest-plan`                                | Same ownership; read or explicitly revise independent total                |
| POST       | `/bookings/{bookingId}/guests/{guestId}/personalized-invitations` | Same ownership; issue/reissue for an active Guest and published invitation |
| POST       | `/guest/invitation-sessions`                                      | Anonymous credential exchange; durable rate limit                          |
| GET        | `/guest/invitation`                                               | `Authorization: Bearer wgs_...`; minimal invitation view                   |

Management requires a confirmed, settled Booking; session/account/access are
rechecked inside booking serialization, including durable command replay. Staff,
restricted Couple and personalized capabilities cannot manage the workspace.
Cross-booking resources are concealed. Every write requires `Idempotency-Key`.
The same actor/action/key and payload replay the original result; changed payload
returns `422 IDEMPOTENCY_KEY_REUSED`. Revision conflicts return `409`.

Groups have a trimmed authored name (1–80), trim/NFKC/default Unicode case-fold
uniqueness, uppercase `#RRGGBB`, revision and ACTIVE/ARCHIVED status. Archived names
remain reserved; 100 active Groups maximum. Default labels: Parents, Groom Side,
Bride Side, Friends. Group archive with active members returns
`409 GUEST_GROUP_IN_USE`; assign/archive those named Guests first. Stable IDs and
append-only snapshots preserve references.

Guests have a name (1–120), active `guestGroupId`, optional E.164 `phone`, optional
`operationalNote` (0–500), revision and status. Phone/note can be cleared with null.
Duplicate names/phones remain separate IDs; maximum 10,000 active Guests. Private
list supports `limit` 1–50 (default 25), status, optional Group and opaque cursor.
Cursors bind the booking, filter and list sequence; edits require restarting a stale
cursor (`409 GUEST_LIST_CURSOR_STALE`).

## Independent total and atomic imports

First access pins the exact Booking planning total and existing ordered source,
or fails when that source is missing/inconsistent. Empty names never reset it.
Only PATCH `guest-plan` with `{ "expectedRevision": 1, "planningHeadcount": 300 }`
activates a new source revision/sequence. Venue capacity applies. Plan history,
Booking ordered synchronization, audit and Guest outbox commit in one transaction.
Unchanged total creates no new revision; stale or conflicting sources fail; native
Booking synchronization supports identical replay and ignores lower sequence.

Example: total 300 with no names, then importing 20 names, remains planning 300
and listed 20. Archiving a name changes listed count only. Actual attendance is
absent from these DTOs; explicit planning zero does not mean actual zero attendance.

Import accepts JSON rows produced by a client's CSV parser: at most 1,000 rows
and 5 MiB HTTP body. Unknown headers, duplicate row keys and formula-like name,
note or key cells fail validation. Each row requires a stable `externalRowKey`.
POST preview with `{ "rows": [...], "allowUpdates": false }`; review its
`createdCount`, `updatedCount`, `unchangedCount`, `previewId` and `digest`; then
POST imports with exactly `{ "previewId": "...", "digest": "..." }` and a new
idempotency key. Preview lasts 30 minutes, belongs to its actor/booking and binds
the current list sequence. Identical row keys/content remain unchanged; changed
reuse requires a new explicit `allowUpdates: true` preview. Archived identities
cannot be silently resurrected by import. Any invalid row or provider failure
rolls back every row, history, command and outbox write.

## Optional personalized invitation

Issuance expects the latest credential revision (zero initially). It returns a
32-byte random `wgc_...` credential once plus `#credential=...`, revision and expiry
at event end + 24 hours. Attach this fragment to the frontend's invitation entry
URL; do not put the credential in a path/query or forward it to analytics. Existing
generic Invitation sharing/QR has no Guest dependency.

POST `{ "credential": "wgc_..." }` to exchange for a random `wgs_...` capability
lasting at most 15 minutes or credential expiry. Backend stores only token hashes;
raw credentials/capabilities are absent from durable command results, audit and
outbox. Logs redact credential, capability, fragment, greeting and note fields.
The one-time issue response cannot be recovered by idempotent replay: a retry
returns `409 INVITATION_CREDENTIAL_ALREADY_ISSUED`; deliberately reissue with a new
key and current revision if the response was lost.

View returns only `recipientGreeting` and the current public invitation snapshot.
It excludes contacts, notes, Groups, other Guests, planning, billing and private
media. Reissue/archive revoke old credentials and sessions immediately. Completed
events remain viewable until expiry; canceled bookings and removed publication
are unavailable. Invalid/revoked/expired authority returns the generic
`404 INVITATION_LINK_UNAVAILABLE`. Exchange counts invalid tokens too, with durable
10 attempts/15 minutes per resolved IP and IP/token fingerprint; excess returns
429 and `Retry-After: 900`. IP and raw tokens are not stored in the limiter.

## In-process provider contract

`GuestReaders.getPlan` returns `{ sourceGuestPlanRevisionId, sourceSequence,
expectedAttendees }`, where expectedAttendees means explicit planning total.
`listGuestGroups` returns IDs, names, colors and statuses only;
`getGuestListSummary` returns listed count and source sequence. These are trusted
in-process consumer ports; do not expose them directly as anonymous HTTP handlers.

Operations search requires a real Manager session or an injected Staff owner
facade that checks mode, assignment and event window. Production runtime does not
inject a Staff facade yet, so Staff operations remain denied. Search is active
booking-scoped, minimum two characters, limit 1–50, exact/prefix/substring ranking
with stable IDs. Results contain name, Group ID and phoneLast4, and never select a
duplicate automatically. `requireGuestForOperations` requires the same facade
before returning authorized disambiguating phone/note. Controlled facade tests
prove delegation; they do not prove SPEC-08 Staff mode implementation.

`readReportPage(bookingId, { afterSequence, throughSequence?, limit }, context)`
accepts only SYSTEM/null-actor contexts with purpose `reporting:guest-management`
or `reporting:rebuild`. Its immutable booking-local sequence and captured fence
support ordered pagination/rebuild. Reports distinguish planning and listed totals,
carry Group membership counts and contain no person contacts, notes, responses or
Staff attendance truth.

`prepareDelivery({ bookingId, guestId, intendedEmail }, context)` requires an
explicit valid recipient, owning access, active Guest, unrevoked credential and
current publication. It returns recipient, credential ID, publication/revision IDs
and expiry only. It does not send or recover raw credentials. Notifications must
later supply encrypted transient delivery and real adapter evidence.

## Acceptance boundary

Validation and exact artifact hashes are recorded in
`tasks/evidence/guest-management-w1-w4-2026-10-12.md`. PostgreSQL fixtures use native
Identity/Booking/Billing/Invitation owners with controlled settlement/storage data;
they are local integration evidence. No paid generation, real-money payment,
external email delivery, production migration or deployment was executed.

GM-W5 remains pending: real downstream Seating/printing/event/invoice conformance,
Staff mode integration, automatic Notifications delivery and final deployment
readiness. Preserve the separate RV backlog and prior SPEC-01–05 evidence.
