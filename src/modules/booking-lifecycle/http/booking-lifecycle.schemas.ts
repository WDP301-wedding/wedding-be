import { z } from 'zod';
import { coupleProfileFields } from '../domain/couple-profile.js';
import { isBookableEventDate } from '../domain/event-date.js';

const uuid = z.uuid();
const revision = z.int().positive();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
const reason = z.string().trim().min(1).max(500);

export const consultationParamsSchema = z.strictObject({ consultationId: uuid });
export const bookingParamsSchema = z.strictObject({ bookingId: uuid });
export const timelineParamsSchema = z.strictObject({ bookingId: uuid, revisionId: uuid });
export const cancellationDecisionParamsSchema = z.strictObject({
  bookingId: uuid,
  requestId: uuid,
});
export const cancellationDecisionBodySchema = z.strictObject({
  expectedRevision: revision,
  decision: z.enum(['APPROVE', 'REJECT']),
  reason,
});

export const createConsultationBodySchema = z.strictObject({
  sourceConsultationId: uuid
    .optional()
    .meta({
      description:
        'Explicit existing-customer selection from an owned consultation. The server verifies the matching email and existing active customer grant before linking RESTRICTED access atomically; typing an email alone never links an account.',
    }),
  ...coupleProfileFields,
  intendedEmail: z.email(),
  displayName: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2_000).optional(),
});

export const workspaceInvitationBodySchema = z.strictObject({ expectedRevision: revision });

export const availabilityQuerySchema = z.strictObject({
  hallId: uuid,
  eventDate: localDate,
  shiftCode: z.enum(['LUNCH', 'DINNER']),
});

export const createBookingBodySchema = z
  .strictObject({
    consultationId: uuid,
    hallId: uuid,
    eventDate: localDate.refine((value) => isBookableEventDate(value), {
      message: 'Ngày tổ chức phải là ngày hợp lệ, từ ngày mốt trở đi (theo giờ Việt Nam).',
    }),
    shiftCode: z.enum(['LUNCH', 'DINNER']),
    menuPackageVersionId: uuid
      .optional()
      .meta({ description: 'Legacy single-menu input. Requires tableCount and excludes menus.' }),
    tableCount: z.int().min(1).max(500).optional().meta({
      description:
        'Legacy single-menu table quantity. For multiple menus, supply only menus[].tableCount.',
    }),
    menus: z
      .array(
        z.strictObject({
          menuPackageVersionId: uuid.overwrite((value) => value.toLowerCase()),
          tableCount: z.int().min(1).max(500),
        }),
      )
      .min(1)
      .max(50)
      .optional()
      .meta({
        description:
          'Preferred selection: 1–50 distinct menu versions, positive table quantity per menu, at most 500 tables in total. Excludes top-level menuPackageVersionId and tableCount. Prices and totals are resolved by the server.',
      }),
    planningHeadcount: z.int().min(0).max(10_000),
    expectedRevision: revision,
  })
  .superRefine((value, context) => {
    if (value.menus !== undefined) {
      if (
        value.menuPackageVersionId !== undefined ||
        value.tableCount !== undefined ||
        new Set(value.menus.map((line) => line.menuPackageVersionId)).size !== value.menus.length ||
        value.menus.reduce((sum, line) => sum + line.tableCount, 0) > 500
      ) {
        context.addIssue({
          code: 'custom',
          path: ['menus'],
          message:
            'Use distinct menus with at most 500 total tables; do not mix legacy selection fields.',
        });
      }
    } else if (value.menuPackageVersionId === undefined || value.tableCount === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['menus'],
        message: 'Supply menus or both legacy menuPackageVersionId and tableCount.',
      });
    }
  })
  .meta({
    override: {
      oneOf: [
        {
          required: ['menus'],
          not: { anyOf: [{ required: ['menuPackageVersionId'] }, { required: ['tableCount'] }] },
        },
        { required: ['menuPackageVersionId', 'tableCount'], not: { required: ['menus'] } },
      ],
    },
  });

export const expectedRevisionBodySchema = z.strictObject({ expectedRevision: revision });

export const timelineItemSchema = z.strictObject({
  itemId: uuid.optional(),
  order: z.int().min(0).max(99),
  startTime: localTime,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
});

export const timelineRevisionBodySchema = z.strictObject({
  expectedRevision: revision,
  predecessorRevisionId: uuid.nullable(),
  items: z.array(timelineItemSchema).max(100),
});

export const approvalBodySchema = expectedRevisionBodySchema;

export const withdrawalBodySchema = z.strictObject({
  expectedRevision: revision,
  reason,
});

export const changeRequestBodySchema = z.strictObject({
  expectedRevision: revision,
  items: z.array(timelineItemSchema).max(100),
  reason,
});

export const cancellationBodySchema = z.strictObject({
  expectedRevision: revision,
  reason,
});

export const consultationResponseSchema = z.strictObject({
  data: z.strictObject({ consultationId: uuid, revision }),
});

export const bookingResponseSchema = z.strictObject({
  data: z.strictObject({ bookingId: uuid, revision, consultationRevision: revision }),
});
