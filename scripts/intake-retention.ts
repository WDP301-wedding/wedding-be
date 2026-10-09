import 'dotenv/config';
import { config } from '../src/config/config.js';
import { createPrismaClient } from '../src/core/database/prisma.js';
import { purgeConsultationIntake } from '../src/modules/booking-lifecycle/application/intake-retention.js';
if (!process.argv.includes('--confirm-retention'))
  throw new Error('Confirm the target database, then pass --confirm-retention.');
const prisma = createPrismaClient(config.database.url);
try {
  console.log(
    JSON.stringify({
      event: 'intake_retention_completed',
      ...(await purgeConsultationIntake(prisma)),
    }),
  );
} finally {
  await prisma.$disconnect();
}
