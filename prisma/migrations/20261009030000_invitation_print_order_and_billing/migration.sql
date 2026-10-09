-- CreateTable
CREATE TABLE "InvitationPrintOrder" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "currentCommercialRevisionId" UUID,
    "receivableChargeId" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "readyAt" TIMESTAMPTZ(6),
    "handedOverAt" TIMESTAMPTZ(6),
    "evidenceReference" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InvitationPrintOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationPrintLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "designId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "printableRevisionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationPrintLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationCommercialRevision" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "linesJson" JSONB NOT NULL,
    "orderTotalVnd" DECIMAL(18,0) NOT NULL,
    "estimatedHandoverAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationCommercialRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationPrintAudit" (
    "sequence" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationPrintAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvitationPrintOrder_bookingId_createdAt_idx" ON "InvitationPrintOrder"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "InvitationPrintLine_orderId_id_idx" ON "InvitationPrintLine"("orderId", "id");

-- CreateIndex
CREATE INDEX "InvitationPrintLine_bookingId_orderId_idx" ON "InvitationPrintLine"("bookingId", "orderId");

-- CreateIndex
CREATE INDEX "InvitationCommercialRevision_bookingId_orderId_idx" ON "InvitationCommercialRevision"("bookingId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationCommercialRevision_orderId_revisionNumber_key" ON "InvitationCommercialRevision"("orderId", "revisionNumber");

-- CreateIndex
CREATE INDEX "InvitationPrintAudit_bookingId_orderId_createdAt_idx" ON "InvitationPrintAudit"("bookingId", "orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationPrintAudit_sequence_key" ON "InvitationPrintAudit"("sequence");

-- CreateIndex
CREATE INDEX "InvitationPrintAudit_bookingId_sequence_idx" ON "InvitationPrintAudit"("bookingId", "sequence");





-- Immutable history triggers
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['InvitationCommercialRevision','InvitationPrintAudit'] LOOP
 EXECUTE format('CREATE TRIGGER studio_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION invitation_media_immutable()', t);
 END LOOP;
END $$;

-- Status and bounds constraints
ALTER TABLE "InvitationPrintOrder" ADD CONSTRAINT print_order_status CHECK(status IN ('REQUESTED','QUOTED','APPROVED','IN_PRODUCTION','READY_FOR_HANDOVER','HANDED_OVER','CANCELLED') AND revision > 0);
ALTER TABLE "InvitationPrintLine" ADD CONSTRAINT print_line_quantity CHECK(quantity BETWEEN 1 AND 10000);
ALTER TABLE "InvitationCommercialRevision" ADD CONSTRAINT commercial_revision_bounds CHECK("revisionNumber" > 0 AND "orderTotalVnd" > 0 AND "orderTotalVnd" <= 1000000000000 AND jsonb_typeof("linesJson") = 'array');
