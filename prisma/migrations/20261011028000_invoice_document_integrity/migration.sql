BEGIN;
CREATE FUNCTION final_invoice_shape_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE adjustment jsonb; line jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Account" a JOIN "AccountRole" r ON r."accountId"=a.id
  WHERE a.id=NEW."issuedByAccountId" AND a.status='ACTIVE' AND r.role='MANAGER') THEN
  RAISE EXCEPTION 'final invoice requires an active Manager issuer' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.document->'adjustments') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.document->'appendices') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.document->'incidentalLines') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_each(NEW.document) p WHERE p.value='null'::jsonb) THEN
  RAISE EXCEPTION 'invoice document requires nonnull exact source fields' USING ERRCODE='23514'; END IF;
 IF NEW."predecessorRevisionId" IS NULL THEN RETURN NEW; END IF;
 adjustment:=NEW.document->'adjustments'->-1;
 IF adjustment IS NULL OR NOT adjustment ?& ARRAY['id','predecessorRevisionId','actorAccountId','occurredAt','reason','lines','deltaVnd']
  OR EXISTS(SELECT 1 FROM jsonb_each(adjustment) p WHERE p.value='null'::jsonb)
  OR jsonb_typeof(adjustment->'reason') IS DISTINCT FROM 'string'
  OR jsonb_typeof(adjustment->'deltaVnd') IS DISTINCT FROM 'number'
  OR jsonb_typeof(adjustment->'lines') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'adjustment requires reasoned immutable line evidence' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT * FROM jsonb_array_elements(adjustment->'lines') LOOP
  IF NOT line ?& ARRAY['id','name','quantity','unit','unitPriceVnd','totalVnd','kind']
   OR EXISTS(SELECT 1 FROM jsonb_each(line) p WHERE p.key<>'note' AND p.value='null'::jsonb)
   OR jsonb_typeof(line->'name') IS DISTINCT FROM 'string' OR char_length(btrim(line->>'name')) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(line->'unit') IS DISTINCT FROM 'string' OR char_length(btrim(line->>'unit')) NOT BETWEEN 1 AND 80
   OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' OR (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)
   OR (line->>'quantity')::numeric NOT BETWEEN 1 AND 2147483647
   OR jsonb_typeof(line->'unitPriceVnd') IS DISTINCT FROM 'number' OR (line->>'unitPriceVnd')::numeric<>trunc((line->>'unitPriceVnd')::numeric)
   OR (line->>'unitPriceVnd')::numeric NOT BETWEEN 0 AND 9007199254740991
   OR jsonb_typeof(line->'totalVnd') IS DISTINCT FROM 'number' OR (line->>'totalVnd')::numeric NOT BETWEEN 0 AND 9007199254740991
   OR line->>'kind' NOT IN ('DEBIT','CREDIT') OR line->>'id' !~ '^[a-f0-9-]{36}$'
   OR (line->'note' IS NOT NULL AND line->'note'<>'null'::jsonb AND (jsonb_typeof(line->'note')<>'string' OR char_length(btrim(line->>'note')) NOT BETWEEN 1 AND 2000)) THEN
   RAISE EXCEPTION 'adjustment line shape or integer amount is invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF jsonb_array_length(adjustment->'lines')<>(SELECT count(DISTINCT l->>'id') FROM jsonb_array_elements(adjustment->'lines') l) THEN
  RAISE EXCEPTION 'adjustment line identities must be distinct' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER final_invoice_shape_valid BEFORE INSERT ON "FinalInvoiceRevision" FOR EACH ROW EXECUTE FUNCTION final_invoice_shape_guard();
CREATE FUNCTION final_invoice_head_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."bookingId"<>OLD."bookingId" THEN RAISE EXCEPTION 'invoice head booking is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER final_invoice_head_identity BEFORE UPDATE ON "FinalInvoiceHead" FOR EACH ROW EXECUTE FUNCTION final_invoice_head_identity_guard();
COMMIT;
