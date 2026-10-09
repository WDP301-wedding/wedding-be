-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "hallId" UUID NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "planningHeadcount" INTEGER NOT NULL DEFAULT 0,
    "effectiveTimelineRevisionId" UUID,
    "confirmedPaymentId" UUID,
    "confirmedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingTimelineRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "eventDate" DATE NOT NULL,
    "hallName" TEXT NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "shiftStartTime" TEXT NOT NULL,
    "shiftEndTime" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "approvedByManagerAt" TIMESTAMPTZ(6),
    "approvedByCoupleAt" TIMESTAMPTZ(6),

    CONSTRAINT "BookingTimelineRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositSettlement" (
    "paymentId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "amountVnd" DECIMAL(18,0) NOT NULL,
    "settledAt" TIMESTAMPTZ(6) NOT NULL,
    "evidenceReference" TEXT NOT NULL,

    CONSTRAINT "DepositSettlement_pkey" PRIMARY KEY ("paymentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_consultationId_key" ON "Booking"("consultationId");
CREATE UNIQUE INDEX "Booking_id_effectiveTimelineRevisionId_key" ON "Booking"("id","effectiveTimelineRevisionId");
CREATE UNIQUE INDEX "Booking_id_confirmedPaymentId_key" ON "Booking"("id","confirmedPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingTimelineRevision_bookingId_revisionNumber_key" ON "BookingTimelineRevision"("bookingId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BookingTimelineRevision_bookingId_id_key" ON "BookingTimelineRevision"("bookingId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DepositSettlement_bookingId_key" ON "DepositSettlement"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositSettlement_bookingId_paymentId_key" ON "DepositSettlement"("bookingId", "paymentId");

-- AddForeignKey
ALTER TABLE "BookingTimelineRevision" ADD CONSTRAINT "BookingTimelineRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Matching immutable owner evidence, never a media-generated CONFIRMED flag.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_effective_timeline_fkey"
 FOREIGN KEY ("id", "effectiveTimelineRevisionId") REFERENCES "BookingTimelineRevision"("bookingId", "id") ON DELETE NO ACTION;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_confirmed_payment_fkey"
 FOREIGN KEY ("id", "confirmedPaymentId") REFERENCES "DepositSettlement"("bookingId", "paymentId") ON DELETE NO ACTION;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_read_context_check" CHECK (
 "phase" IN ('DRAFT','AWAITING_DEPOSIT','CONFIRMED','CANCELLED','COMPLETED') AND
 "shiftCode" IN ('LUNCH','DINNER') AND "revision">0 AND "planningHeadcount" BETWEEN 0 AND 10000 AND
 ("phase" NOT IN ('CONFIRMED','COMPLETED') OR
  ("effectiveTimelineRevisionId" IS NOT NULL AND "confirmedPaymentId" IS NOT NULL AND "confirmedAt" IS NOT NULL))
);
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_evidence_check" CHECK (
 "amountVnd">0 AND "amountVnd"<=9007199254740991 AND length("evidenceReference") BETWEEN 1 AND 512
);
ALTER TABLE "BookingTimelineRevision" ADD CONSTRAINT "BookingTimelineRevision_snapshot_check" CHECK (
 "revisionNumber">0 AND length("hallName") BETWEEN 1 AND 120 AND "shiftCode" IN ('LUNCH','DINNER') AND
 "shiftStartTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
 "shiftEndTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "shiftEndTime">"shiftStartTime" AND
 jsonb_typeof("items")='array' AND jsonb_array_length("items")<=100 AND
 (("approvedByManagerAt" IS NULL AND "approvedByCoupleAt" IS NULL) OR jsonb_array_length("items")>=1)
);

CREATE FUNCTION reject_settlement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Deposit settlement is immutable'; END $$;
CREATE TRIGGER "DepositSettlement_immutable" BEFORE UPDATE OR DELETE ON "DepositSettlement"
 FOR EACH ROW EXECUTE FUNCTION reject_settlement_mutation();

CREATE FUNCTION protect_booking_timeline_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Timeline revision is immutable'; END IF;
 IF (to_jsonb(NEW)-'approvedByManagerAt'-'approvedByCoupleAt') IS DISTINCT FROM
    (to_jsonb(OLD)-'approvedByManagerAt'-'approvedByCoupleAt') OR
    (OLD."approvedByManagerAt" IS NOT NULL AND NEW."approvedByManagerAt" IS DISTINCT FROM OLD."approvedByManagerAt") OR
    (OLD."approvedByCoupleAt" IS NOT NULL AND NEW."approvedByCoupleAt" IS DISTINCT FROM OLD."approvedByCoupleAt")
 THEN RAISE EXCEPTION 'Timeline content and recorded approvals are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BookingTimelineRevision_immutable" BEFORE UPDATE OR DELETE ON "BookingTimelineRevision"
 FOR EACH ROW EXECUTE FUNCTION protect_booking_timeline_revision();
