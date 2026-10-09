BEGIN;

CREATE TYPE "BookingDepositIntentStatus" AS ENUM ('ACTIVE', 'UNKNOWN', 'RELEASED', 'SETTLED');
CREATE TYPE "BookingPromotionStatus" AS ENUM ('PENDING', 'SUCCEEDED');

CREATE TABLE "BookingDepositIntent" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "timelineRevisionId" UUID NOT NULL,
  "amountVnd" DECIMAL(18,0) NOT NULL,
  "status" "BookingDepositIntentStatus" NOT NULL DEFAULT 'ACTIVE',
  "bookingRevisionReserved" INTEGER NOT NULL,
  "coupleAccountId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "providerEvidenceId" TEXT,
  "releasedAt" TIMESTAMPTZ(6),
  "settledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BookingDepositIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingDepositIntent_values_check" CHECK (
    "amountVnd" >= 0 AND "bookingRevisionReserved" > 0 AND "expiresAt" > "createdAt"
  ),
  CONSTRAINT "BookingDepositIntent_state_check" CHECK (
    ("status" IN ('ACTIVE', 'UNKNOWN') AND "releasedAt" IS NULL AND "settledAt" IS NULL)
    OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL AND "settledAt" IS NULL)
    OR ("status" = 'SETTLED' AND "releasedAt" IS NULL AND "settledAt" IS NOT NULL)
  )
);

CREATE TABLE "BookingDepositSettlement" (
  "paymentId" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "timelineRevisionId" UUID NOT NULL,
  "amountVnd" DECIMAL(18,0) NOT NULL,
  "settledAt" TIMESTAMPTZ(6) NOT NULL,
  "promotionStatus" "BookingPromotionStatus" NOT NULL DEFAULT 'PENDING',
  "promotedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingDepositSettlement_pkey" PRIMARY KEY ("paymentId"),
  CONSTRAINT "BookingDepositSettlement_bookingId_key" UNIQUE ("bookingId"),
  CONSTRAINT "BookingDepositSettlement_amount_check" CHECK ("amountVnd" >= 0),
  CONSTRAINT "BookingDepositSettlement_promotion_check" CHECK (
    ("promotionStatus" = 'PENDING' AND "promotedAt" IS NULL)
    OR ("promotionStatus" = 'SUCCEEDED' AND "promotedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "BookingDepositIntent_one_unresolved_key"
  ON "BookingDepositIntent"("bookingId") WHERE "status" IN ('ACTIVE', 'UNKNOWN');
CREATE INDEX "BookingDepositIntent_status_expiresAt_idx" ON "BookingDepositIntent"("status", "expiresAt");
CREATE INDEX "BookingDepositIntent_timelineRevisionId_idx" ON "BookingDepositIntent"("timelineRevisionId");
CREATE INDEX "BookingDepositSettlement_promotionStatus_createdAt_idx"
  ON "BookingDepositSettlement"("promotionStatus", "createdAt");

ALTER TABLE "BookingDepositIntent" ADD CONSTRAINT "BookingDepositIntent_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingDepositIntent" ADD CONSTRAINT "BookingDepositIntent_timelineRevisionId_fkey"
  FOREIGN KEY ("timelineRevisionId") REFERENCES "BookingTimelineRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingDepositSettlement" ADD CONSTRAINT "BookingDepositSettlement_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
