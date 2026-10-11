import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createCommercialSelectionReader } from './commercial-selection.reader.js';
const mocks = vi.hoisted(() => ({
  venue: {
    getRestaurantProfile: vi.fn(),
    requireActiveHallSnapshot: vi.fn(),
    requireActiveShiftSnapshot: vi.fn(),
  },
  menu: { requireCurrentMenuPackageVersion: vi.fn() },
  services: { requireSelection: vi.fn() },
  print: { requireSelection: vi.fn() },
}));
vi.mock('./venue.service.js', () => ({ createVenueService: () => mocks.venue }));
vi.mock('./menu.service.js', () => ({ createMenuService: () => mocks.menu }));
vi.mock('./restaurant-service.service.js', () => ({
  createRestaurantServiceReader: () => mocks.services,
}));
vi.mock('./print-offering.service.js', () => ({ createPrintOfferingReader: () => mocks.print }));
describe('commercial selection owner facts', () => {
  const reader = () => createCommercialSelectionReader({} as PrismaClient);
  const input = { sourceId: 'source', sourceRevisionId: 'version', quantity: 2 };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.venue.getRestaurantProfile.mockResolvedValue({ id: 'restaurant' });
    mocks.venue.requireActiveHallSnapshot.mockResolvedValue({ id: 'hall', maxGuests: 300 });
    mocks.venue.requireActiveShiftSnapshot.mockResolvedValue({ code: 'DINNER' });
    mocks.menu.requireCurrentMenuPackageVersion.mockResolvedValue({
      id: 'version',
      name: 'Menu',
      description: 'Menu facts',
      priceVndPerTable: 3500000,
    });
    mocks.services.requireSelection.mockResolvedValue({
      restaurantId: 'restaurant',
      name: 'MC',
      description: 'Service facts',
      unit: 'buổi',
      unitPriceVnd: 1000,
      lineTotalVnd: 2000,
    });
    mocks.print.requireSelection.mockResolvedValue({
      restaurantId: 'restaurant',
      name: 'Thiệp',
      printType: 'Hai mặt',
      material: 'Giấy',
      templateTitle: 'Mẫu',
      templateVersionId: 'template-version',
      unit: 'copy',
      unitPriceVnd: 5000,
      lineTotalVnd: 10000,
    });
  });
  it('resolves the three venue-owned snapshots', async () => {
    await expect(reader().requireVenue('hall', 'DINNER')).resolves.toEqual({
      restaurant: { id: 'restaurant' },
      hall: { id: 'hall', maxGuests: 300 },
      shift: { code: 'DINNER' },
    });
    expect(mocks.venue.requireActiveHallSnapshot).toHaveBeenCalledWith('hall');
    expect(mocks.venue.requireActiveShiftSnapshot).toHaveBeenCalledWith('DINNER');
  });
  it.each(['MENU', 'SERVICE', 'PRINT'] as const)('returns frozen %s facts', async (category) => {
    const result = await reader().requireSelection({ ...input, category }, 'restaurant');
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toMatchObject(input);
    expect(result.lineTotalVnd).toBe(
      category === 'MENU' ? 7000000 : category === 'SERVICE' ? 2000 : 10000,
    );
    if (category === 'PRINT')
      expect(result.description).toBe('Hai mặt · Giấy · Mẫu · template-version');
  });
  it('rejects a stale menu version', async () => {
    mocks.menu.requireCurrentMenuPackageVersion.mockResolvedValue({ id: 'new-version' });
    await expect(
      reader().requireSelection({ ...input, category: 'MENU' }, 'restaurant'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_PRICE_REVISION_STALE' });
  });
  it.each(['SERVICE', 'PRINT'] as const)(
    'rejects cross-restaurant %s selection',
    async (category) => {
      (category === 'SERVICE' ? mocks.services : mocks.print).requireSelection.mockResolvedValue({
        restaurantId: 'another',
      });
      await expect(
        reader().requireSelection({ ...input, category }, 'restaurant'),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_PRICE_REVISION_STALE' });
    },
  );
  it('maps checked menu multiplication overflow to a commercial conflict', async () => {
    mocks.menu.requireCurrentMenuPackageVersion.mockResolvedValue({
      id: 'version',
      name: 'Menu',
      description: '',
      priceVndPerTable: Number.MAX_SAFE_INTEGER,
    });
    await expect(
      reader().requireSelection({ ...input, category: 'MENU' }, 'restaurant'),
    ).rejects.toMatchObject({ status: 409, code: 'COMMERCIAL_AMOUNT_OVERFLOW' });
  });
  it('propagates non-arithmetic owner failures', async () => {
    const error = new Error('Catalog unavailable');
    mocks.services.requireSelection.mockRejectedValue(error);
    await expect(
      reader().requireSelection({ ...input, category: 'SERVICE' }, 'restaurant'),
    ).rejects.toBe(error);
  });
});
