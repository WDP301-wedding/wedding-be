BEGIN;
-- Bind owner feeds to the schema where they are installed. Prisma schema-qualified
-- queries do not imply an equivalent PostgreSQL function search_path.
ALTER FUNCTION reporting_publish(TEXT,TEXT,JSONB) SET search_path FROM CURRENT;
ALTER FUNCTION analytics_capture_booking(UUID) SET search_path FROM CURRENT;
ALTER FUNCTION analytics_capture_billing(UUID) SET search_path FROM CURRENT;
ALTER FUNCTION analytics_booking_changed() SET search_path FROM CURRENT;
ALTER FUNCTION analytics_feed_changed() SET search_path FROM CURRENT;
ALTER FUNCTION analytics_capture_venue() SET search_path FROM CURRENT;
ALTER FUNCTION analytics_venue_changed() SET search_path FROM CURRENT;
-- Existing Seating owner already emits the explicit planning reason. Preserve old
-- history and accept the current non-RSVP identity, without rewriting old migrations.
ALTER TABLE "InvitationSeatingInvalidation" DROP CONSTRAINT studio_invalidation;
ALTER TABLE "InvitationSeatingInvalidation" ADD CONSTRAINT studio_invalidation CHECK(
  "revisionNumber">0 AND "reasonCode" IN ('HEADCOUNT_OUTSIDE_LAYOUT_RANGE','LAYOUT_RETIRED',
  'SEATING_PLAN_REPLACED','PLANNING_HEADCOUNT_CHANGED'));
COMMIT;
