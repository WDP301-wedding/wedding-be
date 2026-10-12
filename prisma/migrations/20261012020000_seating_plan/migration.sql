CREATE TABLE "SeatingPlan" (
 "bookingId" uuid PRIMARY KEY REFERENCES "Booking"(id) ON DELETE RESTRICT,
 id uuid NOT NULL UNIQUE, "revisionId" uuid NOT NULL UNIQUE,
 "revisionNumber" integer NOT NULL CHECK ("revisionNumber">0),
 "observedBookingRevision" integer NOT NULL CHECK ("observedBookingRevision">0)
);
CREATE TABLE "SeatingPlanRevision" (
 id uuid PRIMARY KEY, "bookingId" uuid NOT NULL REFERENCES "Booking"(id) ON DELETE RESTRICT,
 "planId" uuid NOT NULL REFERENCES "SeatingPlan"(id) DEFERRABLE INITIALLY DEFERRED,
 "revisionNumber" integer NOT NULL CHECK ("revisionNumber">0),
 "predecessorRevisionId" uuid,
 status text NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','REQUIRES_REVIEW')),
 "layoutTemplateVersionId" uuid NOT NULL REFERENCES "LayoutTemplateVersion"(id) ON DELETE RESTRICT,
 "bookingRevision" integer NOT NULL CHECK ("bookingRevision">0),
 "planningHeadcount" integer NOT NULL CHECK ("planningHeadcount" BETWEEN 0 AND 10000),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
 "snapshotDigest" text NOT NULL CHECK ("snapshotDigest" ~ '^[a-f0-9]{64}$'),
 "createdByAccountId" uuid REFERENCES "Account"(id) ON DELETE RESTRICT,
 "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("bookingId","revisionNumber"), UNIQUE(id,"bookingId"),
 FOREIGN KEY ("predecessorRevisionId","bookingId") REFERENCES "SeatingPlanRevision"(id,"bookingId") ON DELETE RESTRICT
);
ALTER TABLE "SeatingPlan" ADD FOREIGN KEY ("revisionId","bookingId") REFERENCES "SeatingPlanRevision"(id,"bookingId") DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "SeatingCommand" (
 "bookingId" uuid NOT NULL REFERENCES "Booking"(id) ON DELETE RESTRICT,
 "intentDigest" text NOT NULL CHECK ("intentDigest" ~ '^[a-f0-9]{64}$'),
 "commandDigest" text NOT NULL CHECK ("commandDigest" ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL, PRIMARY KEY("bookingId","intentDigest")
);
CREATE TABLE "SeatingOutbox" (
 id uuid PRIMARY KEY, "bookingId" uuid NOT NULL, "revisionId" uuid NOT NULL,
 "revisionNumber" integer NOT NULL CHECK ("revisionNumber">0),
 "eventType" text NOT NULL CHECK ("eventType" IN ('seating.plan-confirmed','seating.plan-requires-review')),
 payload jsonb NOT NULL, "occurredAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("bookingId","revisionNumber","eventType"),
 FOREIGN KEY ("revisionId","bookingId") REFERENCES "SeatingPlanRevision"(id,"bookingId") ON DELETE RESTRICT
);
CREATE FUNCTION seating_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Seating history is immutable';
END $$;
CREATE TRIGGER seating_immutable BEFORE UPDATE OR DELETE ON "SeatingPlanRevision" FOR EACH ROW EXECUTE FUNCTION seating_immutable();
CREATE TRIGGER seating_immutable BEFORE UPDATE OR DELETE ON "SeatingCommand" FOR EACH ROW EXECUTE FUNCTION seating_immutable();
CREATE TRIGGER seating_immutable BEFORE UPDATE OR DELETE ON "SeatingOutbox" FOR EACH ROW EXECUTE FUNCTION seating_immutable();
CREATE FUNCTION seating_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Seating head cannot be deleted'; END IF;
 IF NEW.id<>OLD.id OR NEW."bookingId"<>OLD."bookingId" OR NEW."revisionNumber"<OLD."revisionNumber" OR NEW."observedBookingRevision"<OLD."observedBookingRevision" OR (NEW."revisionNumber"=OLD."revisionNumber" AND NEW."revisionId"<>OLD."revisionId") THEN RAISE EXCEPTION 'Seating high-water mark cannot regress'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER seating_head_guard BEFORE UPDATE OR DELETE ON "SeatingPlan" FOR EACH ROW EXECUTE FUNCTION seating_head_guard();
CREATE FUNCTION seating_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE l jsonb; p "SeatingPlanRevision"; BEGIN
 IF NEW."predecessorRevisionId" IS NULL THEN
  IF NEW."revisionNumber"<>1 THEN RAISE EXCEPTION 'Missing seating predecessor'; END IF;
 ELSE
  SELECT * INTO p FROM "SeatingPlanRevision" WHERE id=NEW."predecessorRevisionId";
  IF p."planId"<>NEW."planId" OR p."revisionNumber"+1<>NEW."revisionNumber" OR p."bookingId"<>NEW."bookingId" THEN RAISE EXCEPTION 'Invalid seating predecessor'; END IF;
 END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(NEW.snapshot->'labels') LOOP
  IF NOT EXISTS(SELECT 1 FROM "GuestGroup" WHERE id=(l->>'guestGroupId')::uuid AND "bookingId"=NEW."bookingId") OR NOT EXISTS(SELECT 1 FROM "LayoutTableGeometry" WHERE "layoutTemplateVersionId"=NEW."layoutTemplateVersionId" AND "tableId"=(l->>'layoutTableId')::uuid) THEN RAISE EXCEPTION 'Invalid seating label reference'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER seating_reference_guard BEFORE INSERT ON "SeatingPlanRevision" FOR EACH ROW EXECUTE FUNCTION seating_reference_guard();
CREATE FUNCTION seating_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE h "SeatingPlan"; BEGIN
 SELECT * INTO h FROM "SeatingPlan" WHERE "bookingId"=NEW."bookingId";
 IF NOT EXISTS(SELECT 1 FROM "SeatingPlanRevision" WHERE id=h."revisionId" AND "bookingId"=h."bookingId" AND "planId"=h.id AND "revisionNumber"=h."revisionNumber") THEN RAISE EXCEPTION 'Seating head reference mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER seating_current_guard AFTER INSERT OR UPDATE ON "SeatingPlan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION seating_current_guard();
ALTER TABLE "InvitationSeatingInvalidation" DROP CONSTRAINT studio_invalidation;
ALTER TABLE "InvitationSeatingInvalidation" ADD CONSTRAINT studio_invalidation CHECK("revisionNumber">0 AND "reasonCode" IN ('HEADCOUNT_OUTSIDE_LAYOUT_RANGE','LAYOUT_RETIRED','SEATING_PLAN_REPLACED'));
