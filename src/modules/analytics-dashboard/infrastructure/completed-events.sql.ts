import { Prisma } from '../../../generated/prisma/client.js';
import type { CompletedEventsQuery } from '../http/completed-events.schemas.js';

export function completedEventsSql(schema: Prisma.Sql, q: CompletedEventsQuery) {
  return Prisma.sql`
    WITH latest_bookings AS MATERIALIZED (
      SELECT DISTINCT ON ("recordId") "recordId",value FROM ${schema}."ReportingFact"
      WHERE owner='booking' ORDER BY "recordId",sequence DESC
    ), selected AS MATERIALIZED (
      SELECT * FROM latest_bookings WHERE value->>'phase'='COMPLETED'
        AND value->>'eventDate' BETWEEN ${q.dateFrom} AND ${q.dateTo}
        AND (${q.hallId ?? null}::text IS NULL OR value->>'hallId'=${q.hallId ?? null})
        AND (${q.q}='' OR strpos(lower(concat_ws(' ',value->>'bookingCode',value->>'customerName',
          value->>'alias',value->>'hallNameSnapshot')),lower(${q.q}))>0)
      ORDER BY "recordId" LIMIT 10001
    ), sources AS MATERIALIZED (
      SELECT b.value AS booking,c.value AS billing,b."recordId" AS id,
        (c.value->>'finalInvoiceTotalVnd')::numeric AS invoice_total,
        COALESCE((c.value->>'acceptedChargesVnd')::numeric,(c.value->>'finalInvoiceTotalVnd')::numeric,(b.value->>'effectiveAgreedTotalVnd')::numeric,
          (b.value->>'originalContractTotalVnd')::numeric,(b.value->>'baseChargeVnd')::numeric) AS total,
        COALESCE((b.value->>'effectiveAgreedTotalVnd')::numeric,(b.value->>'originalContractTotalVnd')::numeric,
          (b.value->>'baseChargeVnd')::numeric) AS provisional_total,
        (c.value->>'paidVnd')::numeric-(c.value->>'refundedVnd')::numeric AS paid
      FROM selected b LEFT JOIN LATERAL (
        SELECT value FROM ${schema}."ReportingFact" WHERE owner='billing' AND "recordId"=b."recordId"
        ORDER BY sequence DESC LIMIT 1
      ) c ON true
    ), events AS MATERIALIZED (
      -- Receivables come from Payments, including credits registered after a
      -- retained legacy invoice. Invoice revenue never overrides ledger debt.
      SELECT *,(billing->>'outstandingVnd')::numeric AS outstanding,
        (billing->>'creditVnd')::numeric AS credit,
        CASE WHEN billing IS NULL THEN 'UNKNOWN'
          WHEN (billing->>'outstandingVnd')::numeric>0 THEN 'DEBT' WHEN invoice_total IS NOT NULL THEN 'PAID'
          ELSE 'PENDING_INVOICE' END AS payment_status
      FROM sources
    ), lines AS MATERIALIZED (
      SELECT e.id,e.booking->>'eventDate' AS event_date,e.invoice_total,l,
        COALESCE(l->>'unit',CASE WHEN l->>'category'='MENU' THEN 'bàn' ELSE 'đơn vị' END) AS unit
      FROM events e CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN e.invoice_total IS NOT NULL THEN COALESCE(e.billing->'finalCommercialLines','[]'::jsonb)
          WHEN jsonb_array_length(COALESCE(e.booking->'commercialLines','[]'::jsonb))>0 THEN e.booking->'commercialLines'
          WHEN e.booking->>'menuPackageId' IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
            'category','MENU','sourceId',e.booking->>'menuPackageId','name',e.booking->>'menuNameSnapshot',
            'quantity',e.booking->'tableCount','unit','bàn')) ELSE '[]'::jsonb END
      ) l WHERE l->>'category' IN ('MENU','SERVICE')
    ), offering_rows AS MATERIALIZED (
      SELECT l->>'category' AS category,l->>'sourceId' AS source_id,
        (array_agg(l->>'name' ORDER BY event_date DESC,id DESC))[1] AS name,
        CASE WHEN count(DISTINCT unit)>1 THEN 'nhiều đơn vị' ELSE min(unit) END AS unit,
        count(DISTINCT id)::int AS booking_count,
        count(DISTINCT id) FILTER (WHERE invoice_total IS NOT NULL)::int AS finalized_count,
        sum((l->>'quantity')::numeric) AS quantity,
        COALESCE(sum((l->>'lineTotalVnd')::numeric) FILTER (WHERE invoice_total IS NOT NULL),0) AS revenue
      FROM lines GROUP BY l->>'category',l->>'sourceId'
    ), hall_rows AS MATERIALIZED (
      SELECT booking->>'hallId' AS id,(array_agg(booking->>'hallNameSnapshot' ORDER BY booking->>'eventDate' DESC,events.id DESC))[1] AS name,
        count(*)::int AS booking_count,count(invoice_total)::int AS finalized_count,
        COALESCE(sum(invoice_total),0) AS revenue,
        CASE WHEN count(*) FILTER (WHERE billing IS NULL)>0 THEN NULL ELSE COALESCE(sum(paid),0) END AS paid,
        CASE WHEN count(*) FILTER (WHERE billing IS NULL)>0 THEN NULL ELSE COALESCE(sum(outstanding),0) END AS outstanding
      FROM events GROUP BY booking->>'hallId'
    ), venue AS (
      SELECT value FROM ${schema}."ReportingFact" WHERE owner='venue' ORDER BY sequence DESC LIMIT 1
    ), hall_catalog AS (
      SELECT h->>'id' AS id,h->>'name' AS name FROM venue CROSS JOIN LATERAL jsonb_array_elements(value->'halls') h
      WHERE (h->>'active')::boolean AND (${q.hallId ?? null}::text IS NULL OR h->>'id'=${q.hallId ?? null})
    ), halls AS (
      SELECT COALESCE(r.id,c.id) AS id,COALESCE(c.name,r.name,'Sảnh tiệc') AS name,
        COALESCE(r.booking_count,0) AS booking_count,COALESCE(r.finalized_count,0) AS finalized_count,
        COALESCE(r.revenue,0) AS revenue,CASE WHEN r.id IS NULL THEN 0 ELSE r.paid END AS paid,
        CASE WHEN r.id IS NULL THEN 0 ELSE r.outstanding END AS outstanding
      FROM hall_rows r FULL JOIN hall_catalog c ON c.id=r.id
    ), filtered AS MATERIALIZED (
      SELECT * FROM events WHERE ${q.paymentStatus}='ALL' OR payment_status=${q.paymentStatus}
    ), paging AS (
      SELECT count(*)::int AS total,ceil(count(*)::numeric/${q.pageSize})::int AS pages,
        least(${q.page},greatest(ceil(count(*)::numeric/${q.pageSize}),1))::int AS page FROM filtered
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY booking->>'eventDate' DESC,id DESC
        LIMIT ${q.pageSize} OFFSET (SELECT (page-1)*${q.pageSize} FROM paging)
    )
    SELECT (SELECT count(*)::int FROM events) AS "eventCount",
      (SELECT count(*)::int FROM offering_rows) AS "offeringCount",
      COALESCE((SELECT value FROM ${schema}."ReportingSequence" WHERE owner='booking'),0) AS "bookingSequence",
      COALESCE((SELECT value FROM ${schema}."ReportingSequence" WHERE owner='billing'),0) AS "billingSequence",
      jsonb_build_object(
        'summary',(SELECT jsonb_build_object('completedCount',count(*),'finalizedCount',count(invoice_total),
          'provisionalCount',count(*) FILTER (WHERE invoice_total IS NULL AND billing IS NOT NULL),
          'unknownCount',count(*) FILTER (WHERE billing IS NULL),'revenueVnd',COALESCE(sum(invoice_total),0),
          'provisionalTotalVnd',COALESCE(sum(provisional_total) FILTER (WHERE invoice_total IS NULL),0),
          'netPaidVnd',CASE WHEN count(*) FILTER (WHERE billing IS NULL)>0 THEN NULL ELSE COALESCE(sum(paid),0) END,
          'outstandingVnd',CASE WHEN count(*) FILTER (WHERE billing IS NULL)>0 THEN NULL ELSE COALESCE(sum(outstanding),0) END,
          'creditVnd',CASE WHEN count(*) FILTER (WHERE billing IS NULL)>0 THEN NULL ELSE COALESCE(sum(credit),0) END,
          'unallocatedRevenueVnd',COALESCE(sum(invoice_total),0)-(SELECT COALESCE(sum(revenue),0) FROM offering_rows)) FROM events),
        'halls',COALESCE((SELECT jsonb_agg(jsonb_build_object('hallId',id,'hallName',name,'bookingCount',booking_count,
          'finalizedCount',finalized_count,'revenueVnd',revenue,'netPaidVnd',paid,'outstandingVnd',outstanding)
          ORDER BY booking_count DESC,revenue DESC,id) FROM halls),'[]'::jsonb),
        'offerings',COALESCE((SELECT jsonb_agg(jsonb_build_object('category',category,'sourceId',source_id,'name',name,'unit',unit,
          'bookingCount',booking_count,'finalizedBookingCount',finalized_count,'quantity',quantity,'revenueVnd',revenue)
          ORDER BY booking_count DESC,revenue DESC,source_id) FROM offering_rows),'[]'::jsonb),
        'page',(SELECT page FROM paging),'pageSize',${q.pageSize}::int,'total',(SELECT total FROM paging),'totalPages',(SELECT pages FROM paging),
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('bookingId',id,'bookingCode',booking->>'bookingCode',
          'customerName',COALESCE(booking->>'customerName',''),'eventDate',booking->>'eventDate',
          'hallId',booking->>'hallId','hallName',booking->>'hallNameSnapshot',
          'invoiceRevisionId',billing->>'finalInvoiceRevisionId',
          'invoiceState',CASE WHEN billing IS NULL THEN 'SOURCE_NOT_READY' WHEN invoice_total IS NOT NULL THEN 'FINALIZED' ELSE 'PROVISIONAL' END,
          'totalVnd',CASE WHEN billing IS NULL THEN NULL ELSE total END,'netPaidVnd',paid,'outstandingVnd',outstanding,
          'creditVnd',credit,'paymentStatus',payment_status) ORDER BY booking->>'eventDate' DESC,id DESC) FROM page_rows),'[]'::jsonb)
      ) AS payload
  `;
}
