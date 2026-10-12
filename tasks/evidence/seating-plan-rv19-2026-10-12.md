# SPEC-07 SEA-W1–W5 and RV-19 backend evidence

Date: 2026-10-12 (Asia/Saigon). Branch: `codex/spec07-seating-print`.
Provider version: `seating-plan@1.0.0`. Scope: backend only, Group + optional Guest;
independent Booking planning count; no companion/check-in assumption, frontend change,
paid generation, external send, real-money payment or production migration/deployment.

## Implemented boundaries

SEA-W1: inclusive capacity and physical maximum, zero draft/positive confirmation,
stable IDs and explicit remap/drop rules. SEA-W2: immutable plan history, forward
migration, retained references, monotonic heads and populated upgrade proof.
SEA-W3: exact confirmation/Manager exception, real Venue lifecycle locks,
Booking/Guest/Identity/Billing owner access and Invitation registry in one shared
transaction; rollback, idempotency/revision concurrency, high-water invalidation,
five-minute paged reconciliation and optional minimum-data guidance.
SEA-W4: six strict private HTTP/OpenAPI operations, native session/ownership checks,
foreign/Staff/revoked denial and rejection of geometry/person/color claims.
SEA-W5: [frontend hand-off](../../docs/seating-plan-w1-w5.md), source/API manifest and
backend acceptance; actual Staff/Notifications delivery and deployed journeys stay
separate.

RV-19: generated files consume the actual Seating confirmation via the real
Invitation registry, not registry doubles. Controlled local tests preserve file bytes
after headcount invalidation and retirement, serialize print/headcount races, and
reject stale print capture before delayed reconciliation. Fixed vectors, Group legend,
Vietnamese glyphs and QR are inspected in the resulting PDF. Rendering performs no
ledger mutation; existing print approval/once-only billing remain authoritative.

## Local environment and verification

Windows Node 24.15.0, locked dependencies, PostgreSQL 18 at loopback 127.0.0.1:55435.
Every native suite creates a randomly named disposable database and applies all forward
migrations; populated upgrade seeds native pre-Seating Booking data before the new
migration. Shared/cloud application databases are not used for tests.

Focused native Seating run: 6 files / 16 tests pass, no skips. Seating coverage:
96.76% lines (269/278), 90.2% branches (175/194), 96.12% statements, 96.05% functions;
every included source file meets unchanged 80% line/branch thresholds.
Initial RV-19 coverage run: 3 files / 21 tests pass, no skips; file service/renderers
99.02% lines (203/205), 97.56% branches (80/82), 98.67% statements, 100% functions.
Additional real print-order approval, final regression and immutable hashes are recorded
below.

Final focused runtime/HTTP/renderer run: 10 files / 42 tests pass. Follow-up populated
print-history upgrade and concurrent Venue retirement checks: 2 files / 6 tests pass;
this adds one new retirement-race case to the final inventory. OpenAPI contract gate:
14 files / 40 tests pass, no skips. Empty Prisma deployment: 46 migrations pass.
Typecheck, lint, production build, API generation/check and changed-file Prettier pass.
Repository-wide local Prettier encounters seven pre-existing ignored Playwright YAML
outputs; these artifacts were neither modified nor committed. CI checks the tracked
checkout normally.

The Windows full-suite attempt is **not** a successful gate: two worker forks exited
with native `0xC0000409` in unchanged `guest-management-http.test.ts` and
`invitation-studio/media-persistence.test.ts`. Its 227-file/1,690-test partial pass count
is not acceptance evidence. Full regression/coverage is evaluated by Linux CI with
the unchanged repository commands and thresholds.

Independent read-only review used a separate fresh-context model and found no required
correctness/security/architecture findings. This is an agent review, not a teammate's
approval or owner release acceptance. Mutation experiment on an isolated byte-identical
policy/test copy in ignored local storage inverted the physical-capacity comparison:
the original passed and the mutant failed the inclusive-boundary test. The production
working source was never modified during the running regression suite.

