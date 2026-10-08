# Venue-catalog acceptance evidence

Audit date: 2026-10-06 (Asia/Saigon)

Scope: `wedding-be` FT-V1 through FT-V3 and `wedding-manage-web` FT-V4, VC-01
through VC-23

Status: **Passed at Checkpoint V4**

## Delivered contract and implementation

- The backend owns restaurant, shift, hall, dish/menu, timeline, fixed-layout, stable
  table identity, lifecycle, and private catalog-media authority. Public/current reads
  expose no draft, audit actor, object-key, or service-role fields.
- Manager mutations remain authenticated and authorized by the bearer session. The
  Management Web role presentation cannot manufacture authority and does not expose a
  Staff mutation path.
- Draft updates use server revisions. Published/superseded versions are immutable;
  cloning creates a separate draft. Integer VND values and layout totals are never
  calculated from floating-point client state.
- Layouts are hall-bound on a fixed `10000 x 10000` canvas. Numeric keyboard controls
  are the authoritative editor; there is no Couple geometry or per-guest seating
  operation.
- Catalog media is allowlisted to JPEG, PNG, and WebP with a 10 MB advisory client
  bound and authoritative backend validation. The UI stores only returned signed
  metadata, refreshes expiring URLs, and never renders an object key.

## SEA and decision trace

- **SEA-001:**
  `src/modules/venue-catalog/application/layout.service.test.ts` — “recomputes hall
  and seat bounds in the publication transaction”; and
  `tests/integration/venue-catalog/layout-behavior.test.ts` — “rejects a hall range
  above either current hall capacity or summed table seats”. The Management Web
  companion proof is
  `src/features/venue-catalog/layout-panel.test.tsx` — range/canvas validation blocks
  the API call and the editor displays hall maximum and current seat totals.
- **SEA-002:**
  `tests/integration/venue-catalog/layout-behavior.test.ts` — “publishes one winner,
  preserves exact history, and never reuses retired table IDs”; and
  `src/modules/venue-catalog/application/layout.service.test.ts` — stable IDs survive
  clone/history and retirement is irreversible. The Management Web companion proof
  preserves UUIDs during geometry edits and calls permanent retirement on removal.
- VC-D1 through VC-D9 still match the approved runtime behavior. Checkpoints V1 and
  V2 proved persistence/concurrency and service/provider boundaries; V3 proved the
  immutable HTTP/OpenAPI boundary. FT-V4 consumes only generated operations from that
  boundary.

## Contract lock

- Backend contract commit:
  `7b01f0b13c828a0caac719ae4a739c8d4e2a73b0`
- Generated artifact: `openapi/openapi.json`
- Current SHA-256:
  `caad010d6008cbfc8fc0748f49abad0c651e85ccda5cf008b60ac3f4e6fa3dc5`
- Management Web lock: `api-contract.lock.json`, generated client and schemas all
  report the same digest. The UI contract mark reads the lockfile digest rather than
  duplicating it as a hand-maintained string.
- V3 was initially frozen at digest
  `8aa21388cacb5d2ffa1cfd2cfb6ef5fa23b4964058a72143453bdc2b47215db8`.
  With explicit project-owner authorization, it was reopened only for the missing
  Manager restaurant/shift/hall reads and signed-media list read. Commits
  `6c48188c74d0b20d27f090629e15f01fda10d453` and
  `7b01f0b13c828a0caac719ae4a739c8d4e2a73b0` contain those additive operations.

## Automated verification

### Backend

| Gate | Result |
| --- | --- |
| Focused FT-V3 HTTP/query/runtime/media/contract tests | Pass, 5 files and 27 tests |
| Additive Manager-read HTTP/OpenAPI revalidation | Pass, 20 tests |
| Deterministic seed integration | Pass, 2 tests |
| Catalog persistence compatibility | Pass, 5 tests |
| Complete backend suite | Pass, 76 files and 688 tests with one worker |
| Complete per-file coverage | Pass, 688 tests |
| Coverage totals | 96.37% statements, 92.21% branches, 98.66% functions, 97.05% lines |
| Prisma Client generation | Pass, Prisma 7.10.0 |
| Empty-database migration deploy | Pass, all 3 migrations on disposable PostgreSQL 18 |
| OpenAPI generation/drift, lint, typecheck, build | Pass |
| Dependency audit | Pass with documented exceptions 1145093 and 1153173 |
| Diff, secret, internal-field, and prohibited-path scans | Pass |

