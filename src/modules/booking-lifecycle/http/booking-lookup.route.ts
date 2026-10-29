import type { Router } from 'express';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { bookingLookupQuerySchema, bookingLookupResponseSchema } from './booking-lookup.schemas.js';

/** Read-only identity lookup; scoped identically to consultation workspace access. */
export function registerBookingLookup(router: Router, prisma: PrismaClient) {
  router.get(
    '/booking-lookups',
    validateRequest({ query: bookingLookupQuerySchema }),
    async (_request, response) => {
      const { query } = validatedRequest(response, { query: bookingLookupQuerySchema });
      const managerAccountId = (response.locals.actor as AuthenticatedActor).accountId;
      const q = query.q?.normalize('NFC') ?? '';
      const code = q?.toUpperCase();
      const identityFilter: Prisma.BookingWhereInput = query.ids
        ? { id: { in: [...new Set(query.ids.split(','))] } }
        : code && /^HY-\d+$/u.test(code)
          ? { bookingCode: code }
          : {
              OR: [
                { alias: { contains: q, mode: 'insensitive' } },
                { consultation: { displayName: { contains: q, mode: 'insensitive' } } },
                { consultation: { brideName: { contains: q, mode: 'insensitive' } } },
                { consultation: { groomName: { contains: q, mode: 'insensitive' } } },
                { consultation: { intakeRequest: { phone: { contains: q } } } },
                ...(q && zUuid(q) ? [{ id: q }] : []),
              ],
            };
      const rows = await prisma.booking.findMany({
        where: { AND: [{ consultation: { managerAccountId } }, identityFilter] },
        take: 20,
        orderBy: [{ eventDate: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          bookingCode: true,
          eventDate: true,
          shiftCode: true,
          alias: true,
          consultation: { select: { displayName: true } },
          proposalSnapshot: { select: { hallName: true } },
        },
      });
      response.json(
        bookingLookupResponseSchema.parse({
          data: rows.map((row) => ({
            bookingId: row.id,
            bookingCode: row.bookingCode,
            customerName: row.consultation.displayName,
            eventDate: row.eventDate.toISOString().slice(0, 10),
            hallName: row.proposalSnapshot?.hallName ?? '',
            shiftCode: row.shiftCode,
            alias: row.alias,
          })),
        }),
      );
    },
  );
}

function zUuid(value: string): boolean {
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(value);
}
