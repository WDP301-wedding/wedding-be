# BE-01–05: profile and commercial catalog hand-off

Backend implementation: 2026-10-10–11 (Asia/Saigon). Provider/operation version: `v1`.
Scope: [confirmed backend requirements](backend-scope-2026-10-10.md).
Verification: [acceptance evidence](../tasks/evidence/be01-05-commercial-foundations.md).

## Mounted HTTP and authorization

All paths below are relative to `/api/v1`. Every route is private, authenticated
with the existing Identity bearer session and returns `Cache-Control: no-store`.
Writes require `Idempotency-Key`. Catalog PATCH replaces the complete supplied
display/price facts; `active=false` archives without deleting history.

| Operation                                            | Actor                                                              | Result                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| GET /consultations/{consultationId}/couple-profile   | Owning Manager or account with RESTRICTED/FULL consultation access | Current display label, nullable bride/groom names and consultation revision |
| PATCH /consultations/{consultationId}/couple-profile | Same ownership; Staff-only accounts denied even with a grant       | Partial name update, expected consultation revision, atomic audit           |
| GET /catalog/services                                | Authenticated prospect, Couple or Manager                          | Active service facts                                                        |
| GET /management/services                             | Manager                                                            | Current catalog heads, including archived ones                              |
| POST /management/services                            | Manager                                                            | New stable service ID and immutable revision 1                              |
| PATCH /management/services/{id}                      | Manager                                                            | New revision with expectedRevision; price/edit/archive                      |
| GET /catalog/print-offerings                         | Authenticated prospect, Couple or Manager                          | Active print facts whose exact template is still active/current             |
| GET /management/print-offerings                      | Manager                                                            | Current heads, including archived/unselectable templates                    |
| POST /management/print-offerings                     | Manager                                                            | New offering and exact safe template facts                                  |
| PATCH /management/print-offerings/{id}               | Manager                                                            | New revision with expectedRevision; price/type/material/template/archive    |

Profile cross-scope and Staff reads/writes return concealed `404 NOT_FOUND`.
Scope is rechecked before idempotency replay. Catalog Staff-only reads and all
non-Manager catalog writes return `403 FORBIDDEN`. No anonymous commercial reads
are exposed. Existing public intake accepts optional brideName/groomName; Manager
intake reads return nullable names and conversion preserves them. The accepted
180-day intake retention operation scrubs these extra fields with other intake PII.
Existing consultation/booking ownership and historical records remain separate.

List queries: optional UUID `cursor`, integer `limit` 1–50 (default 20). Response:
`{data:{items:[...],nextCursor:uuid|null}}`. Print template filtering can yield an
empty page with a non-null cursor; continue until nextCursor is null.

## Strict schemas and examples

Names are trimmed and normalized to NFC before the 1–120 character check. Missing
names remain null in persistence; supplied empty strings/null are rejected. No
legacy display label is split into bride/groom roles. Profile PATCH needs at least
one name and a positive `expectedRevision`; omitted names are retained.

```json
{ "expectedRevision": 1, "brideName": "Lan", "groomName": "Minh" }
```

Service POST accepts exactly these fields:

```json
{
  "name": "MC",
  "description": "Dẫn chương trình",
  "unit": "buổi",
  "unitPriceVnd": 2500000,
  "active": true
}
```

The server returns `serviceId`, `sourceRevisionId`, `restaurantId`, `revision` and
the normalized facts. Name/unit limits are 120/80; description can be empty and is
limited to 2000. PATCH adds expectedRevision and supplies all the same fields.

Print POST accepts name (1–120), printType (1–80), material (1–120), templateId,
templateVersionId, integer unitPriceVnd and active. Use IDs from the approved
Invitation template catalog; selection never returns template design content.

```json
{
  "name": "Thiệp tiêu chuẩn",
  "printType": "Hai mặt",
  "material": "Giấy mỹ thuật",
  "templateId": "00000000-0000-4000-8000-000000000001",
  "templateVersionId": "00000000-0000-4000-8000-000000000002",
  "unitPriceVnd": 5000,
  "active": true
}
```

These IDs illustrate the schema and do not identify seeded runtime records. The
server returns offeringId/sourceRevisionId/restaurantId/revision, the facts,
frozen templateTitle and unit `copy`. PATCH also requires expectedRevision and
complete replacement facts. Archiving remains possible after a template is
archived or superseded; reactivation needs an active/current template selection.

Prices are safe nonnegative integer VND. Selection quantities are positive safe
integers. Clients cannot supply restaurant identity, source revision IDs, actor
authority or authoritative totals in catalog commands; strict Zod objects reject
unknown fields. `lineTotalVnd = unitPriceVnd * quantity` uses checked BigInt
arithmetic and refuses totals above Number.MAX_SAFE_INTEGER.

Errors use the existing requestId-bearing envelope: validation 422,
authentication 401, authorization 403/404, missing/invalid/reused idempotency
400/409, stale consultation `STALE_CONSULTATION_REVISION` 409, unselectable source
`OFFERING_NOT_SELECTABLE` 409 and changed price/template
`COMMERCIAL_PRICE_REVISION_STALE` 409. Expected revision is never inferred from a
displayed price. Updating a catalog cannot silently reprice a historical snapshot.

## Owner providers

- Booking `providers.coupleProfileReader.read(consultationId, actor)` returns an
  authorized current profile and consultation revision; no cross-booking lookup.
- Venue `providers.restaurantServices` exposes `requireSelection({serviceId,
sourceRevisionId,quantity})` and `resolveRevision(sourceRevisionId)`.
- Venue `providers.printOfferings` exposes `requireSelection({offeringId,
sourceRevisionId,quantity})` and `resolveRevision(sourceRevisionId)`.
- Invitation `providers.templateSelection` exposes `requireSelection({templateId,
templateVersionId})` and `resolveVersion(templateVersionId)`, returning only
  templateId/templateVersionId/revision/title. It performs catalog reads only and
  never calls Booking, Billing, Storage, media or design writers.

All returned fact objects are frozen scalar snapshots. Current selection checks
active exact versions; historical readers retain original facts after edit/archive.
Manager-only template heads marked active are the published selectable catalog;
inactive templates and old template versions cannot be newly selected. Referenced
template content remains protected by Invitation's existing immutable history.
Venue composes Invitation's reader inside its own database transaction; no runtime
dependency through Invitation -> Payments -> Booking is introduced.
Invitation's standalone provider opens its own transaction so the template lock
is retained until its exact-version facts have been read.

Selection readers serialize their own read against catalog edits. BE-06–09 must
enlist exact profile/catalog versions in commercial submission/approval/deposit
serialization; these price readers alone do not activate revised deposit semantics.
BE-05 creates no print production, extra receivable or second print charge.

## Migrations and rollback

New forward migrations: `20261010010000_couple_profile`,
`20261010020000_restaurant_services`, `20261010030000_print_commercial_offerings`.
The first adds nullable fields without backfill. Service/print revisions retain
stable source IDs, restaurant ownership, actor/time, checked prices, unique source
revision numbers and database triggers rejecting UPDATE/DELETE of history.
Referenced parents/template versions use restrictive foreign keys.

Deploy migrations before updated runtime code. Roll back application code or
disable the new routes if needed; retain these additive columns/tables and all
history. Any schema repair uses a new forward migration. No prior applied
migration is rewritten and no shared data is dropped during verification.

OpenAPI is generated from mounted schemas into `openapi/openapi.json` and checked
against `openapi/openapi.sha256`. Contract/deposit/appendix/invoice extensions
BE-06 onward and external-provider RV gates remain separate work.
