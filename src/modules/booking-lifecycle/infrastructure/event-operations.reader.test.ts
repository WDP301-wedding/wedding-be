import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client.js';
import { eventOperationsReader } from './event-operations.reader.js';
import { createEffectiveCommercialReader } from './effective-commercial.reader.js';
vi.mock('./effective-commercial.reader.js', () => ({ createEffectiveCommercialReader: vi.fn() }));
const readBooking = vi.fn(),
  getEffective = vi.fn();
const tx = { booking: { findUniqueOrThrow: readBooking } } as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createEffectiveCommercialReader).mockReturnValue({
    getEffective,
  } as unknown as ReturnType<typeof createEffectiveCommercialReader>);
});
describe('Booking-owned Staff operational projection', () => {
  it('uses effective approved offerings and identity while excluding print and all monetary fields', async () => {
    readBooking.mockResolvedValue({
      phase: 'CONFIRMED',
      depositSettlement: { contractRevisionId: 'contract' },
    });
    getEffective.mockResolvedValue({
      contract: { document: { brideName: 'Original bride', groomName: 'Original groom' } },
      appendices: [{ document: { brideName: 'Lan', groomName: 'Minh' } }],
      totalVnd: 8000000,
      lines: [
        {
          category: 'MENU',
          name: 'Menu A',
          description: 'Approved dishes',
          unit: 'bàn',
          quantity: 5,
          unitPriceVnd: 1000000,
          lineTotalVnd: 5000000,
        },
        {
          category: 'SERVICE',
          name: 'MC',
          description: 'Dẫn chương trình',
          unit: 'ca',
          quantity: 1,
          unitPriceVnd: 2000000,
          lineTotalVnd: 2000000,
        },
        {
          category: 'PRINT',
          name: 'Thiệp',
          quantity: 200,
          unitPriceVnd: 5000,
          lineTotalVnd: 1000000,
        },
      ],
    });
    expect(await eventOperationsReader.read(tx, 'event')).toEqual({
      phase: 'CONFIRMED',
      brideName: 'Lan',
      groomName: 'Minh',
      tableCount: 5,
      offerings: [
        {
          category: 'MENU',
          name: 'Menu A',
          description: 'Approved dishes',
          unit: 'bàn',
          quantity: 5,
        },
        {
          category: 'SERVICE',
          name: 'MC',
          description: 'Dẫn chương trình',
          unit: 'ca',
          quantity: 1,
        },
      ],
    });
  });
  it('keeps legacy separate names nullable and projects retained proposal facts without inferring identity', async () => {
    readBooking.mockResolvedValue({
      phase: 'COMPLETED',
      consultation: { brideName: null, groomName: null },
      depositSettlement: { contractRevisionId: null },
      proposalSnapshot: {
        menus: null,
        menuName: 'Retained menu',
        menuDescription: 'Retained description',
        tableCount: 2,
        baseChargeVnd: 2000000,
      },
    });
    const result = await eventOperationsReader.read(tx, 'event');
    expect(result).toMatchObject({
      phase: 'COMPLETED',
      brideName: null,
      groomName: null,
      tableCount: 2,
    });
    expect(result.offerings[0]).toEqual({
      category: 'MENU',
      name: 'Retained menu',
      description: 'Retained description',
      unit: 'bàn',
      quantity: 2,
    });
    expect(getEffective).not.toHaveBeenCalled();
  });
  it('does not substitute proposal data when approved commercial evidence is invalid', async () => {
    readBooking.mockResolvedValue({
      phase: 'CONFIRMED',
      depositSettlement: { contractRevisionId: 'contract' },
    });
    getEffective.mockRejectedValue(new Error('APPENDIX_APPROVAL_REQUIRED'));
    await expect(eventOperationsReader.read(tx, 'event')).rejects.toThrow(
      'APPENDIX_APPROVAL_REQUIRED',
    );
  });
});
