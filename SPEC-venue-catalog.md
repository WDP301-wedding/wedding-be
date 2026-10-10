# Specification: Venue Catalog

> Current amendment: [confirmed backend scope](./docs/backend-scope-2026-10-10.md) and [commercial extensions](./SPEC-commercial-contracts.md). Completed implementation evidence below is historical; new names/catalog/contract/invoice rules are separate backend extension tasks. The 2026-10-10 amendment governs conflicts with older access, pricing and client requirements.

- Status: **Approved by project owner on 2026-10-05**
- Module ID: `venue-catalog`
- Requirement ownership: SEA-001 and SEA-002
- Depends on: `core-platform`, `identity-access`
- Consumers: `booking-lifecycle`, `seating-plan`, `analytics-dashboard`

## 1. Objective

Deliver the authoritative catalog for the single restaurant: restaurant profile,
`LUNCH`/`DINNER` shifts, halls, dishes, versioned menu packages and prices, catalog
media, reusable wedding-timeline templates, and versioned fixed seating-layout
templates.

Managers maintain the catalog through Management Web. Public and authenticated
clients may read only active, published catalog content appropriate to their flow.
Later modules consume provider-owned immutable versions or explicit snapshots instead
of copying catalog rules or reading catalog tables directly.

The module must satisfy SEA-001 and SEA-002: every layout belongs to one hall, declares
an explicit supported guest-count range, owns fixed restaurant-defined geometry, and
exposes stable table identifiers that Couple contracts cannot create, move, remove, or
resize.

## 2. Requirement Trace

| Requirement | Owned outcome                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEA-001     | A Manager creates and publishes a layout template version for one active hall with an explicit positive minimum and maximum guest count validated against hall and table capacity. |
| SEA-002     | A published layout version owns immutable geometry and stable restaurant-defined table IDs; no Couple-facing or public contract can mutate geometry, tables, or capacity.          |

SEA-003 through SEA-008 remain owned by `seating-plan`. That module consumes exact
published layout version IDs and table IDs, filters compatibility using the supplied
range, and stores guest-group labels without changing catalog geometry.

## 3. Scope

### 3.1 Included

- The singleton restaurant profile and approved public business contact fields.
- Exactly two restaurant shift codes, `LUNCH` and `DINNER`, with configurable local
  service windows and active state.
- Hall creation, ordering, active/retired lifecycle, maximum guest capacity, and media.
- Dish creation, ordering, active/retired lifecycle, optional standalone/add-on price,
  and media.
- Stable menu-package identities with immutable published versions, ordered dish
  versions, and per-table VND pricing.
- Stable timeline-template identities with immutable published versions and ordered
  relative schedule items.
- Stable layout-template identities with immutable published versions, supported
  guest-count ranges, normalized canvas geometry, and stable table identities.
- Manager-only draft, publish, supersede, and retire workflows.
- Public/current catalog reads, internal current-selection reads, and historical reads
  by an already-stored exact version ID.
- Catalog media upload through the existing private Storage provider and short-lived
  signed read URLs.
- Deterministic seed data for local development and the final demo journey.
- Audit evidence, low-cardinality metrics, OpenAPI contracts, and generated
  Management Web client types.

### 3.2 Excluded

- Availability, slot holds, consultations, bookings, quotations, discounts, taxes,
  deposits, invoices, refunds, or final booking-price calculation.
- Timeline proposal revisions, approvals, deposit eligibility, or post-deposit change
  requests; `booking-lifecycle` owns them.
- Layout selection, expected-headcount compatibility decisions, Manager capacity
  exceptions, guest groups, table labels, or plan confirmation; `seating-plan` owns
  them.
- Per-household, per-guest, per-seat, or table-reservation assignments.
- Couple, Staff, Guest, or public catalog mutation.
- User-authored arbitrary HTML, external image URLs, SVG uploads, video, 3D room
  models, CAD editing, or automatic layout generation.
- Multiple restaurants, branches, tenants, dynamically created shift codes, or an
  external inventory/menu provider.
- Destructive deletion of published or referenced catalog history.

## 4. Inherited Decisions

- The system serves exactly one restaurant; catalog records have no `tenantId`.
- `wedding-be` is the only business-rule and persistence authority. Clients consume
  generated REST contracts and never query PostgreSQL or Supabase directly.
