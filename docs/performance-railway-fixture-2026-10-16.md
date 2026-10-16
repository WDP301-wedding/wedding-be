# Railway synthetic performance fixture — 2026-10-16

The owner supplied three test accounts and explicitly authorized fixture creation
and Railway tests in this conversation. Credentials are held in ignored operator
configuration; no password, access/refresh token or invitation token belongs in
this document or its evidence.

## Fixture and authorization

- Origin: `https://wedding-be-production-e1dc.up.railway.app`.
- Booking: `e80c6f1b-a4fc-4674-a4dd-13ef2601206b`.
- Consultation: `52f0225b-8069-4140-a849-0146ef86e04b`.
- Label: `PERF-TEST-20261016`; event date `2026-11-19`, DINNER, Orchid Hall.
- Planning headcount: 50; five menu tables; four groups and eight synthetic named
  Guests. Listed Guests do not determine planning headcount.
- Both Manager and Couple approved the same timeline and commercial contract
  through existing authenticated APIs. The contract total is 17,500,000 VND and
  the server-calculated deposit is 5,250,000 VND.
- For this explicitly authorized synthetic fixture, the existing Manager manual
  accounting API recorded a clearly labeled synthetic receipt. This is an
  immutable test accounting fact, **not an actual transfer, verified cash receipt
  or VNPay/provider settlement**. No settled row or FULL grant was inserted
  directly. Normal deposit application confirmed the booking and promoted Couple
  access to FULL. This fixture cannot supply live payment acceptance evidence.
- The native Identity invitation issuer used a captured notification port for the
  supplied `.test` recipient; Railway's invitation-acceptance API created the
  RESTRICTED workspace access. Its returned session was revoked. No invitation
  email was sent by this fixture issuer.
- Staff is actively assigned. `BY_GUEST_NAME` was explicitly enabled only for this
  fixture. No check-in or undo was performed.
- A new `PERF-TEST Orchid 50` layout was created and published through Manager
  catalog APIs because the hall had no compatible layout. The fixture's five-table
  Seating plan was selected and confirmed. One synthetic invitation draft was
  created without AI, upload, publication, delivery or print generation.

No existing booking or catalog layout was edited. The new synthetic financial and
approval history is retained; cleanup must not erase or rewrite it. Reuse this
booking rather than creating another synthetic payment on each measurement run.

## Measurement boundary

At this baseline checkpoint the active deployment was
`b1b875c0-25d8-4bcf-a6fe-2484bbb25c74`, source
`5b2536212e9a6feafbb48d9a71bba1f90ded08ae`; PR #46 had not been deployed.
The later owner-authorized merge, deployment and matched comparison are recorded
[separately](perf46-railway-comparison-2026-10-16.md).
`DB_DIAGNOSTICS_ENABLED` is false, so this run cannot demonstrate the new driver
diagnostics or Identity optimization. No service variables, region, application
deployment or migrations were changed.

The service has Notifications workers and FCM enabled with existing test fences;
this fixture booking is outside its booking allowlist. Those shared settings were
left unchanged. This is a sequential, light-load baseline on a shared service,
not an isolated region experiment or capacity/SLO test.

The first eight-family runner attempt stopped on login HTTP 429 before recording
any business sample. It is preserved separately. After allowing the existing
login window to expire, the measurement uses existing sessions between reads and
the runner's bounded renewal/cleanup behavior. Authentication limits were not
changed or bypassed.

Assigned Staff search was probed separately and returned
`403 CHECK_IN_WINDOW_CLOSED`, request ID
`e7bb678f-b53f-493c-b3db-138de2068b83`. The future booking date satisfies the normal
booking rule; it was not rewritten to enter the Staff event window. This denial
is expected authorization evidence and **is not a successful performance sample**.
Successful search timings use the Manager role, which the existing policy permits
outside that window. They cannot close assigned-Staff success acceptance.

The audit runner adaptation retains one initial probe and twenty sequential
round-robin samples per route. Seven families use Couple, and Guest search uses
Manager. Only normalized routes, role, status, size, count, time and request IDs
are retained. Request IDs are matched to logs of the exact deployment. The
canonical eight-family assigned-Staff acceptance requirement remains unchanged.

The read-only DB snapshots compare this booking's complete rows in Booking,
GuestWorkspace, GuestPlanRevision, Guest, GuestGroup, GuestHistory, SeatingPlan,
SeatingPlanRevision, StaffConfiguration, StaffAssignment, StaffHistory,
StaffCheckInRecord, CommercialContractRevision, FinalInvoiceRevision and
BillingLedgerEntry. Evidence stores row counts and hashes, not row payloads.
This does not assert that unrelated shared-service traffic or all tables were
unchanged.

A container DB probe using the existing SSH identity did not complete (CLI exit
11). No container RTT was obtained and no SSH key was registered. Desktop DB
reads used for fixture invariants are not container-to-DB latency measurements.

## Results and remaining acceptance

The [sanitized measurement receipt](../tasks/evidence/perf02-05-railway-fixture-2026-10-16.json)
records **200/200 steady HTTP 200 samples**, ten separate initial HTTP 200 probes
and the one expected Staff 403 probe. All 211 request IDs matched completion logs
from the exact deployment. All fifteen recorded fixture tables had identical
counts and row hashes before/after the reads. Staff check-in records remained
zero. The measurement sessions, including the Staff probe session, were revoked
with HTTP 204. The active deployment/source did not change.

Each row below has twenty steady samples. Times are seconds, nearest-rank p95;
backend duration is from the matching request log, not inferred from client time.

| Role    | GET family                 | Client p95 | Backend p95 |
| ------- | -------------------------- | ---------: | ----------: |
| Couple  | Guest groups               |      5.578 |       5.336 |
| Couple  | Guests, eight results      |      4.129 |       3.890 |
| Couple  | Guest planning             |      4.119 |       3.890 |
| Couple  | Current Seating            |      7.392 |       6.906 |
| Couple  | Compatible layouts         |      5.533 |       5.308 |
| Couple  | Invitations                |      5.830 |       5.587 |
| Couple  | Billing                    |      4.324 |       3.915 |
| Manager | Guest search, eight hits   |     11.307 |      11.071 |
| Couple  | Identity `/auth/me`        |      0.934 |       0.616 |
| Couple  | Overview, one FULL booking |      1.357 |       1.097 |

The first eight families ran sequentially; a separate two-family Identity/overview
run followed after their session cleanup. There was no concurrent load generator.
The old source is still slow on these initialized booking reads. This is a useful
baseline, not evidence of a candidate improvement, pure DB execution time or a
production performance budget.

PERF-02 through PERF-05 remain open until their corresponding live gates pass:
assigned-Staff successful reads in a valid event window; deployed diagnostics and
container DB evidence; an authorized, matched region experiment; and a fixed-
topology baseline/candidate comparison. Synthetic manual accounting does not
change provider acceptance or the existing release NO_GO decision.
