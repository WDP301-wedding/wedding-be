import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();

if (process.argv.includes('migrate') && !migrationDatabaseUrl) {
  throw new Error(
    'MIGRATION_DATABASE_URL is required. Use the Render external PostgreSQL URL locally, or the injected internal URL inside Render. No legacy database fallback is used.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(migrationDatabaseUrl === undefined || migrationDatabaseUrl === ''
    ? {}
    : { datasource: { url: migrationDatabaseUrl } }),
});