- Manager authorization is rebuilt from current identity state. A client-supplied role
  or hidden control is never authority.
- All persisted IDs are UUIDs. Instants are UTC; shift windows are restaurant-local
  wall-clock values interpreted in `Asia/Ho_Chi_Minh`.
- Money is integer VND in APIs and `Decimal(18,0)` in PostgreSQL. Floating-point money
  values are forbidden.
- External inputs use strict Zod schemas; errors use the existing
  `{ error: { code, message, details?, requestId } }` envelope.
- List endpoints use bounded cursor pagination and deterministic secondary ordering.
- Storage remains private. The backend stores object keys and returns short-lived
  signed URLs; it never persists signed URLs or accepts caller-chosen object paths.
- Public catalog text is rendered as text. It is never treated as trusted HTML.

## 5. Approved Decisions

| ID    | Proposed decision                                                                                                                                                                                                                                               | Reason / consequence                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| VC-D1 | Restaurant profile, shifts, and halls are mutable audited records with optimistic concurrency. Downstream commercial records must store an explicit snapshot when created.                                                                                      | Avoids versioning every administrative field while preserving historical booking meaning.                                        |
| VC-D2 | Dishes use stable identities and immutable published versions. Menu-package versions reference exact dish-version IDs and store `priceVndPerTable`; an optional dish `priceVnd` is informational for standalone/add-on display only.                            | A renamed or repriced dish cannot silently alter an already published package or historical booking.                             |
| VC-D3 | Menu, timeline, and layout templates each have one stable aggregate ID, at most one editable draft, and immutable numbered published versions. Publishing a new version atomically supersedes the prior current version without deleting it.                    | Provides a single current choice while preserving every exact version already referenced.                                        |
| VC-D4 | Every layout version has explicit `minGuests` and `maxGuests`; `1 <= minGuests <= maxGuests <= min(hall.maxGuests, sum(table.seatCapacity))`. There is no hidden global default range.                                                                          | Resolves the deferred range policy using observable restaurant capacity rather than an arbitrary number.                         |
| VC-D5 | A table UUID belongs to the stable layout template, not to one revision. A Manager may change its geometry only in a new draft version; removing it retires that identity for future versions, and the UUID is never reassigned to another table.               | Lets `seating-plan` and printable snapshots retain meaningful table references while allowing restaurant-owned layout evolution. |
| VC-D6 | Retirement is non-destructive. It blocks new selection and public/current lists but exact historical version reads remain available to authorized owning modules. A retired aggregate may be restored only by a Manager when no conflicting replacement exists. | Prevents broken bookings, seating plans, reports, and printable revisions.                                                       |
| VC-D7 | Only `MANAGER` may create, edit, publish, restore, retire, upload, attach, or reorder catalog content. `STAFF`, Couple, restricted prospects, and public users receive no mutation route. Public reads expose only active published presentation data.          | Makes restaurant ownership and the SEA-002 mutation boundary explicit.                                                           |
| VC-D8 | Catalog images extend the existing Storage allowlist with `VENUE_CATALOG_MEDIA`, use the same private bucket and validation baseline, and are read via short-lived signed URLs. No bucket becomes public.                                                       | Reuses the approved provider boundary without weakening the core storage policy.                                                 |
| VC-D9 | Draft writes require an `expectedRevision` compare-and-swap value. Creates, publishes, retires, restores, and media attachment changes require the existing `Idempotency-Key`; conflicting payload reuse fails.                                                 | Prevents stale Manager tabs and retries from overwriting drafts or publishing duplicate versions.                                |

Any change to version immutability, price units, capacity validation, stable table
identity, historical resolution, storage visibility, or Manager-only mutation requires
project-owner approval because later modules depend on those contracts.

## 6. Architecture and Dependency Direction

```text
Public Web / Management Web
            |
            | HTTPS + generated OpenAPI types
            v
    venue-catalog HTTP boundary
            |
   services + catalog policies
      /            |            \
PostgreSQL    AuditService    StorageProvider

booking-lifecycle ---> VenueCatalogReader (owned here)
seating-plan     ---> VenueCatalogReader (owned here)
analytics        ---> catalog read model (owned here)
```

Dependencies always point from later modules to `venue-catalog`. This module uses the
identity-owned `AuthenticatedActor`/role middleware but never imports consultation,
booking, guest, seating, payment, or reporting tables.

