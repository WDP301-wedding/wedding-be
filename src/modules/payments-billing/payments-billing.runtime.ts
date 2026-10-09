import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { createAuthenticatedActorResolver } from '../identity-access/authorization/authenticated-actor.middleware.js';
import { createPrismaSessionRepository } from '../identity-access/session/session.repository.js';
import { createPaymentsBillingProviders } from './payments-billing.providers.js';
import { createPaymentsBillingHttpServices } from './http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from './http/payments-billing.router.js';

export async function createPaymentsBillingRuntime(config: Config) {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const providers = createPaymentsBillingProviders(prisma, { vnpay: config.vnpay });
    const services = createPaymentsBillingHttpServices(prisma, providers);
    return Object.freeze({
      router: createPaymentsBillingRouter({
        services,
        resolveActor: createAuthenticatedActorResolver(createPrismaSessionRepository(prisma)),
      }),
      providers,
      resource: Object.freeze({
        name: 'payments-billing-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}
