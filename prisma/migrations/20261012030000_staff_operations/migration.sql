-- CreateTable
CREATE TABLE "StaffConfiguration" (
    "bookingId" UUID NOT NULL,
    "checkInMode" TEXT NOT NULL DEFAULT 'NONE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "ledgerRevision" INTEGER NOT NULL DEFAULT 0,
    "reportSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StaffConfiguration_pkey" PRIMARY KEY ("bookingId")
);

ALTER TABLE "StaffConfiguration" ADD CONSTRAINT staff_config_booking_fk FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffConfiguration" ADD CONSTRAINT staff_config_values CHECK ("checkInMode" IN ('NONE','BY_GUEST_NAME') AND revision>0 AND "ledgerRevision">=0 AND "reportSequence">=0);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "staffAccountId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffHistory" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCommand" (
    "bookingId" UUID NOT NULL,
    "intentDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "StaffCommand_pkey" PRIMARY KEY ("bookingId","intentDigest")
);

-- CreateTable
CREATE TABLE "StaffCheckInRecord" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "ledgerRevision" INTEGER NOT NULL,
    "checkInRecordId" UUID,
    "guestGroupId" UUID NOT NULL,
    "groupNameSnapshot" VARCHAR(80) NOT NULL,
    "groupColorSnapshot" CHAR(7) NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "reason" VARCHAR(500),
    "overrideReason" VARCHAR(500),
    "eventTime" TIMESTAMPTZ(6) NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCheckInRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendanceSnapshot" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAttendanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffOutbox" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "ledgerRevision" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityStaffCommand" (
    "intentDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "IdentityStaffCommand_pkey" PRIMARY KEY ("intentDigest")
);