Future database foreign keys from consumer records to catalog versions may be added by
the consumer migration after both tables exist. Policy ownership and the provider
contract remain here.

## 7. Trust Boundaries and Required Abuse Cases

### 7.1 Protected assets

- Authoritative hall capacity, shift windows, prices, and current published versions.
- Draft and historical catalog versions not intended for public discovery.
- Layout geometry, stable table IDs, and supported capacity ranges.
- Storage object keys, upload metadata, and audit evidence.
- Version IDs and snapshots consumed by booking and seating modules.

### 7.2 Untrusted inputs

- Every public or authenticated path, query, header, JSON body, and file upload.
- Manager-supplied names, descriptions, prices, ordering, times, and geometry.
- Stale Management Web state and duplicated/retried mutations.
- Client-supplied role, lifecycle state, version number, aggregate/version linkage, or
  storage object reference.
- Supabase Storage responses and generated signed URLs.

### 7.3 Required behavior

| Threat                | Required behavior                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role forgery or IDOR  | Reload the actor and target aggregate; deny non-Manager writes and mismatched aggregate/version IDs.                                                    |
| Stale overwrite       | Compare `expectedRevision`; return `409 CATALOG_REVISION_CONFLICT` without partial mutation.                                                            |
| Duplicate publish     | Atomically claim idempotency, assign one next version number, and expose one current version.                                                           |
| Invalid pricing       | Reject negative, fractional, overflow, or client-computed totals; persist only integer VND fields.                                                      |
| Geometry abuse        | Bound table count, JSON size, coordinates, dimensions, rotation, labels, and seat capacities; reject overlap only if a future approved rule defines it. |
| Capacity deception    | Recompute total seats server-side and reject a range above table or hall capacity.                                                                      |
| Historical breakage   | Never hard-delete a published/referenced version or reuse a stable table ID.                                                                            |
| Draft leakage         | Public/current endpoints never serialize drafts, superseded versions, object keys, audit metadata, or Manager identity.                                 |
| Upload abuse          | Verify bytes and MIME, generate object keys, bind purpose/resource, and reject arbitrary URLs, paths, SVG, and oversized files.                         |
| Stored script content | Enforce bounded plain text; clients escape output and no catalog field accepts HTML.                                                                    |

## 8. Domain Model

### 8.1 Restaurant, shifts, and halls

- `RestaurantProfile` is a singleton containing display name, description, address,
  approved public phone/email, and current media ordering. Time zone and currency are
  fixed by the platform rather than Manager input.
- `RestaurantShift` has stable code `LUNCH` or `DINNER`, local `startTime`, local
  `endTime`, active state, and revision. A window must be same-day and start before it
  ends. A code is never deleted or renamed.
- `Hall` has a stable ID, unique normalized name among active halls, description,
  positive `maxGuests`, display order, media ordering, lifecycle, and revision.
- Lowering hall capacity is rejected while a current published layout exceeds the new
  limit. The Manager must publish compatible layout versions first.
- Restoring a hall revalidates name uniqueness. Retiring a hall also removes its
  layouts from new-selection queries but does not mutate their historical versions.

### 8.2 Dishes and menu packages

- `Dish` is a stable identity with lifecycle, current published version, optional
  draft, and display order.
- `DishVersion` contains version number, name, description, category label, optional
  integer `priceVnd`, media references, state, author, and timestamps.
- `MenuPackage` is a stable identity with lifecycle, current published version, and
  optional draft.
- `MenuPackageVersion` contains version number, name, description, positive integer
  `priceVndPerTable`, ordered unique `dishVersionId` items, media references, state,
  author, and timestamps.
- Publishing a package requires every referenced dish version to exist and be
  published. A later dish retirement does not alter the package version.
- Booking may select only current published active versions. Once selected, the
  consumer stores the exact package version ID and an owned commercial snapshot.

### 8.3 Timeline templates

- `TimelineTemplate` is a stable identity with lifecycle, current published version,
  and optional draft.
- `TimelineTemplateVersion` contains version number, name, description, ordered items,
  state, author, and timestamps.
- An item contains a version-local UUID, non-negative `offsetMinutes` from the chosen
  event shift start, title, optional description, optional positive duration, and
  explicit order.
- Publishing validates bounded item count, unique item IDs/order, valid text, and
  deterministic order. Exact bounds are configuration-free schema constants committed
  with tests, not environment values.
