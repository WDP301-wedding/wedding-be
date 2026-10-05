import { describe, expect, it } from 'vitest';

import {
  CATALOG_LIMITS,
  CATALOG_PLATFORM_POLICY,
  CATALOG_RETRY_POLICY,
  CatalogPolicyError,
  createImmutableLayout,
  createImmutableMenuItems,
  createImmutableTimelineItems,
  resolveCatalogPageSize,
  transitionCatalogLifecycle,
  transitionCatalogVersion,
  validateCatalogDescription,
  validateCatalogName,
  validateDishPriceVnd,
  validateHallMaximumGuests,
  validateMediaAlternativeText,
  validateMediaAttachmentCount,
  validateMenuPriceVnd,
  validateShiftWindow,
} from './catalog-policy.js';

const tableId = '11111111-1111-4111-8111-111111111111';

describe('venue catalog approved policy constants', () => {
  it('freezes every approved VC-01 platform and validation constant', () => {
    expect(CATALOG_PLATFORM_POLICY).toEqual({
      currency: 'VND',
      restaurantTimeZone: 'Asia/Ho_Chi_Minh',
      shiftCodes: ['LUNCH', 'DINNER'],
      storagePurpose: 'VENUE_CATALOG_MEDIA',
      storageVisibility: 'PRIVATE',
      signedReadTtlSeconds: 900,
    });
    expect(CATALOG_LIMITS).toMatchObject({
      name: { min: 1, max: 120 },
      description: { min: 0, max: 2_000 },
      mediaAlternativeText: { min: 1, max: 250 },
      tableLabel: { min: 1, max: 50 },
      dishPriceVnd: { min: 0, max: 1_000_000_000 },
      menuPriceVndPerTable: { min: 1, max: 1_000_000_000 },
      hallMaximumGuests: { min: 1, max: 10_000 },
      layoutTableCount: { min: 1, max: 500 },
      tableSeatCapacity: { min: 1, max: 100 },
      timelineItemCount: { min: 1, max: 100 },
      timelineOffsetMinutes: { min: 0, max: 1_440 },
      timelineDurationMinutes: { min: 1, max: 1_440 },
      canvas: { width: 10_000, height: 10_000 },
      mediaPerResource: { min: 0, max: 20 },
      cursorPageSize: { default: 20, max: 100 },
    });
    expect(Object.isFrozen(CATALOG_LIMITS)).toBe(true);
    expect(Object.isFrozen(CATALOG_PLATFORM_POLICY)).toBe(true);
  });

  it('classifies mutation retries without allowing blind conflict retries', () => {
    expect(CATALOG_RETRY_POLICY).toEqual({
      draftRevisionConflict: 'RELOAD_REQUIRED',
      idempotentMutation: 'REPLAY_SAME_KEY_ONLY',
      validationOrLifecycleConflict: 'DO_NOT_RETRY',
      transientProviderFailure: 'REPLAY_SAME_KEY_ONLY',
    });
  });

  it('enforces every approved text, capacity, media-count, and pagination boundary', () => {
    expect(validateCatalogName(` ${'n'.repeat(120)} `)).toHaveLength(120);
    expect(validateCatalogName('💍'.repeat(120))).toBe('💍'.repeat(120));
    expect(() => validateCatalogName('')).toThrow(CatalogPolicyError);
    expect(() => validateCatalogName('n'.repeat(121))).toThrow(CatalogPolicyError);
    expect(validateCatalogDescription('d'.repeat(2_000))).toHaveLength(2_000);
    expect(() => validateCatalogDescription('d'.repeat(2_001))).toThrow(CatalogPolicyError);
    expect(validateMediaAlternativeText('a'.repeat(250))).toHaveLength(250);
    expect(() => validateMediaAlternativeText('')).toThrow(CatalogPolicyError);
    expect(validateHallMaximumGuests(10_000)).toBe(10_000);
    expect(() => validateHallMaximumGuests(10_001)).toThrow(CatalogPolicyError);
    expect(validateMediaAttachmentCount(0)).toBe(0);
    expect(validateMediaAttachmentCount(20)).toBe(20);
    expect(() => validateMediaAttachmentCount(21)).toThrow(CatalogPolicyError);
    expect(resolveCatalogPageSize()).toBe(20);
    expect(resolveCatalogPageSize(100)).toBe(100);
    expect(() => resolveCatalogPageSize(101)).toThrow(CatalogPolicyError);
  });
});