PDF inspection: [retained fixture](fixtures/seating-plan/seating-accepted.pdf),
[exact Seating/QR facts](fixtures/seating-plan/seating-accepted.json),
[machine inspection](fixtures/seating-plan/inspection.json) and
[rendered back side](fixtures/seating-plan/seating-accepted-2.png).
Poppler rendering and `scripts/inspect-seating-print.py` verify two physical pages,
148×210 mm TrimBox, 3 mm bleed, embedded fonts, Vietnamese names/Group labels, retained
vector ellipse aspect/color, text inside trim and decoded generic QR. Visual inspection
of both pages found no clipping, overlap or missing glyphs. Rotated rectangles and
illegible/overflowing layout/legend denial are additionally covered by renderer tests.

Runner: repository Vitest with `--pool=forks --maxWorkers=1 --execArgv=--no-opt
--testTimeout=30000 --hookTimeout=60000`, parent Node `--no-opt`, validated loopback
`TEST_MIGRATION_DATABASE_URL`; focused coverage include filters target the complete
Seating module or the three changed file service/renderers. These overrides do not
weaken tests, assertions, coverage thresholds or production timeouts.

Earlier failed attempts are diagnostic, not accepted gates: one Windows fork exited
with native `0xC0000409`, matching prior repository evidence; a thread attempt rejected
the unsupported `--no-opt` worker flag; malformed legend fixture coordinates initially
hit strict validation before overflow. Corrected focused runs exercise the intended
failures. A broad print-only coverage filter included unrelated unexercised legacy
order/contract sources and failed; its partial coverage is not reported as acceptance.

TDD: SEA-W1 test failed before its domain implementation existed. The RV-19 native
file regression failed with `PRINT_SEATING_NOT_SUPPORTED` before the renderer change,
then passed. No prerequisite checkbox was closed by configuration/mock/health alone.

## Linux regression and exact artifacts

[Backend CI run 38188448534](https://github.com/WDP301-wedding/wedding-be/actions/runs/38188448534)
passes both unchanged CI jobs on runtime source
`f11dc9105d7f5e328ab6b2f756563a29482addc8`:

- Static formatting, lint, typecheck, build, audit and OpenAPI check pass.
- Unit: 138 files / 1,248 tests pass; contract: 14 files / 40 tests pass.
- Empty PostgreSQL install: all 46 migrations deploy.
- Integration: 77 files / 417 tests pass, no skips.
- Full suite/coverage: 229 files / 1,705 tests pass, no skips; 97.43% lines,
  93.56% branches, 96.60% statements and 98.42% functions. Every source file meets
  the existing 80% line/branch thresholds.

Test-only follow-up `b8ec6b1fd752f9a43a87a8cf750ebdde07ed8c9d` adds concurrent retirement
and actual pre-upgrade printable-history proof; its two native suites pass locally.
Runtime source is byte-identical to the passing CI revision above. PR:
[#35 (draft)](https://github.com/WDP301-wedding/wedding-be/pull/35).

Final [Backend CI run 38189087856](https://github.com/WDP301-wedding/wedding-be/actions/runs/38189087856)
also passes both unchanged jobs on exact implementation/test source
`b8ec6b1fd752f9a43a87a8cf750ebdde07ed8c9d`: all 46 migrations, 138 unit files /
1,248 tests, 14 contract files / 40 tests, **77 integration files / 418 tests** and
**229 full-suite files / 1,706 tests**, no skips. Final full coverage is
**97.44% lines / 93.58% branches**, 96.61% statements and 98.42% functions; every
source file meets the unchanged 80% line/branch gates. The following hand-off commit
changes only documentation/evidence and has identical runtime/schema/API/test sources.

OpenAPI SHA-256: `dbf4880f1f92a65ba503d9db0890b857e80e7fff46a6065a5d65ffbaf1ccc430`.
The [machine manifest](seating-plan-provider-manifest-2026-10-12.json) records exact
module/owner source, migration, API and unchanged lockfile hashes. The retained fixture
PDF SHA-256 is `58bba95b048d207a012be45bdfaf77c7876e6d7504279cca23f2b0c919a11c45`.

## Readiness boundary

This is source and native local integration/file evidence with controlled fixture
settlement/storage. It proves neither provider sandbox settlement, live Supabase,
Notifications delivery nor production deployment. GM-W5 and SPEC-08/09 remain
outstanding; other RV tasks retain their existing target-specific evidence/status.
Existing SPEC-01–05 audit history
and owner-created untracked merge evidence remain preserved.
