-- Add immutable multi-menu facts without repricing or rewriting historical proposals.
-- NULL marks pre-extension snapshots; readers synthesize their single existing line.
ALTER TABLE "BookingProposalSnapshot" ADD COLUMN "menus" JSONB;

CREATE FUNCTION booking_proposal_menu_totals_valid(lines JSONB, tables INTEGER, total NUMERIC)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT coalesce(
    count(*) BETWEEN 1 AND 50
    AND count(DISTINCT line."packageId") = count(*)
    AND count(DISTINCT line."versionId") = count(*)
    AND sum(line."tableCount") = tables
    AND sum(line."lineTotalVnd") = total AND total BETWEEN 0 AND 9007199254740991
    AND bool_and(coalesce(
      line."tableCount" BETWEEN 1 AND 500 AND trunc(line."tableCount") = line."tableCount"
      AND line."priceVndPerTable" BETWEEN 0 AND 9007199254740991
      AND trunc(line."priceVndPerTable") = line."priceVndPerTable"
      AND line."lineTotalVnd" = line."priceVndPerTable" * line."tableCount", FALSE)), FALSE)
  FROM jsonb_to_recordset(lines) AS line(
    "packageId" TEXT, "versionId" TEXT, "tableCount" NUMERIC,
    "priceVndPerTable" NUMERIC, "lineTotalVnd" NUMERIC
  );
$$;

ALTER TABLE "BookingProposalSnapshot" ADD CONSTRAINT "BookingProposalSnapshot_menus_check"
  CHECK ("menus" IS NULL OR (
    jsonb_typeof("menus") = 'array' AND jsonb_array_length("menus") BETWEEN 1 AND 50
    AND booking_proposal_menu_totals_valid("menus", "tableCount", "baseChargeVnd")
    AND "menus"->0->>'versionId' = "menuPackageVersionId"::TEXT
    AND "menus"->0->>'packageId' = "menuPackageId"::TEXT
    AND ("menus"->0->>'priceVndPerTable')::NUMERIC = "menuPriceVndPerTable"
  ));

-- Preserve the original single-menu invariant for NULL historical snapshots;
-- multi-menu totals are checked against all retained lines instead of the first.
ALTER TABLE "BookingProposalSnapshot" DROP CONSTRAINT "BookingProposalSnapshot_bounds_check";
ALTER TABLE "BookingProposalSnapshot" ADD CONSTRAINT "BookingProposalSnapshot_bounds_check"
  CHECK (
    "hallMaxGuests" BETWEEN 1 AND 10000 AND "menuVersionNumber" > 0
    AND "tableCount" BETWEEN 1 AND 500 AND "planningHeadcount" BETWEEN 0 AND 10000
    AND "menuPriceVndPerTable" >= 0
    AND ("menus" IS NOT NULL OR "baseChargeVnd" = "menuPriceVndPerTable" * "tableCount")
    AND "depositAmountVnd" = ceil("baseChargeVnd" * 0.30)
  );
-- The existing proposal immutability trigger protects the added column too.
