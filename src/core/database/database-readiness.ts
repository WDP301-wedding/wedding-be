import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import type { ReadinessProbe } from '../http/readiness.js';
import type { ShutdownResource } from '../http/lifecycle.js';

type Migration = Readonly<{ name: string; checksum: string }>;
type MigrationRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};
type ReadinessPool = Pick<Pool, 'connect' | 'end' | 'on'>;

export const DATABASE_READINESS_TIMEOUT_MS = 5_000;

// Lotus was shipped as a data migration before it was guarded for empty databases.
// Accept the original release only against the exact guarded artifact. Keep all
// other migrations, including future changes to this file, on exact matching.
const lotusMigration = '20261105081000_add_lotus_layout_templates';
const lotusGuardedChecksum = '16f8fb7b33ce8a680344bb485a772e5bcb4dc54ac6168ce2cc96f874f8b5352b';
const lotusOriginalChecksum = 'b0c4d125fde2df1327ccbd7cb7af9ab3fefe8cee31ee6caca8646a0529639929';

function matchesAppliedChecksum(migration: Migration, appliedChecksum: string): boolean {
  return (
    appliedChecksum === migration.checksum ||
    (migration.name === lotusMigration &&
      migration.checksum === lotusGuardedChecksum &&
      appliedChecksum === lotusOriginalChecksum)
  );
}

export function readRequiredMigrations(): readonly Migration[] {
  const directory = new URL('../../../prisma/migrations/', import.meta.url);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      checksum: createHash('sha256')
        .update(readFileSync(new URL(`${entry.name}/migration.sql`, directory)))
        .digest('hex'),
    }));
}

/** One dedicated connection, bounded acquisition/query, no writes or provider calls. */
export function createDatabaseReadiness(
  databaseUrl: string | undefined,
  options: { readonly pool?: ReadinessPool; readonly migrations?: readonly Migration[] } = {},
): Readonly<{ probe: ReadinessProbe; resource: ShutdownResource }> {
  if (!databaseUrl?.trim()) throw new Error('Database readiness requires DATABASE_URL.');
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('schema')?.trim() || 'public';
  const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
  const migrations = options.migrations ?? readRequiredMigrations();
  if (migrations.length === 0) throw new Error('Database readiness requires migration artifacts.');
  const pool =
    options.pool ??
    new Pool({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 4_000,
      query_timeout: 700,
      statement_timeout: 700,
      idleTimeoutMillis: 10_000,
      application_name: 'wedding-readiness',
    });
  // An idle connection lost during an outage must not terminate the process.
  pool.on('error', () => undefined);
  let closed = false;
  let closing: Promise<void> | undefined;
  let inFlight: Promise<void> | undefined;
  let abortActive: (() => void) | undefined;
  const run = async (signal: AbortSignal): Promise<void> => {
    const client = await pool.connect();
    let released = false;
    const release = (destroy: boolean): void => {
      if (!released) {
        released = true;
        abortActive = undefined;
        client.release(destroy);
      }
    };
    const abort = (): void => release(true);
    abortActive = abort;
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted || closed) throw new Error('Database readiness cancelled.');
      const { rows } = await client.query<MigrationRow>(
        `SELECT migration_name, checksum, finished_at, rolled_back_at FROM ${quotedSchema}."_prisma_migrations"`,
      );
      if (
        signal.aborted ||
        closed ||
        rows.some((row) => row.finished_at === null && row.rolled_back_at === null) ||
        migrations.some(
          (migration) =>
            !rows.some(
              (row) =>
                row.migration_name === migration.name &&
                matchesAppliedChecksum(migration, row.checksum) &&
                row.finished_at !== null &&
                row.rolled_back_at === null,
            ),
        )
      ) {
        throw new Error('Database schema is incompatible with this build.');
      }
      release(false);
    } catch (error: unknown) {
      release(true);
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
  return Object.freeze({
    probe: (signal) => {
      if (closed) return Promise.reject(new Error('Database readiness is closed.'));
      inFlight ??= run(signal).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    resource: Object.freeze({
      name: 'database-readiness',
      close: () => {
        closed = true;
        abortActive?.();
        closing ??= pool.end();
        return closing;
      },
      forceClose: () => {
        closed = true;
        abortActive?.();
      },
    }),
  });
}
