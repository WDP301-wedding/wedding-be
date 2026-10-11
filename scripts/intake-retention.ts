import 'dotenv/config';
import { config } from '../src/config/config.js';
import { createPrismaClient } from '../src/core/database/prisma.js';
import { purgeConsultationIntake } from '../src/modules/booking-lifecycle/application/intake-retention.js';
import { retentionOptions } from './retention-options.js';
try {
  const options = retentionOptions(process.argv.slice(2), config.database.url);
  if (options.inspect) console.log(JSON.stringify({ event: 'retention_target', ...options }));
  else {
    const prisma = createPrismaClient(config.database.url);
    try {
      const result = await purgeConsultationIntake(prisma, new Date(), options);
      console.log(
        JSON.stringify({
          event: 'intake_retention_completed',
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
    'Intake retention failed. No completion should be assumed; inspect the target and confirm operator, fingerprint and batch arguments.',
  );
  process.exitCode = 1;
}
