import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  CatalogPolicyError,
  transitionCatalogLifecycle,
  validateCatalogDescription,
  validateCatalogName,
  validateHallMaximumGuests,
  validateShiftWindow,
  type CatalogLifecycle,
} from '../domain/catalog-policy.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';

export type RestaurantShiftCode = 'LUNCH' | 'DINNER';

export interface RestaurantProfileView {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly address: string;
  readonly publicPhone: string | null;
  readonly publicEmail: string | null;
  readonly revision: number;
}

export interface ShiftSnapshot {
  readonly code: RestaurantShiftCode;
  readonly startTime: string;
  readonly endTime: string;
}

export interface ShiftView extends ShiftSnapshot {
  readonly isActive: boolean;
  readonly revision: number;
}

export interface HallSnapshot {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maxGuests: number;
}

export interface HallView extends HallSnapshot {
  readonly displayOrder: number;
  readonly lifecycle: CatalogLifecycle;
  readonly revision: number;
  readonly retiredAt: Date | null;
}

export interface VenueService {
  getRestaurantProfile(): Promise<RestaurantProfileView>;
  updateRestaurantProfile(input: UpdateRestaurantProfileInput): Promise<RestaurantProfileView>;
  listActiveShifts(): Promise<readonly ShiftView[]>;
  updateShift(input: UpdateShiftInput): Promise<ShiftView>;
  requireActiveShiftSnapshot(code: RestaurantShiftCode): Promise<ShiftSnapshot>;
  createHall(input: CreateHallInput): Promise<HallView & { readonly nameNormalized: string }>;
  updateHall(input: UpdateHallInput): Promise<HallView>;
  changeHallLifecycle(input: ChangeHallLifecycleInput): Promise<HallView>;
  listActiveHalls(): Promise<readonly HallView[]>;
  getHall(id: string): Promise<HallView>;
  requireActiveHallSnapshot(id: string): Promise<HallSnapshot>;
}

export interface UpdateRestaurantProfileInput {
  readonly displayName: string;
  readonly description: string;
  readonly address: string;
  readonly publicPhone: string | null;
  readonly publicEmail: string | null;
  readonly expectedRevision: number;
  readonly context: CatalogMutationContext;
}

export interface UpdateShiftInput {
  readonly code: RestaurantShiftCode;
  readonly startTime: string;
  readonly endTime: string;
  readonly isActive: boolean;
  readonly expectedRevision: number;
  readonly context: CatalogMutationContext;
}

export interface CreateHallInput {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maxGuests: number;
  readonly displayOrder: number;
  readonly context: CatalogMutationContext;
}

export interface UpdateHallInput extends Omit<CreateHallInput, 'context'> {
  readonly expectedRevision: number;
  readonly context: CatalogMutationContext;
}

export interface ChangeHallLifecycleInput {
  readonly id: string;
  readonly expectedRevision: number;
  readonly transition: 'RETIRE' | 'RESTORE';
  readonly context: CatalogMutationContext;
}

type Transaction = Prisma.TransactionClient;

export class VenueCatalogConflictError extends AppError {
  constructor(code: VenueConflictCode) {
    super({ status: 409, code, message: venueConflictMessages[code] });
  }
}

type VenueConflictCode =
  | 'CATALOG_REVISION_CONFLICT'
  | 'CATALOG_HALL_NAME_CONFLICT'
  | 'CATALOG_HALL_CAPACITY_CONFLICT'
  | 'CATALOG_LIFECYCLE_CONFLICT';

const venueConflictMessages: Readonly<Record<VenueConflictCode, string>> = {
  CATALOG_REVISION_CONFLICT: 'The venue record changed after it was loaded.',
  CATALOG_HALL_NAME_CONFLICT: 'An active hall already uses this name.',
  CATALOG_HALL_CAPACITY_CONFLICT: 'A current published layout exceeds the requested hall capacity.',
  CATALOG_LIFECYCLE_CONFLICT: 'The hall lifecycle changed after it was loaded.',
};

