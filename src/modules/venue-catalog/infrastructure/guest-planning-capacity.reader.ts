import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';

export function createGuestPlanningCapacityReader(boundary: PrismaBookingBoundary) {
  return {
    async requireCapacity(hallId: string, headcount: number, context: ContractContext) {
      const tx = boundary.enlist(context);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`HALL:${hallId}`}))`;
      await tx.$queryRaw`SELECT id FROM "Hall" WHERE id=${hallId}::uuid FOR SHARE`;
      const hall = await tx.hall.findUnique({ where: { id: hallId } });
      if (hall === null || hall.lifecycle !== 'ACTIVE') throw new NotFoundError();
      if (headcount > hall.maxGuests)
        throw new AppError({
          status: 409,
          code: 'GUEST_PLAN_CAPACITY_EXCEEDED',
          message: 'The planning total exceeds hall capacity.',
        });
    },
  };
}
