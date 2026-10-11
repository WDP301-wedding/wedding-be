import { Prisma } from '../../../generated/prisma/client.js';
import { commercialConflict } from '../domain/commercial-contract.js';

// Retry the entire owner transaction after rollback, never an enlisted callback.
// A fresh snapshot rechecks current authorization, expected revision and money pins.
export async function retryCommercialWrite<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'))
        throw error;
    }
  }
  throw commercialConflict('CONTRACT_REVISION_STALE');
}
