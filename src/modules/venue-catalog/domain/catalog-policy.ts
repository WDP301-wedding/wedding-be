export const CATALOG_LIMITS = deepFreeze({
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

export const CATALOG_PLATFORM_POLICY = deepFreeze({
  currency: 'VND',
  restaurantTimeZone: 'Asia/Ho_Chi_Minh',
  shiftCodes: ['LUNCH', 'DINNER'] as const,
  storagePurpose: 'VENUE_CATALOG_MEDIA',
  storageVisibility: 'PRIVATE',
  signedReadTtlSeconds: 15 * 60,
});

export const CATALOG_RETRY_POLICY = deepFreeze({
  draftRevisionConflict: 'RELOAD_REQUIRED',
  idempotentMutation: 'REPLAY_SAME_KEY_ONLY',
  validationOrLifecycleConflict: 'DO_NOT_RETRY',
  transientProviderFailure: 'REPLAY_SAME_KEY_ONLY',
});

export type CatalogLifecycle = 'ACTIVE' | 'RETIRED';
export type CatalogVersionState = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
export type CatalogTableShape = 'ROUND' | 'RECTANGLE';

export class CatalogPolicyError extends Error {
  override readonly name = 'CatalogPolicyError';

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function validateDishPriceVnd(priceVnd: number): number {
  return requireBoundedInteger('dishPriceVnd', priceVnd, CATALOG_LIMITS.dishPriceVnd);
}

export function validateCatalogName(value: string): string {
  return requireText('name', value, CATALOG_LIMITS.name);
}

export function validateCatalogDescription(value: string): string {
  return requireText('description', value, CATALOG_LIMITS.description);
}

export function validateMediaAlternativeText(value: string): string {
  return requireText('alternativeText', value, CATALOG_LIMITS.mediaAlternativeText);
}

export function validateHallMaximumGuests(value: number): number {
  return requireBoundedInteger('hallMaximumGuests', value, CATALOG_LIMITS.hallMaximumGuests);
}

export function validateMediaAttachmentCount(value: number): number {
  return requireBoundedInteger('mediaAttachmentCount', value, CATALOG_LIMITS.mediaPerResource);
}

export function resolveCatalogPageSize(value?: number): number {
  return value === undefined
    ? CATALOG_LIMITS.cursorPageSize.default
    : requireBoundedInteger('pageSize', value, {
        min: 1,
        max: CATALOG_LIMITS.cursorPageSize.max,
      });
}

export function validateMenuPriceVnd(priceVndPerTable: number): number {
  return requireBoundedInteger(
    'priceVndPerTable',
    priceVndPerTable,
    CATALOG_LIMITS.menuPriceVndPerTable,
  );
}

export function validateShiftWindow(
  startTime: string,
  endTime: string,
): Readonly<{ startTime: string; endTime: string }> {
  const startMinutes = parseLocalTime(startTime);
  const endMinutes = parseLocalTime(endTime);
  if (startMinutes >= endMinutes) {
    throw new CatalogPolicyError(
      'CATALOG_INVALID_SHIFT_WINDOW',
      'A shift must start before it ends on the same local day.',
    );
  }
  return Object.freeze({ startTime, endTime });
}

export function transitionCatalogVersion(
  state: CatalogVersionState,
  transition: 'PUBLISH' | 'SUPERSEDE',
): CatalogVersionState {
  if (state === 'DRAFT' && transition === 'PUBLISH') {
    return 'PUBLISHED';
  }
  if (state === 'PUBLISHED' && transition === 'SUPERSEDE') {
    return 'SUPERSEDED';
  }
  throw new CatalogPolicyError(
    'CATALOG_INVALID_VERSION_TRANSITION',
    `Cannot ${transition.toLowerCase()} a ${state.toLowerCase()} version.`,
  );
}

export function transitionCatalogLifecycle(
  lifecycle: CatalogLifecycle,
  transition: 'RETIRE' | 'RESTORE',
): CatalogLifecycle {
  if (lifecycle === 'ACTIVE' && transition === 'RETIRE') {
    return 'RETIRED';
  }
  if (lifecycle === 'RETIRED' && transition === 'RESTORE') {
    return 'ACTIVE';
  }
  throw new CatalogPolicyError(
    'CATALOG_INVALID_LIFECYCLE_TRANSITION',
    `Cannot ${transition.toLowerCase()} an ${lifecycle.toLowerCase()} catalog aggregate.`,
  );
}

export interface MenuItemInput {
  readonly dishVersionId: string;
  readonly displayOrder: number;
}

export function createImmutableMenuItems(
  items: readonly MenuItemInput[],
): readonly Readonly<MenuItemInput>[] {
  if (items.length === 0) {
    throw new CatalogPolicyError('CATALOG_MENU_EMPTY', 'A menu package requires a dish.');
  }
  requireUnique(
    items.map(({ dishVersionId }) => dishVersionId),
    'dish version',
  );
  requireContiguousOrder(items);
  return freezeOrdered(items, (item) => ({ ...item }));
}

export interface TimelineItemInput {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly offsetMinutes: number;
  readonly durationMinutes: number | null;
  readonly displayOrder: number;
}

export function createImmutableTimelineItems(
  items: readonly TimelineItemInput[],
): readonly Readonly<TimelineItemInput>[] {
  requireArrayBounds('timeline items', items, CATALOG_LIMITS.timelineItemCount);
  requireUnique(
    items.map(({ id }) => id),
    'timeline item',
  );
  requireContiguousOrder(items);
  return freezeOrdered(items, (item) => ({
    ...item,
    title: requireText('title', item.title, CATALOG_LIMITS.name),
    description:
      item.description === null
        ? null
        : requireText('description', item.description, CATALOG_LIMITS.description),
    offsetMinutes: requireBoundedInteger(
      'offsetMinutes',
      item.offsetMinutes,
      CATALOG_LIMITS.timelineOffsetMinutes,
    ),
    durationMinutes:
      item.durationMinutes === null
        ? null
        : requireBoundedInteger(
            'durationMinutes',
            item.durationMinutes,
            CATALOG_LIMITS.timelineDurationMinutes,
          ),
  }));
}

export interface LayoutTableInput {
  readonly tableId: string;
  readonly label: string;
  readonly shape: CatalogTableShape;
  readonly seatCapacity: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotationDegrees: number;
  readonly displayOrder: number;
}

export interface LayoutInput {
  readonly hallMaximumGuests: number;
  readonly minGuests: number;
  readonly maxGuests: number;
  readonly registeredTableIds: readonly string[];
  readonly retiredTableIds: readonly string[];
  readonly tables: readonly LayoutTableInput[];
}

export interface ImmutableLayout {
  readonly minGuests: number;
  readonly maxGuests: number;
  readonly totalSeatCapacity: number;
  readonly tables: readonly Readonly<LayoutTableInput>[];
}

export function createImmutableLayout(input: LayoutInput): ImmutableLayout {
  const hallMaximumGuests = requireBoundedInteger(
    'hallMaximumGuests',
    input.hallMaximumGuests,
    CATALOG_LIMITS.hallMaximumGuests,
  );
  requireArrayBounds('layout tables', input.tables, CATALOG_LIMITS.layoutTableCount);
  requireUnique(
    input.tables.map(({ tableId }) => tableId),
    'layout table',
  );
  requireContiguousOrder(input.tables);

  const registered = new Set(input.registeredTableIds);
  const retired = new Set(input.retiredTableIds);
  const tables = freezeOrdered(input.tables, (table) => {
    if (!registered.has(table.tableId)) {
      throw new CatalogPolicyError(
        'CATALOG_TABLE_OWNERSHIP_CONFLICT',
        'A layout table does not belong to the template registry.',
      );
    }
    if (retired.has(table.tableId)) {
      throw new CatalogPolicyError(
        'CATALOG_TABLE_RETIRED',
        'A retired table identity cannot be reused.',
      );
    }
    if (table.shape !== 'ROUND' && table.shape !== 'RECTANGLE') {
      throw new CatalogPolicyError('CATALOG_TABLE_SHAPE_INVALID', 'Table shape is invalid.');
    }

    const width = requirePositiveCanvasInteger('width', table.width);
    const height = requirePositiveCanvasInteger('height', table.height);
    const x = requireCanvasPosition('x', table.x);
    const y = requireCanvasPosition('y', table.y);
    if (x + width > CATALOG_LIMITS.canvas.width || y + height > CATALOG_LIMITS.canvas.height) {
      throw new CatalogPolicyError(
        'CATALOG_TABLE_OUT_OF_BOUNDS',
        'Table geometry must remain inside the normalized canvas.',
      );
    }

    return {
      ...table,
      label: requireText('label', table.label, CATALOG_LIMITS.tableLabel),
      seatCapacity: requireBoundedInteger(
        'seatCapacity',
        table.seatCapacity,
        CATALOG_LIMITS.tableSeatCapacity,
      ),
      x,
      y,
      width,
      height,
      rotationDegrees: requireBoundedInteger('rotationDegrees', table.rotationDegrees, {
        min: 0,
        max: 359,
      }),
    };
  });
  const totalSeatCapacity = tables.reduce((total, table) => total + table.seatCapacity, 0);
  const minGuests = requireBoundedInteger('minGuests', input.minGuests, {
    min: 1,
    max: Math.min(hallMaximumGuests, totalSeatCapacity),
  });
  const maxGuests = requireBoundedInteger('maxGuests', input.maxGuests, {
    min: minGuests,
    max: Math.min(hallMaximumGuests, totalSeatCapacity),
  });

  return Object.freeze({ minGuests, maxGuests, totalSeatCapacity, tables });
}

function parseLocalTime(value: string): number {
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/u.exec(value);
  if (match?.groups === undefined) {
    throw new CatalogPolicyError(
      'CATALOG_INVALID_SHIFT_TIME',
      'Shift time must use minute-precision HH:mm format.',
    );
  }
  return Number(match.groups.hour) * 60 + Number(match.groups.minute);
}

function requireText(
  field: string,
  value: string,
  bounds: Readonly<{ min: number; max: number }>,
): string {
  const trimmed = value.trim();
  const characterCount = [...trimmed].length;
  if (characterCount < bounds.min || characterCount > bounds.max) {
    throw new CatalogPolicyError(
      'CATALOG_TEXT_OUT_OF_BOUNDS',
      `${field} must contain between ${String(bounds.min)} and ${String(bounds.max)} trimmed characters.`,
    );
  }
  return trimmed;
}

function requireBoundedInteger(
  field: string,
  value: number,
  bounds: Readonly<{ min: number; max: number }>,
): number {
  if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    throw new CatalogPolicyError(
      'CATALOG_INTEGER_OUT_OF_BOUNDS',
      `${field} must be an integer from ${String(bounds.min)} through ${String(bounds.max)}.`,
    );
  }
  return value;
}

function requireArrayBounds(
  field: string,
  values: readonly unknown[],
  bounds: Readonly<{ min: number; max: number }>,
): void {
  if (values.length < bounds.min || values.length > bounds.max) {
    throw new CatalogPolicyError(
      'CATALOG_ITEM_COUNT_OUT_OF_BOUNDS',
      `${field} must contain between ${String(bounds.min)} and ${String(bounds.max)} items.`,
    );
  }
}

function requireUnique(values: readonly string[], identity: string): void {
  if (new Set(values).size !== values.length) {
    throw new CatalogPolicyError(
      'CATALOG_DUPLICATE_IDENTITY',
      `Each ${identity} identity must be unique.`,
    );
  }
}

function requireContiguousOrder(values: readonly { readonly displayOrder: number }[]): void {
  const sorted = values.map(({ displayOrder }) => displayOrder).sort((left, right) => left - right);
  if (sorted.some((displayOrder, index) => displayOrder !== index + 1)) {
    throw new CatalogPolicyError(
      'CATALOG_INVALID_DISPLAY_ORDER',
      'Display order must be unique and contiguous from one.',
    );
  }
}

function freezeOrdered<TInput extends { readonly displayOrder: number }, TOutput>(
  values: readonly TInput[],
  map: (value: TInput) => TOutput,
): readonly Readonly<TOutput>[] {
  return Object.freeze(
    [...values]
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((value) => Object.freeze(map(value))),
  );
}

function requireCanvasPosition(field: string, value: number): number {
  return requireBoundedInteger(field, value, { min: 0, max: CATALOG_LIMITS.canvas.width });
}

function requirePositiveCanvasInteger(field: string, value: number): number {
  return requireBoundedInteger(field, value, { min: 1, max: CATALOG_LIMITS.canvas.width });
}

function deepFreeze<const T>(value: T): Readonly<T> {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
