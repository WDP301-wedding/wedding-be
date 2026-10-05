import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../core/errors/app-error.js';
import type {
  AuthenticatedActor,
  AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { AuthenticationRequiredError } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { ForbiddenIdentityAccessError } from '../../identity-access/authorization/authorization.service.js';
import type { LayoutService, LayoutVersionSnapshot } from './layout.service.js';
import type { MenuPackageSnapshot, MenuService } from './menu.service.js';
import type { TimelineService, TimelineTemplateSnapshot } from './timeline.service.js';
import type { HallSnapshot, ShiftSnapshot, VenueService } from './venue.service.js';
import {
  authorizeCatalogManager,
  createCatalogManagerAuthorizer,
  createVenueCatalogReader,
} from './venue-catalog.provider.js';

function actor(roles: AuthenticatedActor['roles']): AuthenticatedActor {
  return Object.freeze({
    accountId: randomUUID(),
    sessionId: randomUUID(),
    displayEmail: 'manager@example.test',
    roles: Object.freeze([...roles]),
  });
}

const hallSnapshot: HallSnapshot = {
  id: randomUUID(),
  name: 'Grand Hall',
  description: '',
  maxGuests: 100,
};
const shiftSnapshot: ShiftSnapshot = { code: 'LUNCH', startTime: '10:00', endTime: '14:00' };
const menuSnapshot: MenuPackageSnapshot = {
  id: randomUUID(),
  menuPackageId: randomUUID(),
  versionNumber: 1,
  state: 'PUBLISHED',
  revision: 2,
  name: 'Classic',
  description: '',
  priceVndPerTable: 5_000_000,
  items: [],
};
const timelineSnapshot: TimelineTemplateSnapshot = {
  id: randomUUID(),
  templateId: randomUUID(),
  versionNumber: 1,
  revision: 2,
  state: 'PUBLISHED',
  name: 'Wedding day',
  description: '',
  items: [],
};
const layoutSnapshot: LayoutVersionSnapshot = {
  id: randomUUID(),
  templateId: randomUUID(),
  hallId: hallSnapshot.id,
  versionNumber: 1,
  revision: 2,
  state: 'PUBLISHED',
  name: 'Layout',
  description: '',
  minGuests: 1,
  maxGuests: 10,
  totalSeatCapacity: 10,
  tables: [],
};

function services() {
  const requireActiveHallSnapshot = vi.fn(() => Promise.resolve(hallSnapshot));
  const requireActiveShiftSnapshot = vi.fn(() => Promise.resolve(shiftSnapshot));
  const requireCurrentMenuPackageVersion = vi.fn(() => Promise.resolve(menuSnapshot));
  const resolveMenuPackageVersion = vi.fn(() =>
    Promise.resolve({ ...menuSnapshot, state: 'SUPERSEDED' as const }),
  );
  const requireCurrentTimelineVersion = vi.fn(() => Promise.resolve(timelineSnapshot));
  const resolveTimelineVersion = vi.fn(() =>
    Promise.resolve({ ...timelineSnapshot, state: 'SUPERSEDED' as const }),
  );
  const listCurrentLayoutVersionsForHall = vi.fn(() => Promise.resolve([layoutSnapshot]));
  const resolveLayoutVersion = vi.fn(() =>
    Promise.resolve({ ...layoutSnapshot, state: 'SUPERSEDED' as const }),
  );
  const venue = {
    requireActiveHallSnapshot,
    requireActiveShiftSnapshot,
  } as unknown as VenueService;
  const menu = {
    requireCurrentMenuPackageVersion,
    resolveMenuPackageVersion,
  } as unknown as MenuService;
  const timeline = {
    requireCurrentVersion: requireCurrentTimelineVersion,
    resolveVersion: resolveTimelineVersion,
  } as unknown as TimelineService;
  const layout = {
    listCurrentVersionsForHall: listCurrentLayoutVersionsForHall,
    resolveVersion: resolveLayoutVersion,
  } as unknown as LayoutService;
  return {
    venue,
    menu,
    timeline,
    layout,
    mocks: { requireCurrentMenuPackageVersion, resolveMenuPackageVersion },
  };
}

describe('VenueCatalogReader', () => {
  it('uses current-selection operations separately from exact historical resolution', async () => {
    const dependencies = services();
    const reader = createVenueCatalogReader(dependencies);

    await expect(reader.requireActiveHallSnapshot(hallSnapshot.id)).resolves.toEqual(hallSnapshot);
    await expect(reader.requireActiveShiftSnapshot('LUNCH')).resolves.toEqual(shiftSnapshot);
    await expect(
      reader.requireCurrentMenuPackageVersion(menuSnapshot.menuPackageId),
    ).resolves.toMatchObject({ state: 'PUBLISHED' });
    await expect(
      reader.requireCurrentTimelineTemplateVersion(timelineSnapshot.templateId),
    ).resolves.toMatchObject({ state: 'PUBLISHED' });
    await expect(reader.listCurrentLayoutVersionsForHall(hallSnapshot.id)).resolves.toMatchObject([
      { state: 'PUBLISHED' },
    ]);

    await expect(reader.resolveMenuPackageVersion(menuSnapshot.id)).resolves.toMatchObject({
      state: 'SUPERSEDED',
    });
    await expect(reader.resolveTimelineTemplateVersion(timelineSnapshot.id)).resolves.toMatchObject(
      { state: 'SUPERSEDED' },
    );
    await expect(reader.resolveLayoutTemplateVersion(layoutSnapshot.id)).resolves.toMatchObject({
      state: 'SUPERSEDED',
    });
    expect(dependencies.mocks.requireCurrentMenuPackageVersion).toHaveBeenCalledWith(
      menuSnapshot.menuPackageId,
    );
    expect(dependencies.mocks.resolveMenuPackageVersion).toHaveBeenCalledWith(menuSnapshot.id);
  });

  it('returns detached deeply immutable snapshots', async () => {
    const dependencies = services();
    const reader = createVenueCatalogReader(dependencies);

    const menu = await reader.requireCurrentMenuPackageVersion(menuSnapshot.menuPackageId);
    const layouts = await reader.listCurrentLayoutVersionsForHall(hallSnapshot.id);

    expect(menu).not.toBe(menuSnapshot);
    expect(layouts[0]).not.toBe(layoutSnapshot);
    expect(Object.isFrozen(menu)).toBe(true);
    expect(Object.isFrozen(menu.items)).toBe(true);
    expect(Object.isFrozen(layouts)).toBe(true);
    expect(Object.isFrozen(layouts[0]?.tables)).toBe(true);
  });

  it('preserves concealed wrong-ID and retired dependency failures', async () => {
    const dependencies = services();
    dependencies.venue.requireActiveHallSnapshot = vi.fn(() => Promise.reject(new NotFoundError()));
    dependencies.menu.requireCurrentMenuPackageVersion = vi.fn(() =>
      Promise.reject(new NotFoundError()),
    );
    const reader = createVenueCatalogReader(dependencies);

    await expect(reader.requireActiveHallSnapshot(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(reader.requireCurrentMenuPackageVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('has no reverse imports from future booking, seating, guest, payment, or analytics modules', async () => {
    const source = await readFile(new URL('./venue-catalog.provider.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/modules\/(?:booking|seating|guest|payment|analytics)/u);
  });
});

describe('catalog Manager authorization', () => {
  it.each([
    ['staff', ['STAFF']],
    ['couple', ['COUPLE']],
    ['restricted prospect', []],
    ['mixed non-manager roles', ['STAFF', 'COUPLE']],
  ] as const)('denies %s catalog mutation context creation', (_label, roles) => {
    const forged = { ...actor(roles), role: 'MANAGER', body: { roles: ['MANAGER'] } };

    expect(() => authorizeCatalogManager(forged, randomUUID())).toThrow(
      ForbiddenIdentityAccessError,
    );
  });

  it('creates an immutable mutation context only for a current Manager actor', () => {
    const manager = actor(['MANAGER']);
    const requestId = randomUUID();

    const context = authorizeCatalogManager(manager, requestId);

    expect(context).toEqual({ actorId: manager.accountId, requestId });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('re-resolves current session state and fails closed for stale/revoked sessions', async () => {
    const resolver: AuthenticatedActorResolver = {
      resolve: vi.fn(() => Promise.reject(new AuthenticationRequiredError())),
    };
    const authorizer = createCatalogManagerAuthorizer(resolver);

    await expect(authorizer.authorize('stale-token', randomUUID())).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });

  it('uses only the roles returned by the current resolver', async () => {
    const currentStaff = actor(['STAFF']);
    const resolver: AuthenticatedActorResolver = {
      resolve: vi.fn(() => Promise.resolve(currentStaff)),
    };
    const authorizer = createCatalogManagerAuthorizer(resolver);

    await expect(
      authorizer.authorize('token-with-forged-manager-body', randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenIdentityAccessError);
  });
});
