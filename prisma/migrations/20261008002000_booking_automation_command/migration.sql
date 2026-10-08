CREATE TABLE "BookingAutomationCommand" (
  "commandId" UUID PRIMARY KEY,
  "bookingId" UUID NOT NULL,
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" > 0),
  "requestedAt" TIMESTAMPTZ(6) NOT NULL,
  "completedAt" TIMESTAMPTZ(6) NOT NULL
);
