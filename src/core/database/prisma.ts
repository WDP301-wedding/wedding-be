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

  const schema = new URL(connectionString).searchParams.get('schema')?.trim();
  const adapter = new PrismaPg(
    { connectionString },
    schema === undefined || schema === '' ? undefined : { schema },
  );

  return new PrismaClient({ adapter });
}