describe('venue catalog money, shift, and lifecycle policy', () => {
  it.each([0, 1_000_000_000])('accepts the dish price boundary %s VND', (price) => {
    expect(validateDishPriceVnd(price)).toBe(price);
  });

  it.each([1, 1_000_000_000])('accepts the menu price boundary %s VND', (price) => {
    expect(validateMenuPriceVnd(price)).toBe(price);
  });

  it.each([-1, 0.5, 1_000_000_001])('rejects invalid integer VND value %s', (price) => {
    expect(() => validateDishPriceVnd(price)).toThrow(CatalogPolicyError);
  });

  it('rejects zero for a menu per-table price', () => {
    expect(() => validateMenuPriceVnd(0)).toThrow(CatalogPolicyError);
  });

  it('accepts minute-precision same-day shifts and rejects overnight/equal windows', () => {
    expect(validateShiftWindow('10:30', '14:00')).toEqual({
      startTime: '10:30',
      endTime: '14:00',
    });
    expect(() => validateShiftWindow('18:00', '18:00')).toThrow(CatalogPolicyError);
    expect(() => validateShiftWindow('22:00', '02:00')).toThrow(CatalogPolicyError);
    expect(() => validateShiftWindow('10:30:15', '14:00')).toThrow(CatalogPolicyError);
  });

  it('allows only the approved version and aggregate transitions', () => {
    expect(transitionCatalogVersion('DRAFT', 'PUBLISH')).toBe('PUBLISHED');
    expect(transitionCatalogVersion('PUBLISHED', 'SUPERSEDE')).toBe('SUPERSEDED');
    expect(() => transitionCatalogVersion('SUPERSEDED', 'PUBLISH')).toThrow(CatalogPolicyError);
    expect(transitionCatalogLifecycle('ACTIVE', 'RETIRE')).toBe('RETIRED');
    expect(transitionCatalogLifecycle('RETIRED', 'RESTORE')).toBe('ACTIVE');
    expect(() => transitionCatalogLifecycle('ACTIVE', 'RESTORE')).toThrow(CatalogPolicyError);
  });
});

describe('venue catalog immutable ordered policies', () => {
  it('sorts and freezes menu and timeline items while rejecting duplicate identities', () => {
    const menu = createImmutableMenuItems([
      { dishVersionId: '22222222-2222-4222-8222-222222222222', displayOrder: 2 },
      { dishVersionId: '33333333-3333-4333-8333-333333333333', displayOrder: 1 },
    ]);
    const timeline = createImmutableTimelineItems([
      {
        id: '44444444-4444-4444-8444-444444444444',
        title: ' Dinner ',
        description: null,
        offsetMinutes: 60,
        durationMinutes: 90,
        displayOrder: 2,
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        title: 'Welcome',
        description: '',
        offsetMinutes: 0,
        durationMinutes: null,
        displayOrder: 1,
      },
    ]);

    expect(menu.map(({ displayOrder }) => displayOrder)).toEqual([1, 2]);
    expect(timeline.map(({ title }) => title)).toEqual(['Welcome', 'Dinner']);
    expect(Object.isFrozen(menu)).toBe(true);
    expect(Object.isFrozen(menu[0])).toBe(true);
    expect(Object.isFrozen(timeline)).toBe(true);
    expect(() =>
      createImmutableMenuItems([
        { dishVersionId: menu[0]!.dishVersionId, displayOrder: 1 },
        { dishVersionId: menu[0]!.dishVersionId, displayOrder: 2 },
      ]),
    ).toThrow(CatalogPolicyError);
    expect(() => createImmutableTimelineItems([])).toThrow(CatalogPolicyError);
    expect(() =>
      createImmutableTimelineItems(
        Array.from({ length: 101 }, (_, index) => ({
          id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
          title: 'Item',
          description: null,
          offsetMinutes: 0,
          durationMinutes: null,
          displayOrder: index + 1,
        })),
      ),
    ).toThrow(CatalogPolicyError);
  });

  it('recomputes seats and enforces hall, range, ownership, retirement, and canvas bounds', () => {
    const layout = createImmutableLayout({
      hallMaximumGuests: 80,
      minGuests: 10,
      maxGuests: 60,
      registeredTableIds: [tableId],
      retiredTableIds: [],
      tables: [
        {
          tableId,
          label: ' T1 ',
          shape: 'ROUND',
          seatCapacity: 60,
          x: 0,
          y: 0,
          width: 500,
          height: 500,
          rotationDegrees: 359,
          displayOrder: 1,
        },
      ],
    });

    expect(layout.totalSeatCapacity).toBe(60);
    expect(layout.tables[0]?.label).toBe('T1');
    expect(Object.isFrozen(layout.tables[0])).toBe(true);
    expect(() =>
      createImmutableLayout({
        hallMaximumGuests: 80,
        minGuests: 10,
        maxGuests: 61,
        registeredTableIds: [tableId],
        retiredTableIds: [],
        tables: layout.tables,
      }),
    ).toThrow(CatalogPolicyError);
    expect(() =>
      createImmutableLayout({
        hallMaximumGuests: 80,
        minGuests: 10,
        maxGuests: 60,
        registeredTableIds: [tableId],
        retiredTableIds: [tableId],
        tables: layout.tables,
      }),
    ).toThrow(CatalogPolicyError);
    expect(() =>
      createImmutableLayout({
        hallMaximumGuests: 80,
        minGuests: 10,
        maxGuests: 60,
        registeredTableIds: [tableId],
        retiredTableIds: [],
        tables: [{ ...layout.tables[0]!, x: 9_501 }],
      }),
    ).toThrow(CatalogPolicyError);
    expect(() =>
      createImmutableLayout({
        hallMaximumGuests: 80,
        minGuests: 1,
        maxGuests: 1,
        registeredTableIds: [],
        retiredTableIds: [],
        tables: [],
      }),
    ).toThrow(CatalogPolicyError);
    expect(() =>
      createImmutableLayout({
        hallMaximumGuests: 80,
        minGuests: 1,
        maxGuests: 1,
        registeredTableIds: [tableId],
        retiredTableIds: [],
        tables: [{ ...layout.tables[0]!, seatCapacity: 101 }],
      }),
    ).toThrow(CatalogPolicyError);
  });
});
