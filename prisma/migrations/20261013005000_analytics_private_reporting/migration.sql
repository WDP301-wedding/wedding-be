BEGIN;
-- Backend owns these private projections. Public API roles receive no policies;
-- enabling RLS also covers installations with default public SELECT grants.
ALTER TABLE "ReportingSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportingFact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsGeneration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsHead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsProjection" ENABLE ROW LEVEL SECURITY;
COMMIT;
