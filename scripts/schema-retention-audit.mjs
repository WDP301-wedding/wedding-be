import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';

// Metadata and optional fixture digests: no row contents, SQL text, destination,
// token or credentials leave this process.
// Read-only transaction and server deadline also apply on the selected remote DB.
const output = process.env.PERF_SCHEMA_OUTPUT;
if (!output || !process.env.DATABASE_URL)
  throw new Error('Select DATABASE_URL and a new PERF_SCHEMA_OUTPUT.');
await writeFile(output, '{}\n', { flag: 'wx' });
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  statement_timeout: 5000,
  application_name: 'wedding_schema_retention_audit',
});
const rehearsal = [
  'ntf12_rehearsal_7469190783fb4b039f409b2f50843556',
  'ntf12_rehearsal_a96eee86c8e041bc94ceec99c8018d75',
  'ntf_rv16_edd0b9f9cfb4493195b69841b00a900f',
];
const result = {
  at: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim(),
  source: 'Selected operator DATABASE_URL; metadata only; not container latency',
  readOnly: true,
  limitations: [
    'Activity is a point-in-time observation, not absence-of-consumer proof.',
    'Dynamic SQL, external consumers and JSON payload references require owner confirmation.',
    'No deletions approved. Retained provider/UNKNOWN and immutable evidence must survive cleanup.',
  ],
};
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  result.settings = (
    await client.query(`SELECT current_setting('server_version') AS version,
    current_setting('max_connections')::int AS max_connections, current_setting('transaction_read_only') AS read_only`)
  ).rows[0];
  result.schemas = (
    await client.query(`SELECT n.nspname AS schema, pg_get_userbyid(n.nspowner) AS owner,
    count(c.oid)::int AS tables FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relkind IN ('r','p')
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' GROUP BY n.oid ORDER BY n.nspname`)
  ).rows;
  result.tables = (
    await client.query(`SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS database_owner,
    pg_total_relation_size(c.oid)::float8 AS bytes, s.n_live_tup::float8 AS estimated_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)
  ).rows;
  result.foreignKeys = (
    await client.query(
      `SELECT n.nspname AS source_schema, c.relname AS source_table,
    tn.nspname AS target_schema, tc.relname AS target_table, k.conname AS constraint
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class tc ON tc.oid=k.confrelid JOIN pg_namespace tn ON tn.oid=tc.relnamespace
    WHERE k.contype='f' AND (n.nspname='public' OR tn.nspname='public' OR n.nspname=ANY($1) OR tn.nspname=ANY($1))
    ORDER BY n.nspname,c.relname,k.conname`,
      [rehearsal],
    )
  ).rows;
  result.jsonColumns = (
    await client.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND data_type IN ('json','jsonb') ORDER BY table_name,column_name`)
  ).rows;
  result.rehearsalDependencies = (
    await client.query(
      `SELECT DISTINCT sn.nspname AS referenced_schema,
    s.relname AS referenced_relation, dn.nspname AS dependent_schema, d.relname AS dependent_relation
    FROM pg_depend dep JOIN pg_class s ON s.oid=dep.refobjid AND dep.refclassid='pg_class'::regclass
    JOIN pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_rewrite rw ON rw.oid=dep.objid AND dep.classid='pg_rewrite'::regclass
    JOIN pg_class d ON d.oid=rw.ev_class JOIN pg_namespace dn ON dn.oid=d.relnamespace
    WHERE sn.nspname=ANY($1) AND dn.nspname<>sn.nspname ORDER BY 1,2,3,4`,
      [rehearsal],
    )
  ).rows;
  result.rehearsalFunctionReferences = (
    await client.query(
      `SELECT n.nspname AS schema, p.proname AS function,
    r.schema_name AS referenced_schema FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN unnest($1::text[]) AS r(schema_name) WHERE p.prokind IN ('f','p')
    AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND (position(r.schema_name IN p.prosrc)>0 OR position(r.schema_name IN coalesce(array_to_string(p.proconfig, ','),''))>0) ORDER BY 1,2,3`,
      [rehearsal],
    )
  ).rows;
  result.activity = (
    await client.query(`SELECT application_name, state, wait_event_type, count(*)::int AS connections
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
    GROUP BY application_name,state,wait_event_type ORDER BY 1,2,3`)
  ).rows;
  if (process.env.PERF_BOOKING_ID) {
    const id = process.env.PERF_BOOKING_ID;
    if (!/^[a-f0-9-]{36}$/iu.test(id)) throw new Error('Invalid selected fixture ID.');
    result.fixture = { bookingId: id, tables: {} };
    const tables = [
      ['Booking', 'id'],
      ['GuestWorkspace', 'bookingId'],
      ['GuestPlanRevision', 'bookingId'],
      ['Guest', 'bookingId'],
      ['GuestGroup', 'bookingId'],
      ['GuestHistory', 'bookingId'],
      ['SeatingPlan', 'bookingId'],
      ['SeatingPlanRevision', 'bookingId'],
      ['StaffConfiguration', 'bookingId'],
      ['StaffAssignment', 'bookingId'],
      ['StaffHistory', 'bookingId'],
      ['StaffCheckInRecord', 'bookingId'],
      ['CommercialContractRevision', 'bookingId'],
      ['FinalInvoiceRevision', 'bookingId'],
      ['BillingLedgerEntry', 'bookingId'],
    ];
    for (const [table, column] of tables) {
      const order = ['GuestWorkspace', 'StaffConfiguration'].includes(table) ? 'bookingId' : 'id';
      // Identifiers are a closed local list; the fixture selector is bound.
      const rows = (
        await client.query(`SELECT * FROM "${table}" WHERE "${column}"=$1 ORDER BY "${order}"`, [
          id,
        ])
      ).rows;
      result.fixture.tables[table] = {
        count: rows.length,
        sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      };
    }
  }
  await client.query('ROLLBACK');
  const paths = execFileSync(
    'git',
    ['ls-files', 'src', 'scripts', 'prisma/migrations', 'tasks/evidence', 'docs'],
    { encoding: 'utf8', windowsHide: true },
  )
    .trim()
    .split(/\r?\n/u);
  const files = await Promise.all(
    paths
      .filter((p) => /\.(ts|mjs|sql|md|json)$/u.test(p))
      .map(async (path) => ({ path, text: await readFile(path, 'utf8') })),
  );
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gmu)];
  for (const row of result.tables) {
    const model = models.find((m) => m[1] === row.name || m[2].includes(`@@map("${row.name}")`));
    const names = [
      row.name,
      model?.[1],
      model && model[1][0].toLowerCase() + model[1].slice(1),
    ].filter(Boolean);
    const matches = files.filter((f) =>
      names.some((name) => new RegExp(`\\b${name}\\b`, 'u').test(f.text)),
    );
    row.prismaModel = model?.[1] ?? null;
    row.runtimeReferences = matches
      .filter((f) => f.path.startsWith('src/') && !f.path.endsWith('.test.ts'))
      .map((f) => f.path);
    row.workerReferences = row.runtimeReferences.filter((p) =>
      /worker|retention|scheduler|delivery|projection/iu.test(p),
    );
    row.migrationReferences = matches
      .filter((f) => f.path.startsWith('prisma/migrations/'))
      .map((f) => f.path);
    row.incomingForeignKeys = result.foreignKeys.filter(
      (f) => f.target_schema === 'public' && f.target_table === row.name,
    ).length;
    row.outgoingForeignKeys = result.foreignKeys.filter(
      (f) => f.source_schema === 'public' && f.source_table === row.name,
    ).length;
    row.proposedAction = 'RETAIN';
  }
  result.rehearsalReferences = Object.fromEntries(
    rehearsal.map((name) => [name, files.filter((f) => f.text.includes(name)).map((f) => f.path)]),
  );
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify({
      output,
      tables: result.tables.length,
      schemas: result.schemas,
      foreignKeys: result.foreignKeys.length,
      jsonColumns: result.jsonColumns.length,
      rehearsalDependencies: result.rehearsalDependencies.length,
    }),
  );
} finally {
  await client.end();
}
