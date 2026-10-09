import { randomUUID } from 'node:crypto';
import { createApp } from '../../../src/app.js';
import { parseEnvironment } from '../../../src/config/env.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createBookingLifecycleRuntime } from '../../../src/modules/booking-lifecycle/booking-lifecycle.runtime.js';
import { createAuthenticatedActorResolver } from '../../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import { hashPassword } from '../../../src/modules/identity-access/crypto/password.js';
import { createIdentityRuntime } from '../../../src/modules/identity-access/identity.runtime.js';
import { createPrismaSessionRepository } from '../../../src/modules/identity-access/session/session.repository.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import { createPaymentsBillingHttpServices } from '../../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from '../../../src/modules/payments-billing/http/payments-billing.router.js';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createPayableBooking } from './deposit-fixture.js';
import { controlledVnpay } from './vnpay-fixture.js';

// Only initial booking/catalog facts and provider transport are controlled. Every
// money, access, session and booking transition uses its production owner adapter.
export async function createAcceptanceFixture(
  prisma: PrismaClient,
  databaseUrl: string,
  origins = ['http://localhost:3400', 'http://localhost:3402'],
) {
  const f = await createPayableBooking(prisma);
  const config = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    CORS_ALLOWED_ORIGINS: origins.join(','),
  });
  const password = `Acceptance-${randomUUID()}`;
  const verifier = await hashPassword(password, config.identityAccess.password);
  for (const accountId of [CATALOG_SEED_IDS.actor, f.accountId]) {
    await prisma.passwordCredential.create({
      data: {
        accountId,
        algorithm: verifier.algorithm,
        version: verifier.version,
        ...verifier.parameters,
        saltEncoded: verifier.saltEncoded,
        derivedKeyEncoded: verifier.derivedKeyEncoded,
      },
    });
  }
  const couple = await prisma.account.findUniqueOrThrow({ where: { id: f.accountId } });
  const managerAccount = await prisma.account.findUniqueOrThrow({
    where: { id: CATALOG_SEED_IDS.actor },
  });
  const identity = await createIdentityRuntime(config);
  try {
    const booking = await createBookingLifecycleRuntime(config);
    const providers = createPaymentsBillingProviders(prisma, {
      vnpay: controlledVnpay,
      gateway: {
        query() {
          return Promise.reject(new Error('Controlled provider timeout'));
        },
      },
    });
    const router = createPaymentsBillingRouter({
      services: createPaymentsBillingHttpServices(prisma, providers),
      resolveActor: createAuthenticatedActorResolver(createPrismaSessionRepository(prisma)),
    });
    const app = createApp({
      runtimeEnvironment: 'test',
      corsConfig: config.cors,
      registerRoutes(app) {
        app.use('/api/v1', identity.router, booking.router, router);
      },
    });
    return {
      ...f,
      app,
      providers,
      password,
      coupleEmail: couple.displayEmail,
      managerEmail: managerAccount.displayEmail,
      manager: { ...f.context, actorAccountId: CATALOG_SEED_IDS.actor },
      async close() {
        await booking.resource.close();
        await identity.resource.close();
      },
    };
  } catch (error) {
    await identity.resource.close();
    throw error;
  }
}
