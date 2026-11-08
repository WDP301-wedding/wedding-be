import { NotFoundError } from '../../../core/errors/app-error.js';
import {
  eventOperationsSchema,
  type EventOperationsReader,
} from '../application/event-operations.reader.js';
import { proposalMenuLinesSchema } from '../domain/booking-policy.js';
import { createEffectiveCommercialReader } from './effective-commercial.reader.js';

/** Booking-owned projection: explicitly select operational facts and never expose prices. */
export const eventOperationsReader: EventOperationsReader = {
  async read(tx, bookingId) {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        phase: true,
        consultation: { select: { brideName: true, groomName: true } },
        depositSettlement: { select: { contractRevisionId: true } },
        proposalSnapshot: true,
      },
    });
    if (booking.depositSettlement?.contractRevisionId) {
      const effective = await createEffectiveCommercialReader(tx).getEffective(bookingId);
      const identity = effective.appendices.at(-1)?.document ?? effective.contract.document;
      return eventOperationsSchema.parse({
        phase: booking.phase,
        brideName: identity.brideName,
        groomName: identity.groomName,
        tableCount: effective.lines
          .filter((l) => l.category === 'MENU')
          .reduce((n, l) => n + l.quantity, 0),
        offerings: effective.lines
          .filter((l) => l.category !== 'PRINT')
          .map((l) => ({
            category: l.category,
            name: l.name,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
          })),
      });
    }
    const snapshot = booking.proposalSnapshot;
    if (!snapshot) throw new NotFoundError();
    const menus =
      snapshot.menus == null
        ? [
            {
              name: snapshot.menuName,
              description: snapshot.menuDescription,
              tableCount: snapshot.tableCount,
            },
          ]
        : proposalMenuLinesSchema.parse(snapshot.menus);
    return eventOperationsSchema.parse({
      phase: booking.phase,
      ...booking.consultation,
      tableCount: snapshot.tableCount,
      offerings: menus.map((menu) => ({
        category: 'MENU',
        name: menu.name,
        description: menu.description,
        unit: 'bàn',
        quantity: menu.tableCount,
      })),
    });
  },
};
