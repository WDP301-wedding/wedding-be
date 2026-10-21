# Website remediation scope amendment — 2026-10-19

The project owner explicitly expanded the performance/reliability revision from
backend-only work to **all of wedding-web plus the supporting wedding-be paths**.
Required order: frontend first, backend second, direct browser E2E last. This
supersedes the frontend edit restriction in AGENTS.md and the team-boundary
paragraph of backend-scope-2026-10-10.md for this initiative only.

Canonical implementation plan: [wedding-web plan](../../wedding-web/tasks/plan.md).
Canonical task status: [wedding-web todo](../../wedding-web/tasks/todo.md), with
stable WEB-FE, WEB-BE and WEB-E2E identifiers. The existing backend tasks/plan.md,
backend-revision-todo.md and historical SPEC/RV/PERF evidence remain intact. This
plan is additional work, not a declaration that earlier deployed improvements
are absent. Check exact current source/deployment and open diffs before each task.

The frontend scope includes public catalog/intake, authentication/OTP/account,
workspace and all child pages, generic/personal invitations, file downloads,
legacy redirects and desktop/mobile behavior. Preserve the current visual design
unless a concrete usability/accessibility defect requires a scoped correction.
wedding-manage-web, wedding-app, new business features and a general redesign are
outside this initiative.

Frontend checks are acceptance gates for wedding-web. They do not replace backend
authorization, money/race, schema/OpenAPI, migration and provider evidence. Planning,
local tests, browser tests using controlled failures, deployed read verification
and real provider outcomes must have separate labels.

Keep Group + optional Guest, separately entered planningHeadcount, opt-in named
check-in, unknown attendance when disabled, read-only guest invitations and no
RSVP. Money remains integer VND, server calculated; preserve immutable commercial
history, idempotency and settlement evidence. Do not infer companion-count rules
or bride/groom identities. Never rewrite applied migrations.

This amendment authorizes the expanded work scope and order. It does not turn
the shared live booking into a destructive test fixture, authorize paid generation
or real-money transactions, or authorize deployment merely because a plan exists.
Use a dedicated synthetic fixture and sandbox/provider authorization for mutating
E2E; otherwise report those cases pending rather than fabricate acceptance.

Baseline: [19 October browser/API audit](../tasks/evidence/web-dashboard-audit-2026-10-19.md).
This turn changes planning/instruction documents only; implementation has not begun.