The additive V3 reopening changed no schema, migration, seed, domain, repository, or
service behavior. The affected HTTP/OpenAPI tests plus lint, typecheck, build, and API
drift checks were rerun after the final contract commit. The earlier complete suite
and disposable database evidence therefore remain applicable without manufacturing a
second migration result.

### Management Web

| Gate | Result |
| --- | --- |
| Clean install | `npm ci --ignore-scripts` pass, 304 packages |
| Complete component/unit suite with coverage | Pass, 8 files and 40 tests |
| Coverage totals | 95.65% statements, 90.90% branches, 100% functions, 95.58% lines |
| Immutable API check | Pass, digest `caad010d…` |
| ESLint / Prettier / strict TypeScript | Pass |
| Production build | Pass; `/`, `/_not-found`, `/catalog`, and `/icon.svg` prerender |
| Dependency audit policy | Pass; 0 critical, 4 reviewed dev-only high findings |
| Diff and staged-secret scans | Pass |

The full coverage command used one worker and a 15-second per-test timeout because the
Windows jsdom environment was slow. It ran every test without exclusions. A deliberate
mutation inverted the 10 MB upload check; two upload tests failed before the condition
was restored, proving the validation path is test-sensitive.

Registry audit discovered the newly published
`GHSA-68fv-2mgg-jv7q` in transitive `source-map-js@1.2.1`. The lockfile now resolves
`source-map-js@1.2.2`, the patched release. The remaining four High reports are the
existing `GHSA-vfj7-8cjw-p6xm` dev-only exception, graph-locked and expiring on
2026-10-15; no exception was added for the new advisory.

## Browser, accessibility, and security review

- Playwright exercised the Manager catalog against a local contract-shaped mock at
  desktop and `390 x 844` mobile viewports. All observed API requests returned 200;
  controls were named in the accessibility snapshot and keyboard alternatives were
  present for timeline, layout, and media ordering.
- The audit found and fixed mobile horizontal overflow. Final DOM measurement reported
  `horizontalOverflow: false` (`scrollWidth 375` at `innerWidth 390`).
- The audit also found one unhandled signed-URL refresh rejection after the mock
  session expired. The timer now catches the rejection and reports a recoverable panel
  error. Resource selection now keys by `resource path + UUID`, with a regression test
  proving equal UUIDs in different resource kinds remain distinct.
- Trust boundaries reviewed: Manager session token, generated API operations, file
  uploads, storage-provider responses, and signed URL expiry. Assets are Manager
  authority, catalog history, stable table identities, and private Storage metadata.
  Backend authorization, allowlisted upload validation, React output escaping,
  bounded inputs, signed read metadata, and generic recoverable errors remain in
  place.
- Generated and rendered artifacts were inspected for object keys, actor/account audit
  fields, service-role secrets, Couple geometry mutations, and per-guest seating. None
  were present. Temporary mock servers, logs, screenshots, and Playwright session
  artifacts were removed before commit.

## Review commits and verdict

- Management Web acceptance-hardening commit:
  `f54851c11a4e273561af9427ce5504d93c7bd28b`
- Prior FT-V4 feature commits: `0dcc51c` (VC-18), `e276920` (VC-19), `7576276`
  (VC-20), `564999d` (VC-21), and `a0dd230` (VC-22).

VC-01 through VC-23 are implemented and verified. The backend contract and Management
Web worktrees contain only intended committed artifacts. On 2026-10-06, the project
owner explicitly approved the implementation with “tôi phê duyệt implementation.”
Checkpoint V4 is green; SPEC-03 may begin under the approved fast-track protocol and
`WEDDING-CONTRACT-1@1.0.0`.
