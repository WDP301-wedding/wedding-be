import { describe, expect, it, vi } from 'vitest';

import type { VenueCatalogReader } from '../../venue-catalog/application/venue-catalog.provider.js';
import { createSlotHoldService, type SlotHoldRepository } from './slot-hold.service.js';

describe('SlotHoldService', () => {
  it('validates active venue selections before reading availability', async () => {
    const catalog = catalogReader();
    const repository = {
      inspect: vi.fn().mockResolvedValue({ available: true, activeHold: null }),
      acquire: vi.fn(),
    } as unknown as SlotHoldRepository;
    const now = new Date('2026-10-07T10:00:00.000Z');
    const service = createSlotHoldService({ repository, catalog, now: () => now });

    await expect(
      service.checkAvailability({
        hallId: '00000000-0000-4000-8000-000000000001',
        eventDate: '2026-12-20',
        shiftCode: 'DINNER',
      }),
    ).resolves.toEqual({ available: true, activeHold: null });
    expect(repository.inspect).toHaveBeenCalledWith(expect.objectContaining({ databaseNow: now }));
  });

  it('allocates a generated hold after active venue validation', async () => {
    const catalog = catalogReader();
    const repository = {
      inspect: vi.fn(),
      acquire: vi.fn().mockImplementation((input) => Promise.resolve(input)),
    } as unknown as SlotHoldRepository;
    const service = createSlotHoldService({
      repository,
      catalog,
      now: () => new Date('2026-10-07T10:00:00.000Z'),
      createId: () => '00000000-0000-4000-8000-000000000010',
    });

    const acquired = await service.acquire({
      bookingId: '00000000-0000-4000-8000-000000000011',
      hallId: '00000000-0000-4000-8000-000000000001',
      eventDate: '2026-12-20',
      shiftCode: 'DINNER',
      managerAccountId: '00000000-0000-4000-8000-000000000012',
      expectedRevision: 1,
      requestId: '00000000-0000-4000-8000-000000000013',
    });

    expect(acquired).toMatchObject({
      holdId: '00000000-0000-4000-8000-000000000010',
      bookingId: '00000000-0000-4000-8000-000000000011',
    });
    expect(catalog.requireActiveHallSnapshot).toHaveBeenCalledOnce();
    expect(catalog.requireActiveShiftSnapshot).toHaveBeenCalledOnce();
  });
});

function catalogReader(): VenueCatalogReader {
  return {
    requireActiveHallSnapshot: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Garden Hall',
      description: 'Garden venue',
      maxGuests: 500,
    }),
    requireActiveShiftSnapshot: vi.fn().mockResolvedValue({
      code: 'DINNER',
      startTime: '17:30',
      endTime: '22:00',
    }),
  } as unknown as VenueCatalogReader;
}
