import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createCommercialSelectionReader } from './commercial-selection.reader.js';
const mocks = vi.hoisted(() => ({
  venue: {
    getRestaurantProfile: vi.fn(),
    requireActiveHallSnapshot: vi.fn(),
    requireActiveShiftSnapshot: vi.fn(),
  },
  menu: { requireCurrentMenuPackageVersion: vi.fn(), requireCurrentMenuPackageHeaders: vi.fn() },
  services: { requireSelection: vi.fn(), requireBatchSelections: vi.fn() },
  print: { requireSelection: vi.fn(), requireBatchSelections: vi.fn() },
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
    mocks.menu.requireCurrentMenuPackageHeaders.mockImplementation((ids: readonly string[]) => {
      const map = new Map();
      for (const id of ids) {
        map.set(id, {
          id: 'version',
          menuPackageId: id,
          name: 'Menu',
          description: 'Menu facts',
          priceVndPerTable: 3500000,
        });
      }
      return Promise.resolve(map);
    });
    mocks.services.requireSelection.mockResolvedValue({
      restaurantId: 'restaurant',
      name: 'MC',
      description: 'Service facts',
      unit: 'buổi',
      unitPriceVnd: 1000,
      lineTotalVnd: 2000,
    });
    mocks.services.requireBatchSelections.mockImplementation(
      (items: Array<{ serviceId: string; quantity: number }>) => {
        const map = new Map();
        for (const item of items) {
          map.set(item.serviceId, {
            restaurantId: 'restaurant',
            name: 'MC',
            description: 'Service facts',
            unit: 'buổi',
            unitPriceVnd: 1000,
            lineTotalVnd: 1000 * item.quantity,
          });
        }
        return Promise.resolve(map);
      },
    );
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
    mocks.print.requireBatchSelections.mockImplementation(
      (items: Array<{ offeringId: string; quantity: number }>) => {
        const map = new Map();
        for (const item of items) {
          map.set(item.offeringId, {
            restaurantId: 'restaurant',
            name: 'Thiệp',
            printType: 'Hai mặt',
            material: 'Giấy',
            templateTitle: 'Mẫu',
            templateVersionId: 'template-version',
            unit: 'copy',
            unitPriceVnd: 5000,
            lineTotalVnd: 5000 * item.quantity,
          });
        }
        return Promise.resolve(map);
      },
    );
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
  it('resolves multiple selections across categories in batch', async () => {
    const lines = [
      { category: 'MENU' as const, sourceId: 'menu-1', sourceRevisionId: 'version', quantity: 10 },
      { category: 'SERVICE' as const, sourceId: 'srv-1', sourceRevisionId: 'v1', quantity: 2 },
      { category: 'PRINT' as const, sourceId: 'prt-1', sourceRevisionId: 'v2', quantity: 100 },
    ];
    const result = await reader().requireSelections(lines, 'restaurant');
    expect(result.size).toBe(3);
    expect(result.get('MENUmenu-1')?.lineTotalVnd).toBe(35000000);
    expect(result.get('SERVICEsrv-1')?.lineTotalVnd).toBe(2000);
    expect(result.get('PRINTprt-1')?.lineTotalVnd).toBe(500000);
    expect(mocks.services.requireBatchSelections).toHaveBeenCalledTimes(1);
    expect(mocks.print.requireBatchSelections).toHaveBeenCalledTimes(1);
  });
  it('returns empty map for empty inputs in requireSelections', async () => {
    const result = await reader().requireSelections([], 'restaurant');
    expect(result.size).toBe(0);
  });
});
