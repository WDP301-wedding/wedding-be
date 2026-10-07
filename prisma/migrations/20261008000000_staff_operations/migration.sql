-- CreateEnum
CREATE TYPE "StaffAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "StaffEventAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "staffAccountId" UUID NOT NULL,
    "status" "StaffAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMPTZ(6),
    "revocationReason" TEXT,
    "assignedByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StaffEventAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdAttendanceLedger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "invitationHouseholdId" UUID NOT NULL,
    "guestGroupIdSnapshot" UUID NOT NULL,
    "actualAttendees" INTEGER NOT NULL DEFAULT 0,
    "ledgerRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HouseholdAttendanceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceArrival" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ledgerId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "invitationHouseholdId" UUID NOT NULL,
    "attendeeCount" INTEGER NOT NULL,
    "guestGroupIdSnapshot" UUID NOT NULL,
    "eventTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByAccountId" UUID NOT NULL,
    "managerOverrideReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceArrival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ledgerId" UUID NOT NULL,
    "arrivalId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "invitationHouseholdId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "expectedLedgerRevision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffEventAssignment_bookingId_staffAccountId_key" ON "StaffEventAssignment"("bookingId", "staffAccountId");

-- CreateIndex
CREATE INDEX "StaffEventAssignment_bookingId_status_idx" ON "StaffEventAssignment"("bookingId", "status");

-- CreateIndex
CREATE INDEX "StaffEventAssignment_staffAccountId_status_idx" ON "StaffEventAssignment"("staffAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdAttendanceLedger_bookingId_invitationHouseholdId_key" ON "HouseholdAttendanceLedger"("bookingId", "invitationHouseholdId");

-- CreateIndex
CREATE INDEX "HouseholdAttendanceLedger_bookingId_idx" ON "HouseholdAttendanceLedger"("bookingId");

-- CreateIndex
CREATE INDEX "AttendanceArrival_ledgerId_idx" ON "AttendanceArrival"("ledgerId");

-- CreateIndex
CREATE INDEX "AttendanceArrival_bookingId_invitationHouseholdId_idx" ON "AttendanceArrival"("bookingId", "invitationHouseholdId");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_ledgerId_idx" ON "AttendanceCorrection"("ledgerId");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_arrivalId_idx" ON "AttendanceCorrection"("arrivalId");

-- AddForeignKey
ALTER TABLE "AttendanceArrival" ADD CONSTRAINT "AttendanceArrival_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "HouseholdAttendanceLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "HouseholdAttendanceLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_arrivalId_fkey" FOREIGN KEY ("arrivalId") REFERENCES "AttendanceArrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