- `booking-lifecycle` may copy one exact published version into a new editable timeline
  proposal. The copy no longer follows future template publications.

### 8.4 Layout templates and stable tables

- `LayoutTemplate` is a stable identity for one hall with lifecycle, current published
  version, optional draft, and a registry of stable table identities.
- A template cannot move to another hall. A Manager creates another template instead.
- `LayoutTableIdentity` contains a UUID, template ID, creation metadata, and optional
  retirement metadata. A UUID never belongs to two templates and is never recycled.
- `LayoutTemplateVersion` contains version number, `minGuests`, `maxGuests`, immutable
  ordered geometry on the fixed normalized canvas, state, author, and timestamps.
- Each geometry entry references one non-retired table identity and contains a bounded
  plain-text label, shape (`ROUND` or `RECTANGLE`), positive `seatCapacity`, integer
  `x`, `y`, `width`, `height`, `rotationDegrees`, and display order.
- Canvas coordinates use integers from `0` through `10000` so rendering is independent
  of screen pixels. Width and height are positive and each table's bounding box must
  remain inside the canvas. Rotation is an integer from `0` through `359`.
- Publishing recomputes total seat capacity and enforces VC-D4. Geometry overlap is
  allowed because the approved product requirements do not define collision rules;
  Management Web shows the resulting fixed arrangement for human review.
- Published geometry, ranges, and table membership cannot be patched. A Manager
  creates the next draft version. Couple contracts receive read-only version/table
  identities and cannot submit geometry fields.

### 8.5 Media assets

- `CatalogMediaAsset` stores resource type/ID, generated object key, checksum, verified
  MIME, byte size, alternative text, display order, author, and lifecycle timestamps.
- Allowed files remain JPEG, PNG, and WebP under the existing 25 MiB object limit.
- Public/current responses may include a short-lived signed URL and safe metadata, but
  never the object key, bucket, checksum, uploader, or provider response.
- Replacing media creates/attaches a new asset before detaching the old one. Storage
  deletion runs only after database commit and only when no draft or published record
  references the object.

## 9. Version and Lifecycle State Machines

### 9.1 Versioned aggregate

```text
create aggregate -> DRAFT v1
DRAFT --publish--> PUBLISHED (current)
PUBLISHED --create next draft--> PUBLISHED + DRAFT vN+1
DRAFT vN+1 --publish--> prior SUPERSEDED + vN+1 PUBLISHED (current)
```

- At most one draft and one current published version exist per aggregate.
- Draft content may change only through compare-and-swap writes.
- Publishing is one PostgreSQL transaction: validate dependencies, claim the next
  version, freeze content, supersede the prior current version, update the aggregate
  pointer, and append an audit record.
- `SUPERSEDED` is terminal. To reuse old content, a Manager clones it into a new draft
  with a new version ID/number.
- Published and superseded rows are immutable, including authorship and timestamps.

### 9.2 Aggregate lifecycle

```text
ACTIVE --retire--> RETIRED
RETIRED --restore with revalidation--> ACTIVE
```

- Retirement blocks new selection and removes the aggregate from public/current
  lists; it does not change version states or stored references.
- Drafts may be abandoned before publication. Abandonment does not remove a published
  version and must not reuse draft/version or table IDs.
- An aggregate with no published version is Manager-visible only.
- No HTTP `DELETE` exists for halls, dishes, packages, timeline templates, layout
  templates, published versions, or stable table identities.

## 10. Authorization Contract

| Capability                                     | Public / restricted prospect               | Couple                                     | Staff                                | Manager        | Internal owning module   |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------ | -------------- | ------------------------ |
| Read public active catalog                     | Allow                                      | Allow                                      | Allow                                | Allow          | Allow                    |
| Read Manager drafts/history                    | Deny                                       | Deny                                       | Deny                                 | Allow          | Deny                     |
| Mutate restaurant/shift/hall/dish/menu         | Deny                                       | Deny                                       | Deny                                 | Allow          | Deny                     |
| Mutate timeline/layout draft geometry or range | Deny                                       | Deny                                       | Deny                                 | Allow          | Deny                     |
| Resolve an exact stored historical version     | Deny unless exposed by its owning resource | Deny unless exposed by its owning resource | Deny unless operationally authorized | Allow          | Allow through typed port |
| Attach guest-group labels to tables            | Not owned here                             | Not owned here                             | Not owned here                       | Not owned here | `seating-plan` only      |

