BEGIN;
CREATE TABLE "IncidentalOffering" (
 "id" uuid PRIMARY KEY, "restaurantId" uuid NOT NULL REFERENCES "RestaurantProfile"("id") ON DELETE RESTRICT,
 "revision" integer NOT NULL DEFAULT 1 CHECK ("revision">0), "name" text NOT NULL,
 "description" text NOT NULL, "unit" text NOT NULL, "unitPriceVnd" decimal(18,0) NOT NULL CHECK ("unitPriceVnd" BETWEEN 0 AND 9007199254740991),
 "chargingRule" text NOT NULL, "active" boolean NOT NULL DEFAULT true,
 CHECK(char_length(btrim("name")) BETWEEN 1 AND 120 AND char_length(btrim("unit")) BETWEEN 1 AND 80 AND char_length(btrim("description")) BETWEEN 1 AND 2000 AND char_length(btrim("chargingRule")) BETWEEN 1 AND 1000)
);
ALTER TABLE "Booking" ADD COLUMN "incidentalPolicyVersion" integer, ADD COLUMN "incidentalPricing" jsonb;
ALTER TABLE "Booking" ADD CHECK (("incidentalPolicyVersion" IS NULL AND "incidentalPricing" IS NULL) OR ("incidentalPolicyVersion"=1 AND jsonb_typeof("incidentalPricing")='array'));
CREATE FUNCTION freeze_booking_incidental_pricing() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."incidentalPolicyVersion" IS DISTINCT FROM OLD."incidentalPolicyVersion" OR NEW."incidentalPricing" IS DISTINCT FROM OLD."incidentalPricing" THEN
   RAISE EXCEPTION 'booking incidental agreement is immutable' USING ERRCODE='23514'; END IF;
 ELSIF NEW."incidentalPolicyVersion"=1 THEN
  SELECT "id" INTO rid FROM "RestaurantProfile" WHERE "singletonKey"='RESTAURANT';
  PERFORM 1 FROM "RestaurantProfile" WHERE "id"=rid FOR SHARE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('offeringId',"id",'revision',"revision",'name',"name",'description',"description",'unit',"unit",'unitPriceVnd',"unitPriceVnd",'chargingRule',"chargingRule") ORDER BY "id"),'[]'::jsonb)
   INTO NEW."incidentalPricing" FROM "IncidentalOffering" WHERE "restaurantId"=rid AND "active";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_incidental_pricing BEFORE INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION freeze_booking_incidental_pricing();
