import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from 'pg';

import { createPrismaClient } from '../../../src/core/database/prisma.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

export const catalogMigrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();

export class CatalogTestDatabase {
  readonly databaseName: string;
  readonly #admin: Client;
  readonly #databaseUrl: string;
  readonly #testDatabaseUrl: string;
  #prisma: PrismaClient | undefined;
  #connected = false;
  #databaseCreated = false;

  constructor(prefix: string) {
    this.#databaseUrl =
      catalogMigrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
    this.databaseName = `${prefix}_${randomUUID().replaceAll('-', '')}`;
    this.#testDatabaseUrl = withDatabase(this.#databaseUrl, this.databaseName);
    this.#admin = new Client({ connectionString: this.#databaseUrl });
  }

  get prisma(): PrismaClient {
    if (this.#prisma === undefined) throw new Error('Catalog test database is not connected.');
    return this.#prisma;
  }

  async connect(): Promise<void> {
    await this.#admin.connect();
    this.#connected = true;
    await this.#admin.query(`CREATE DATABASE ${quoteIdentifier(this.databaseName)}`);
    this.#databaseCreated = true;
    const migrationClient = new Client({ connectionString: this.#testDatabaseUrl });
    await migrationClient.connect();
    const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
    const entries = await readdir(migrationsRoot, { withFileTypes: true });
    const migrationPaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(migrationsRoot, entry.name, 'migration.sql'))
      .sort();
    try {
      for (const migrationPath of migrationPaths) {
        await migrationClient.query(await readFile(migrationPath, 'utf8'));
      }
    } finally {
      await migrationClient.end();
    }
    this.#prisma = createPrismaClient(this.#testDatabaseUrl);
    await this.#prisma.$connect();
    await this.#prisma.$queryRaw`SELECT 1`;
    await this.#prisma.$transaction((transaction) => transaction.$queryRaw`SELECT 1`);
  }

  async disconnect(): Promise<void> {
    await this.#prisma?.$disconnect();
    if (this.#connected) {
      if (this.#databaseCreated) {
        await this.#admin.query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(this.databaseName)} WITH (FORCE)`,
        );
      }
      await this.#admin.end();
    }
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function withDatabase(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.delete('schema');
  url.searchParams.delete('options');
  return url.toString();
}