The provider contract separates current selection from historical resolution so a
consumer cannot accidentally offer retired content for a new booking:

```typescript
interface VenueCatalogReader {
  requireActiveHallSnapshot(hallId: string): Promise<HallSnapshot>;
  requireActiveShiftSnapshot(code: 'LUNCH' | 'DINNER'): Promise<ShiftSnapshot>;
  requireCurrentMenuPackageVersion(menuPackageId: string): Promise<MenuPackageSnapshot>;
  requireCurrentTimelineTemplateVersion(templateId: string): Promise<TimelineTemplateSnapshot>;
  listCurrentLayoutVersionsForHall(hallId: string): Promise<readonly LayoutVersion[]>;
  resolveMenuPackageVersion(versionId: string): Promise<MenuPackageSnapshot>;
  resolveTimelineTemplateVersion(versionId: string): Promise<TimelineTemplateSnapshot>;
  resolveLayoutTemplateVersion(versionId: string): Promise<LayoutVersion>;
}
```

The three `resolve*` operations accept only exact version IDs already stored by an
owning module. They do not mark content selectable and are not exposed as arbitrary
Couple/public history-browsing endpoints.

## 11. Draft HTTP Contract

All routes live under `/api/v1`, use strict schemas, stable error codes, the common
request ID, and deterministic cursor pagination. Read responses use ETags where useful;
draft mutations use explicit `expectedRevision` rather than last-write-wins.

### 11.1 Public/current reads

| Method and path                                                                          | Authentication | Contract summary                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `GET /catalog/restaurant`                                                                | Public         | Active restaurant profile, active shifts, safe business contacts, and signed current media URLs. |
| `GET /catalog/halls`                                                                     | Public         | Cursor page of active halls with capacity and current media.                                     |
| `GET /catalog/halls/{hallId}`                                                            | Public         | One active hall or concealed `404`.                                                              |
| `GET /catalog/dishes`                                                                    | Public         | Cursor page of active current dish versions with bounded filters.                                |
| `GET /catalog/menu-packages`                                                             | Public         | Cursor page of active current menu versions, dish summaries, and per-table price.                |
| Timeline and layout templates have no direct public, prospect, Couple, or Staff catalog  |
| route. `booking-lifecycle` and `seating-plan` obtain them through the typed provider and |
| expose only the read models authorized by those modules.                                 |

### 11.2 Manager administration

