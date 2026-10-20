# Reusable demo catalog and seating — 20 October 2026

The owner authorized the proposed retention, display-name changes and per-hall
seating seed with “hãy thực hiện theo đề xuất của bạn đi”. This is a data operation
on the existing synthetic Railway demo, using its deployed Manager APIs. It does
not change application routes, database schema, migrations or frontend source.
Historical PERF/SPEC/RV evidence remains unchanged.

## Applied changes

| Record                                              | Previous display name             | Current display name               |
| --------------------------------------------------- | --------------------------------- | ---------------------------------- |
| Hall `be5d4496-de6a-4666-8d17-3202b1f873ed`         | PERF-TEST Staff event and Storage | Sảnh Demo — Tiệc thân mật          |
| Consultation `52f0225b-8069-4140-a849-0146ef86e04b` | PERF-TEST-20261016                | DEMO — Tiệc Orchid 50 khách        |
| Consultation `dc8b7116-36d7-4e28-b848-e03fb8c0383f` | PERF-TEST-20261017-STAFF          | DEMO — Thực hành vận hành 50 khách |
| Eight named Guests in each of these two bookings    | Khách PERF 01–08                  | Khách Demo 01–08                   |

IDs are retained. The Hall update used the deployed Manager endpoint and expected
revision. Consultation has no display-label update endpoint; a narrow operator
transaction checked exact Consultation/Booking IDs, old labels and authenticated
Manager ownership under row locks, incremented only the Consultation revision and
appended an audit record for each label change. No bride/groom identity was inferred
or changed. Guests were renamed through the existing authenticated PATCH endpoint;
their previous history remains and sixteen new history entries record the changes.

The two published `PERF-TEST Orchid 50` layout versions were cloned, renamed and
published as successors on the same template IDs. The previous versions became
SUPERSEDED through the normal catalog workflow. Their content, geometry and stable
table IDs remain intact. Existing Booking seating selections are unchanged.

Nine additional published templates have separate deterministic template/version/
table IDs and round tables with ten seats each:

| Hall                      | Small                               | Standard          | Maximum           |
| ------------------------- | ----------------------------------- | ----------------- | ----------------- |
| Lotus Hall                | 10 tables / 100 seats; 1–100 guests | 20 / 200; 101–200 | 30 / 300; 201–300 |
| Orchid Hall               | 5 / 50; 1–50                        | 10 / 100; 51–100  | 12 / 120; 101–120 |
| Sảnh Demo — Tiệc thân mật | 5 / 50; 1–50                        | 10 / 100; 51–100  | 12 / 120; 101–120 |

The normalized geometry reserves empty space above the tables and a central aisle;
these are catalog coordinates, not a surveyed floor plan or a physical aisle-width
certification. Tables do not overlap or exceed canvas bounds. There are now thirteen
active templates, including the preserved baseline Lotus templates and the two
renamed historical fixture templates. No existing template was retired.

## Preservation and verification

The [sanitized receipt](../tasks/evidence/demo-catalog-refresh-2026-10-20.json)
records IDs, name mappings, published versions, request IDs and hash comparisons.
Private credentials and raw operator snapshots remain under ignored `.local-demo/`.

- Fifteen protected Booking, slot, plan, group, check-in and financial tables match
  their pre-operation row counts and hashes exactly.
- All sixteen Guests retain their IDs, memberships, contacts, operational notes,
  statuses and creation timestamps. Only name, normalized name and revision changed.
  Guest counts and independent planning totals are unchanged. Workspace listSequence
  advances by eight per fixture; all previous GuestHistory rows are byte-equivalent
  and exactly sixteen new revisions were appended.
- Original catalog version content and geometry remain equivalent. Approved
  contracts, appendices, invoice, ledger/payment facts, selected seating history and
  historical proposal names were not rewritten. Historical PERF labels, including
  names captured in approved snapshots, therefore remain visible in those contexts.
- No confirmed Hall/date/shift collision exists. Renaming does not release the
  existing fixture reservations; their dates, shifts and lifecycle are unchanged.
- Replay after the catalog refresh, and again after Guest renaming, produced zero
  additional changes. Colliding IDs/content edits stop instead of overwriting them.
- Direct deployed-browser reads verified both fixture seating option lists, the
  renamed public Hall, and desktop/390px rendering. Public pages use the existing
  300-second revalidation policy; the first stale response was followed by a fresh
  response containing the new Hall name. No Booking plan was selected or confirmed.
- All completed operator sessions and the browser session were revoked. Sessions
  from interrupted operator runs were identified by their exact login request IDs
  and revoked through the owned-session API.

The three focused seed tests, typecheck, build, 71 contract tests, OpenAPI generation
and OpenAPI check passed. ESLint passed for the changed files and for authored code
with existing generated/operator output excluded; the unbounded default lint scan
exhausted the default Node heap. No ESLint configuration or rule was changed.
The first full test attempt could not connect to local PostgreSQL. After crash
recovery, the disposable-database full run passed 2,037 tests but retained one
pg-pool connection timeout and seven Windows worker exits (`3221226505`). The eight
affected files were then rerun with one worker: seven passed 108 tests; the remaining
Booking runtime worker exited again and passed all five tests when run alone in a
fresh disposable database. Assertions, timeouts and pool configuration were unchanged.
All affected files therefore passed on retry; the original full run remains recorded
as NOT_GREEN, not relabeled as a clean continuous run. No shared database was used
for integration tests.

## Repeatable operation

Implementation: `scripts/demo-catalog-refresh.ts` (validated plan and stable IDs)
and `scripts/demo-catalog-refresh.mjs` (operator execution). Run from repository root:

```powershell
# Set DEMO_REFRESH_CONFIG to a private synthetic fixture configuration containing
# origin, synthetic=true, initialized=true and credentials.manager.
# Set DEMO_REFRESH_DATABASE_URL to the verified operator connection for that same
# demo database. Never paste credentials into commands, reports or Git.
node --import tsx scripts/demo-catalog-refresh.mjs          # inspect/verify only
node --import tsx scripts/demo-catalog-refresh.mjs --apply  # explicit data writes
```

The runner pins the known demo origin and exact fixture IDs. It refuses changed
Hall capacities, unknown Halls, conflicting labels, unexpected drafts and edited
seed content. It resumes its own exact drafts and uses stable idempotency keys.
The original native catalog seed is retained: it verifies its baseline IDs and does
not overwrite these Hall/layout edits. This additional overlay must be run after
the initial seed; `preserveExistingEdits` remains the existing explicit option for
an intentionally edited restaurant profile. No old seed or migration was rewritten.

This dataset remains synthetic. Its old manual-accounting entries are not real
transfers or provider settlement evidence. This work adds no payment, generation,
delivery, check-in, production acceptance or PERF performance claim.
