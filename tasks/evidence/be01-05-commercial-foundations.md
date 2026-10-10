# BE-01–05 commercial foundations evidence

Implementation/verification: 2026-10-10–11 (project/client timezone Asia/Saigon).
Target: local PostgreSQL on 127.0.0.1:55435; uniquely created test databases only.
No external provider requests, paid generation, real-money settlement, shared-data
mutations or frontend changes form part of this evidence.

## Implemented boundaries

BE-01 adds nullable intake/consultation names, strict normalized input schemas and
forward migration. BE-02 adds scoped read/update commands, expected consultation
revision, atomic audit, idempotency replay authorization, name-preserving intake
conversion and the existing retention policy's extra PII scrub.

BE-03/04 add stable restaurant services with immutable price/display revisions,
Manager create/revise/archive/list HTTP, active selection and historical provider
readers. BE-05 adds equivalent print commercial offerings and safe exact-version
Invitation template selection. Mounted runtime providers expose these owner ports.

See [handoff](../../docs/be01-05-commercial-foundations.md) for route inventory,
RBAC, DTO examples/errors, provider version v1 and rollout/rollback limitations.

## Verification records

- Focused profile/catalog normalization and checked arithmetic tests pass.
- Ten new disposable PostgreSQL tests pass: populated legacy upgrade without
  guessed names; scoped/revisioned/replay-safe profile updates; intake conversion
  and retention; service price/archive history and database immutability; concurrent
  service revision/RBAC/idempotency; safe print/template selection and archive;
  stale/concurrent print pricing with no production or Billing writes; partial
  names/granted Staff denial/profile races and audit rollback; paginated
  management/selection, strict commands, missing references and provider failure.
- Four existing Booking runtime tests (including the added BE-01–05 runtime
  journey) pass with real Identity sessions and actual owner composition. The
  additional journey creates a Manager-owned template through Invitation HTTP,
  reads prices before deposit and retains post-deposit editor/template denials.
- All 29 forward migrations deploy successfully to an empty temporary database.
  The new populated-upgrade fixture inserts a legacy consultation before the
  profile migration; both names remain null and its display label is preserved.
- Read-only Prisma schema diff against the migrated database matches the original
  26-migration/HEAD-schema baseline byte-for-byte after trimming. Existing baseline
  FK/default/partial-index/index-name differences are unchanged; no schema repair
  or database diff was applied.
- An actual overflow-guard mutation caused its arithmetic regression to fail.
  The source was restored byte-for-byte and both new domain suites were rerun.
- Full regression with real local PostgreSQL: **189 files / 1,512 tests pass**,
  zero failed/pending tests, runner exit 0. Command: `npm run test -- --coverage
  --pool=threads --maxWorkers=1 --testTimeout=20000 --hookTimeout=60000`.
  All test databases use the disposable local admin URL; the base quality database
  is also uniquely created/migrated and dropped in the harness's finally block.
- Full coverage: lines **97.30%** (7,839/8,056), branches **93.41%** (5,053/5,409),
  statements **96.52%**, functions **98.27%**. No file is below the existing 80%
  line/branch threshold; thresholds and test inventory were not relaxed.
- `npm run test:contract`: **10 files / 33 tests pass**.
- Final `npm run typecheck`, `npm run lint`, `npm run build`, `npm run api:check`,
  Prettier checks and `git diff --check` pass. API generation was also run;
  canonical SHA-256: `fcc54f3a842836e17ca056ca2ec81cec6172c28f79c3831477418c721e273184`.
- Final standalone template-provider callback typings/binding were rechecked in
  the real mounted BE runtime journey after the full run: one selected journey
  passes and the other three cases are deliberately excluded only from this
  focused rerun. All four ran and passed in the complete suite above. A fresh
  final-source coverage run of both runtime/commercial suites also passes:
  **14 tests / 2 files**, using forks and one worker. The template selection reader
  (including standalone callbacks) reaches **95.23% lines**, **91.66% branches**,
  **100% functions**, retaining the per-file thresholds. This supplements the full
  coverage snapshot collected before the last adapter callback adjustment.

The initial print fixture failed Invitation's existing deferred owner reference
guard because version/head writes were separate transactions. It was corrected to
use the owner's atomic version/head and monotonic-revision rules; no database
constraint or historical migration was weakened.

The first complete regression attempt exposed historical fixtures selecting the
new Prisma fields before the profile migration, a custom upgrade order placing
print foreign keys before Invitation tables, and old intake output fixtures
missing the new nullable fields. Those fixtures were corrected without removing
assertions or changing old migrations. Windows Node workers also exited natively
with code 3221226505; the unchanged payment HTTP suite passed all ten tests with
`--pool=threads`. Final full verification uses threads and one worker, retaining
all tests and the existing per-file 80% line/branch thresholds. Longer runner
deadlines accommodate local database setup; no production timeout was changed.
The supplemental two-suite threads coverage attempt also exited natively and is
not counted as a pass; its forks rerun above is the successful final-source proof.

## Implementation review

Authorization precedes private idempotency replay, and profile/catalog mutation,
revision and audit commit together. Catalog edits serialize on stable head rows;
readers pin exact source versions and checked totals. Historical revision writes
fail closed in PostgreSQL. Booking owns profile access, Venue owns commercial
facts, and Invitation exposes safe scalar template metadata through a read-only
port. Lists are cursor-bounded to 50 candidates; template checks are bounded by
that page size. No new dependency, media/Billing writer, foreign frontend change,
or orphaned implementation was introduced.

## Evidence separation

Implemented code: mounted real Booking/Venue/Invitation readers, commands, schemas
and persistence. Offline verification: local PostgreSQL, Identity sessions and
controlled application/provider tests. Configuration: external credentials were
not validated for this work. Live external integration/production readiness: no
claim; pending RV-04–21 remain in the active backlog. BE-06–17 still need exact
commercial approvals, deposit, Billing and invoice integration evidence.
