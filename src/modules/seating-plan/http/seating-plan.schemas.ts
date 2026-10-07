import { z } from 'zod';

import { strictWriteSchema } from '../../../core/http/validate.js';

// ─── Param schemas ────────────────────────────────────────────────────────────

export const bookingParamsSchema = z.strictObject({
  bookingId: z.uuid(),
});

export const planParamsSchema = z.strictObject({
  bookingId: z.uuid(),
  planId: z.uuid(),
});

export const managementPlanParamsSchema = z.strictObject({
  planId: z.uuid(),
});

export const layoutOptionsQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
});

// ─── Body schemas ─────────────────────────────────────────────────────────────

export const selectLayoutBodySchema = strictWriteSchema({
  layoutTemplateVersionId: z.uuid(),
  expectedBookingRevision: z.int().min(1),
});

export const saveRevisionBodySchema = strictWriteSchema({
  expectedRevision: z.int().min(1),
  labels: z.array(
    z.strictObject({
      layoutTableId: z.uuid(),
      guestGroupId: z.uuid(),
    }),
  ),
  layoutTemplateVersionId: z.uuid().optional(),
});

export const confirmBodySchema = strictWriteSchema({
  expectedRevision: z.int().min(1),
  expectedBookingRevision: z.int().min(1),
});

export const exceptionBodySchema = strictWriteSchema({
  expectedRevision: z.int().min(1),
  expectedBookingRevision: z.int().min(1),
  reason: z.string().trim().min(10).max(500),
});