| Method and path                                                                                         | Contract summary                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PATCH /management/catalog/restaurant`                                                                  | Update singleton profile with expected revision.                   |
| `PATCH /management/catalog/shifts/{shiftCode}`                                                          | Update/activate/retire one fixed shift code.                       |
| `POST /management/catalog/halls` / `PATCH .../{hallId}`                                                 | Create or update a hall.                                           |
| `POST /management/catalog/halls/{hallId}/retirement` / `.../restoration`                                | Change hall lifecycle without deletion.                            |
| `POST /management/catalog/dishes` / `POST .../{dishId}/versions`                                        | Create a dish/draft or next immutable version draft.               |
| `PATCH /management/catalog/dish-versions/{versionId}` / `POST .../{versionId}/publication`              | Edit or publish a dish draft.                                      |
| `POST /management/catalog/menu-packages` / `POST .../{packageId}/versions`                              | Create a package/draft or next draft.                              |
| `PATCH /management/catalog/menu-package-versions/{versionId}` / `POST .../{versionId}/publication`      | Edit or publish package content and price.                         |
| `POST /management/catalog/timeline-templates` / `POST .../{templateId}/versions`                        | Create a timeline template/draft or next draft.                    |
| `PATCH /management/catalog/timeline-template-versions/{versionId}` / `POST .../{versionId}/publication` | Edit or publish timeline items.                                    |
| `GET /management/catalog/timeline-templates` / `GET .../{templateId}`                                   | List/detail current, draft, superseded, and retired timeline data. |
| `POST /management/catalog/layout-templates` / `POST .../{templateId}/versions`                          | Create a hall-bound layout/draft or next draft.                    |
| `PATCH /management/catalog/layout-template-versions/{versionId}` / `POST .../{versionId}/publication`   | Edit or publish fixed geometry and capacity range.                 |
| `GET /management/catalog/layout-templates` / `GET .../{templateId}`                                     | List/detail current, draft, superseded, and retired layout data.   |
| `POST /management/catalog/dishes/{dishId}/retirement` / `.../restoration`                               | Retire or restore a dish aggregate.                                |
| `POST /management/catalog/menu-packages/{packageId}/retirement` / `.../restoration`                     | Retire or restore a menu-package aggregate.                        |
| `POST /management/catalog/timeline-templates/{templateId}/retirement` / `.../restoration`               | Retire or restore a timeline-template aggregate.                   |
| `POST /management/catalog/layout-templates/{templateId}/retirement` / `.../restoration`                 | Retire or restore a layout-template aggregate.                     |
| `POST /management/catalog/media-assets`                                                                 | Upload and validate one catalog image for an allowlisted resource. |
| `PATCH /management/catalog/{resource}/{resourceId}/media-order`                                         | Attach/reorder validated media using expected revision.            |

Manager list/detail endpoints under `/management/catalog/...` include drafts,
superseded versions, lifecycle state, and revision metadata. They never include raw
object keys or unrestricted provider data.

All state-changing `POST` operations require `Idempotency-Key`. A key reused with a
different canonical request hash returns `422 IDEMPOTENCY_KEY_REUSED`; an in-flight
duplicate returns `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`. Validation, authorization,
not-found, stale revision, invalid transition, and dependency conflicts keep stable
machine-readable codes.

## 12. Historical Reference Preservation

- Consumer records store stable aggregate IDs plus exact immutable version IDs where a
  versioned entity is selected.
- `booking-lifecycle` snapshots mutable hall/shift fields and menu commercial fields
  into its own revision when they become part of a proposal or booking.
- A timeline created from a template records `sourceTimelineTemplateVersionId` and
  copies its items. Later template changes never rewrite that timeline.
- `seating-plan` stores `layoutTemplateVersionId` and table IDs. It may attach group
  labels but cannot submit or persist replacement geometry through this module.
- Analytics may join stable IDs for grouping, but historical reports use consumer
  snapshots/version rows rather than current display values when meaning would change.
- Published/superseded versions and stable table identities are retained while any
  consumer can reference them. Automated deletion is out of scope.

## 13. Configuration and Seed Contract

No new secret or external provider is introduced. Storage continues to use the
existing Supabase configuration and private bucket. Catalog validation bounds are
committed schema constants with tests; environment variables do not silently change
business meaning between environments.

The deterministic development/demo seed is idempotent by stable seed keys and includes:

- one restaurant profile with both active shift codes;
- at least two halls with different maximum capacities;
- enough published dish versions for at least two published menu-package versions;
- at least one published timeline template;
- at least two published layout templates for one hall with non-identical capacity
  ranges and stable table UUIDs;
- one retired catalog record proving historical resolution and current-list exclusion.

Seed commands never run automatically in production and never overwrite Manager-edited
records with matching stable IDs.

## 14. Project Structure

```text
wedding-be/
├── prisma/                                      # catalog schema and forward migration
├── scripts/                                     # explicit idempotent catalog seed entry
├── src/modules/venue-catalog/
│   ├── application/                             # commands, queries, provider contract
│   ├── domain/                                  # lifecycle, versions, capacity, geometry
│   ├── infrastructure/                          # Prisma repositories and media adapter
│   └── http/                                    # strict Zod/OpenAPI schemas and router
└── tests/integration/venue-catalog/              # PostgreSQL, HTTP, race, and auth tests

