BEGIN;

CREATE TYPE "BookingSlotHoldStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED', 'CONSUMED');
CREATE TYPE "DepositIntentPinStatus" AS ENUM ('NONE', 'ACTIVE', 'UNKNOWN', 'SETTLED', 'FAILED');

CREATE TABLE "BookingSlotHold" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "hallId" UUID NOT NULL,
  "eventDate" DATE NOT NULL,
  "shiftCode" "RestaurantShiftCode" NOT NULL,
  "status" "BookingSlotHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "depositIntentPin" "DepositIntentPinStatus" NOT NULL DEFAULT 'NONE',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "terminalAt" TIMESTAMPTZ(6),
  "acquiredByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BookingSlotHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingSlotHold_state_check" CHECK (
    ("status" = 'ACTIVE' AND "terminalAt" IS NULL)
    OR ("status" <> 'ACTIVE' AND "terminalAt" IS NOT NULL)
  ),
  CONSTRAINT "BookingSlotHold_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "BookingOutboxEvent" (
  "id" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" UUID NOT NULL,
  "aggregateRevision" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "payload" JSONB NOT NULL,
  "publishedAt" TIMESTAMPTZ(6),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingOutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingOutboxEvent_revision_attempt_check" CHECK (
    "aggregateRevision" > 0 AND "attemptCount" >= 0
  )
);

CREATE UNIQUE INDEX "BookingSlotHold_one_active_slot_key"
  ON "BookingSlotHold"("hallId", "eventDate", "shiftCode") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "BookingSlotHold_one_active_booking_key"
  ON "BookingSlotHold"("bookingId") WHERE "status" = 'ACTIVE';
CREATE INDEX "BookingSlotHold_bookingId_createdAt_idx"
  ON "BookingSlotHold"("bookingId", "createdAt" DESC);
CREATE INDEX "BookingSlotHold_status_expiresAt_idx"
  ON "BookingSlotHold"("status", "expiresAt");
CREATE UNIQUE INDEX "BookingOutboxEvent_eventType_aggregateId_aggregateRevision_key"
  ON "BookingOutboxEvent"("eventType", "aggregateId", "aggregateRevision");
CREATE INDEX "BookingOutboxEvent_publishedAt_occurredAt_idx"
  ON "BookingOutboxEvent"("publishedAt", "occurredAt");

ALTER TABLE "BookingSlotHold" ADD CONSTRAINT "BookingSlotHold_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingSlotHold" ADD CONSTRAINT "BookingSlotHold_hallId_fkey"
  FOREIGN KEY ("hallId") REFERENCES "Hall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
