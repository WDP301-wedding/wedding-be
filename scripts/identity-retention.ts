import 'dotenv/config';

import { config } from '../src/config/config.js';
import { createPrismaClient } from '../src/core/database/prisma.js';
import {
  createIdentityRetentionService,
  createPrismaIdentityRetentionRepository,
} from '../src/modules/identity-access/account/identity-retention.js';

const confirmationFlag = '--confirm-retention';

async function main(arguments_: readonly string[]): Promise<void> {
  if (!arguments_.includes(confirmationFlag)) {
    throw new Error(
      `Identity retention changes persisted data. Re-run with ${confirmationFlag} after confirming the target database.`,
    );
  }

  const databaseUrl = config.database.url;
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for identity retention.');
  }
  const batchSize = parseBatchSize(arguments_);
  const schema = new URL(databaseUrl).searchParams.get('schema')?.trim() || 'public';
  const prisma = createPrismaClient(databaseUrl);

  try {
    const service = createIdentityRetentionService({
      repository: createPrismaIdentityRetentionRepository(prisma, { schema }),
      retentionDays: config.identityAccess.retentionDays,
    });
    const result = await service.run({ batchSize });
    console.log(JSON.stringify({ event: 'identity_retention_completed', ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

function parseBatchSize(arguments_: readonly string[]): number {
  const argument = arguments_.find((value) => value.startsWith('--batch-size='));
  if (argument === undefined) {
    return 100;
  }
  const parsed = Number(argument.slice('--batch-size='.length));
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new RangeError('Identity retention batch size must be an integer from 1 to 1000.');
  }
  return parsed;
}

try {
  await main(process.argv.slice(2));
} catch {
  console.error('Identity retention failed. No retention changes should be assumed.');
  process.exitCode = 1;
}
