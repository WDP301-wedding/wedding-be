-- CreateEnum
CREATE TYPE "SeatingPlanStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REQUIRES_REVIEW');

-- CreateTable
CREATE TABLE "SeatingPlan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "status" "SeatingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" UUID,
    "confirmedRevisionId" UUID,
    "planRevision" INTEGER NOT NULL DEFAULT 1,
    "createdByAccountId" UUID NOT NULL,
    "updatedByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SeatingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatingPlanRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seatingPlanId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "layoutTemplateVersionId" UUID NOT NULL,
    "expectedAttendees" INTEGER NOT NULL,
    "revisionDigest" TEXT NOT NULL,
    "createdByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatingPlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatingPlanLabel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisionId" UUID NOT NULL,
    "layoutTableId" UUID NOT NULL,
    "guestGroupId" UUID NOT NULL,
    "colorSnapshot" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "SeatingPlanLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatingPlanExceptionRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seatingPlanId" UUID NOT NULL,
    "planRevisionAtException" INTEGER NOT NULL,
    "bookingRevisionSnapshot" INTEGER NOT NULL,
    "headcountSnapshot" INTEGER NOT NULL,
    "layoutTemplateVersionId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatingPlanExceptionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatingRevisionRegistration" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisionId" UUID NOT NULL,
    "validityProofJson" JSONB NOT NULL,
    "digestAtRegistration" TEXT NOT NULL,
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SeatingRevisionRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeatingPlan_bookingId_key" ON "SeatingPlan"("bookingId");

-- CreateIndex
CREATE INDEX "SeatingPlan_bookingId_status_idx" ON "SeatingPlan"("bookingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SeatingPlanRevision_seatingPlanId_revisionNumber_key" ON "SeatingPlanRevision"("seatingPlanId", "revisionNumber");

-- CreateIndex
CREATE INDEX "SeatingPlanRevision_seatingPlanId_revisionNumber_idx" ON "SeatingPlanRevision"("seatingPlanId", "revisionNumber" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SeatingPlanLabel_revisionId_layoutTableId_key" ON "SeatingPlanLabel"("revisionId", "layoutTableId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatingPlanLabel_revisionId_displayOrder_key" ON "SeatingPlanLabel"("revisionId", "displayOrder");

-- CreateIndex
CREATE INDEX "SeatingPlanLabel_revisionId_idx" ON "SeatingPlanLabel"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatingPlanExceptionRecord_seatingPlanId_key" ON "SeatingPlanExceptionRecord"("seatingPlanId");

-- CreateIndex
CREATE INDEX "SeatingPlanExceptionRecord_seatingPlanId_idx" ON "SeatingPlanExceptionRecord"("seatingPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatingRevisionRegistration_revisionId_key" ON "SeatingRevisionRegistration"("revisionId");

-- CreateIndex
CREATE INDEX "SeatingRevisionRegistration_invalidatedAt_idx" ON "SeatingRevisionRegistration"("invalidatedAt");

-- AddForeignKey
ALTER TABLE "SeatingPlanRevision" ADD CONSTRAINT "SeatingPlanRevision_seatingPlanId_fkey" FOREIGN KEY ("seatingPlanId") REFERENCES "SeatingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatingPlanLabel" ADD CONSTRAINT "SeatingPlanLabel_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SeatingPlanRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatingPlanExceptionRecord" ADD CONSTRAINT "SeatingPlanExceptionRecord_seatingPlanId_fkey" FOREIGN KEY ("seatingPlanId") REFERENCES "SeatingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatingRevisionRegistration" ADD CONSTRAINT "SeatingRevisionRegistration_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SeatingPlanRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
