# Couple pre-deposit backend server release — 2026-10-23

The owner explicitly authorized deploying this backend and its migration to the
existing server. [PR #92](https://github.com/WDP301-wedding/wedding-be/pull/92)
merged reviewed implementation `d1308749d4163c1a34aa715d44d9fa07cb0d214b` as main
`dea2f5912711417bebcc228d6045d58c75309e80`.

## Review and exact-head gates

Independent correctness/security review found no blocking defect. All required
[PR CI gates](https://github.com/WDP301-wedding/wedding-be/actions/runs/39909281374)
passed: 1,534 unit tests, 100 contract tests, 716 PostgreSQL integration tests and
the full 314 files / 2,350 tests. Coverage is 97.38% lines / 92.89% branches, with
all existing per-file thresholds enforced. Dependency audit passed the unchanged
repository policy. This closes CAP-BE-02 without relabelling the retained local
Windows worker failures as a green full run.

## Controlled database release

Target: Render PostgreSQL `dpg-dbct3l5g1s2s73eesm00-a`, Singapore. A PostgreSQL
custom-format backup of 1,985,751 bytes was retained privately before migration;
its archive list is readable (1,166 entries). Backup SHA-256:
`4ec120e6feb566c6eb9add0ed45fec39fa42b59d712363068eb8e7b9cf4beca5`.
An archive-list check is not a full restore rehearsal.

Only `20261023020000_couple_predeposit_app_access` was pending and applied through
Prisma migrate deploy, at 06:11 UTC. Its checksum is
`746ae5aa7e013dc93e70a05ae7eea6e4721881628eb3933f3cc566eafc24937c`.
All 66 previous migration records/checksums and existing role IDs/timestamps are
preserved; migration history now contains 67 records. Exactly three missing
COUPLE roles were added, leaving no consultation-access owner without the role.
All 27 grant rows remain identical: 12 RESTRICTED and 15 FULL. Thirty selected
account, credential, invitation, booking, commercial, timeline and billing table
digests match before/after, including immutable documents and payment evidence.

External access was scoped temporarily to the operator IPv4 only and restored in
`finally` to the original empty public allowlist. TLS peer verification remained
enabled. No reset, seed, destructive import or prior migration edit was used.

## Application rollout

[Main CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39910071752)
also passed every gate on merge commit
`dea2f5912711417bebcc228d6045d58c75309e80`, with the same full-suite counts and
coverage. Render deployment `dep-dbdfotks728c73bq54jg` became live at
`2026-10-23T06:21:05Z` (13:21 in Vietnam) at
[the existing backend](https://wedding-be-render-trial.onrender.com).
The checked commit was deployed explicitly through the Render API; this release
does not establish that the automatic checksPass trigger works.

At 06:21 UTC, 23 deployed HTTP probes passed using existing synthetic accounts:

- Android login and refresh returned body credentials without a Web cookie;
  identity retained COUPLE. Test-created sessions were logged out.
- The same DRAFT/RESTRICTED booking that appeared only for Web before deployment
  now appears identically for both Web and Android. The two response digests match.
- Profile, proposal, commercial-contract and active deposit-discovery reads return
  200. RESTRICTED billing and guest-plan reads remain 403; a known foreign booking
  is concealed with 404. The existing CONFIRMED/FULL owner still reads billing and
  guest-plan successfully. Anonymous/revoked-session access returns 401.
- The native acceptance route rejects an empty strict body with 422. Actual
  acceptance, one-time replay and concurrent promotion are proven by the exact-head
  PostgreSQL tests, not by consuming a shared live invitation during this release.
- Deployed OpenAPI SHA-256 matches the generated artifact exactly:
  `c3c6367a48ad31893f076a770a9ab3f135410c7f8e6a26b725fc68491e1752dd`.

The before-deployment probe initially used an invalid limit of 100 (maximum 50)
and attempted GET on the POST-only timeline-revisions path. Those operator probes
returned 422 and 404 respectively; the corrected read-only baseline passed.
No product code or validation limit was changed for these harness corrections.

The final Render read confirms the exact commit is live, all environment values
and worker/provider settings match the pre-release aggregate digest, and public
database access is closed. No smoke probe edited business data or initiated a
payment, email, paid generation or other provider operation. This closes
CAP-REL-01 for backend deployment, while CAP-CLIENT-01 remains with client owners.

## Scope and rollback

Preserve the pre-release Render backend revision
`f068aa8a72877dcb8a9cc4e117ffa073b652ec71` for application rollback if required.
Keep additive roles/migration and all immutable financial history. Never restore
the pre-migration database over newer writes. Client per-booking role gates and
native provider-browser integration remain with the frontend owners; see the
[API hand-off](../../docs/couple-predeposit-app-access.md). No paid generation or
real-money payment is authorized by this release.
