# VNPay sandbox Railway rehearsal: 2026-10-11

## Scope and authorization

The owner selected the Hobby rehearsal: deploy sandbox configuration, observe
outbound IPv4, then verify provider-hosted checkout, IPN and QueryDr. The Railway
environment named `production` is the previously authorized developer-only test
environment. No subscription upgrade, real-money payment, Gemini generation,
automatic refund or frontend change is included.

Target project `1c56721d-021a-442c-9e01-bb91abe73adb`, service
`0f70d648-8c59-48bd-84f3-29a86d2e2d38`, environment
`08a2899c-b0d6-4200-a505-604965a4b3fc`.

## Configuration and initial observations

- All four VNPay variables were validated locally, transferred through stdin
  without command-line secret values, and compared with Railway values. Other
  runtime variables were preserved. Terminal matches the owner's IPN screenshot.
- The owner saved IPN URL
  `https://wedding-be-production-e1dc.up.railway.app/api/v1/billing/callbacks/vnpay`.
  A deliberately invalid signature returned HTTP 200 with VNPay `RspCode=97`.
  This is rejection evidence, not settlement evidence.
- Return URL is temporarily `/docs`; it is a reachable landing page, not a
  payment-result UI or settlement authority.
- Hobby remains active, Static Outbound IP remains off and outbound IPv6 remains
  enabled for Supabase. Observed IPv4 changed across deployments:
  `54.215.216.139`, `152.55.176.237`, `152.55.176.96`, then `152.55.178.57`.
  Repeated observations
  within each probe matched, but do not establish permanent or destination-specific
  egress. Current configured query IP is `152.55.176.237`; changing variables and
  redeploying can invalidate an observation, so no update/redeploy loop was used.

## Controlled prerequisite fixture

Read-only preflight found zero accounts, bookings, payment attempts and catalog
records. A new deterministic demonstration catalog and isolated synthetic
Manager/Couple booking were prepared using repository fixture logic. Test mailbox
uses `example.invalid`; no email was sent. Initial accepted proposal/timeline facts
were controlled prerequisites, not evidence of a real commercial-approval journey.

Booking `091ac91e-126e-4f41-ae1d-83ce651318b7`, timeline
`fa59bfb8-c869-465f-b841-c61674b36f56`. Server-side legacy snapshot deposit is
15,000,000 VND. No settled state, payment ledger entry or access promotion was
seeded. The fixture hold was renewed once with a dedicated audit record while
waiting for CI, before any payment attempt existed.

## Live failure and bounded transaction fix

Real HTTP login succeeded. Deposit creation returned HTTP 500, request
`88dc0916-97d8-4faa-b322-d3b4bc810e6f`, before checkout. Direct diagnostic using
the same test intent reproduced Prisma `P2028`: default transaction timeout
5000 ms, query attempted after 5168 ms. Read-only inspection confirmed no attempt,
provider evidence, payment ledger entry or application survived rollback.

Commit `24d4a7937b7f6a7889bfa26d345a23dbb1096f9f` retains Serializable isolation,
booking advisory lock and enlisted owner callbacks, with a ten-second acquisition
limit and bounded thirty-second transaction timeout, consistent with the newer
booking boundary. Locks/connections can be retained longer; this is not a latency
optimization. Independent technical review found no blocking issue.

