-- Queue insertion participates in the source transaction: a late commit becomes
-- pending regardless of source timestamp. No timestamp watermark can skip it.
CREATE TABLE "RealtimeDelivery" (
  "stream" TEXT NOT NULL,
  "eventId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "enqueuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  "leaseToken" UUID,
  "leaseUntil" TIMESTAMPTZ(6),
  "deliveredAt" TIMESTAMPTZ(6),
  PRIMARY KEY ("stream", "eventId", "revision")
);
CREATE INDEX "RealtimeDelivery_pending_idx" ON "RealtimeDelivery" ("stream", "enqueuedAt", "eventId", "revision") WHERE "deliveredAt" IS NULL;

CREATE FUNCTION enqueue_realtime_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document JSONB := to_jsonb(NEW);
  source_id UUID;
  source_revision INTEGER := 1;
BEGIN
  IF TG_ARGV[0] = 'audit' AND document->>'entityType' NOT IN (
    'restaurant-profile', 'restaurant-shift', 'hall', 'dish', 'dish-version',
    'menu-package', 'menu-package-version', 'timeline-template',
    'timeline-template-version', 'layout-template', 'layout-template-version',
    'layout-table-identity', 'catalog-media-asset', 'print-offering', 'restaurant-service'
  ) THEN RETURN NEW; END IF;
  source_id := COALESCE(document->>'eventId', document->>'id')::uuid;
  IF TG_ARGV[0] = 'notification' THEN source_revision := (document->>'revision')::integer; END IF;
  EXECUTE format('INSERT INTO %I."RealtimeDelivery" ("stream", "eventId", "revision") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', TG_TABLE_SCHEMA)
    USING TG_ARGV[0], source_id, source_revision;
  RETURN NEW;
END $$;

DO $$
DECLARE spec TEXT[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['BookingOutboxEvent','booking','id'], ['BillingOutboxEvent','billing','id'],
    ['GuestOutbox','guest','eventId'], ['SeatingOutbox','seating','id'],
    ['InvitationStudioOutbox','studio','eventId'], ['IdentityOutbox','identity','eventId'],
    ['StaffOutbox','staff','id'], ['NotificationInbox','notification','id'], ['AuditLog','audit','id']
  ] LOOP
    EXECUTE format('CREATE TRIGGER realtime_enqueue AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION enqueue_realtime_delivery(%L)', spec[1], spec[2]);
    IF spec[2] = 'notification' THEN
      EXECUTE format('CREATE TRIGGER realtime_revision AFTER UPDATE OF "revision" ON %I FOR EACH ROW WHEN (OLD."revision" IS DISTINCT FROM NEW."revision") EXECUTE FUNCTION enqueue_realtime_delivery(%L)', spec[1], spec[2]);
      EXECUTE format('INSERT INTO "RealtimeDelivery" ("stream","eventId","revision") SELECT %L,%I,"revision" FROM %I ON CONFLICT DO NOTHING', spec[2], spec[3], spec[1]);
    ELSIF spec[2] = 'audit' THEN
      -- Same source contract as catalog-events.ts. Non-catalog audits are private.
      EXECUTE format('INSERT INTO "RealtimeDelivery" ("stream","eventId") SELECT %L,%I FROM %I WHERE "entityType" = ANY($1) ON CONFLICT DO NOTHING', spec[2], spec[3], spec[1])
      USING ARRAY['restaurant-profile','restaurant-shift','hall','dish','dish-version','menu-package','menu-package-version','timeline-template','timeline-template-version','layout-template','layout-template-version','layout-table-identity','catalog-media-asset','print-offering','restaurant-service'];
    ELSE
      EXECUTE format('INSERT INTO "RealtimeDelivery" ("stream","eventId") SELECT %L,%I FROM %I ON CONFLICT DO NOTHING', spec[2], spec[3], spec[1]);
    END IF;
  END LOOP;
END $$;
