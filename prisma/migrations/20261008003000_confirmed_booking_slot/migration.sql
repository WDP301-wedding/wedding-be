CREATE UNIQUE INDEX "Booking_one_confirmed_slot_key"
ON "Booking" ("hallId", "eventDate", "shiftCode")
WHERE "phase" IN ('CONFIRMED', 'COMPLETED');
