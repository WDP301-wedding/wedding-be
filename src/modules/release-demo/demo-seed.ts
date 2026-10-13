import { createHash } from 'node:crypto';

export const DEMO_SCENARIOS = ['no-names', 'partial-names'] as const;
type SeedFacts = Readonly<Record<string, string | number | null>>;
export interface DemoSeedPort<T extends SeedFacts> {
  /** Owner-owned reader returns current facts, including revision, or no fixture. */
  read(this: void, seedKey: string): Promise<T | null>;
  /** Native owner command with the stable key; no update/upsert port is offered. */
  create(this: void, input: T, idempotencyKey: string): Promise<void>;
}
export function demoSeedKey(scenario: string): string {
  const hex = createHash('sha256').update(`BACKEND-RELEASE@3.0.0:${scenario}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const fingerprint = (facts: SeedFacts) =>
  JSON.stringify(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b)));

/** Bounded offline seed adapter. Staging execution requires a separate approved port. */
export async function ensureDemoSeed<T extends SeedFacts & { scenario: string }>(
  target: Readonly<{ environment: string; databaseUrl: string }>,
  input: T,
  owner: DemoSeedPort<T>,
): Promise<'CREATED' | 'VERIFIED_EXISTING'> {
  const url = new URL(target.databaseUrl);
  if (
    target.environment !== 'test' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/^\/(?:rel_|commercial_contract_api_)[a-z0-9_]+$/u.test(url.pathname)
  ) {
    throw Error('DISPOSABLE_RELEASE_TARGET_REQUIRED');
  }
  const key = demoSeedKey(input.scenario),
    previous = await owner.read(key);
  if (previous !== null) {
    if (fingerprint(previous) !== fingerprint(input)) throw Error('DEMO_SEED_CONFLICT');
    return 'VERIFIED_EXISTING';
  }
  await owner.create(input, key);
  const created = await owner.read(key);
  if (created === null || fingerprint(created) !== fingerprint(input))
    throw Error('DEMO_SEED_NOT_PERSISTED');
  return 'CREATED';
}
