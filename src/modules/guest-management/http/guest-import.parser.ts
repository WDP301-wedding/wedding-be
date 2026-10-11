import express, { Router } from 'express';
/** Installed before the general JSON parser; only this import path gets 5 MiB. */
export function createGuestImportBodyParser() {
  const router = Router();
  router.post(
    '/api/v1/bookings/:bookingId/guests/import-previews',
    express.json({ limit: 5 * 1024 * 1024 }),
  );
  return router;
}
