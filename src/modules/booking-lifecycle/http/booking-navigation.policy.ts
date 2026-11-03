import type { Prisma } from '../../../generated/prisma/client.js';
// Keep fresh/unconverted requests: optional relations must not become SQL NULL exclusions.
export const activeIntakeWhere: Prisma.ConsultationRequestWhereInput = {
  OR: [
    { consultationId: null },
    { consultation: { booking: null } },
    { consultation: { booking: { phase: { not: 'CANCELLED' } } } },
  ],
};
