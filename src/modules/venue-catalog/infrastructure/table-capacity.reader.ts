import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { requireTableCapacity } from '../../booking-lifecycle/domain/table-capacity.js';

type Client = PrismaClient | Prisma.TransactionClient;

/** A layout's number of tables is authoritative. Per-table seat settings are not used. */
export async function readHallTableCapacity(
  client: Pick<Client, 'hall' | 'layoutTemplateVersion'>,
  hallId: string,
) {
  const [hall, layouts] = await Promise.all([
    client.hall.findUnique({ where: { id: hallId }, select: { maxGuests: true, lifecycle: true } }),
    client.layoutTemplateVersion.findMany({
      where: {
        state: 'PUBLISHED',
        currentFor: { is: { hallId, lifecycle: 'ACTIVE', hall: { lifecycle: 'ACTIVE' } } },
      },
      select: { _count: { select: { geometry: true } } },
    }),
  ]);
  if (hall === null) throw new NotFoundError();
  return {
    hallMaxGuests: hall.maxGuests,
    maximumTables:
      hall.lifecycle === 'ACTIVE'
        ? Math.max(0, ...layouts.map((layout) => layout._count.geometry))
        : 0,
  };
}

/** Enlisted writes hold the hall and layout-template locks through their mutation. */
export async function readLockedHallTableCapacity(client: Client, hallId: string) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`HALL:${hallId}`}))`;
  // Catalog publication/retirement serializes on LAYOUT_TEMPLATE, not only HALL.
  // Lock existing templates in order, then read a fresh snapshot after any wait.
  // A concurrently added template can only increase the available maximum.
  await client.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('LAYOUT_TEMPLATE:' || ordered.id::text))
    FROM (SELECT id FROM "LayoutTemplate" WHERE "hallId"=${hallId}::uuid ORDER BY id) ordered`;
  return readHallTableCapacity(client, hallId);
}

export async function requireHallTableCapacity(
  client: Client,
  hallId: string,
  headcount: number,
  tableCount: number,
) {
  const capacity = await readLockedHallTableCapacity(client, hallId);
  requireTableCapacity(headcount, tableCount, capacity.maximumTables, capacity.hallMaxGuests);
  return capacity;
}
