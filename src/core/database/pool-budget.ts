/** Eight owner runtimes plus the dedicated one-connection readiness pool.
 * Planned processes include rollout overlap, replicas and separate worker/CLI
 * processes sharing this database; this does not enable HTTP multi-replica mode. */
export function parsePoolBudget(source: Readonly<Record<string, string | undefined>>) {
  const integer = (name: string, fallback: number): number => {
    const raw = source[name] ?? String(fallback);
    if (!/^\d+$/u.test(raw) || Number(raw) < 1 || Number(raw) > 100000)
      throw new Error(`Invalid database pool setting: ${name}.`);
    return Number(raw);
  };
  const max = integer('DB_POOL_MAX', 3);
  const connectionTimeoutMillis = integer('DB_POOL_ACQUIRE_TIMEOUT_MS', 2000);
  const idleTimeoutMillis = integer('DB_POOL_IDLE_TIMEOUT_MS', 10000);
  if (idleTimeoutMillis < 1000 || idleTimeoutMillis > 60000)
    throw new Error('Invalid database pool setting: DB_POOL_IDLE_TIMEOUT_MS.');
  const plannedProcesses = integer('DB_PLANNED_PROCESSES', 2);
  const databaseMax = integer('DB_MAX_CONNECTIONS', 60);
  const reserve = integer('DB_CONNECTION_RESERVE', 10);
  const perProcess = 8 * max + 1;
  const aggregate = perProcess * plannedProcesses + reserve;
  if (aggregate > databaseMax)
    throw new Error('Declared database connection budget exceeds capacity.');
  return Object.freeze({
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    plannedProcesses,
    databaseMax,
    reserve,
    perProcess,
    aggregate,
  });
}
