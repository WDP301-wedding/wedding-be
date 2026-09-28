import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(migrationDatabaseUrl === undefined || migrationDatabaseUrl === ''
    ? {}
    : { datasource: { url: migrationDatabaseUrl } }),
});
