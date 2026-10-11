import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { createGuestServices } from './infrastructure/guest.composition.js';
import { createGuestRouter } from './http/guest.router.js';

export async function createGuestManagementRuntime(config: Config) {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const services = createGuestServices(prisma);
    return Object.freeze({
      router: createGuestRouter(services),
      providers: services.readers,
      resource: Object.freeze({
        name: 'guest-management-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
