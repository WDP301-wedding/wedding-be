import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { createScopedIdentityReaders } from '../../identity-access/authorization/scoped-identity.reader.js';
import { createPrismaDepositSettlementReader } from '../../payments-billing/infrastructure/prisma-deposit-settlement.reader.js';
import { createPrismaBookingReaders } from '../../booking-lifecycle/infrastructure/prisma-booking.readers.js';
import { createGuestBookingPlanningProviders } from '../../booking-lifecycle/infrastructure/guest-planning.providers.js';
import { createGuestPlanningCapacityReader } from '../../venue-catalog/infrastructure/guest-planning-capacity.reader.js';
import { GuestRepository } from './guest.repository.js';
import { GuestService } from '../application/guest.service.js';
import { GuestLinksService } from '../application/guest-links.service.js';
import { createGuestPublicationReader } from '../../invitation-studio/infrastructure/guest-publication.reader.js';
import { GuestReaders, type GuestStaffAccessFacade } from '../application/guest-readers.js';

export function createGuestServices(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
  staff?: GuestStaffAccessFacade,
  sharedBoundary?: PrismaBookingBoundary,
) {
  const boundary = sharedBoundary ?? new PrismaBookingBoundary(prisma);
  const identity = createScopedIdentityReaders(prisma, boundary, now);
  const billing = createPrismaDepositSettlementReader(prisma, boundary);
  const owners = {
    ...createPrismaBookingReaders(prisma, boundary, identity.access, billing),
    planning: createGuestBookingPlanningProviders(prisma, boundary, billing),
    capacity: createGuestPlanningCapacityReader(boundary),
    invitation: createGuestPublicationReader(prisma, boundary),
  };
  const repository = new GuestRepository(prisma, boundary);
  const guests = new GuestService(repository, identity.resolver, owners, now);
  return {
    guests,
    links: new GuestLinksService(guests),
    readers: new GuestReaders(guests, staff),
    owners,
    identity,
    boundary,
    repository,
  };
}
