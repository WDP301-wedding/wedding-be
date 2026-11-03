CREATE TABLE "StaffWorkItem" (
  "id" UUID NOT NULL, "bookingId" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('TASK','INCIDENT','HANDOVER')),
  "title" VARCHAR(160) NOT NULL, "description" VARCHAR(4000) NOT NULL,
  "priority" VARCHAR(16) NOT NULL DEFAULT 'NORMAL' CHECK ("priority" IN ('NORMAL','URGENT')),
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','IN_PROGRESS','DONE')),
  "assignedAccountId" UUID, "createdByAccountId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "StaffWorkItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffWorkItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StaffWorkItem_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StaffWorkItem_assignedAccountId_fkey" FOREIGN KEY ("assignedAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "StaffWorkItem_bookingId_createdAt_id_idx" ON "StaffWorkItem"("bookingId","createdAt","id");
CREATE INDEX "StaffWorkItem_assignedAccountId_status_idx" ON "StaffWorkItem"("assignedAccountId","status");
