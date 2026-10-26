-- Preserve optional customer selections separately from free-text notes.
ALTER TABLE "ConsultationRequest"
  ADD COLUMN "preferredHallId" UUID,
  ADD COLUMN "preferredMenuVersionId" UUID,
  ADD COLUMN "preferredShift" "RestaurantShiftCode";
