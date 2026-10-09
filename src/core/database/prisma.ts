import { PrismaPg } from '@prisma/adapter-pg';

import { config } from '../../config/config.js';
import { PrismaClient } from '../../generated/prisma/client.js';

export class DatabaseConfigurationError extends Error {
  override readonly name = 'DatabaseConfigurationError';

  constructor() {
    super('DATABASE_URL is required to create the runtime database client.');
  }
}

export function createPrismaClient(databaseUrl = config.database.url): PrismaClient {
  const connectionString = databaseUrl?.trim();

  if (connectionString === undefined || connectionString === '') {
    throw new DatabaseConfigurationError();
  }

  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema')?.trim();
  // Prisma's PostgreSQL adapter serializes and parses timestamps as UTC.
  const startupOptions = url.searchParams.get('options') ?? process.env.PGOPTIONS ?? '';
  url.searchParams.set('options', `${startupOptions} -c timezone=UTC`.trim());
  const adapter = new PrismaPg(
    { connectionString: url.toString() },
    schema === undefined || schema === '' ? undefined : { schema },
  );

  return new PrismaClient({ adapter });
}
