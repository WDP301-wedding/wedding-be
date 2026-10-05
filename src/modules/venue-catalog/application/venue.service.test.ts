import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createVenueService } from './venue.service.js';

const actorId = randomUUID();
const requestId = randomUUID();
const context = { actorId, requestId };

function prismaWithTransaction(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as unknown as PrismaClient;
}

describe('venue service', () => {
  it('updates a fixed shift only when its local window is valid', async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const auditCreate = vi.fn<
      (input: { data: { metadata: unknown } }) => Promise<Record<string, never>>
    >(() => Promise.resolve({}));
    const service = createVenueService(
      prismaWithTransaction({
        restaurantShift: { updateMany },
        auditLog: { create: auditCreate },
      }),
    );

    await expect(
      service.updateShift({
        code: 'LUNCH',
        startTime: '11:00',
        endTime: '14:00',
        isActive: true,
        expectedRevision: 2,
        context,
      }),
    ).resolves.toMatchObject({ code: 'LUNCH', revision: 3 });
    await expect(
      service.updateShift({
        code: 'DINNER',
        startTime: '18:00',
        endTime: '18:00',
        isActive: true,
        expectedRevision: 1,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID_SHIFT_WINDOW' });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(auditCreate.mock.calls[0]?.[0].data.metadata).toEqual({
      changedFields: ['endTime', 'isActive', 'startTime'],
      shiftCode: 'LUNCH',
    });
  });

  it('normalizes hall names and rejects stale writes', async () => {
    const create = vi.fn(({ data }: { data: object }) => Promise.resolve(data));
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const transaction = {
      hall: { create, updateMany },
      $queryRaw: vi.fn(() => Promise.resolve([])),
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const service = createVenueService(prismaWithTransaction(transaction));

    await expect(
      service.createHall({
        id: randomUUID(),
        name: '  Grand Hall  ',
        description: ' Ballroom ',
        maxGuests: 500,
        displayOrder: 0,
        context,
      }),
    ).resolves.toMatchObject({ name: 'Grand Hall', nameNormalized: 'grand hall' });
    await expect(
      service.updateHall({
        id: randomUUID(),
        name: 'Garden',
        description: '',
        maxGuests: 100,
        displayOrder: 1,
        expectedRevision: 3,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_REVISION_CONFLICT' });
  });

  it('blocks lowering hall capacity below a current published layout', async () => {
    const service = createVenueService(
      prismaWithTransaction({
        hall: { updateMany: vi.fn() },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ maxGuests: 400 }])
          .mockResolvedValueOnce([{ layoutVersionId: randomUUID(), maxGuests: 350 }]),
        auditLog: { create: vi.fn() },
      }),
    );

    await expect(
      service.updateHall({
        id: randomUUID(),
        name: 'Grand Hall',
        description: '',
        maxGuests: 300,
        displayOrder: 0,
        expectedRevision: 1,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_HALL_CAPACITY_CONFLICT' });
  });

  it('separates active selection snapshots from retired manager history', async () => {
    const hall = {
      id: randomUUID(),
      name: 'Grand Hall',
      description: 'Ballroom',
      maxGuests: 500,
      displayOrder: 0,
      lifecycle: 'RETIRED',
      revision: 4,
      retiredAt: new Date(),
    };
    const prisma = {
      hall: {
        findUnique: vi.fn(() => Promise.resolve(hall)),
        findFirst: vi.fn(() => Promise.resolve(null)),
      },
    } as unknown as PrismaClient;
    const service = createVenueService(prisma);

    await expect(service.getHall(hall.id)).resolves.toMatchObject({ lifecycle: 'RETIRED' });
    await expect(service.requireActiveHallSnapshot(hall.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reads the singleton profile and deterministically ordered active venue records', async () => {
    const hall = {
      id: randomUUID(),
      name: 'Garden',
      description: '',
      maxGuests: 100,
      displayOrder: 1,
      lifecycle: 'ACTIVE',
      revision: 1,
      retiredAt: null,
    } as const;
    const shift = {
      code: 'DINNER',
      startTime: new Date('1970-01-01T18:00:00.000Z'),
      endTime: new Date('1970-01-01T21:30:00.000Z'),
      isActive: true,
      revision: 2,
    } as const;
    const prisma = {
      restaurantProfile: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            id: randomUUID(),
            displayName: 'Estate',
            description: '',
            address: '1 Road',
            publicPhone: null,
            publicEmail: null,
            revision: 1,
          }),
        ),
      },
      restaurantShift: {
        findMany: vi.fn(() => Promise.resolve([shift])),
        findFirst: vi.fn(() => Promise.resolve(shift)),
      },
      hall: {
        findMany: vi.fn(() => Promise.resolve([hall])),
        findFirst: vi.fn(() => Promise.resolve(hall)),
      },
    } as unknown as PrismaClient;
    const service = createVenueService(prisma);

    await expect(service.getRestaurantProfile()).resolves.toMatchObject({ displayName: 'Estate' });
    await expect(service.listActiveShifts()).resolves.toEqual([
      { code: 'DINNER', startTime: '18:00', endTime: '21:30', isActive: true, revision: 2 },
    ]);
    await expect(service.requireActiveShiftSnapshot('DINNER')).resolves.toEqual({
      code: 'DINNER',
      startTime: '18:00',
      endTime: '21:30',
    });
    await expect(service.listActiveHalls()).resolves.toEqual([hall]);
  });

  it('updates the restaurant while normalizing optional contacts', async () => {
    const profile = {
      id: randomUUID(),
      displayName: 'Estate',
      description: '',
      address: '1 Road',
      publicPhone: null,
      publicEmail: null,
      revision: 2,
    };
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const service = createVenueService(
      prismaWithTransaction({
        restaurantProfile: {
          updateMany,
          findUniqueOrThrow: vi.fn(() => Promise.resolve(profile)),
        },
        auditLog: { create: vi.fn(() => Promise.resolve({})) },
      }),
    );

    await expect(
      service.updateRestaurantProfile({
        displayName: ' Estate ',
        description: ' ',
        address: ' 1 Road ',
        publicPhone: ' ',
        publicEmail: null,
        expectedRevision: 1,
        context,
      }),
    ).resolves.toEqual(profile);
    expect(updateMany).toHaveBeenCalledWith({
      where: { singletonKey: 'RESTAURANT', revision: 1 },
      data: expect.objectContaining({ publicPhone: null, publicEmail: null }),
    });
  });

  it('updates retired halls without reporting a false active lifecycle', async () => {
    const retiredAt = new Date();
    const service = createVenueService(
      prismaWithTransaction({
        $queryRaw: vi.fn(() =>
          Promise.resolve([{ maxGuests: 100, lifecycle: 'RETIRED', retiredAt }]),
        ),
        hall: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
        auditLog: { create: vi.fn(() => Promise.resolve({})) },
      }),
    );

    await expect(
      service.updateHall({
        id: randomUUID(),
        name: 'Garden',
        description: '',
        maxGuests: 120,
        displayOrder: 1,
        expectedRevision: 2,
        context,
      }),
    ).resolves.toMatchObject({ lifecycle: 'RETIRED', retiredAt, revision: 3 });
  });

  it('restores a retired hall and rejects an invalid repeated restoration', async () => {
    const hall = {
      id: randomUUID(),
      name: 'Garden',
      description: '',
      maxGuests: 100,
      displayOrder: 1,
      lifecycle: 'RETIRED',
      revision: 2,
      retiredAt: new Date(),
    } as const;
    const service = createVenueService(
      prismaWithTransaction({
        hall: {
          findUnique: vi.fn(() => Promise.resolve(hall)),
          updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        },
        auditLog: { create: vi.fn(() => Promise.resolve({})) },
      }),
    );
    await expect(
      service.changeHallLifecycle({
        id: hall.id,
        expectedRevision: 2,
        transition: 'RESTORE',
        context,
      }),
    ).resolves.toMatchObject({ lifecycle: 'ACTIVE', revision: 3, retiredAt: null });

    const invalid = createVenueService(
      prismaWithTransaction({
        hall: { findUnique: vi.fn(() => Promise.resolve({ ...hall, lifecycle: 'ACTIVE' })) },
        auditLog: { create: vi.fn() },
      }),
    );
    await expect(
      invalid.changeHallLifecycle({
        id: hall.id,
        expectedRevision: 2,
        transition: 'RESTORE',
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_LIFECYCLE_CONFLICT' });
  });

  it('conceals missing profile, shift, and hall records and validates ordering', async () => {
    const prisma = {
      restaurantProfile: { findUnique: vi.fn(() => Promise.resolve(null)) },
      restaurantShift: { findFirst: vi.fn(() => Promise.resolve(null)) },
      hall: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        findFirst: vi.fn(() => Promise.resolve(null)),
      },
    } as unknown as PrismaClient;
    const service = createVenueService(prisma);
    await expect(service.getRestaurantProfile()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.requireActiveShiftSnapshot('LUNCH')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.getHall(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.requireActiveHallSnapshot(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.createHall({
        id: randomUUID(),
        name: 'Invalid',
        description: '',
        maxGuests: 1,
        displayOrder: -1,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INTEGER_OUT_OF_RANGE' });
  });
});
