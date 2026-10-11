import 'dotenv/config';
import { config } from '../src/config/config.js';
import { createPrismaClient } from '../src/core/database/prisma.js';
import {
  createIdentityRetentionService,
  createPrismaIdentityRetentionRepository,
} from '../src/modules/identity-access/account/identity-retention.js';
import { retentionOptions } from './retention-options.js';
try {
  const options = retentionOptions(process.argv.slice(2), config.database.url);
  if (options.inspect) console.log(JSON.stringify({ event: 'retention_target', ...options }));
  else {
    const prisma = createPrismaClient(config.database.url);
    try {
      const service = createIdentityRetentionService({
        repository: createPrismaIdentityRetentionRepository(prisma, {
          schema: options.target.schema,
        }),
        retentionDays: config.identityAccess.retentionDays,
        operatorId: options.operatorId,
        requestId: () => options.requestId,
      });
      const result = await service.run({ batchSize: options.batchSize });
      console.log(
        JSON.stringify({
          event: 'identity_retention_completed',
          requestId: options.requestId,
          operatorId: options.operatorId,
          targetFingerprint: options.fingerprint,
          batchSize: options.batchSize,
          ...result,
        }),
      );
    } finally {
      await prisma.$disconnect();
    }
  }
} catch {
  console.error(
    'Identity retention failed. No completion should be assumed; inspect the target and confirm operator, fingerprint and batch arguments.',
  );
  process.exitCode = 1;
}
