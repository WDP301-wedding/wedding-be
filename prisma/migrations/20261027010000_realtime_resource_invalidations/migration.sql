-- Forward-only: queue metadata invalidations for the existing owner-authorized audit stream.
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
    'consultation-request', 'STAFF_OPERATIONS', 'invitation-design'
  ) THEN RETURN NEW; END IF;
  source_id := COALESCE(document->>'eventId', document->>'id')::uuid;
  IF TG_ARGV[0] = 'notification' THEN source_revision := (document->>'revision')::integer; END IF;
  EXECUTE format('INSERT INTO %I."RealtimeDelivery" ("stream", "eventId", "revision") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', TG_TABLE_SCHEMA)
    USING TG_ARGV[0], source_id, source_revision;
  RETURN NEW;
END $$;
