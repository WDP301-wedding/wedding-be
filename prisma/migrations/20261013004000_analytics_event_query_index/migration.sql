CREATE INDEX "AnalyticsProjection_booking_event_idx" ON "AnalyticsProjection"
  ("generationId", (value->>'eventDate'), (value->>'hallId'), "recordId") WHERE owner='booking';
