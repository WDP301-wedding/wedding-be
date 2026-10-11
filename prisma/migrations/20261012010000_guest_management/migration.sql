-- CreateTable
CREATE TABLE "GuestWorkspace" (
    "bookingId" UUID NOT NULL,
    "planRevisionId" UUID NOT NULL,
    "planRevision" INTEGER NOT NULL DEFAULT 1,
    "planSequence" INTEGER NOT NULL,
    "listSequence" INTEGER NOT NULL DEFAULT 1,
    "initializedBookingRevision" INTEGER NOT NULL,

    CONSTRAINT "GuestWorkspace_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "GuestPlanRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "planningHeadcount" INTEGER NOT NULL,
    "sourceBookingRevision" INTEGER NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestPlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestGroup" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" CHAR(7) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "guestGroupId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "phone" VARCHAR(16),
    "operationalNote" VARCHAR(500),
    "externalRowKey" VARCHAR(120),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestHistory" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestCommand" (
    "bookingId" UUID NOT NULL,
    "intentDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "GuestCommand_pkey" PRIMARY KEY ("bookingId","intentDigest")
);

-- CreateTable
CREATE TABLE "GuestImportPreview" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "listSequence" INTEGER NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "rows" JSONB NOT NULL,
    "allowUpdates" BOOLEAN NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "unchangedCount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "GuestImportPreview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestInvitationCredential" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "publicInvitationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestInvitationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestInvitationSession" (
    "tokenHash" CHAR(64) NOT NULL,
    "credentialId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "GuestInvitationSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "GuestOutbox" (
    "eventId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestOutbox_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestWorkspace_planRevisionId_key" ON "GuestWorkspace"("planRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestPlanRevision_bookingId_revision_key" ON "GuestPlanRevision"("bookingId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "GuestPlanRevision_bookingId_sourceSequence_key" ON "GuestPlanRevision"("bookingId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "GuestPlanRevision_bookingId_id_key" ON "GuestPlanRevision"("bookingId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GuestGroup_bookingId_normalizedName_key" ON "GuestGroup"("bookingId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "GuestGroup_bookingId_id_key" ON "GuestGroup"("bookingId", "id");

-- CreateIndex
CREATE INDEX "Guest_bookingId_status_normalizedName_id_idx" ON "Guest"("bookingId", "status", "normalizedName", "id");

-- CreateIndex
CREATE INDEX "Guest_bookingId_guestGroupId_idx" ON "Guest"("bookingId", "guestGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_bookingId_externalRowKey_key" ON "Guest"("bookingId", "externalRowKey");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_bookingId_id_key" ON "Guest"("bookingId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GuestHistory_entityId_entityType_revision_key" ON "GuestHistory"("entityId", "entityType", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "GuestInvitationCredential_tokenHash_key" ON "GuestInvitationCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestInvitationCredential_bookingId_guestId_idx" ON "GuestInvitationCredential"("bookingId", "guestId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestInvitationCredential_guestId_revision_key" ON "GuestInvitationCredential"("guestId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "GuestOutbox_bookingId_eventType_sourceSequence_key" ON "GuestOutbox"("bookingId", "eventType", "sourceSequence");

-- Owner scope and retained identity constraints. No legacy migration is changed.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['GuestWorkspace','GuestPlanRevision','GuestGroup','Guest','GuestHistory','GuestCommand','GuestImportPreview','GuestInvitationCredential','GuestOutbox'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT',t,t||'_booking_fk');
 END LOOP;
END $$;
ALTER TABLE "GuestWorkspace" ADD CONSTRAINT guest_workspace_plan_fk FOREIGN KEY ("bookingId","planRevisionId") REFERENCES "GuestPlanRevision"("bookingId",id);
ALTER TABLE "Guest" ADD CONSTRAINT guest_group_scope_fk FOREIGN KEY ("bookingId","guestGroupId") REFERENCES "GuestGroup"("bookingId",id);
ALTER TABLE "GuestInvitationCredential" ADD CONSTRAINT guest_credential_scope_fk FOREIGN KEY ("bookingId","guestId") REFERENCES "Guest"("bookingId",id);
ALTER TABLE "GuestInvitationSession" ADD CONSTRAINT guest_session_credential_fk FOREIGN KEY ("credentialId") REFERENCES "GuestInvitationCredential"(id);
ALTER TABLE "GuestInvitationCredential" ADD CONSTRAINT guest_public_identity_fk FOREIGN KEY ("publicInvitationId") REFERENCES "InvitationPublicIdentity"(id);
ALTER TABLE "GuestWorkspace" ADD CONSTRAINT guest_workspace_bounds CHECK("planRevision">0 AND "planSequence">=0 AND "listSequence">0 AND "initializedBookingRevision">0);
ALTER TABLE "GuestPlanRevision" ADD CONSTRAINT guest_plan_bounds CHECK(revision>0 AND "sourceSequence">=0 AND "planningHeadcount" BETWEEN 0 AND 10000 AND "sourceBookingRevision">0);
ALTER TABLE "GuestGroup" ADD CONSTRAINT guest_group_bounds CHECK(revision>0 AND status IN ('ACTIVE','ARCHIVED') AND length(trim(name)) BETWEEN 1 AND 80 AND color ~ '^#[A-F0-9]{6}$');
ALTER TABLE "Guest" ADD CONSTRAINT guest_bounds CHECK(revision>0 AND status IN ('ACTIVE','ARCHIVED') AND length(trim(name)) BETWEEN 1 AND 120 AND (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'));
ALTER TABLE "GuestInvitationCredential" ADD CONSTRAINT guest_credential_bounds CHECK(revision>0 AND "tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "GuestInvitationSession" ADD CONSTRAINT guest_session_hash CHECK("tokenHash" ~ '^[a-f0-9]{64}$');
CREATE FUNCTION guest_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Guest history is immutable';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['GuestPlanRevision','GuestHistory','GuestCommand','GuestOutbox'] LOOP
  EXECUTE format('CREATE TRIGGER guest_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guest_immutable_guard()',t);
 END LOOP;
END $$;
CREATE FUNCTION guest_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW."bookingId"<>OLD."bookingId" OR NEW.revision<>OLD.revision+1 OR NEW."createdAt"<>OLD."createdAt" THEN
  RAISE EXCEPTION 'Guest identity is retained and revision must advance once';
 END IF;
 IF TG_TABLE_NAME='Guest' THEN
  IF NEW."externalRowKey" IS DISTINCT FROM OLD."externalRowKey" THEN RAISE EXCEPTION 'Import identity is stable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guest_identity BEFORE UPDATE OR DELETE ON "Guest" FOR EACH ROW EXECUTE FUNCTION guest_identity_guard();
CREATE TRIGGER guest_group_identity BEFORE UPDATE OR DELETE ON "GuestGroup" FOR EACH ROW EXECUTE FUNCTION guest_identity_guard();
CREATE FUNCTION guest_credential_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR
  (to_jsonb(NEW)-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'revokedAt') THEN
  RAISE EXCEPTION 'Credential evidence permits only once-only revocation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guest_credential_retained BEFORE UPDATE OR DELETE ON "GuestInvitationCredential" FOR EACH ROW EXECUTE FUNCTION guest_credential_guard();

CREATE TABLE "GuestExchangeLimit" (key CHAR(64) PRIMARY KEY, attempts INTEGER NOT NULL CHECK(attempts>0), "expiresAt" TIMESTAMPTZ(6) NOT NULL);
CREATE INDEX "GuestExchangeLimit_expiresAt_idx" ON "GuestExchangeLimit"("expiresAt");
