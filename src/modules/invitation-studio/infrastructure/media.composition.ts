import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import type { StorageProvider } from '../../../integrations/storage/storage-provider.js';
import { createScopedIdentityReaders } from '../../identity-access/authorization/scoped-identity.reader.js';
import { createPrismaDepositSettlementReader } from '../../payments-billing/infrastructure/prisma-deposit-settlement.reader.js';
import { createPrismaBookingReaders } from '../../booking-lifecycle/infrastructure/prisma-booking.readers.js';
import { createMediaAccessGuard } from '../application/media-access.guard.js';
import { createMediaEventStartReader } from '../application/media-event-start.reader.js';
import { MediaService } from '../application/media.service.js';
import { PrismaMediaRepository } from './prisma-media.repository.js';
import { SharpMediaInspector } from './sharp-media.inspector.js';

/** Real W1 owner composition. No seed/fake confirmed state and no money writer.
 * HTTP/OpenAPI publication is an independent IS-W6 hand-off. Storage is explicit
 * so bootstrap cannot quietly fall back to a fake provider. */
export function createPersistentMediaService(
  prisma: PrismaClient,
  storage: StorageProvider,
  now: () => Date = () => new Date(),
) {
  const boundary = new PrismaBookingBoundary(prisma);
  const identity = createScopedIdentityReaders(prisma, boundary, now);
  const billing = createPrismaDepositSettlementReader(prisma, boundary);
  const providers = createPrismaBookingReaders(prisma, boundary, identity.access, billing);
  const guard = createMediaAccessGuard(
    identity.resolver,
    providers.booking,
    createMediaEventStartReader(providers.timeline),
  );
  const repository = new PrismaMediaRepository(prisma, boundary);
  const service = new MediaService(repository, guard, storage, new SharpMediaInspector(), now);
  return { service, repository, boundary, guard, identity, ...providers, billing };
}
