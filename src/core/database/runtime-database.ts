import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ShutdownResource } from '../http/lifecycle.js';

export function createApplicationDatabaseResource(
  prisma: Pick<PrismaClient, '$disconnect'>,
  resources: readonly ShutdownResource[],
): ShutdownResource {
  return {
    name: 'application-resources',
    close: closeApplicationDatabase(prisma, resources),
    forceClose: () => {
      for (const resource of resources) {
        try {
          resource.forceClose?.();
        } catch {
          /* Continue best-effort cleanup of every child. */
        }
      }
    },
  };
}

/** The composition root owns this client; modules borrow it and drain first. */
export function closeApplicationDatabase(
  prisma: Pick<PrismaClient, '$disconnect'>,
  resources: readonly ShutdownResource[],
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= (async () => {
      const results = await Promise.allSettled(resources.map(async (resource) => resource.close()));
      results.push(...(await Promise.allSettled([prisma.$disconnect()])));
      const errors = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason as unknown);
      if (errors.length) throw new AggregateError(errors, 'Application resource cleanup failed.');
    })();
    return closing;
  };
}
