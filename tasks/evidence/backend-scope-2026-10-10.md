# Backend Scope Revision Evidence: 2026-10-10

Branch: `codex/backend-scope-revision`. This revision records scope preparation and
a narrow terminology cleanup, not a deployment or finished commercial
implementation. Business requirements were explicitly confirmed by the owner.

## Completed

- Revised Product Requirements, capability ownership, baseline Section 22,
  commercial/profile extension SPEC and backend-only SPEC-06–11 scope.
- Replaced guest response specification with Guest Management: groups/households,
  imports, planned headcount, read-only invitation links, delivery and check-in consumers.
- Created the active BE-01–17 and GM/SEA/STF/NTF/ANL/REL backend task backlog;
  existing 01–04 and 05 backend completion/evidence remains historical.
- Removed old UI skill from repo and local discovery, its installer and mandatory
  instructions. Recoverable copies exist under C:/Users/DELL/.codex/retired-skills/.
  Existing frontend repositories were not edited.
- Replaced the old copied-source guide with links to current requirements/evidence.
- Renamed application/Prisma headcount property to sourceGuestPlanRevisionId,
  with explicit mapping to the existing physical column/constraint. No DDL or data
  rewrite; existing applied migrations remain byte-for-byte unchanged.
- Updated the public invitation OpenAPI summary to read-only terminology.

## Verification

| Check | Result |
| --- | --- |
| npm ci | Restored pinned dependencies; package manifest/lock unchanged |
| npm run db:generate; Prisma format | Passed; generated client matches mapped property |
| npm run typecheck | Passed |
| npm run lint | Passed, zero errors/warnings |
| npm run build | Passed |
| Focused Booking policy/repository + tests/contract | 12 files, 49 tests passed |
| Booking runtime integration | 1 file, 3 tests passed on local disposable PostgreSQL databases |
| npm run api:generate; npm run api:check | Passed |
| Changed-file Prettier | Passed; manually maintained planning docs honor repository ignores |
| git diff --check | Passed |
| Current source link check | Five new/current documents, zero missing relative file links |
| Removed skill directory check | Repo and installed skill directories absent |
| OpenAPI guest-response route check | No guest response routes |

The local demo PostgreSQL server was started for temporary-database integration
tests and stopped afterward; existing demo data was preserved. No shared/production
database was used. Dependency restoration repaired missing sharp/qrcode packages;
no dependency versions were changed. Contract tests were rerun after generation
completed to avoid observing an artifact during a concurrent write.

OpenAPI SHA-256:
`6f92021e6c8fa7f4f094cc65b3bcf165adf82d819cf18bdf8ad8b70f8307297e`.
This artifact describes existing implemented routes, not pending commercial APIs.
No frontend contract locks were regenerated; the frontend team owns its hand-off.

## Pending Implementation

BE-01–17 and all new GM/SEA/STF/NTF/ANL/REL waves remain unchecked. Separate
bride/groom database fields, service/print catalogs, multi-menu commercial contract,
PDF/dual approvals, whole-contract 30% deposit, appendices, contract-linked print,
incidental expenses and final invoice/adjustment APIs are specification work only
in this revision. Do not claim a running full revised wedding/payment journey.
