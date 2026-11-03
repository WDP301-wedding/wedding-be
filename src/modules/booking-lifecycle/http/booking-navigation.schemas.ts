import { z } from 'zod';
import { bookingRowSchema } from '../../analytics-dashboard/http/analytics.schemas.js';
import { intakeRecordSchema } from './experience.schemas.js';
export const numberPageQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(120).default(''),
});
export const bookingPageQuery = numberPageQuery.extend({
  scope: z.enum(['mine', 'all']).default('all'),
  phase: z.enum(['ALL', 'DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'COMPLETED']).default('ALL'),
  sort: z
    .enum(['recency', 'eventDate', 'hallName', 'shiftCode', 'tableCount', 'phase'])
    .default('recency'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export const consultationPageQuery = numberPageQuery.extend({
  status: z.enum(['ALL', 'NEW', 'CONVERTED', 'CLOSED']).default('ALL'),
  sort: z.enum(['createdAt', 'displayName', 'preferredDate', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export const navigationRowSchema = bookingRowSchema.extend({
  createdAt: z.iso.datetime(),
  brideName: z.string().nullable(),
  groomName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  managerAccountId: z.uuid().nullable(),
  managerEmail: z.string().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
});
const pageFields = {
  page: z.int().positive(),
  pageSize: z.int().positive(),
  total: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
};
export const bookingPageResponse = z.strictObject({
  data: z.strictObject({
    ...pageFields,
    items: z.array(navigationRowSchema).max(100),
    counts: z.strictObject({ all: z.int().nonnegative(), mine: z.int().nonnegative() }),
  }),
});
export const consultationPageResponse = z.strictObject({
  data: z.strictObject({
    ...pageFields,
    items: z.array(intakeRecordSchema).max(100),
    counts: z.strictObject({ total: z.int().nonnegative(), pending: z.int().nonnegative() }),
  }),
});
export const archivePageResponse = z.strictObject({
  data: z.strictObject({ ...pageFields, items: z.array(navigationRowSchema).max(100) }),
});
export const archiveDetailResponse = z.strictObject({
  data: z.strictObject({
    booking: navigationRowSchema,
    cancellationReason: z.string().nullable(),
    contract: z
      .strictObject({
        state: z.string(),
        totalVnd: z.int().nonnegative(),
        depositVnd: z.int().nonnegative(),
        document: z.unknown(),
      })
      .nullable(),
  }),
});
export const navigationResponse = z.strictObject({
  data: z.strictObject({ bookingId: z.uuid(), phase: z.string() }),
});
