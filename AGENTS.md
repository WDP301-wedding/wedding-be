# Backend Ownership

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

Keep guest lists, groups, planned headcount, seating and event check-in. Guests only
view invitations; do not add guest response statuses, response endpoints, attendance
confirmation forms, response deadlines, response reminders or response analytics.

Money uses integer VND and server-calculated totals. Contract, appendix and finalized
invoice history is immutable. Preserve payment idempotency and settlement evidence.
Never rewrite applied migrations or infer bride/groom names by splitting legacy text.
