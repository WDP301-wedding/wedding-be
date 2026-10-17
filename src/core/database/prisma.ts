import { PrismaPg } from '@prisma/adapter-pg';

import { config } from '../../config/config.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { DiagnosticPool } from './diagnostics.js';
import { parsePoolBudget } from './pool-budget.js';

const schemas = new WeakMap<PrismaClient, string>();
export function prismaSchema(prisma: PrismaClient): string {
  return schemas.get(prisma) ?? 'public';
}

export class DatabaseConfigurationError extends Error {
  override readonly name = 'DatabaseConfigurationError';

  constructor() {
    super('DATABASE_URL is required to create the runtime database client.');
  }
}

export function createPrismaClient(
  databaseUrl = config.database.url,
  diagnosticsEnabled = process.env.DB_DIAGNOSTICS_ENABLED === 'true',
  poolOwner: 'default' | 'venue-catalog' | 'analytics' = 'default',
): PrismaClient {
  const connectionString = databaseUrl?.trim();

  if (connectionString === undefined || connectionString === '') {
    throw new DatabaseConfigurationError();
  }

  const url = new URL(connectionString);
  const budget = parsePoolBudget(process.env);
  const { connectionTimeoutMillis, idleTimeoutMillis } = budget;
  const max = {
    default: budget.max,
    'venue-catalog': budget.venueCatalogMax,
    analytics: budget.analyticsMax,
  }[poolOwner];
  const poolConfig = { max, connectionTimeoutMillis, idleTimeoutMillis };
  const schema = url.searchParams.get('schema')?.trim();
  // Prisma's PostgreSQL adapter serializes and parses timestamps as UTC.
  const startupOptions = url.searchParams.get('options') ?? process.env.PGOPTIONS ?? '';
  url.searchParams.set('options', `${startupOptions} -c timezone=UTC`.trim());
  const adapter = diagnosticsEnabled
    ? new PrismaPg(new DiagnosticPool({ connectionString: url.toString(), ...poolConfig }), {
        ...(schema ? { schema } : {}),
        disposeExternalPool: true,
      })
    : new PrismaPg(
        { connectionString: url.toString(), ...poolConfig },
        schema ? { schema } : undefined,
      );
  const client = new PrismaClient({ adapter });
  schemas.set(client, schema || 'public');
  return client;
}
