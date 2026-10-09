BEGIN;

CREATE TYPE "BookingTimelineRevisionState" AS ENUM ('CURRENT', 'SUPERSEDED', 'EFFECTIVE');
CREATE TYPE "BookingTimelineParty" AS ENUM ('MANAGER', 'COUPLE');
CREATE TYPE "BookingTimelineDecisionType" AS ENUM ('APPROVED', 'WITHDRAWN');

ALTER TABLE "Booking"
  ADD COLUMN "currentTimelineRevisionId" UUID,
  ADD COLUMN "effectiveTimelineRevisionId" UUID;

CREATE TABLE "BookingTimelineRevision" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "predecessorRevisionId" UUID,
  "state" "BookingTimelineRevisionState" NOT NULL DEFAULT 'CURRENT',
  "managerApprovedAt" TIMESTAMPTZ(6),
  "coupleApprovedAt" TIMESTAMPTZ(6),
  "contentHash" TEXT NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BookingTimelineRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingTimelineRevision_number_check" CHECK ("revisionNumber" > 0),
  CONSTRAINT "BookingTimelineRevision_predecessor_check" CHECK ("predecessorRevisionId" IS NULL OR "predecessorRevisionId" <> "id")
);

CREATE TABLE "BookingTimelineItem" (
  "id" UUID NOT NULL,
  "timelineRevisionId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "startTime" TIME(0) NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "BookingTimelineItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingTimelineItem_content_check" CHECK (
    "displayOrder" BETWEEN 0 AND 99
    AND char_length(btrim("title")) BETWEEN 1 AND 120
    AND ("description" IS NULL OR char_length("description") <= 2000)
  )
);

CREATE TABLE "BookingTimelineDecision" (
  "id" UUID NOT NULL,
  "timelineRevisionId" UUID NOT NULL,
  "party" "BookingTimelineParty" NOT NULL,
  "decision" "BookingTimelineDecisionType" NOT NULL,
  "sequence" INTEGER NOT NULL,
  "reason" TEXT,
  "actorAccountId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BookingTimelineDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingTimelineDecision_content_check" CHECK (
    "sequence" > 0 AND ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500)
  )
);

CREATE UNIQUE INDEX "Booking_currentTimelineRevisionId_key" ON "Booking"("currentTimelineRevisionId");
CREATE UNIQUE INDEX "Booking_effectiveTimelineRevisionId_key" ON "Booking"("effectiveTimelineRevisionId");
CREATE UNIQUE INDEX "BookingTimelineRevision_bookingId_revisionNumber_key" ON "BookingTimelineRevision"("bookingId", "revisionNumber");
CREATE UNIQUE INDEX "BookingTimelineRevision_one_current_key" ON "BookingTimelineRevision"("bookingId") WHERE "state" = 'CURRENT';
CREATE INDEX "BookingTimelineRevision_bookingId_createdAt_idx" ON "BookingTimelineRevision"("bookingId", "createdAt" DESC);
CREATE UNIQUE INDEX "BookingTimelineItem_timelineRevisionId_itemId_key" ON "BookingTimelineItem"("timelineRevisionId", "itemId");
CREATE UNIQUE INDEX "BookingTimelineItem_timelineRevisionId_displayOrder_key" ON "BookingTimelineItem"("timelineRevisionId", "displayOrder");
CREATE UNIQUE INDEX "BookingTimelineDecision_timelineRevisionId_party_sequence_key" ON "BookingTimelineDecision"("timelineRevisionId", "party", "sequence");
CREATE INDEX "BookingTimelineDecision_timelineRevisionId_occurredAt_idx" ON "BookingTimelineDecision"("timelineRevisionId", "occurredAt");

ALTER TABLE "BookingTimelineRevision" ADD CONSTRAINT "BookingTimelineRevision_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingTimelineRevision" ADD CONSTRAINT "BookingTimelineRevision_predecessorRevisionId_fkey"
  FOREIGN KEY ("predecessorRevisionId") REFERENCES "BookingTimelineRevision"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "BookingTimelineItem" ADD CONSTRAINT "BookingTimelineItem_timelineRevisionId_fkey"
  FOREIGN KEY ("timelineRevisionId") REFERENCES "BookingTimelineRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingTimelineDecision" ADD CONSTRAINT "BookingTimelineDecision_timelineRevisionId_fkey"
  FOREIGN KEY ("timelineRevisionId") REFERENCES "BookingTimelineRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_currentTimelineRevisionId_fkey"
  FOREIGN KEY ("currentTimelineRevisionId") REFERENCES "BookingTimelineRevision"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_effectiveTimelineRevisionId_fkey"
  FOREIGN KEY ("effectiveTimelineRevisionId") REFERENCES "BookingTimelineRevision"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
