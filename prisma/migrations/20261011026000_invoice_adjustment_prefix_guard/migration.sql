BEGIN;
CREATE OR REPLACE FUNCTION final_invoice_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior "FinalInvoiceRevision"%ROWTYPE; current_id uuid; root "CommercialContractRevision"%ROWTYPE; effective_id uuid;
 agreed numeric; incidental numeric; draft_revision integer; expense_lines jsonb; appendix_lines jsonb; adjustment jsonb; delta numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 PERFORM require_event_ended(NEW."bookingId"); PERFORM require_financial_unpinned(NEW."bookingId");
 SELECT "currentRevisionId" INTO current_id FROM "FinalInvoiceHead" WHERE "bookingId"=NEW."bookingId";
 IF NEW."predecessorRevisionId" IS DISTINCT FROM current_id THEN RAISE EXCEPTION 'invoice predecessor is stale' USING ERRCODE='23514'; END IF;
 IF current_id IS NULL THEN
  SELECT r.* INTO root FROM "BookingDepositSettlement" s JOIN "CommercialContractRevision" r ON r."id"=s."contractRevisionId" WHERE s."bookingId"=NEW."bookingId";
  IF NOT FOUND OR NEW."document"->'contract' IS DISTINCT FROM jsonb_build_object('revisionId',root."id",'documentDigest',root."documentDigest",'document',root."document") THEN
   RAISE EXCEPTION 'invoice original contract conflicts' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(h."effectiveRevisionId",root."id") INTO effective_id FROM "CommercialAppendixHead" h WHERE h."bookingId"=NEW."bookingId";
  effective_id:=COALESCE(effective_id,root."id");
  SELECT COALESCE(jsonb_agg(jsonb_build_object('revisionId',r."id",'documentDigest',r."documentDigest",'document',r."document") ORDER BY r."revisionNumber"),'[]'::jsonb)
   INTO appendix_lines FROM "CommercialAppendixRevision" r WHERE r."bookingId"=NEW."bookingId" AND r."state"='APPROVED';
  SELECT COALESCE(sum("deltaVnd"),0)+root."contractTotalVnd" INTO agreed FROM "CommercialAppendixRevision" WHERE "bookingId"=NEW."bookingId" AND "state"='APPROVED';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l."id",'name',l."name",'quantity',l."quantity",'unit',l."unit",'unitPriceVnd',l."unitPriceVnd",'totalVnd',l."totalVnd",'note',l."note") ORDER BY l."id"),'[]'::jsonb),COALESCE(sum(l."totalVnd"),0)
   INTO expense_lines,incidental FROM "IncidentalExpenseLine" l WHERE l."bookingId"=NEW."bookingId";
  SELECT "revision" INTO draft_revision FROM "IncidentalExpenseDraft" WHERE "bookingId"=NEW."bookingId";
  IF NEW."revisionNumber"<>1 OR NEW."document"->'adjustments'<>'[]'::jsonb OR NEW."document"->'appendices' IS DISTINCT FROM appendix_lines
   OR NEW."document"->'incidentalLines' IS DISTINCT FROM expense_lines OR (NEW."document"->>'expenseDraftRevision')::integer IS DISTINCT FROM COALESCE(draft_revision,0)
   OR (NEW."document"->>'incidentalTotalVnd')::numeric IS DISTINCT FROM incidental OR (NEW."document"->>'commercialTotalVnd')::numeric IS DISTINCT FROM agreed
   OR NEW."document"->>'effectiveCommercialRevisionId' IS DISTINCT FROM effective_id::text OR NEW."deltaVnd"<>incidental OR NEW."totalVnd"<>agreed+incidental THEN
   RAISE EXCEPTION 'final invoice source snapshot conflicts' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO prior FROM "FinalInvoiceRevision" WHERE "id"=current_id AND "bookingId"=NEW."bookingId";
  adjustment:=NEW."document"->'adjustments'->-1;
  SELECT COALESCE(sum(CASE WHEN l->>'kind'='DEBIT' THEN (l->>'totalVnd')::numeric ELSE -(l->>'totalVnd')::numeric END),0) INTO delta FROM jsonb_array_elements(adjustment->'lines') l;
  IF NEW."revisionNumber"<>prior."revisionNumber"+1 OR (NEW."document"-ARRAY['adjustments','totalVnd']) IS DISTINCT FROM (prior."document"-ARRAY['adjustments','totalVnd'])
   OR ((NEW."document"->'adjustments')-(jsonb_array_length(NEW."document"->'adjustments')-1)) IS DISTINCT FROM prior."document"->'adjustments'
   OR adjustment->>'id' IS DISTINCT FROM NEW."id"::text OR adjustment->>'predecessorRevisionId' IS DISTINCT FROM current_id::text
   OR adjustment->>'actorAccountId' IS DISTINCT FROM NEW."issuedByAccountId"::text OR (adjustment->>'occurredAt')::timestamptz IS DISTINCT FROM NEW."issuedAt"
   OR char_length(btrim(adjustment->>'reason')) NOT BETWEEN 1 AND 500 OR jsonb_array_length(adjustment->'lines') NOT BETWEEN 1 AND 50
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(adjustment->'lines') l WHERE l->>'kind' NOT IN ('DEBIT','CREDIT') OR (l->>'quantity')::numeric<1
      OR (l->>'unitPriceVnd')::numeric<0 OR (l->>'totalVnd')::numeric IS DISTINCT FROM (l->>'quantity')::numeric*(l->>'unitPriceVnd')::numeric)
   OR NEW."deltaVnd" IS DISTINCT FROM delta OR (adjustment->>'deltaVnd')::numeric IS DISTINCT FROM delta OR NEW."totalVnd"<>prior."totalVnd"+delta THEN
   RAISE EXCEPTION 'invoice adjustment successor conflicts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