ALTER TABLE "IncidentalExpenseLine" ADD COLUMN "sourceType" text NOT NULL DEFAULT 'LEGACY', ADD COLUMN "offeringId" uuid, ADD COLUMN "offeringRevision" integer, ADD COLUMN "reason" text;
ALTER TABLE "IncidentalExpenseLine" ADD CHECK ("sourceType" IN ('LEGACY','CATALOG','OTHER'));
CREATE TABLE "IncidentalExpenseReview" (
 "id" uuid PRIMARY KEY, "bookingId" uuid NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
 "revisionNumber" integer NOT NULL CHECK("revisionNumber">0), "draftRevision" integer NOT NULL CHECK("draftRevision">=0),
 "type" text NOT NULL CHECK("type" IN ('EXPENSES','NONE','ADJUSTMENT')),
 "state" text NOT NULL CHECK("state" IN ('AWAITING_APPROVAL','APPROVED','CHANGES_REQUESTED','WITHDRAWN')),
 "document" jsonb NOT NULL, "documentDigest" text NOT NULL CHECK("documentDigest" ~ '^[a-f0-9]{64}$'),
 "managerAccountId" uuid NOT NULL REFERENCES "Account"("id"), "managerApprovedAt" timestamptz(6) NOT NULL,
 "coupleAccountId" uuid REFERENCES "Account"("id"), "coupleApprovedAt" timestamptz(6), "decisionReason" text,
 "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("bookingId","revisionNumber"), UNIQUE("id","bookingId"),
 CHECK("managerAccountId" IS DISTINCT FROM "coupleAccountId"),
 CHECK("state"<>'APPROVED' OR "type"='NONE' OR ("coupleAccountId" IS NOT NULL AND "coupleApprovedAt" IS NOT NULL))
);
ALTER TABLE "IncidentalExpenseDraft" ADD COLUMN "currentReviewId" uuid UNIQUE REFERENCES "IncidentalExpenseReview"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "IncidentalExpenseDraft" ADD FOREIGN KEY ("currentReviewId","bookingId") REFERENCES "IncidentalExpenseReview"("id","bookingId") ON DELETE RESTRICT;
CREATE FUNCTION incidental_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'retain expense review history' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 PERFORM require_event_ended(NEW."bookingId");
 IF TG_OP='UPDATE' THEN
  IF EXISTS(SELECT 1 FROM "FinalInvoiceRevision" i WHERE i."bookingId"=OLD."bookingId" AND (i.document->>'incidentalReviewId'=OLD.id::text OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.document->'adjustments') a WHERE a->>'reviewId'=OLD.id::text))) THEN
   RAISE EXCEPTION 'invoiced expense approval is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','coupleAccountId','coupleApprovedAt','decisionReason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','coupleAccountId','coupleApprovedAt','decisionReason'])
    OR OLD.state='WITHDRAWN' OR (OLD.state<>'AWAITING_APPROVAL' AND NEW.state<>'WITHDRAWN')
    OR (OLD."coupleApprovedAt" IS NOT NULL AND (NEW."coupleApprovedAt" IS DISTINCT FROM OLD."coupleApprovedAt" OR NEW."coupleAccountId" IS DISTINCT FROM OLD."coupleAccountId")) THEN
    RAISE EXCEPTION 'expense review content and approvals are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.state IN ('WITHDRAWN','CHANGES_REQUESTED') AND char_length(btrim(COALESCE(NEW."decisionReason",'')))=0 THEN RAISE EXCEPTION 'expense review reason required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.state NOT IN ('AWAITING_APPROVAL','APPROVED') OR (NEW.state='APPROVED' AND NEW.type<>'NONE') OR NEW."coupleAccountId" IS NOT NULL OR NEW."coupleApprovedAt" IS NOT NULL THEN RAISE EXCEPTION 'Manager initiates expense review' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Booking" b JOIN "Consultation" c ON c.id=b."consultationId" JOIN "AccountRole" ar ON ar."accountId"=c."managerAccountId" JOIN "Account" a ON a.id=ar."accountId" WHERE b.id=NEW."bookingId" AND b."incidentalPolicyVersion"=1 AND c."managerAccountId"=NEW."managerAccountId" AND ar.role='MANAGER' AND a.status='ACTIVE') THEN RAISE EXCEPTION 'assigned Manager required' USING ERRCODE='23514'; END IF;
 IF NEW."coupleAccountId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Booking" b JOIN "ConsultationAccess" g ON g."consultationId"=b."consultationId" JOIN "AccountRole" ar ON ar."accountId"=g."accountId" JOIN "Account" a ON a.id=g."accountId" WHERE b.id=NEW."bookingId" AND g."accountId"=NEW."coupleAccountId" AND g.level='FULL' AND ar.role='COUPLE' AND a.status='ACTIVE') THEN RAISE EXCEPTION 'owning FULL Couple required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER incidental_review_valid BEFORE INSERT OR UPDATE OR DELETE ON "IncidentalExpenseReview" FOR EACH ROW EXECUTE FUNCTION incidental_review_guard();
CREATE FUNCTION incidental_line_agreement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; prices jsonb; price jsonb; policy integer;
BEGIN
 bid:=CASE WHEN TG_OP='DELETE' THEN OLD."bookingId" ELSE NEW."bookingId" END;
 PERFORM pg_advisory_xact_lock(hashtext(bid::text));
 SELECT "incidentalPolicyVersion","incidentalPricing" INTO policy,prices FROM "Booking" WHERE id=bid;
 IF policy IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF EXISTS(SELECT 1 FROM "IncidentalExpenseDraft" d JOIN "IncidentalExpenseReview" r ON r.id=d."currentReviewId" WHERE d."bookingId"=bid AND r.state<>'WITHDRAWN') THEN RAISE EXCEPTION 'reopen expense review before changing lines' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW."sourceType"='CATALOG' THEN
  SELECT p INTO price FROM jsonb_array_elements(prices) p WHERE p->>'offeringId'=NEW."offeringId"::text;
  IF price IS NULL OR NEW."name" IS DISTINCT FROM price->>'name' OR NEW."unit" IS DISTINCT FROM price->>'unit' OR NEW."unitPriceVnd" IS DISTINCT FROM (price->>'unitPriceVnd')::numeric OR NEW."offeringRevision" IS DISTINCT FROM (price->>'revision')::integer THEN RAISE EXCEPTION 'expense price differs from frozen agreement' USING ERRCODE='23514'; END IF;
 ELSIF NEW."sourceType"='OTHER' THEN
  IF char_length(btrim(COALESCE(NEW.reason,''))) NOT BETWEEN 1 AND 1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(prices) p WHERE lower(p->>'name')=lower(NEW.name)) THEN RAISE EXCEPTION 'specific OTHER description and reason required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'new booking requires agreed catalog item or reasoned OTHER' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER incidental_line_agreement BEFORE INSERT OR UPDATE OR DELETE ON "IncidentalExpenseLine" FOR EACH ROW EXECUTE FUNCTION incidental_line_agreement_guard();
