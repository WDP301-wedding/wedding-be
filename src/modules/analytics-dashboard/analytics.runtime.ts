import { randomUUID } from 'node:crypto';
import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { createAnalyticsServices } from './infrastructure/analytics.composition.js';
import { createAnalyticsRouter } from './http/analytics.router.js';
export async function createAnalyticsRuntime(config: Config) {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const services = createAnalyticsServices(prisma);
    let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined;
    let stopping = false;
    const tick = async () => {
      let after: string | undefined;
      while (!stopping) {
        const heads = await prisma.analyticsHead.findMany({
          take: 100,
          orderBy: { scope: 'asc' },
          ...(after === undefined ? {} : { where: { scope: { gt: after } } }),
        });
        for (const head of heads) {
          if (stopping) break;
          const requestId = randomUUID();
          await services.projector
            .refresh(head.scope, {
              authority: 'AUTHENTICATED',
              actorAccountId: head.scope,
              requestId,
              causationId: requestId,
            })
            .catch(() => undefined);
        }
        if (heads.length < 100) break;
        after = heads.at(-1)!.scope;
      }
    };
    const stop = async () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      stopping = true;
      await pending;
    };
    return {
      router: createAnalyticsRouter(services.service, services.resolver, services.audit),
      providers: services,
      start() {
        stopping = false;
        if (!timer)
          timer = setInterval(() => {
            if (!pending)
              pending = tick()
                .catch(() => undefined)
                .finally(() => {
                  pending = undefined;
                });
          }, 60000).unref();
      },
      stop,
      resource: {
        name: 'analytics-database',
        async close() {
          await stop();
          await prisma.$disconnect();
        },
      },
    };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
