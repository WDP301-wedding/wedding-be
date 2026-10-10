-- Legacy labels are retained verbatim. No role/name inference or backfill.
ALTER TABLE "Consultation" ADD COLUMN "brideName" TEXT, ADD COLUMN "groomName" TEXT;
ALTER TABLE "ConsultationRequest" ADD COLUMN "brideName" TEXT, ADD COLUMN "groomName" TEXT;
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_couple_names_length"
CHECK (("brideName" IS NULL OR char_length("brideName") BETWEEN 1 AND 120)
   AND ("groomName" IS NULL OR char_length("groomName") BETWEEN 1 AND 120));
ALTER TABLE "ConsultationRequest" ADD CONSTRAINT "ConsultationRequest_couple_names_length"
CHECK (("brideName" IS NULL OR char_length("brideName") BETWEEN 1 AND 120)
   AND ("groomName" IS NULL OR char_length("groomName") BETWEEN 1 AND 120));
