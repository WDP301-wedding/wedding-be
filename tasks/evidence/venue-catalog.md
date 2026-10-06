# Venue-catalog acceptance evidence

Audit date: 2026-10-06 (Asia/Saigon)

Scope: `wedding-be` FT-V3, VC-11 through VC-17

Status: **Passed at Checkpoint V3**

## Delivered contract

- Public/current restaurant, shift, hall, dish, and menu-package reads expose active
  catalog data, signed media, cursor metadata, and integer VND values without draft,
  revision, actor, audit, or Storage internals.
- Manager-only routes cover restaurant/shift/hall administration; dish, menu,
  timeline, and fixed-layout aggregate history; draft clone/edit/publish; explicit
  retirement/restoration; stable table identity; and media upload/replacement/order.
- Every mutation uses strict request schemas. POST operations use the established
  atomic idempotency middleware, mutable writes use expected revisions, version owners
  are resolved server-side, and Manager authorization is derived from the current
  bearer session rather than caller-supplied role or aggregate data.
- Multipart catalog media is memory-bounded, MIME/size/field constrained, scoped to an
  allowlisted catalog resource, and serialized only as signed read metadata.
- `npm run catalog:seed` creates deterministic restaurant, shift, hall, published and
  retired dish/menu, timeline, layout, and stable-table fixtures. It is disabled in
  production, is idempotent for unchanged fixtures, and rejects Manager-edited stable
  seed records instead of overwriting them.

## Automated verification

| Gate | Result |
| --- | --- |
| Focused FT-V3 HTTP/query/runtime/media/contract tests | Pass, 5 files and 27 tests |
| Deterministic seed integration | Pass, 2 tests |
| Catalog persistence compatibility | Pass, 5 tests |
| Complete backend suite | Pass, 76 files and 688 tests with one worker |
| Complete per-file coverage | Pass, 688 tests |
| Coverage totals | 96.37% statements, 92.21% branches, 98.66% functions, 97.05% lines |
| Prisma Client generation | Pass, Prisma 7.10.0 |
| Empty-database migration deploy | Pass, all 3 migrations on disposable PostgreSQL 18 |
| OpenAPI generation and drift | Pass |
| ESLint / Prettier / strict typecheck / production build | Pass |
| Dependency audit | Pass with documented exceptions 1145093 and 1153173 |
| Diff, secret, internal-field, and prohibited-path scans | Pass |

The full suite was serialized because concurrent Windows workers caused database-pool
teardown timeouts after otherwise passing assertions. The one-worker run completed all
assertions and teardown hooks without suppressing or excluding any test. PostgreSQL 18
returns SQLSTATE `23001` for the migration's `ON DELETE RESTRICT`, while PostgreSQL 17
returned `23503`; the compatibility assertion accepts only those two integrity errors
for the same protected-delete behavior.

During the final audit, npm published advisory 1241209 for transitive
`source-map-js@1.2.1`. The lockfile was upgraded to `source-map-js@1.2.2`, removing the
advisory; no new audit exception was added.

## Contract lock and review

- Generated artifact: `openapi/openapi.json`
- SHA-256 digest:
  `8aa21388cacb5d2ffa1cfd2cfb6ef5fa23b4964058a72143453bdc2b47215db8`
- Every operation response now has a concrete schema for public reads, pagination,
  Manager aggregate history, publication/lifecycle results, fixed geometry, stable
  table IDs, and signed media; the contract does not fall back to `data: unknown`.
- Artifact scans found no object key, actor/account audit field, service-role secret,
  public timeline/layout mutation, per-guest seating, or guest-assignment route.
- Management Web work remains gated on locking this exact digest and the final backend
  commit that contains it.

## Verdict

VC-11 through VC-17 are implemented and verified. Checkpoint V3 is green, and FT-V4
may begin only after the downstream Management Web contract lock references this
artifact digest and backend commit.
