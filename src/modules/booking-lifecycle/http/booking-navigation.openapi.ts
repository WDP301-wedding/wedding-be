import type { z } from 'zod';
import type { ZodOpenApiObject, ZodOpenApiOperationObject } from 'zod-openapi';
import {
  numberPageQuery,
  bookingPageQuery,
  consultationPageQuery,
  bookingPageResponse,
  consultationPageResponse,
  archivePageResponse,
  archiveDetailResponse,
  navigationResponse,
} from './booking-navigation.schemas.js';
const get = (
  operationId: string,
  schema: z.ZodType,
  description: string,
  query?: z.ZodObject,
): ZodOpenApiOperationObject => ({
  operationId,
  tags: ['Booking navigation'],
  description,
  security: [{ bearerAuth: [] }],
  ...(query ? { requestParams: { query } } : {}),
  responses: {
    '200': { description: 'Private no-store result.', content: { 'application/json': { schema } } },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '404': { $ref: '#/components/responses/NotFound' },
    '422': { $ref: '#/components/responses/UnprocessableEntity' },
  },
});
const booking = {
  name: 'bookingId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};
export const bookingNavigationPaths: NonNullable<ZodOpenApiObject['paths']> = {
  '/management/booking-page': {
    get: get(
      'getManagementBookingPage',
      bookingPageResponse,
      'Manager. Real database numbered pagination, consistent count/page snapshot, stable sorting and search. Excludes cancelled bookings. Mine uses the retained consultation manager, never browser-local claims.',
      bookingPageQuery,
    ),
  },
  '/management/consultation-page': {
    get: get(
      'getManagementConsultationPage',
      consultationPageResponse,
      'Manager. Real numbered pagination over all matching consultation requests; excludes records linked to cancelled bookings.',
      consultationPageQuery,
    ),
  },
  '/booking-archive': {
    get: get(
      'getBookingArchive',
      archivePageResponse,
      'Manager sees cancelled bookings; Couple sees only owned cancelled bookings. No records are deleted. Numbered pagination with consistent totals.',
      numberPageQuery,
    ),
  },
  '/bookings/{bookingId}/archive': {
    parameters: [booking],
    get: get(
      'getArchivedBooking',
      archiveDetailResponse,
      'Read-only cancelled booking and retained contract snapshot. Manager or owning Couple only. Active bookings do not appear here.',
    ),
  },
  '/bookings/{bookingId}/navigation': {
    parameters: [booking],
    get: get(
      'getBookingNavigation',
      navigationResponse,
      'Manager or owning Couple. Minimal authoritative phase for route admission, including cancelled bookings; no mutation.',
    ),
  },
};