wedding-manage-web/
├── app/(manager)/catalog/                       # thin Manager routes
└── src/features/venue-catalog/                  # forms, lists, version/history, layout editor
```

Route files remain thin. Domain code does not import Express, Prisma-generated input
types, React, Next.js, or Supabase SDK payloads.

## 15. Code and Contract Style

- Strict TypeScript, ESM, kebab-case filenames, PascalCase types, camelCase values.
- Inputs and outputs are separate types; IDs for hall, dish, package, template,
  version, media, and table are not interchangeable.
- Lifecycle transitions are explicit commands and conditional writes, not arbitrary
  enum updates.
- Immutable version outputs use readonly arrays/objects and deterministic ordering.
- New API fields are additive. Breaking changes require a separately approved version
  plan.
- Presentation text is normalized for uniqueness where required but original display
  text is preserved. Search normalization does not become an authorization decision.

## 16. Testing Strategy

### 16.1 Unit and mutation-sensitive tests

- Shift window, VND price, text, ordering, version, lifecycle, and state-transition
  guards cover every boundary and invalid transition.
- Layout tests cover VC-D4, canvas bounds, stable table ownership, unique table IDs,
  retired table reuse, table count/seat totals, and immutable published geometry.
- Package tests prove exact dish-version references and per-table pricing cannot drift.
- Timeline tests prove deterministic ordering and immutable published items.
- Authorization tables fail if any non-Manager mutation permission is inverted.

### 16.2 PostgreSQL integration and concurrency tests

- Empty-database migration and rollback-free forward deployment succeed.
- Unique normalized active hall names, one draft/current version, aggregate/version
  ownership, version numbers, and table identities are enforced in PostgreSQL.
- Two concurrent publishes produce one next current version; the loser receives a
  stable conflict without a partial supersession.
- Stale draft updates and capacity-lowering races cannot bypass current layouts.
- Retirement racing a new consumer selection has one serialized result; already stored
  exact version references remain resolvable.
- Media replacement failure cleans up an unreferenced object without deleting the
  prior valid asset.

### 16.3 Contract and Management Web tests

- OpenAPI documents pagination, errors, idempotency, expected revisions, lifecycle,
  prices, version IDs, capacity ranges, and read-only geometry.
- Generated backend and Management Web schemas remain deterministic and identical.
- Public/current endpoints exclude drafts, retired aggregates, history metadata,
  object keys, and Manager identity.
- Direct HTTP tests deny Staff, Couple, restricted prospect, unauthenticated, and forged
  role mutation attempts.
- Management Web tests cover list/create/edit/publish/retire flows, stale conflicts,
  integer VND display/input, accessible keyboard editing, responsive layout preview,
  and backend-denial handling.
- No Couple or public generated client operation contains a layout geometry mutation.

### 16.4 Requirement-to-test matrix

| Requirement | Planned automated evidence                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEA-001     | Manager create/publish HTTP tests; hall/range/table-capacity validation unit tests; PostgreSQL hall/version integrity and publish-race tests; Management Web range form test.              |
| SEA-002     | Stable table UUID and immutable publish tests; historical resolution after supersede/retire; direct non-Manager mutation denial; OpenAPI search proving no Couple geometry write contract. |

## 17. Privacy, Retention, and Audit

- Restaurant business name, address, public phone, and public email are deliberately
  public catalog fields. Personal contacts or private operational notes are not
  accepted by these schemas.
- Catalog text, prices, capacities, geometry, and public media contain no guest,
  Couple, credential, payment, or staff PII.
- Audit actions include create, draft update, publish, supersede, retire, restore,
  capacity change, price change, media attach/detach, and failed protected mutation.
- Audit metadata allowlists actor ID, aggregate/version IDs, action, result, and changed
  field names. It excludes descriptions, contact values, image bytes, signed URLs,
  object keys, and request bodies.
- Published/superseded catalog versions are durable business history and have no
  automatic deletion in this module. Abandoned drafts and unreferenced media may be
  cleaned only by a later approved retention job with dry-run evidence.

## 18. Observability

- Counters cover catalog mutation outcome, publish outcome, lifecycle outcome, media
  outcome, and authorization denial by stable reason.
- Histograms cover list/read, publish validation, and Storage provider duration using
  bounded route/provider labels.
- Metrics contain no actor/resource UUID, catalog name/text, contact value, object key,
  or signed URL.
- Logs use event name and request ID; bodies, geometry arrays, contact values, and
  provider payloads are not logged.

## 19. Commands and Verification

Backend focused commands:

```powershell
npm run db:generate
npm run db:migrate:deploy
npm run test:unit -- venue-catalog
npm run test:integration -- venue-catalog
npm run test:contract
npm run api:check
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run audit:ci
```

Management Web commands:

```powershell
npm run api:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run audit:ci
```

Migration acceptance uses a disposable PostgreSQL database and proves deployment from
an empty schema plus upgrade from the approved identity schema. Documentation changes
run Prettier and `git diff --check` before approval.

## 20. Boundaries

### Always

- Authorize every mutation as a current Manager on the backend.
- Use immutable exact versions for published menus, timelines, layouts, and dishes.
- Validate prices, capacity, geometry, text, uploads, aggregate/version linkage, and
  lifecycle transitions at the boundary and again through database constraints where
  possible.
- Preserve published/superseded versions and stable IDs used by later modules.
- Use optimistic concurrency, transactionally publish, and audit state-changing
  actions.
- Keep Storage private and return only short-lived signed reads.
- Test real non-Manager denials and concurrent publish/retirement paths.

### Ask first

- Change price units, supported shift codes, layout range rules, table-ID stability,
  version immutability, retirement behavior, or historical retention.
- Allow Staff, Couple, restricted prospects, Guests, or public users to mutate any
  catalog content.
- Add taxes, discounts, inventory, ingredient/allergen claims, arbitrary HTML, SVG,
  video, external URLs, automatic layout generation, or another provider.
- Make a Storage bucket public, change upload limits/types, or add a new data-retention
  job.
- Add destructive migrations or hard deletion of catalog history.

### Never

- Trust client role, price total, capacity total, version number, lifecycle state,
  object path, or aggregate/version relationship.
- Let Couple/public contracts create, move, resize, rotate, add, remove, or reidentify
  layout tables, or change `minGuests`/`maxGuests`.
- Assign invitation households or individual guests to tables/seats in this module.
- Mutate a published/superseded version in place, recycle a stable table ID, or silently
  redirect a historical version reference to the current version.
- Hard-delete a published/referenced hall, dish, package, template, version, table, or
  media object.
- Expose drafts, object keys, provider credentials, audit metadata, or unapproved
  contact data through public/current reads.

## 21. Success Criteria

1. SEA-001 and SEA-002 each map to explicit automated evidence and API contracts.
2. Restaurant, shift, hall, dish, menu-package, pricing, media, timeline-template, and
   layout-template scope is represented without importing booking or seating policy.
3. Published dish, menu, timeline, and layout versions are immutable and historical
   exact-version reads survive supersession and retirement.
4. Every layout belongs to one hall, declares a valid range, and passes server/database
   capacity checks against stable table geometry.
5. Table IDs remain stable across layout versions and cannot be recycled or mutated
   through Couple/public contracts.
6. Only current Managers can mutate catalog state; direct HTTP tests deny every other
   actor and forged UI state.
7. Public/current responses expose only active published presentation fields and safe
   signed media reads.
8. Booking and seating consumers use provider-owned typed contracts, exact version IDs,
   and snapshots without a dependency cycle.
9. Backend migrations, seeds, unit/integration/concurrency/contract suites, OpenAPI,
   coverage, lint, typecheck, build, and audit gates pass.
10. Management Web implements accessible, responsive catalog administration without
    owning business validation or authorizing itself.

## 22. Approval Record

The project owner approved VC-D1 through VC-D9 as written on 2026-10-05. This approval
authorizes creation of the detailed backend and Management Web implementation plan and
task list; it does not authorize implementation by itself.

SPEC-02 planning must:

1. append ordered vertical slices to `tasks/plan.md` and `tasks/todo.md`;
2. include forward migration, provider/domain rules, HTTP/OpenAPI, deterministic seed,
   Management Web, and final acceptance-audit tasks;
3. keep every implementation task within five human-authored files or split it;
4. add checkpoints for database/domain integrity, immutable API contract, and complete
   cross-repository acceptance evidence; and
5. require a second explicit project-owner approval before any `venue-catalog`
   implementation begins.

The project owner gave that second approval on 2026-10-05 for VC-01 through VC-23,
their dependency order, checkpoints V1 through V4, and the bounded constants in
`tasks/plan.md` Section 17.1. This completes SPEC-02 and Checkpoint V0 and authorizes
implementation in the recorded order; no implementation task has started as part of
the specification gate.

## 2026-10-10 Backend Extension

Add Manager-controlled versioned service catalogs and minimal print commercial offerings (SVC-001–004). Use current selection/historical-resolution ports, stable archived references and integer VND. The completed venue tasks remain historical; BE-03–05 are separate backend additions.

Authority and validation: [commercial specification](./SPEC-commercial-contracts.md),
[confirmed scope](./docs/backend-scope-2026-10-10.md) and
[active backend tasks](./tasks/backend-revision-todo.md). These requirements do not
claim that the pending extension is already mounted in the generated API.
