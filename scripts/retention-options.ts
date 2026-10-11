import { createHash, randomUUID } from 'node:crypto';

/** No credentials in target evidence. Inspection never opens a DB connection. */
export function retentionOptions(args: readonly string[], databaseUrl: string | undefined) {
  if (!databaseUrl) throw new Error('Retention configuration is unavailable.');
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid retention target.');
  const schema = url.searchParams.get('schema')?.trim() || 'public';
  if (!/^[a-z_][a-z0-9_]*$/u.test(schema)) throw new Error('Invalid retention schema.');
  const target = {
    host: url.hostname.toLowerCase(),
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.slice(1)),
    schema,
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(target)).digest('hex');
  const flags = new Map<string, string>();
  for (const arg of args) {
    const [name, ...rest] = arg.split('=');
    if (
      ![
        '--inspect-target',
        '--confirm-retention',
        '--target-fingerprint',
        '--operator',
        '--batch-size',
      ].includes(name!) ||
      flags.has(name!)
    )
      throw new Error('Invalid retention arguments.');
    flags.set(name!, rest.join('='));
  }
  if (flags.has('--inspect-target')) {
    if (flags.size !== 1 || flags.get('--inspect-target') !== '')
      throw new Error('Inspection accepts no execution arguments.');
    return { inspect: true as const, target, fingerprint };
  }
  const operatorId = flags.get('--operator') ?? '';
  const batchValue = flags.get('--batch-size') ?? '100';
  const batchSize = Number(batchValue);
  if (
    flags.get('--confirm-retention') !== '' ||
    flags.get('--target-fingerprint') !== fingerprint ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/u.test(operatorId) ||
    !/^[0-9]+$/u.test(batchValue) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1000
  )
    throw new Error('Retention requires an exact target, operator and bounded batch.');
  return {
    inspect: false as const,
    target,
    fingerprint,
    operatorId,
    batchSize,
    requestId: randomUUID(),
  };
}
