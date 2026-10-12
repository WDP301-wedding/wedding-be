-- Extend the reason vocabulary without rewriting applied migrations or history.
ALTER TABLE "InvitationSeatingInvalidation" DROP CONSTRAINT studio_invalidation;
ALTER TABLE "InvitationSeatingInvalidation" ADD CONSTRAINT studio_invalidation
  CHECK ("revisionNumber" > 0 AND "reasonCode" IN (
    'HEADCOUNT_OUTSIDE_LAYOUT_RANGE', 'LAYOUT_RETIRED',
    'SEATING_PLAN_REPLACED', 'PLANNING_HEADCOUNT_CHANGED'
  ));