CREATE FUNCTION invoice_incidental_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "IncidentalExpenseReview"%ROWTYPE; rev integer; request jsonb; actual jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Booking" WHERE id=NEW."bookingId" AND "incidentalPolicyVersion"=1) THEN RETURN NEW; END IF;
 SELECT r0.* INTO r FROM "IncidentalExpenseDraft" d JOIN "IncidentalExpenseReview" r0 ON r0.id=d."currentReviewId" WHERE d."bookingId"=NEW."bookingId";
 SELECT revision INTO rev FROM "IncidentalExpenseDraft" WHERE "bookingId"=NEW."bookingId";
 IF r.id IS NULL OR r.state<>'APPROVED' OR r."draftRevision" IS DISTINCT FROM rev THEN RAISE EXCEPTION 'current expense approval required' USING ERRCODE='23514'; END IF;
 IF NEW."predecessorRevisionId" IS NULL THEN
  IF r.type NOT IN ('NONE','EXPENSES') OR NEW.document->>'incidentalReviewId' IS DISTINCT FROM r.id::text OR NEW.document->'incidentalLines' IS DISTINCT FROM r.document->'lines' OR (r.type='NONE' AND NEW.document->'incidentalLines'<>'[]'::jsonb) THEN RAISE EXCEPTION 'approved expense snapshot differs' USING ERRCODE='23514'; END IF;
 ELSE
  request:=r.document->'adjustment';
  SELECT jsonb_agg(l-ARRAY['id','totalVnd']) INTO actual FROM jsonb_array_elements(NEW.document->'adjustments'->-1->'lines') l;
  IF r.type<>'ADJUSTMENT' OR NEW.document->'adjustments'->-1->>'reviewId' IS DISTINCT FROM r.id::text OR request->>'expectedInvoiceRevisionId' IS DISTINCT FROM NEW."predecessorRevisionId"::text OR request->'lines' IS DISTINCT FROM actual OR request->>'reason' IS DISTINCT FROM NEW.document->'adjustments'->-1->>'reason' OR (request->>'expectedBillingRevision')::integer IS DISTINCT FROM (NEW."sourceBillingRevision"-(CASE WHEN NEW."deltaVnd"=0 THEN 0 ELSE 1 END)) THEN RAISE EXCEPTION 'approved invoice adjustment required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_incidental_approval BEFORE INSERT ON "FinalInvoiceRevision" FOR EACH ROW EXECUTE FUNCTION invoice_incidental_approval_guard();
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l."id",'name',l."name",'quantity',l."quantity",'unit',l."unit",'unitPriceVnd',l."unitPriceVnd",'totalVnd',l."totalVnd",'note',l."note") || CASE WHEN l."sourceType"='CATALOG' THEN jsonb_build_object('sourceType','CATALOG','offeringId',l."offeringId",'offeringRevision',l."offeringRevision") WHEN l."sourceType"='OTHER' THEN jsonb_build_object('sourceType','OTHER','reason',l."reason") ELSE '{}'::jsonb END ORDER BY l."id"),'[]'::jsonb),COALESCE(sum(l."totalVnd"),0)
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

CREATE OR REPLACE FUNCTION enqueue_realtime_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document JSONB := to_jsonb(NEW);
  source_id UUID;
  source_revision INTEGER := 1;
BEGIN
  IF TG_ARGV[0] = 'audit' AND document->>'entityType' NOT IN (
    'restaurant-profile', 'restaurant-shift', 'hall', 'dish', 'dish-version',
    'menu-package', 'menu-package-version', 'timeline-template',
    'timeline-template-version', 'layout-template', 'layout-template-version',
    'layout-table-identity', 'catalog-media-asset', 'print-offering', 'restaurant-service',
    'consultation-request', 'STAFF_OPERATIONS', 'invitation-design', 'incidental-review', 'incidental-offering'
  ) THEN RETURN NEW; END IF;
  source_id := COALESCE(document->>'eventId', document->>'id')::uuid;
  IF TG_ARGV[0] = 'notification' THEN source_revision := (document->>'revision')::integer; END IF;
  EXECUTE format('INSERT INTO %I."RealtimeDelivery" ("stream", "eventId", "revision") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', TG_TABLE_SCHEMA)
    USING TG_ARGV[0], source_id, source_revision;
  RETURN NEW;
END $$;

COMMIT;
