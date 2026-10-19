# Read latency attribution — owner request, 2026-10-19

This is a narrow backend follow-up explicitly requested after the access-token
rollout. It implements the measurement intent of canonical WEB-BE-00 and one
measured endpoint slice; it does not close the pending frontend-first website
initiative or its canonical checklist in wedding-web/tasks/todo.md.

## Scope and sequence

1. Pin serving source/configuration, existing initialized synthetic fixture and
   credentials. Audit GET service/repository paths for initialization, repair,
   reconciliation and projection writes before measuring them. Preserve all
   financial history, idempotency and writer fences; no paid/provider commands.
2. Rebaseline the audited HTTP reads (initial probes separate from steady samples),
   then collect at least 20 steady samples for the slowest candidate and its UI
   cohort. Keep source, fixture, pool sizes, placement and timeouts fixed.
3. Attribute pool admission, lock acquisition and SQL separately. Existing
   acquireMs includes connection setup; lockRoundTripMs includes network and is
   part of queryRoundTripMs. Neither is pure PostgreSQL lock wait or execution
   time. Use server-side timing/EXPLAIN and bounded wait observation where needed;
   label estimates, sampling gaps and operator-versus-container measurements.
4. Write a regression for the measured bottleneck, make one focused optimization
   in a clean worktree, preserve authorization/snapshot/concurrency behavior, and
   repeat the same measurement with unchanged controls. Keep only a measurable win.
5. Run focused/native tests and repository gates, review the exact diff, and save
   sanitized raw samples, GET side-effect inventory and before/after evidence.
   Deployment, if needed for the authorized verification, retains exact-head CI
   and paired rollback controls. Never infer provider acceptance from these reads.

## Acceptance

Report the ranked scope, connection/lock/SQL timing semantics, GET write hazards,
the selected endpoint and its measured change. Aim for the canonical 30% median
improvement without increased errors or weaker correctness checks. Leave broader
API-family tasks open; do not claim this one endpoint completes WEB-BE-01–10.

Raw private credentials and SQL values remain outside version control. Telemetry
contains bounded numeric timings, route templates, request IDs and digests only.
Temporary operator connections/SSH registrations must be closed/revoked.
