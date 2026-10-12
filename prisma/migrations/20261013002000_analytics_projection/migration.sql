CREATE TABLE "AnalyticsGeneration" (id UUID PRIMARY KEY, scope TEXT NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(), checkpoints JSONB NOT NULL);
CREATE INDEX "AnalyticsGeneration_scope_createdAt_idx" ON "AnalyticsGeneration"(scope,"createdAt");
CREATE TABLE "AnalyticsHead" (scope TEXT PRIMARY KEY, "generationId" UUID NOT NULL REFERENCES "AnalyticsGeneration"(id));
CREATE TABLE "AnalyticsProjection" ("generationId" UUID NOT NULL REFERENCES "AnalyticsGeneration"(id), owner TEXT NOT NULL,
  "recordId" TEXT NOT NULL, sequence INTEGER NOT NULL, value JSONB NOT NULL, PRIMARY KEY("generationId",owner,"recordId"));
