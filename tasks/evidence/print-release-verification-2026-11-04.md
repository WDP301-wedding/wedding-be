# Print appendix release verification — 2026-11-04

The owner explicitly requested keeping the demo settlement date bypass,
investigating the reported HTTP 500/publication failures, and pushing, merging
and deploying after verification. This extends the multi-design print revision
across wedding-be, wedding-web and wedding-manage-web.

## Findings and local evidence

- The mocked booking overview tests omitted the account/invitation reads now
  performed by the route. Completing the fixtures removes the reported 500s.
  Native PostgreSQL overview HTTP tests pass (6 cases). Active Web bookings
  exclude cancelled bookings; Android retains owned cancelled history.
- The proposal mock omitted selected deposit intents and incorrectly expected
  withdrawal permission without an approval. The tests now represent the owner
  contract and retain the permission assertions.
- The default settlement date bypass remains unchanged, as requested for demo.
  Separate tests cover the optional strict switch and prove that demo mode still
  rejects an ineligible booking. No financial authorization or amount guard is
  removed.
- Publication HTTP/owner acceptance passes all 7 selected cases, covering public
  JSON/HTML/QR, same identity across designs, revision conflicts, removal,
  rollback and retained history. The old public-schema test is corrected to
  check that a private key is absent from parsed output; historical snapshots
  can still be safely projected without rejecting harmless unknown stored keys.
- The backend unit suite passes: 173 files, 1,567 tests. Remaining mocked runtime
  fixtures were completed for logging, template history, configuration and
  timeline approval reads; email/copy expectations match current Vietnamese
  messages. No tests were disabled and no thresholds lowered.
- The Manager print/appendix/typography subset passes: 4 files, 21 tests.
- During broader frontend verification, a real cross-tab token feedback loop
  was found: receiving a token persisted and rebroadcast it. The receiver now
  persists without rebroadcast and ignores duplicate tokens. An HTTP 401 also
  bypasses that same rejected cached token before refreshing once. Regression
  tests cover both paths. Invitation publication waits for the authoritative
  server snapshot rather than assuming revision zero or trusting localStorage.

Ignored local logs are named `test-results/release-*.log` for backend and
`test-results-release-*.log` for clients. Windows native worker termination still
occurs on some combined database runs; the existing isolated local acceptance
and Linux CI are kept separate. Exact-head CI is required before merge.

## Release gates and target

CI now also executes backend units and the scoped native overview/publication/
print appendix cases, plus the invitation/authentication/print/typography client
regressions. Existing lint, typecheck, API lock, build and audit checks remain.

Target is the existing Render service `wedding-be-render-trial`,
`srv-dbct9ao473hc73a5qud0`, workspace `my space`,
`tea-dbcss8ks728c73851hl0`, as selected in the owner's existing
[Render record](../../docs/render-migration-2026-10-22.md). Both clients retain
their existing Vercel projects and GitHub deployment workflows. No new resources
or provider credentials are requested.

Before release the live backend is commit `189bf31f72d132c75d0d5bbaf8d729f21c5e4abc`,
Render deployment `dep-dbl20615efls7380m3mg`. Rollback must retain all additive
migrations and financial/consent history. Restore compatible client/backend
builds together; do not drop or rewrite requests, appendices, orders or invoices.

## Current status

Implementation/review: in progress. PR checks, merges, target migration,
deployments and post-deploy browser verification are pending. No deployment or
external provider success is claimed by the local evidence above.
