import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createGuestRouter } from '../../modules/guest-management/http/guest.router.js';
import { createStaffRouter } from '../../modules/staff-operations/http/staff.router.js';
import type { createGuestServices } from '../../modules/guest-management/infrastructure/guest.composition.js';
import type { createStaffServices } from '../../modules/staff-operations/infrastructure/staff.composition.js';
import { createOpenApiDocument } from '../openapi/generate.js';
import { AppError } from '../errors/app-error.js';

const booking = '11111111-1111-4111-8111-111111111111';
const resolver = { resolve: vi.fn().mockResolvedValue({ accountId: booking, roles: ['MANAGER'] }) };
function app() {
  const server = express();
  server.use(express.json());
  server.use(
    createGuestRouter({ identity: { resolver } } as unknown as ReturnType<
      typeof createGuestServices
    >),
  );
  server.use(createStaffRouter({ resolver } as unknown as ReturnType<typeof createStaffServices>));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (!(error instanceof AppError)) return next(error);
    res.status(error.status).json({ code: error.code });
  };
  server.use(errors);
  return server;
}
describe('retired named-guest and check-in HTTP surface', () => {
  it.each([
    ['get', `/bookings/${booking}/guests`],
    ['post', `/bookings/${booking}/guests`],
    ['patch', `/bookings/${booking}/guests/${booking}`],
    ['post', `/bookings/${booking}/guests/imports`],
    ['post', `/bookings/${booking}/guests/${booking}/invitation-links`],
    ['post', `/bookings/${booking}/guests/${booking}/delivery`],
    ['patch', `/bookings/${booking}/check-in-settings`],
    ['get', `/bookings/${booking}/check-in-settings`],
    ['get', `/staff/events/${booking}/guests/search`],
    ['post', `/staff/events/${booking}/guests/${booking}/check-ins`],
    ['post', `/staff/events/${booking}/guests/${booking}/check-in-undos`],
  ] as const)(
    'returns 410 for authenticated %s %s before old services execute',
    async (method, path) => {
      const response = await request(app())[method](path).set('Authorization', 'Bearer test');
      expect(response.status).toBe(410);
      expect(response.body).toEqual({ code: 'FEATURE_RETIRED' });
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );
  it('still requires authentication on retired routes', async () => {
    const response = await request(app()).get(`/bookings/${booking}/guests`);
    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('publishes retirement instead of promising successful guest/check-in writes', () => {
    const paths = createOpenApiDocument().paths!;
    for (const path of [
      '/bookings/{bookingId}/guests',
      '/bookings/{bookingId}/check-in-settings',
      '/staff/events/{bookingId}/guests/{guestId}/check-ins',
      '/bookings/{bookingId}/guests/{guestId}/delivery',
    ]) {
      const operation = paths[path]!.post ?? paths[path]!.patch!;
      expect(operation.deprecated).toBe(true);
      expect(operation.requestBody).toBeUndefined();
      expect(operation.responses).toHaveProperty('410');
      expect(operation.responses).not.toHaveProperty('201');
    }
  });
});
