BEGIN;

ALTER TABLE "InvitationCommercialRevision" DROP CONSTRAINT commercial_revision_bounds;
ALTER TABLE "InvitationCommercialRevision" ADD CONSTRAINT commercial_revision_bounds CHECK (
 "revisionNumber">0 AND "orderTotalVnd" BETWEEN 0 AND 9007199254740991
 AND jsonb_typeof("linesJson")='array');

CREATE FUNCTION print_commercial_quote_bounds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_count integer; quoted_count integer; total numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "CommercialContract" WHERE "bookingId"=NEW."bookingId") THEN
  IF NEW."orderTotalVnd" NOT BETWEEN 1 AND 1000000000000
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."linesJson") q
    WHERE (q->>'unitPriceVnd')::numeric NOT BETWEEN 1 AND 1000000) THEN
   RAISE EXCEPTION 'legacy print quotation exceeds commercial bounds' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT count(*) INTO line_count FROM "InvitationPrintLine"
  WHERE "orderId"=NEW."orderId" AND "bookingId"=NEW."bookingId";
 SELECT count(DISTINCT q->>'lineId'),sum((q->>'lineTotalVnd')::numeric)
  INTO quoted_count,total FROM jsonb_array_elements(NEW."linesJson") q;
 IF line_count=0 OR quoted_count<>line_count OR jsonb_array_length(NEW."linesJson")<>line_count
  OR total IS DISTINCT FROM NEW."orderTotalVnd"
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."linesJson") q
   LEFT JOIN "InvitationPrintLine" p ON p."id"::text=q->>'lineId'
    AND p."orderId"=NEW."orderId" AND p."bookingId"=NEW."bookingId"
   WHERE p."id" IS NULL OR p."commercialSource" IS NULL
    OR q->>'designId' IS DISTINCT FROM p."designId"::text
    OR (q->>'quantity')::numeric IS DISTINCT FROM p."quantity"
    OR (q->>'unitPriceVnd')::numeric IS DISTINCT FROM (p."commercialSource"->>'unitPriceVnd')::numeric
    OR (q->>'lineTotalVnd')::numeric IS DISTINCT FROM p."quantity"::numeric*(p."commercialSource"->>'unitPriceVnd')::numeric) THEN
  RAISE EXCEPTION 'contracted print quotation must preserve frozen prices and quantities' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER print_commercial_quote_bounds_valid BEFORE INSERT ON "InvitationCommercialRevision"
 FOR EACH ROW EXECUTE FUNCTION print_commercial_quote_bounds_guard();

COMMIT;
