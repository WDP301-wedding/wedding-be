# Completed-event dashboard and prospective deposit policy

Owner approved the consultation in this chat on 2026-11-08. This amendment may
change wedding-be, wedding-manage-web, wedding-web and PRM-app. It supersedes the
fixed 30% deposit rule for newly created bookings only.

## Accepted behavior

- Reports select COMPLETED events by inclusive local event date. Revenue is the
  current finalized invoice total, including approved invoice adjustments. Cash is
  proven payments minus refunds. Credit adjustments reduce receivables. An event
  without a finalized invoice has provisional amounts and cannot be called PAID.
- Hall rankings show completed-event count separately from invoice revenue, cash
  and outstanding. Menu/service rankings group stable source IDs, count an event
  once, show quantities and sum frozen finalized commercial line values. General
  incidental/adjustment amounts are separate; payments are not allocated to items.
- Payment filters and event pagination run in SQL with a bounded date range and
  aggregate budget. Missing financial evidence is unknown, never inferred zero.
- Archive the current service named exactly `Dịch vụ MC`, retaining revisions,
  contract references and historical reports. Keep `MC tiệc cưới` selectable.
- Manager sets integer deposit percentage 10–100, default 30. Snapshot the policy
  atomically on booking INSERT; later configuration changes and draft revisions
  cannot change that booking's rate. Old bookings/documents/payments keep their
  prior data. Retained PDFs and document digests are never rewritten.
- Show the snapshot percentage in Manager/Couple Web, Android and new contract PDF.
  Database migrations are forward-only; configuration has its own column and audit.

## Implementation and verification

1. Prospective policy schema/guards, arithmetic and contract/PDF compatibility.
2. Completed-event financial reporting through owner-published facts and SQL paging.
3. Manager dashboard/configuration, Couple/Android percentage display.
4. Disposable PostgreSQL migration/integration tests; backend types/lint/tests/build,
   contract tests/OpenAPI; web tests/types/lint/build/typography and browser checks;
   Flutter analyze/test without APK packaging.

No deployment or real payment/provider operation is included in local acceptance.
