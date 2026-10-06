import { createHash } from 'node:crypto';

import type { Request, Router } from 'express';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import type { ShutdownResource } from '../../core/http/lifecycle.js';
import { createIdempotencyMiddleware } from '../../core/idempotency/idempotency.middleware.js';
import { defineIdempotencyPolicy } from '../../core/idempotency/idempotency.policy.js';
import { createPrismaIdempotencyRepository } from '../../core/idempotency/idempotency.repository.js';
import { createIdempotencyService } from '../../core/idempotency/idempotency.service.js';
import { FakeStorageProvider } from '../../integrations/storage/fake-storage-provider.js';
import type { StorageProvider } from '../../integrations/storage/storage-provider.js';
import { createSupabaseStorageProvider } from '../../integrations/storage/supabase-storage-provider.js';
import { createAuthenticatedActorResolver } from '../identity-access/authorization/authenticated-actor.middleware.js';
import { createPrismaSessionRepository } from '../identity-access/session/session.repository.js';
import { createCatalogMediaService } from './application/catalog-media.service.js';
import { createCatalogQueryService } from './application/catalog-query.service.js';
import { createLayoutService } from './application/layout.service.js';
import { createMenuService } from './application/menu.service.js';
import { createTimelineService } from './application/timeline.service.js';
import { createCatalogManagerAuthorizer } from './application/venue-catalog.provider.js';
import { createVenueService } from './application/venue.service.js';
import { catalogActorScope, createVenueCatalogRouter } from './http/venue-catalog.router.js';

export type VenueCatalogRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
}>;

export async function createVenueCatalogRuntime(config: Config): Promise<VenueCatalogRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const storage = createStorage(config);
    const media = createCatalogMediaService(prisma, storage);
    const actorResolver = createAuthenticatedActorResolver(createPrismaSessionRepository(prisma));
    const authorizer = createCatalogManagerAuthorizer(actorResolver);
    const idempotency = createIdempotencyService(createPrismaIdempotencyRepository(prisma));
    const router = createVenueCatalogRouter({
      services: {
        authorizeManager: (accessToken, requestId) => authorizer.authorize(accessToken, requestId),
        venue: createVenueService(prisma),
        menu: createMenuService(prisma),
        timeline: createTimelineService(prisma),
        layout: createLayoutService(prisma),
        media,
        queries: createCatalogQueryService(prisma, media),
      },
      createIdempotencyHandler: (normalizedRoute) =>
        createIdempotencyMiddleware({
          service: idempotency,
          policy: defineIdempotencyPolicy({
            actorScope: catalogActorScope,
            normalizedRoute,
            operationVersion: 'v1',
            payload: catalogIdempotencyPayload,
          }),
        }),
    });
    return Object.freeze({
      router,
      resource: Object.freeze({
        name: 'venue-catalog-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}

function createStorage(config: Config): StorageProvider {
  return config.storage.enabled
    ? createSupabaseStorageProvider(config.storage)
    : new FakeStorageProvider();
}

export function catalogIdempotencyPayload(request: Request): unknown {
  const file = request.file;
  return {
    params: request.params,
    query: request.query,
    body: request.body as unknown,
    ...(file === undefined
      ? {}
      : {
          file: {
            contentType: file.mimetype,
            sizeBytes: file.size,
            checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
          },
        }),
  };
}
