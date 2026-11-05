# Seating drag/confirmation 409 — 2026-11-05

## Diagnosis

Read-only Render application logs from service `srv-dbct9ao473hc73a5qud0`
show successful revision saves followed by failed confirmation requests with
`PRINTABLE_SEATING_DIGEST_CONFLICT`. Examples on 5 November (UTC):

- 11:02:32: revision save succeeds; 11:02:34 confirmation fails,
  request ID `0b0f4e13-e08c-4f45-a7cb-efec340df26d`.
- 11:03:56: revision save succeeds; 11:03:59 confirmation fails,
  request ID `0c38ae1b-f562-40b6-9601-72e6b41278d4`.

Frontend inspection confirms that drag/drop submits `positions` and that Seating
stores/reuses them when confirming. Invitation's printable registration still
requires x/y to equal the original Venue template. Moving a table therefore saves
its draft successfully but cannot confirm it. No frontend runtime change is needed.

## Correction

Printable registration accepts Seating's saved x/y, already bounded by the strict
schema and bound into the content digest. Venue still controls the exact table set,
labels, shape, size and rotation. Digest/replay, authorization, planning/capacity,
retirement, transactional rollback and immutable print-history rules remain in place.
No migration or existing booking/history rewrite is required.

## Verification

- RED: native PostgreSQL regression fails at printable registration with the
  same 409 before the correction.
- Native PostgreSQL: four complete suites pass (34 tests): Seating owner,
  authenticated HTTP, Seating print files and printable registry conformance.
  They cover moved-table save/confirmation/reload, idempotency, exact registered
  coordinates, immutable prior registrations/files, ownership and capacity guards.
- The extended Invitation suite has 36 passing and 6 failing tests. All six
  failures reproduce on an archived, unchanged `8a1ec8512c35b197ee2be5d86ac7eda2413fbc14`
  baseline using the same dependencies and isolated PostgreSQL. Each fails in
  publication's `readSeating` with missing/ineligible seating state
  (`PRINTABLE_SEATING_REQUIRES_REVIEW`). These existing fixture-order failures do
  not enter the changed coordinate comparison. The suite is not reported green.
- Policy/OpenAPI: six tests pass. Updated the stale contract test to inspect the
  seven Seating-owned paths (excluding the separate Staff guidance path) and allow
  existing bounded `positions`, while still rejecting table shape/size/rotation
  and person-placement claims. No runtime request schema or endpoint was changed.
- Browser: the actual `PlanEditor` and `seatingApi` run against native authenticated
  HTTP routes and a disposable PostgreSQL database. Drag → save (201) → confirm
  (201) → reload retains exact positions at 1280×900 and 390×844. No page errors;
  all seven Seating HTTP requests succeed. Next navigation/session bootstrap is a
  local fixture; this is component/native-API verification, not hosted Next E2E.
- `npm run typecheck`, `npm run build`, `npm run lint` and `git diff --check` pass.
  The initial default-heap typecheck exhausted local memory; the complete retry
  used Node's 4096 MB heap, without changing TypeScript configuration or gates.

Local browser evidence: `.local-demo/seating-drag-browser-result.json`,
`seating-drag-desktop.png`, `seating-drag-mobile.png`. Native/extended results:
`.local-demo/seating-drag-green-isolated.log`; unchanged-source comparison:
`.local-demo/seating-drag-baseline.log`. These local artifacts contain synthetic
fixtures only and are not provider/deployment evidence.

The initial green run was interrupted by a local PostgreSQL process crash
(`0xC0000142` / client `ECONNRESET`); it is not counted as a passing result.
Subsequent native checks use a dedicated loopback cluster on port 55439 and
disposable databases, with synthetic accounts and no external provider calls.
Hosted mutation/deployment acceptance remains separate from local verification.
No deployment or shared-booking mutation was performed for this correction.
