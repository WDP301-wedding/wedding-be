# Backend Ownership

Owner-approved exception, 2026-10-19: the website performance/reliability revision
may change both `wedding-web` and `wedding-be`, in that order, followed by direct
browser E2E verification of the deployed website. It covers all wedding-web routes,
not only the dashboard. `wedding-manage-web` and `wedding-app` remain outside this
revision. Follow each repository's own instructions. The canonical plan/task list
is `../wedding-web/tasks/plan.md` and `../wedding-web/tasks/todo.md`; see
`docs/web-remediation-scope-2026-10-19.md`. This exception supersedes the frontend
edit restriction below only for this revision; business/provider safeguards remain.

From SPEC-06 onward, work in this repository is backend-only. The frontend team
owns wedding-web, wedding-manage-web and wedding-app, including their new UI.
Do not delete or modify existing frontend code as part of this backend revision.
Frontend checks, screenshots and native builds are not backend acceptance gates.

Read docs/backend-scope-2026-10-10.md before planning or implementing new work.
It records the project owner's confirmed requirements and supersedes conflicting
older requirements, copied guides and task outlines. SPEC-01 through SPEC-04 are
completed; SPEC-05 is completed for backend scope. Preserve their evidence and add
the commercial/profile extensions as new work rather than reopening old checklists.

Completed baseline code/tests do not prove live external integration or deployment
readiness. Read tasks/evidence/spec01-05-runtime-audit-2026-10-10.md and track the
RV tasks in tasks/backend-revision-todo.md. Keep configuration, offline tests,
live sandbox/provider evidence and production readiness separate. Never mark a
provider feature live because credentials exist, a mock passed or health returned 200.
Do not execute paid generation, real-money payments or destructive/shared-data
operations during an audit; arrange an explicitly authorized test environment first.

There is no mandatory frontend design skill. Backend hand-offs include strict
schemas, OpenAPI, examples, errors, authorization, migrations and provider evidence.

Use Group + optional Guest list, not Household/party identities. A named Guest may
bring companions; removing Household does not prohibit them. Companion-count
storage/check-in rules are not yet confirmed; do not implement or prohibit them
by assumption.
Group seating works without named guests. Planned headcount is separately entered
by Couple/Manager, never derived from Guest count; an empty list cannot reset it.
Name-based check-in is explicitly opt-in per booking and off by default. Disabled
check-in is not recorded/unknown, never zero actual attendance. Enabled check-in
counts listed guests only, not whole-event attendance. Guests only view invitations;
do not add response statuses/endpoints/forms/deadlines/reminders/analytics.

Money uses integer VND and server-calculated totals. Contract, appendix and finalized
invoice history is immutable. Preserve payment idempotency and settlement evidence.
Never rewrite applied migrations or infer bride/groom names by splitting legacy text.
