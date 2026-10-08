import { randomUUID } from 'node:crypto';

import type { VenueCatalogReader } from '../../venue-catalog/application/venue-catalog.provider.js';
import type { RestaurantShiftCode } from '../../venue-catalog/application/venue.service.js';

export type SlotAvailability = Readonly<{
  available: boolean;
  activeHold: Readonly<{ holdId: string; expiresAt: Date }> | null;
}>;

export type AcquireSlotHoldInput = Readonly<{
  bookingId: string;
  hallId: string;
  eventDate: string;
  shiftCode: RestaurantShiftCode;
  managerAccountId: string;
  expectedRevision: number;
  requestId: string;
}>;

export type AcquiredSlotHold = Readonly<{
  holdId: string;
  bookingId: string;
  expiresAt: Date;
  bookingRevision: number;
  replayed: boolean;
}>;

export interface SlotHoldRepository {
  inspect(
    input: Readonly<{
      hallId: string;
      eventDate: string;
      shiftCode: RestaurantShiftCode;
      databaseNow: Date;
    }>,
  ): Promise<SlotAvailability>;
  acquire(
    input: AcquireSlotHoldInput & Readonly<{ holdId: string; acquiredAt: Date }>,
  ): Promise<AcquiredSlotHold>;
}

export function createSlotHoldService(
  options: Readonly<{
    repository: SlotHoldRepository;
    catalog: VenueCatalogReader;
    now?: () => Date;
    createId?: () => string;
  }>,
) {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  return Object.freeze({
    async checkAvailability(
      input: Readonly<{
        hallId: string;
        eventDate: string;
        shiftCode: RestaurantShiftCode;
      }>,
    ): Promise<SlotAvailability> {
      await validateVenue(options.catalog, input.hallId, input.shiftCode);
      return immutable(await options.repository.inspect({ ...input, databaseNow: now() }));
    },

    async acquire(input: AcquireSlotHoldInput): Promise<AcquiredSlotHold> {
      await validateVenue(options.catalog, input.hallId, input.shiftCode);
      return immutable(
        await options.repository.acquire({
          ...input,
          holdId: createId(),
          acquiredAt: now(),
        }),
      );
    },
  });
}

async function validateVenue(
  catalog: VenueCatalogReader,
  hallId: string,
  shiftCode: RestaurantShiftCode,
): Promise<void> {
  await Promise.all([
    catalog.requireActiveHallSnapshot(hallId),
    catalog.requireActiveShiftSnapshot(shiftCode),
  ]);
}

function immutable<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
