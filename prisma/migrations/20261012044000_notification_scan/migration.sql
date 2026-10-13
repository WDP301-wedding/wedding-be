CREATE TABLE "NotificationScan" (
  "name" TEXT PRIMARY KEY,
  "fence" TIMESTAMPTZ(6) NOT NULL,
  "cursor" TEXT
);
