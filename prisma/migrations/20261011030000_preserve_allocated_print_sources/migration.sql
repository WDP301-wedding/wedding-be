BEGIN;

-- Keep the exact commercial facts of already allocated production immutable.
-- A catalog successor cannot invalidate an approved or produced print batch.
CREATE OR REPLACE FUNCTION appendix_print_obligations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation record; agreed_line jsonb;
BEGIN
 IF NEW."state"<>'APPROVED' THEN RETURN NEW; END IF;
 FOR allocation IN
  SELECT p."commercialSource"->>'offeringId' AS offering_id,
   p."commercialSource"->>'sourceRevisionId' AS source_revision_id,
   (p."commercialSource"->>'unitPriceVnd')::numeric AS unit_price,
   sum(p."quantity") AS used
  FROM "InvitationPrintLine" p JOIN "InvitationPrintOrder" o ON o."id"=p."orderId"
  WHERE p."bookingId"=NEW."bookingId" AND p."commercialSource" IS NOT NULL
   AND o."status" IN ('APPROVED','IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER')
  GROUP BY p."commercialSource"->>'offeringId', p."commercialSource"->>'sourceRevisionId',
   (p."commercialSource"->>'unitPriceVnd')::numeric
 LOOP
  SELECT v INTO agreed_line FROM jsonb_array_elements(NEW."document"->'afterLines') v
   WHERE v->>'category'='PRINT' AND v->>'sourceId'=allocation.offering_id;
  IF NOT FOUND OR (agreed_line->>'quantity')::numeric<allocation.used THEN
   RAISE EXCEPTION 'appendix cannot remove allocated print obligations' USING ERRCODE='23514';
  END IF;
  IF agreed_line->>'sourceRevisionId' IS DISTINCT FROM allocation.source_revision_id
   OR (agreed_line->>'unitPriceVnd')::numeric IS DISTINCT FROM allocation.unit_price THEN
   RAISE EXCEPTION 'appendix cannot replace allocated print commercial sources' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

COMMIT;
