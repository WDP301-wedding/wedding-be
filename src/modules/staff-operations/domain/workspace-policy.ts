import { z } from 'zod';
import { eventOperationsSchema } from '../../booking-lifecycle/application/event-operations.reader.js';
import { approvedTimelineSnapshotSchema } from '../../booking-lifecycle/application/booking-readers.js';
import { seatingRenderSchema } from '../../invitation-studio/domain/studio-policy.js';
const text = (max: number) => z.string().trim().normalize('NFC').min(1).max(max);
export const workKind = z.enum(['TASK', 'INCIDENT', 'HANDOVER']);
export const workStatus = z.enum(['OPEN', 'IN_PROGRESS', 'DONE']);
export const workPriority = z.enum(['NORMAL', 'URGENT']);
export const eventListQuery = z.strictObject({
  q: z.string().trim().max(120).default(''),
  afterId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  phase: z.enum(['CONFIRMED', 'COMPLETED']).default('CONFIRMED'),
});
export const eventListSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        bookingId: z.uuid(),
        bookingCode: z.string(),
        alias: z.string().nullable(),
        eventDate: z.iso.date(),
        hallName: z.string(),
        shiftCode: z.enum(['LUNCH', 'DINNER']),
        phase: z.enum(['CONFIRMED', 'COMPLETED']),
      }),
    )
    .max(50),
  nextAfterId: z.uuid().nullable(),
});
export const workspaceSchema = z.strictObject({
  bookingId: z.uuid(),
  bookingCode: z.string(),
  alias: z.string().nullable(),
  operations: eventOperationsSchema,
  planningHeadcount: z.int().nonnegative(),
  isManager: z.boolean(),
  timeline: approvedTimelineSnapshotSchema,
  seating: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ABSENT'), renderSnapshot: z.tuple([]) }),
    z.strictObject({
      status: z.enum(['DRAFT', 'CONFIRMED', 'REQUIRES_REVIEW']),
      renderSnapshot: seatingRenderSchema,
    }),
  ]),
  members: z.array(z.strictObject({ accountId: z.uuid(), label: z.string() })).max(100),
});
export const workCreateInput = z.strictObject({
  kind: workKind,
  title: text(160),
  description: text(4000),
  priority: workPriority.default('NORMAL'),
  assignedAccountId: z.uuid().nullable().default(null),
});
export const workUpdateInput = z.strictObject({
  expectedRevision: z.int().positive(),
  status: workStatus,
  assignedAccountId: z.uuid().nullable().optional(),
  note: text(2000),
});
export const workPageQuery = z.strictObject({
  afterId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  kind: workKind.optional(),
});
export const workItemSchema = z.strictObject({
  id: z.uuid(),
  bookingId: z.uuid(),
  kind: workKind,
  title: z.string(),
  description: z.string(),
  priority: workPriority,
  status: workStatus,
  assignedAccountId: z.uuid().nullable(),
  createdByAccountId: z.uuid(),
  revision: z.int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const workPageSchema = z.strictObject({
  items: z.array(workItemSchema).max(50),
  nextAfterId: z.uuid().nullable(),
});
export const workHistoryQuery = z.strictObject({
  afterRevision: z.coerce.number().int().nonnegative().default(0),
});
export const workHistorySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        revision: z.int().positive(),
        actorAccountId: z.uuid(),
        createdAt: z.iso.datetime(),
        snapshot: z.record(z.string(), z.unknown()),
      }),
    )
    .max(25),
  nextAfterRevision: z.int().positive().nullable(),
});