Real local PostgreSQL regression waits 5.2 seconds between audit writes, verifies
atomic commit, then verifies rollback on a subsequent controlled failure. Mutation
to five seconds failed with P2028; restored thirty seconds passed. Local typecheck,
lint, build, five scope/client unit tests, 33 contract tests and OpenAPI check passed.
GitHub [CI run 38091187734](https://github.com/WDP301-wedding/wedding-be/actions/runs/38091187734)
passed both complete gates, including real migration/integration and full-suite
PostgreSQL coverage.

The reviewed feature source was uploaded to Railway deployment
`0384978f-a511-4a0e-b917-2382a4c0259d`. Compiled boundary expected SHA-256:
`38d63990ea6ca0b5ed26edb244a51053e9eaa4d45bb6496254cfe125f3bb6d37`.
[PR #25](https://github.com/WDP301-wedding/wedding-be/pull/25) depends on #24;
neither is merged or inherits the teammate-approval exception granted only to #23.
Main automatic deployments and Wait for CI remain enabled.

## Provider outcome

One provider-hosted NCB sandbox checkout completed using VNPay's public test card
and test OTP; no real funds were transferred. Normal authenticated HTTP checkout
returned 201. Attempt `a6ad3cbe-5537-4e2d-8ea5-fd882b37a7f1` paid 15,000,000 VND;
provider transaction `15701164`, payment date `20261011053448` (GMT+7).
The ReturnURL arrived at `/docs` with response/status `00/00`. Redirect parameters
alone were not used to declare settlement.

At 22:35:06 UTC the independent database read found the actual accepted IPN:
evidence `7affb545-c0ae-42c0-87fd-2f6554f9d459`, channel `IPN`, decision `ACCEPTED`,
outcome `SUCCEEDED`, matching attempt, transaction and amount. IPN payload SHA-256:
`4e425f79d7d1586b4bf481ecb6a29a21e68892ad2e7969a842c82b67d87b51c8`.
Exactly one payment ledger entry already existed; downstream application was
initially pending, booking `AWAITING_DEPOSIT`, access `RESTRICTED`.

The authorized normal HTTP payment-status read returned 200 with both
`status=SUCCEEDED` and `applicationStatus=SUCCEEDED`. At 22:36:08 UTC the database
confirmed booking `CONFIRMED` revision 3, exactly one payment entry
`dc9a50b0-d3ee-48aa-b7fe-d631ee001616` for 15,000,000 VND, exactly one deposit
application, and the same reserved account at `FULL` with that source payment.
Status reconciliation completed the owner effects without another checkout or
provider charge. Automatic background recovery was not exercised (RV-16).

One separate real QueryDr request ran from the deployed container at 22:35:25 UTC.
It returned response/status `00/00`; the current adapter verified its actual
signature and matching attempt, transaction and 15,000,000 VND. Query response
payload SHA-256:
`962137a6585dc7006edf5e92af7623c491adbd56fbc7773a9b4a3882a16ef0d8`.
This read-only probe made one request and zero database writes. It succeeded with
configured `VNPAY_QUERY_IP=152.55.176.237`, despite observed generic IPv4
`152.55.178.57`. This proves this terminal's sandbox request worked at this time;
it does not establish permanent egress, destination-specific routing, absence of
merchant IP restrictions elsewhere, or production acceptance. No IP update or
additional deployment was needed after this successful probe.

An exact replay of the provider-signed ReturnURL parameters to the IPN endpoint
returned HTTP 200 / `RspCode=02` (already confirmed). This was a controlled duplicate
replay, not another genuine provider delivery. At 22:37:14 UTC the database still
had one attempt, one accepted IPN receipt, one payment and one application; booking
revision and access were unchanged. Controlled invalid amount/signature/merchant,
duplicate/concurrent/late evidence and timeout/unknown cases passed the real
PostgreSQL suite in the CI run above; those negative cases use controlled transports,
not additional live payments.

Final Railway deployment is `SUCCESS`; compiled boundary SHA-256 matched the
expected value above. `/docs`, canonical and browser OpenAPI, live/ready health and
catalog reads all returned 200 at 22:36:17 UTC. Canonical OpenAPI exactly matches
the repository, SHA-256:
`fcc54f3a842836e17ca056ca2ec81cec6172c28f79c3831477418c721e273184`.
Main autodeploy remains enabled with `checkSuites=true`; Static Outbound IP is off
and outbound IPv6 is on. Raw credentials, session tokens, signed URLs and test-card
values remain outside committed evidence.
The task-only Railway SSH key was revoked and both owned local key files removed
after all remote checks.

RV-12/RV-13 baseline sandbox gates have this target-specific configuration, offline
and genuine provider evidence. Rerun RV-13 after BE-09 changes deposit calculation.
Balance checkout (RV-14), full multi-actor commercial workflow (RV-15), revised
contract amounts and production-money acceptance remain untested. Preserve this
real sandbox settlement and immutable ledger history; do not reset it for another
demo. Before each demo, create a new eligible test booking and verify checkout,
IPN and status; repeat QueryDr after deployment/config changes rather than assuming
Hobby egress stays fixed. Replace `/docs` with the frontend-owned result route when
available; that page must use authorized payment-status reads.
