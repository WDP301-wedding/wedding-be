# Wedding web contract v3 integration follow-up

Backend extension requested on 2026-10-13 after reviewing the four integration
questions in `wedding-web/docs/contract-v3-integration.md`. This adds to the
completed SPEC-01–11 scope; it does not reopen or replace previous acceptance.
Frontend source and its locked API artifact remain owned by the frontend team.

## Read the latest personal invitation revision

`GET /api/v1/bookings/{bookingId}/guests/{guestId}/personalized-invitations`
requires a current account bearer session and the same confirmed-Booking access
as issuance: Manager or owning FULL Couple. It accepts no query fields and needs
no `Idempotency-Key`. Responses are `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`.

Before the first issuance:

```json
{
  "data": {
    "guestId": "10000000-0000-4000-8000-000000000001",
    "revision": 0,
    "credentialId": null,
    "expiresAt": null,
    "revokedAt": null
  }
}
```

After issuance, the latest credential's ID, positive revision, expiry and nullable
revocation time are returned. Expired/revoked credentials and archived Guests retain
their latest revision. This read neither issues/revokes a credential nor initializes
a Guest workspace. It exposes no raw token, fragment, token hash, contact details,
delivery destination, or private invitation content.

Read `revision` and pass it as `expectedRevision` to the existing issuance/delivery
command. On `409 GUEST_INVITATION_REVISION_STALE`, refresh metadata before a new
intent; do not guess successive integers. A concurrent issuance can still win after
the read. Keep one idempotency key for retries of an unchanged intent. Issuance
returns a raw credential once; lost responses still require explicit reissuance,
which revokes the old credential. Metadata cannot recover the previous link.

Anonymous/Guest capabilities and revoked account sessions receive 401; unrelated
Couple/Staff or foreign Guest IDs are concealed with 404; insufficient owning
RESTRICTED access receives 403. Invalid UUIDs/unknown query fields receive 422.
Reading metadata does not establish that publication/event gates permit issuance.

## Find the current seating plan by Booking

`GET /api/v1/bookings/{bookingId}/seating-plans/current` requires the same bearer
session and confirmed-Booking Manager/owning FULL Couple access. It accepts no
query fields, needs no idempotency key, and returns `Cache-Control: no-store`.

There is one current plan per Booking. Before selection the result is:

```json
{ "data": null }
```

Otherwise `data` is the exact existing plan DTO from
`GET /bookings/{bookingId}/seating-plans/{planId}` including `seatingPlanId`,
`revisionId`, `revisionNumber`, status, immutable render/Group snapshot and current
planning/Booking facts. Both reads use the existing revalidation path; a stale plan
can become `REQUIRES_REVIEW` and lose printable eligibility. Prior revisions and
captured print history remain immutable. No new plan is created by reading.

The frontend can discover this plan on every load without browser-local ID storage
or manual ID entry. `data:null` is an authorized empty state, not a swallowed error.
401/403/404/422 errors preserve the existing authorization/validation behavior.
No named list or enabled check-in is required. No geometry/person-seat input is added.

## Email link and deployment configuration

Personalized email links now use `/invitation/personal#credential=wgc_...`, matching
the frontend's `URLSearchParams` parser and the existing direct-issuance fragment.
Credentials remain in the fragment, never the path/query. The controlled email
test extracts the credential with that parser and exchanges it through the real
Guest HTTP routes; this is not evidence of a live delivered email.

Target: Railway project `1c56721d-021a-442c-9e01-bb91abe73adb`, environment
`production`, service `wedding-be` (`0f70d648-8c59-48bd-84f3-29a86d2e2d38`).
This is the documented developer test target, not production acceptance.

```dotenv
VNPAY_RETURN_URL=https://wedding-web-silk.vercel.app/payment-return
NOTIFICATIONS_GUEST_LINK_URL=https://wedding-web-silk.vercel.app/invitation/personal
AUTH_TRUST_PROXY_HOPS=1
```

The VNPay URL was already correct. The notification URL was absent and has been
saved using `--skip-deploys`; it takes effect at the next approved deployment/restart.
No payment/generation/mail-provider transaction or business-data mutation was run.
Do not call this configuration change a live delivery acceptance.

## Proxy IP evidence and remaining integration gate

The backend resolves rate-limit IPs through Express `request.ip`. Its approved
parser permits only zero or one trusted hop. Keep the configured value `1`;
the existing direct Railway entry point must remain safe.

A bounded developer-target probe sent invalid invitation credentials through both
the direct Railway URL and the Vercel rewrite, with and without forged IP headers.
Only short-lived Guest exchange rate-limit counters were changed; no Guest/session
credential or business record was created. Database queries compared hashed bucket
changes without recording raw IPs/tokens. Direct requests used the same buckets
with/without spoofed headers. Vercel requests did not use the same buckets as the
direct client, and successive Vercel probes also differed. None resolved to the
supplied forged address. The different Vercel buckets are consistent with changing
upstream egress IPs; the probe does not prove a shared-client collision or the exact
forwarded header chain. Original client-IP preservation remains unverified.

Do not increase the hop count or trust `X-Real-IP`/`X-Vercel-Forwarded-For` solely
because a request carries them. Multiple paths of different lengths require a
reviewed trust boundary. Coordinate a verifiable gateway-to-backend forwarding
contract with the frontend/hosting owners, then test separate clients, the direct
route, forged headers and retry/rate-limit behavior. This is a remaining integration
gate, not a completed auth configuration proof.

References: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/),
[Vercel request headers](https://vercel.com/docs/headers/request-headers), and
[Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

## Client hand-off

Use the generated `openapi/openapi.json` and `openapi/openapi.sha256` from the
reviewed backend commit. The frontend team must update its API lock/types and replace
revision guessing and local-only seating discovery with these reads. Existing POST
commands and individual-plan GET remain compatible. No migrations are required.
Code completion, exact-source CI, deployment, actual provider delivery and full
product readiness are separate evidence gates.
