# SPEC-10 integration on the accepted SPEC-09 baseline

Date: 2026-10-13 (Asia/Saigon). Backend-only integration.

The original Analytics checkpoint was built in an uncommitted checkout based on
SPEC-08. Before publication, remote main was refreshed and found to contain
[PR #37](https://github.com/WDP301-wedding/wedding-be/pull/37), commit
`6974141b2039f35025c94f221f35c228c54c2749`, with the accepted Notifications/FCM
implementation. The original competing checkout and its evidence were preserved.
Only Analytics and its integration were carried onto this accepted baseline.
No accepted Notifications implementation or applied migration was replaced.

## SPEC-09 regression coverage

The accepted baseline's [Linux CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38292345101)
already passes the unchanged 80% lines/branches per-file gates. This revision adds
four native PostgreSQL tests for exact idle/absolute Android session expiry,
independent live sessions, account suspension/reactivation, malformed identity
references, current minimal contact facts, Couple audience revocation, assigned
Manager access and nullable effective schedules. All four pass locally.
No test is skipped or assertion removed to achieve coverage. No provider send is
performed by these additional tests.

## Analytics integration and database privacy

All six native owner feeds, immutable facts, committed source fences, bounded
projections/rebuild, Manager authorization, private reporting/export routes and
the 60-second runtime are retained. The existing Notifications/FCM startup,
observability, settings and worker configuration remain intact. New startup
checks verify Analytics registration, start/close and cleanup on initialization
failure; 23 lifecycle tests pass locally.

Review found an exposed database boundary: a non-owner role with SELECT grants
could read new reporting facts. A new native test first reproduced this leak.
Forward migration `20261013005000_analytics_private_reporting` enables RLS on all
five reporting/projection tables with no public policies. The same test then
passes: the granted non-owner sees no facts/counters, all five tables have RLS,
and native backend owner capture remains functional. Applied migrations are not
edited. Empty PostgreSQL deploy applies all 60 migrations successfully; the
populated upgrade preserves existing owner evidence and backfills Analytics.

## Verification at publication

Local runtime: Node 24.19.0, PostgreSQL 18.6 on an isolated loopback cluster.
Integration databases and the granted probe role are disposable, uniquely named
and cleaned by their fixtures. No connected Supabase business data is mutated.
Tests use one worker and 60-second runner/cleanup budgets on Windows; application
deadlines and the repository's 80% per-file thresholds are unchanged.

Typecheck, formatting, production build, generated OpenAPI equality and the locked
dependency audit pass. Full lint found only three unbound-method assertions in
the new lifecycle checks; those retain the same assertions using typed spies and
pass focused lint and lifecycle reruns. The full suite with PostgreSQL coverage
and both existing Linux CI jobs must pass on the final PR head before merge.
The exact publication source/API hashes are in
[the integration manifest](analytics-spec09-integration-manifest-2026-10-13.json).

The original [Analytics evidence](analytics-dashboard-w1-w4-2026-10-13.md) and
[original manifest](analytics-dashboard-provider-manifest-2026-10-13.json) remain
historical checkpoints. Their old whole-workspace SPEC-09 coverage blocker and
56-migration count are superseded by this integration; they are not final-head
acceptance claims. A final CI/deployment receipt is collected after publication.

## Review and release boundaries

Agent review covers owner compatibility, immutable money/history, current identity
authorization, strict API/error contracts, bounded reads, RLS, atomic projection
publication and shutdown recovery. It is not an independent team-member approval.
The owner explicitly requested testing, merge and Swagger verification in this
task. Merge authorization is recorded separately from independent reviewer proof;
no approving reviewer is invented.

Deployment uses the existing Railway developer staging target and configured main
source with Wait for CI. Its release migration and Swagger publication are checked
separately from offline coverage. Anonymous checks do not prove authenticated
live workflows, provider delivery or production readiness. Existing live-provider
evidence and the still-disabled FCM/device boundary remain separate. RV-21 and
REL tasks are not closed by these offline tests or Swagger reads.
