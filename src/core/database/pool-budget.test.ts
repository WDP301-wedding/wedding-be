import { describe, expect, it } from 'vitest';
import { parsePoolBudget } from './pool-budget.js';

describe('aggregate runtime pool budget', () => {
  it('includes eight owners, readiness, overlapping processes and provider reserve', () => {
    expect(parsePoolBudget({})).toEqual({
      max: 3,
      venueCatalogMax: 3,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      plannedProcesses: 2,
      databaseMax: 60,
      reserve: 10,
      perProcess: 25,
      aggregate: 60,
    });
    expect(parsePoolBudget({ DB_POOL_MAX: '1', DB_PLANNED_PROCESSES: '4' }).aggregate).toBe(46);
  });
  it('budgets the catalog override instead of charging every owner the same maximum', () => {
    const budget = parsePoolBudget({
      DB_POOL_MAX: '2',
      DB_POOL_MAX_VENUE_CATALOG: '3',
      DB_CONNECTION_RESERVE: '24',
    });
    expect(budget.venueCatalogMax).toBe(3);
    expect(budget.perProcess).toBe(18);
    expect(budget.aggregate).toBe(60);
    expect(() =>
      parsePoolBudget({
        DB_POOL_MAX: '2',
        DB_POOL_MAX_VENUE_CATALOG: '4',
        DB_CONNECTION_RESERVE: '24',
      }),
    ).toThrow('budget');
  });
  it.each(['0', '-1', '1.5', 'x', '', '100001'])(
    'rejects an invalid catalog pool maximum %s',
    (value) =>
      expect(() => parsePoolBudget({ DB_POOL_MAX_VENUE_CATALOG: value })).toThrow(
        'DB_POOL_MAX_VENUE_CATALOG',
      ),
  );
  it('allows bounded idle reuse without increasing aggregate connections', () => {
    const idle = parsePoolBudget({ DB_POOL_IDLE_TIMEOUT_MS: '60000' });
    expect(idle.idleTimeoutMillis).toBe(60000);
    expect(idle.aggregate).toBe(parsePoolBudget({}).aggregate);
    expect(parsePoolBudget({ DB_POOL_IDLE_TIMEOUT_MS: '1000' }).idleTimeoutMillis).toBe(1000);
  });
  it.each(['0', '999', '60001', '-1', '1.5', '', 'x'])(
    'rejects an unbounded or thrashing idle lifetime %s',
    (value) => {
      expect(() => parsePoolBudget({ DB_POOL_IDLE_TIMEOUT_MS: value })).toThrow(
        'DB_POOL_IDLE_TIMEOUT_MS',
      );
    },
  );
  it.each(['0', '-1', '1.5', 'x', '', '100001'])('rejects invalid pool limits %s', (max) => {
    expect(() => parsePoolBudget({ DB_POOL_MAX: max })).toThrow('DB_POOL_MAX');
  });
  it('fails closed before connecting when the declared topology exceeds capacity', () => {
    expect(() => parsePoolBudget({ DB_POOL_MAX: '10' })).toThrow('budget');
    expect(() => parsePoolBudget({ DB_PLANNED_PROCESSES: '3' })).toThrow('budget');
    expect(
      parsePoolBudget({ DB_POOL_MAX: '2', DB_PLANNED_PROCESSES: '3', DB_MAX_CONNECTIONS: '61' })
        .aggregate,
    ).toBe(61);
  });
});
