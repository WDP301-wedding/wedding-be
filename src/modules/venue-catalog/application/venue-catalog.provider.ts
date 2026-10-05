import { z } from 'zod';

import { ValidationError } from '../../../core/errors/app-error.js';
import type {
  AuthenticatedActor,
  AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { requireAnyRole } from '../../identity-access/authorization/authorization.service.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';
import type { LayoutService, LayoutVersionSnapshot } from './layout.service.js';
import type { MenuPackageSnapshot, MenuService } from './menu.service.js';
import type { TimelineService, TimelineTemplateSnapshot } from './timeline.service.js';
import type {
  HallSnapshot,
  RestaurantShiftCode,
  ShiftSnapshot,
  VenueService,
} from './venue.service.js';

export interface VenueCatalogReader {
  requireActiveHallSnapshot(hallId: string): Promise<HallSnapshot>;
  requireActiveShiftSnapshot(code: RestaurantShiftCode): Promise<ShiftSnapshot>;
  requireCurrentMenuPackageVersion(menuPackageId: string): Promise<MenuPackageSnapshot>;
  requireCurrentTimelineTemplateVersion(templateId: string): Promise<TimelineTemplateSnapshot>;
  listCurrentLayoutVersionsForHall(hallId: string): Promise<readonly LayoutVersionSnapshot[]>;
  resolveMenuPackageVersion(versionId: string): Promise<MenuPackageSnapshot>;
  resolveTimelineTemplateVersion(versionId: string): Promise<TimelineTemplateSnapshot>;
  resolveLayoutTemplateVersion(versionId: string): Promise<LayoutVersionSnapshot>;
}

export interface CatalogManagerAuthorizer {
  authorize(accessToken: string, requestId: string): Promise<CatalogMutationContext>;
}

interface VenueCatalogReaderDependencies {
  readonly venue: Pick<VenueService, 'requireActiveHallSnapshot' | 'requireActiveShiftSnapshot'>;
  readonly menu: Pick<
    MenuService,
    'requireCurrentMenuPackageVersion' | 'resolveMenuPackageVersion'
  >;
  readonly timeline: Pick<TimelineService, 'requireCurrentVersion' | 'resolveVersion'>;
  readonly layout: Pick<LayoutService, 'listCurrentVersionsForHall' | 'resolveVersion'>;
}

export function createVenueCatalogReader(
  dependencies: VenueCatalogReaderDependencies,
): VenueCatalogReader {
  const reader: VenueCatalogReader = {
    async requireActiveHallSnapshot(hallId) {
      return immutableSnapshot(await dependencies.venue.requireActiveHallSnapshot(hallId));
    },

    async requireActiveShiftSnapshot(code) {
      return immutableSnapshot(await dependencies.venue.requireActiveShiftSnapshot(code));
    },

    async requireCurrentMenuPackageVersion(menuPackageId) {
      return immutableSnapshot(
        await dependencies.menu.requireCurrentMenuPackageVersion(menuPackageId),
      );
    },

    async requireCurrentTimelineTemplateVersion(templateId) {
      return immutableSnapshot(await dependencies.timeline.requireCurrentVersion(templateId));
    },

    async listCurrentLayoutVersionsForHall(hallId) {
      return immutableSnapshot(await dependencies.layout.listCurrentVersionsForHall(hallId));
    },

    async resolveMenuPackageVersion(versionId) {
      return immutableSnapshot(await dependencies.menu.resolveMenuPackageVersion(versionId));
    },

    async resolveTimelineTemplateVersion(versionId) {
      return immutableSnapshot(await dependencies.timeline.resolveVersion(versionId));
    },

    async resolveLayoutTemplateVersion(versionId) {
      return immutableSnapshot(await dependencies.layout.resolveVersion(versionId));
    },
  };
  return Object.freeze(reader);
}

export function authorizeCatalogManager(
  actor: AuthenticatedActor,
  requestId: string,
): CatalogMutationContext {
  const requestIdResult = z.uuid().safeParse(requestId);
  if (!requestIdResult.success) {
    throw new ValidationError([
      {
        path: 'requestId',
        code: 'invalid_format',
        message: 'Catalog mutation requestId must be a UUID.',
      },
    ]);
  }
  const manager = requireAnyRole(actor, ['MANAGER']);
  return Object.freeze({ actorId: manager.accountId, requestId: requestIdResult.data });
}

export function createCatalogManagerAuthorizer(
  resolver: AuthenticatedActorResolver,
): CatalogManagerAuthorizer {
  const authorizer: CatalogManagerAuthorizer = {
    async authorize(accessToken, requestId) {
      const actor = await resolver.resolve(accessToken);
      return authorizeCatalogManager(actor, requestId);
    },
  };
  return Object.freeze(authorizer);
}

function immutableSnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