export function createVenueService(prisma: PrismaClient): VenueService {
  const service: VenueService = {
    async getRestaurantProfile() {
      const profile = await prisma.restaurantProfile.findUnique({
        where: { singletonKey: 'RESTAURANT' },
      });
      if (profile === null) throw new NotFoundError();
      return toRestaurantView(profile);
    },

    async updateRestaurantProfile(input) {
      const values = {
        displayName: validateCatalogName(input.displayName),
        description: validateCatalogDescription(input.description),
        address: requireBoundedText('address', input.address, 1, 2_000),
        publicPhone: optionalText(input.publicPhone, 250),
        publicEmail: optionalText(input.publicEmail, 320),
      };
      return prisma.$transaction(async (transaction) => {
        const result = await transaction.restaurantProfile.updateMany({
          where: { singletonKey: 'RESTAURANT', revision: input.expectedRevision },
          data: {
            ...values,
            revision: { increment: 1 },
            updatedByAccountId: input.context.actorId,
          },
        });
        if (result.count !== 1) throw new VenueCatalogConflictError('CATALOG_REVISION_CONFLICT');
        const profile = await transaction.restaurantProfile.findUniqueOrThrow({
          where: { singletonKey: 'RESTAURANT' },
        });
        await appendAudit(transaction, input.context, {
          action: 'catalog.restaurant-updated',
          entityType: 'restaurant-profile',
          entityId: profile.id,
          metadata: {
            changedFields: ['address', 'description', 'displayName', 'publicEmail', 'publicPhone'],
          },
        });
        return toRestaurantView(profile);
      });
    },

    async listActiveShifts() {
      const shifts = await prisma.restaurantShift.findMany({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
      return Object.freeze(shifts.map(toShiftView));
    },

    async updateShift(input) {
      const window = validateShiftWindow(input.startTime, input.endTime);
      return prisma.$transaction(async (transaction) => {
        const result = await transaction.restaurantShift.updateMany({
          where: { code: input.code, revision: input.expectedRevision },
          data: {
            startTime: localTimeToDate(window.startTime),
            endTime: localTimeToDate(window.endTime),
            isActive: input.isActive,
            revision: { increment: 1 },
            updatedByAccountId: input.context.actorId,
          },
        });
        if (result.count !== 1) throw new VenueCatalogConflictError('CATALOG_REVISION_CONFLICT');
        await appendAudit(transaction, input.context, {
          action: 'catalog.shift-updated',
          entityType: 'restaurant-shift',
          entityId: null,
          metadata: {
            changedFields: ['endTime', 'isActive', 'startTime'],
            shiftCode: input.code,
          },
        });
        return Object.freeze({
          code: input.code,
          startTime: window.startTime,
          endTime: window.endTime,
          isActive: input.isActive,
          revision: input.expectedRevision + 1,
        });
      });
    },

    async requireActiveShiftSnapshot(code) {
      const shift = await prisma.restaurantShift.findFirst({ where: { code, isActive: true } });
      if (shift === null) throw new NotFoundError();
      return toShiftSnapshot(shift);
    },

    async createHall(input) {
      const values = normalizeHallInput(input);
      try {
        return await prisma.$transaction(async (transaction) => {
          const hall = await transaction.hall.create({
            data: {
              id: input.id,
              ...values,
              updatedByAccountId: input.context.actorId,
            },
          });
          await appendAudit(transaction, input.context, {
            action: 'catalog.hall-created',
            entityType: 'hall',
            entityId: hall.id,
            metadata: { maxGuests: values.maxGuests },
          });
          return Object.freeze({ ...toHallView(hall), nameNormalized: values.nameNormalized });
        });
      } catch (error: unknown) {
        throw mapHallUniqueConflict(error);
      }
    },

    async updateHall(input) {
      const values = normalizeHallInput(input);
      try {
        return await prisma.$transaction(
          async (transaction) => {
            const locked = await transaction.$queryRaw<
              Array<{
                maxGuests: number;
                lifecycle: CatalogLifecycle;
                retiredAt: Date | null;
              }>
            >(Prisma.sql`
              SELECT "maxGuests", "lifecycle", "retiredAt"
                FROM "Hall"
               WHERE "id" = ${input.id}::uuid
                 AND "revision" = ${input.expectedRevision}
               FOR UPDATE
            `);
            const current = locked[0];
            if (current === undefined) {
              throw new VenueCatalogConflictError('CATALOG_REVISION_CONFLICT');
            }
            if (values.maxGuests < current.maxGuests) {
              const conflicts = await transaction.$queryRaw<
                Array<{ layoutVersionId: string; maxGuests: number }>
              >(Prisma.sql`
                SELECT version."id" AS "layoutVersionId", version."maxGuests"
                  FROM "LayoutTemplate" template
                  JOIN "LayoutTemplateVersion" version
                    ON version."id" = template."currentPublishedVersionId"
                 WHERE template."hallId" = ${input.id}::uuid
                   AND template."lifecycle" = 'ACTIVE'
                   AND version."state" = 'PUBLISHED'
                   AND version."maxGuests" > ${values.maxGuests}
                 LIMIT 1
              `);
              if (conflicts.length > 0) {
                throw new VenueCatalogConflictError('CATALOG_HALL_CAPACITY_CONFLICT');
              }
            }
            const result = await transaction.hall.updateMany({
              where: { id: input.id, revision: input.expectedRevision },
              data: {
                ...values,
                revision: { increment: 1 },
                updatedByAccountId: input.context.actorId,
              },
            });
            if (result.count !== 1) {
              throw new VenueCatalogConflictError('CATALOG_REVISION_CONFLICT');
            }
            await appendAudit(transaction, input.context, {
              action: 'catalog.hall-updated',
              entityType: 'hall',
              entityId: input.id,
              metadata: {
                changedFields: ['description', 'displayOrder', 'maxGuests', 'name'],
              },
            });
            return Object.freeze({
              id: input.id,
              name: values.name,
              description: values.description,
              maxGuests: values.maxGuests,
              displayOrder: values.displayOrder,
              lifecycle: current.lifecycle,
              revision: input.expectedRevision + 1,
              retiredAt: current.retiredAt,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        throw mapHallUniqueConflict(error);
      }
    },

    async changeHallLifecycle(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const hall = await transaction.hall.findUnique({ where: { id: input.id } });
          if (hall === null || hall.revision !== input.expectedRevision) {
            throw new VenueCatalogConflictError('CATALOG_LIFECYCLE_CONFLICT');
          }
          let lifecycle: CatalogLifecycle;
          try {
            lifecycle = transitionCatalogLifecycle(hall.lifecycle, input.transition);
          } catch (error: unknown) {
            if (error instanceof CatalogPolicyError) {
              throw new VenueCatalogConflictError('CATALOG_LIFECYCLE_CONFLICT');
            }
            throw error;
          }
          const retiredAt = lifecycle === 'RETIRED' ? new Date() : null;
          const result = await transaction.hall.updateMany({
            where: {
              id: input.id,
              revision: input.expectedRevision,
              lifecycle: hall.lifecycle,
            },
            data: {
              lifecycle,
              retiredAt,
              revision: { increment: 1 },
              updatedByAccountId: input.context.actorId,
            },
          });
          if (result.count !== 1) {
            throw new VenueCatalogConflictError('CATALOG_LIFECYCLE_CONFLICT');
          }
          await appendAudit(transaction, input.context, {
            action: lifecycle === 'RETIRED' ? 'catalog.hall-retired' : 'catalog.hall-restored',
            entityType: 'hall',
            entityId: input.id,
            metadata: { lifecycle },
          });
          return Object.freeze({
            ...toHallView(hall),
            lifecycle,
            revision: hall.revision + 1,
            retiredAt,
          });
        });
      } catch (error: unknown) {
        throw mapHallUniqueConflict(error);
      }
    },

    async listActiveHalls() {
      const halls = await prisma.hall.findMany({
        where: { lifecycle: 'ACTIVE' },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      });
      return Object.freeze(halls.map(toHallView));
    },

    async getHall(id) {
      const hall = await prisma.hall.findUnique({ where: { id } });
      if (hall === null) throw new NotFoundError();
      return toHallView(hall);
    },

    async requireActiveHallSnapshot(id) {
      const hall = await prisma.hall.findFirst({ where: { id, lifecycle: 'ACTIVE' } });
      if (hall === null) throw new NotFoundError();
      return toHallSnapshot(hall);
    },
  };
  return Object.freeze(service);
}

function normalizeHallInput(input: {
  readonly name: string;
  readonly description: string;
  readonly maxGuests: number;
  readonly displayOrder: number;
}) {
  const name = validateCatalogName(input.name);
  return Object.freeze({
    name,
    nameNormalized: name.toLocaleLowerCase('en-US'),
    description: validateCatalogDescription(input.description),
    maxGuests: validateHallMaximumGuests(input.maxGuests),
    displayOrder: requireNonNegativeInteger('displayOrder', input.displayOrder),
  });
}

function toRestaurantView(profile: {
  id: string;
  displayName: string;
  description: string;
  address: string;
  publicPhone: string | null;
  publicEmail: string | null;
  revision: number;
}): RestaurantProfileView {
  return Object.freeze({
    id: profile.id,
    displayName: profile.displayName,
    description: profile.description,
    address: profile.address,
    publicPhone: profile.publicPhone,
    publicEmail: profile.publicEmail,
    revision: profile.revision,
  });
}

function toShiftSnapshot(shift: {
  code: RestaurantShiftCode;
  startTime: Date;
  endTime: Date;
}): ShiftSnapshot {
  return Object.freeze({
    code: shift.code,
    startTime: dateToLocalTime(shift.startTime),
    endTime: dateToLocalTime(shift.endTime),
  });
}

function toShiftView(shift: {
  code: RestaurantShiftCode;
  startTime: Date;
  endTime: Date;
  isActive: boolean;
  revision: number;
}): ShiftView {
  return Object.freeze({
    ...toShiftSnapshot(shift),
    isActive: shift.isActive,
    revision: shift.revision,
  });
}

function toHallSnapshot(hall: {
  id: string;
  name: string;
  description: string;
  maxGuests: number;
}): HallSnapshot {
  return Object.freeze({
    id: hall.id,
    name: hall.name,
    description: hall.description,
    maxGuests: hall.maxGuests,
  });
}

function toHallView(hall: {
  id: string;
  name: string;
  description: string;
  maxGuests: number;
  displayOrder: number;
  lifecycle: CatalogLifecycle;
  revision: number;
  retiredAt: Date | null;
}): HallView {
  return Object.freeze({
    ...toHallSnapshot(hall),
    displayOrder: hall.displayOrder,
    lifecycle: hall.lifecycle,
    revision: hall.revision,
    retiredAt: hall.retiredAt,
  });
}

function localTimeToDate(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function dateToLocalTime(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
}

function optionalText(value: string | null, max: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized === '' ? null : requireBoundedText('contact', normalized, 1, max);
}

function requireBoundedText(field: string, value: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new CatalogPolicyError(
      'CATALOG_TEXT_OUT_OF_RANGE',
      `${field} must contain between ${min} and ${max} characters.`,
    );
  }
  return normalized;
}

function requireNonNegativeInteger(field: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new CatalogPolicyError('CATALOG_INTEGER_OUT_OF_RANGE', `${field} must be non-negative.`);
  }
  return value;
}

function mapHallUniqueConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new VenueCatalogConflictError('CATALOG_HALL_NAME_CONFLICT');
  }
  return error;
}

async function appendAudit(
  transaction: Transaction,
  context: CatalogMutationContext,
  event: Readonly<{
    action: string;
    entityType: string;
    entityId: string | null;
    metadata: Prisma.InputJsonObject;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      requestId: context.requestId,
      actorType: 'USER',
      actorId: context.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
    },
  });
}