-- CreateIndex
CREATE INDEX "StaffAssignment_staffAccountId_status_idx" ON "StaffAssignment"("staffAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_bookingId_staffAccountId_key" ON "StaffAssignment"("bookingId", "staffAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffHistory_entityType_entityId_revision_key" ON "StaffHistory"("entityType", "entityId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCheckInRecord_checkInRecordId_key" ON "StaffCheckInRecord"("checkInRecordId");

-- CreateIndex
CREATE INDEX "StaffCheckInRecord_bookingId_guestId_ledgerRevision_idx" ON "StaffCheckInRecord"("bookingId", "guestId", "ledgerRevision");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCheckInRecord_bookingId_ledgerRevision_key" ON "StaffCheckInRecord"("bookingId", "ledgerRevision");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCheckInRecord_id_bookingId_guestId_key" ON "StaffCheckInRecord"("id", "bookingId", "guestId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendanceSnapshot_bookingId_sourceSequence_key" ON "StaffAttendanceSnapshot"("bookingId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "StaffOutbox_bookingId_ledgerRevision_key" ON "StaffOutbox"("bookingId", "ledgerRevision");

ALTER TABLE "StaffAssignment" ADD FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffAssignment" ADD FOREIGN KEY ("staffAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffAssignment" ADD CHECK (status IN ('ACTIVE','REVOKED') AND revision>0);
ALTER TABLE "StaffHistory" ADD FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffHistory" ADD FOREIGN KEY ("actorAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffCommand" ADD FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffCheckInRecord" ADD FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffCheckInRecord" ADD FOREIGN KEY ("guestId","bookingId") REFERENCES "Guest"(id,"bookingId") ON DELETE RESTRICT;
ALTER TABLE "StaffCheckInRecord" ADD FOREIGN KEY ("guestGroupId","bookingId") REFERENCES "GuestGroup"(id,"bookingId") ON DELETE RESTRICT;
ALTER TABLE "StaffCheckInRecord" ADD FOREIGN KEY ("actorAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffCheckInRecord" ADD FOREIGN KEY ("checkInRecordId","bookingId","guestId") REFERENCES "StaffCheckInRecord"(id,"bookingId","guestId") ON DELETE RESTRICT;
ALTER TABLE "StaffCheckInRecord" ADD CHECK ("ledgerRevision">0 AND ((action='CHECK_IN' AND "checkInRecordId" IS NULL AND reason IS NULL) OR (action='UNDO' AND "checkInRecordId" IS NOT NULL AND length(reason) BETWEEN 10 AND 500)));
ALTER TABLE "StaffCheckInRecord" ADD CHECK ("overrideReason" IS NULL OR length("overrideReason") BETWEEN 10 AND 500);
ALTER TABLE "StaffAttendanceSnapshot" ADD FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
ALTER TABLE "StaffOutbox" ADD FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
CREATE FUNCTION staff_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Staff history is immutable';
END $$;
CREATE TRIGGER staff_immutable BEFORE UPDATE OR DELETE ON "StaffHistory" FOR EACH ROW EXECUTE FUNCTION staff_immutable();
CREATE TRIGGER staff_immutable BEFORE UPDATE OR DELETE ON "StaffCommand" FOR EACH ROW EXECUTE FUNCTION staff_immutable();
CREATE TRIGGER staff_immutable BEFORE UPDATE OR DELETE ON "IdentityStaffCommand" FOR EACH ROW EXECUTE FUNCTION staff_immutable();
CREATE TRIGGER staff_immutable BEFORE UPDATE OR DELETE ON "StaffCheckInRecord" FOR EACH ROW EXECUTE FUNCTION staff_immutable();
CREATE TRIGGER staff_immutable BEFORE UPDATE OR DELETE ON "StaffAttendanceSnapshot" FOR EACH ROW EXECUTE FUNCTION staff_immutable();
CREATE TRIGGER staff_immutable BEFORE UPDATE OR DELETE ON "StaffOutbox" FOR EACH ROW EXECUTE FUNCTION staff_immutable();
CREATE FUNCTION staff_configuration_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW."ledgerRevision"<OLD."ledgerRevision" OR NEW."reportSequence"<OLD."reportSequence" OR NEW.revision<OLD.revision OR (OLD."ledgerRevision">0 AND NEW."checkInMode"<>OLD."checkInMode") THEN RAISE EXCEPTION 'Staff configuration history cannot be hidden'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_configuration_guard BEFORE UPDATE OR DELETE ON "StaffConfiguration" FOR EACH ROW EXECUTE FUNCTION staff_configuration_guard();

-- Enforce one effective named identity even if an infrastructure caller bypasses
-- the application command. Same booking lock order as Guest/Staff owner writes.
CREATE FUNCTION staff_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg "StaffConfiguration"%ROWTYPE; previous "StaffCheckInRecord"%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW."bookingId"::text));
 SELECT * INTO cfg FROM "StaffConfiguration" WHERE "bookingId"=NEW."bookingId" FOR UPDATE;
 IF cfg."checkInMode" IS DISTINCT FROM 'BY_GUEST_NAME' OR NEW."ledgerRevision" IS DISTINCT FROM cfg."ledgerRevision"+1 THEN RAISE EXCEPTION 'Staff journal sequence or mode conflict'; END IF;
 SELECT * INTO previous FROM "StaffCheckInRecord" WHERE "bookingId"=NEW."bookingId" AND "guestId"=NEW."guestId" ORDER BY "ledgerRevision" DESC LIMIT 1;
 IF NEW.action='CHECK_IN' THEN
  IF previous.action='CHECK_IN' OR NOT EXISTS(SELECT 1 FROM "Guest" WHERE id=NEW."guestId" AND "bookingId"=NEW."bookingId" AND status='ACTIVE') THEN RAISE EXCEPTION 'Guest check-in identity conflict'; END IF;
 ELSE
  IF previous.action IS DISTINCT FROM 'CHECK_IN' OR previous.id IS DISTINCT FROM NEW."checkInRecordId" THEN RAISE EXCEPTION 'Guest undo conflict'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_journal_guard BEFORE INSERT ON "StaffCheckInRecord" FOR EACH ROW EXECUTE FUNCTION staff_journal_guard();
