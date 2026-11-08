# Fixed table capacity and effective commercial summaries — 2026-11-09

Owner approved implementation across backend, Manager Web, Couple Web and PRM-app.

- At most ten people per table; partially occupied tables are valid. No new capacity configuration.
- Aggregate MENU quantities remain the table count; PRINT/SERVICE quantities never contribute.
- Explicit Couple headcount edits remain available. Reject headcount above effective tables times ten.
- New/edited proposals, commercial selections, contract/appendix drafts, submission, approvals and new deposit eligibility/reservations revalidate table minimum and current published active hall-layout maximum. A hall without a selectable published layout cannot accept new commercial commitments.
- Existing per-table seatCapacity does not change the ten-person rule. Do not rewrite immutable catalog versions or retained PDFs.
- Current summaries use the effective mutually approved appendix, then mutually approved contract, then proposal. A pending successor does not hide the prior effective appendix.
- Table/menu names, quantities and effective agreed totals come from one source. The original agreed/received deposit and historical document views remain unchanged. Settlement/reconciliation of an already reserved payment uses its frozen facts even if the layout catalog later changes.
- Database pagination and sorting by table count use the same effective value displayed to users.
- Legacy over-capacity approved documents remain readable with a capacity issue; correct via a new valid appendix, never silently reduce quantities or money.
- Seating checks actual table identities at ten seats each and requires enough tables for the effective agreement. Existing confirmed incompatible layouts require review.

API additions: proposal responses optionally include commercialSource and capacity
(guestsPerTable=10, minimumTables, maximumTables, issue). Public halls optionally
include maxTables. Existing response fields retain their shapes. New business
conflicts return 409 with BOOKING_TABLES_INSUFFICIENT, BOOKING_LAYOUT_TABLE_LIMIT,
BOOKING_LAYOUT_UNAVAILABLE or BOOKING_HALL_CAPACITY_EXCEEDED.

Local verification does not imply deployment or provider acceptance. Verification
evidence is recorded separately. No APK build is needed for this revision.

## Verification and release notes

No data migration is needed. The ten-person rule is applied to new commands;
immutable proposal/contract/appendix/PDF rows are never backfilled or rewritten.
The current UI may therefore show a preserved 20-table approved agreement with a
12-table-layout warning until a valid corrective appendix is mutually approved.

The existing demo catalog includes some historical compressed layouts (few table
identities with unusually high seatCapacity metadata). Those identities now count
as ten seats each for operations. Publish a genuinely larger layout if a hall is
to accept more tables; this revision never manufactures extra tables or rewrites
shared catalog rows. A new draft/retired layout does not raise the commercial limit.

Web API pins continue to point at their real released backend version. Local
additive response types cover commercialSource, capacity and maxTables until a
reviewed backend release is available for an actual generated-client repin.

Local browser QA used temporary routes rendering real production components with
isolated in-memory props and no financial/network writes. The routes were removed
after verification. Screenshots live under output/playwright/table-capacity-*.

A historical agreement exceeding today's layout maximum can be corrected in two
steps without rewriting history: Couple first lowers planning headcount within
both effective menu-table and available-layout capacity, then the parties approve
a smaller valid menu-table appendix. Planning updates alone never increase or
silently lower the historical agreed table count.
