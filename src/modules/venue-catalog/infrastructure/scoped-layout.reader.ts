import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { enlistedPrismaClient } from '../../../core/database/enlisted-prisma-client.js';
import { createLayoutService, type LayoutService } from '../application/layout.service.js';

/** Reuse the booking connection while it holds locks; a second pool acquisition
 * can otherwise wait on transactions blocked by this very booking. */
export function createScopedLayoutReader(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
): Pick<LayoutService, 'resolveVersion' | 'listCurrentVersionsForHall'> {
  const reader = () => {
    const tx = boundary.current();
    return createLayoutService(tx === undefined ? prisma : enlistedPrismaClient(tx));
  };
  return {
    resolveVersion: (id) => reader().resolveVersion(id),
    listCurrentVersionsForHall: (id) => reader().listCurrentVersionsForHall(id),
  };
}
