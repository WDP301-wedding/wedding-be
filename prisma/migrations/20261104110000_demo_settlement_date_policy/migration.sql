-- Match the existing application demo policy without weakening phase, source,
-- immutability, payment-pin or ledger guards. Unscoped SQL remains strict.
CREATE OR REPLACE FUNCTION require_event_ended(bid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM "Booking" b
  JOIN "BookingProposalSnapshot" p ON p."bookingId"=b."id"
  WHERE b."id"=bid AND b."phase" IN ('CONFIRMED','COMPLETED')
 ) THEN
  RAISE EXCEPTION 'commercial invoice requires eligible booking' USING ERRCODE='23514';
 END IF;
 IF current_setting('app.strict_settlement_date_check', true) IS DISTINCT FROM 'false'
  AND NOT EXISTS(
   SELECT 1 FROM "Booking" b
   JOIN "BookingProposalSnapshot" p ON p."bookingId"=b."id"
   WHERE b."id"=bid
    AND (b."eventDate"+p."shiftEndTime") AT TIME ZONE 'Asia/Ho_Chi_Minh'<=CURRENT_TIMESTAMP
  ) THEN
  RAISE EXCEPTION 'commercial invoice requires authoritative event end' USING ERRCODE='23514';
 END IF;
END $$;
