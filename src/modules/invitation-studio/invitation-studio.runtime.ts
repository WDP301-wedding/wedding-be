import { Router } from 'express';
import { createInvitationTemplateSelectionProvider } from './infrastructure/template-selection.reader.js';
import type { InvitationTemplateSelectionReader } from './application/template-selection.port.js';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { ProviderError } from '../../core/errors/app-error.js';
import type { ShutdownResource } from '../../core/http/lifecycle.js';
import type { StorageProvider } from '../../integrations/storage/storage-provider.js';
import { createSupabaseStorageProvider } from '../../integrations/storage/supabase-storage-provider.js';
import { createMediaRouter } from './http/media.router.js';
import { createInvitationStudioServices } from './infrastructure/studio.composition.js';
import { createStudioRouter } from './http/studio.router.js';
import { createGeminiAiImageProvider } from '../../integrations/ai-image/gemini-ai-image-provider.js';
import { createStaffSeatingServices } from '../staff-operations/infrastructure/staff-seating.composition.js';
import { createStaffRouter } from '../staff-operations/http/staff.router.js';
import { createSeatingRouter } from '../seating-plan/http/seating.router.js';
import { startSeatingReconciler } from '../seating-plan/infrastructure/seating-reconciler.js';
import { createLogger } from '../../core/logging/logger.js';
import type {
  SeatingPlanReader,
  SeatingGuidanceReader,
} from '../seating-plan/application/seating.contracts.js';

export type InvitationStudioRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
  providers: Readonly<{
    templateSelection: InvitationTemplateSelectionReader;
    seatingPlan: SeatingPlanReader;
    seatingGuidance: SeatingGuidanceReader;
    attendance: ReturnType<typeof createStaffSeatingServices>['staff']['readers'];
  }>;
}>;

/** Runtime never substitutes fake Storage or fake confirmed owner facts. */
export async function createInvitationStudioRuntime(
  config: Config,
  now: () => Date = () => new Date(),
): Promise<InvitationStudioRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const unavailable = () => Promise.reject(new ProviderError('unavailable'));
    const storage: StorageProvider = config.storage.enabled
      ? createSupabaseStorageProvider(config.storage)
      : {
          put: unavailable,
          createSignedReadUrl: unavailable,
          delete: unavailable,
          read: unavailable,
        };
    const ai =
      config.aiImage?.provider === 'gemini'
        ? createGeminiAiImageProvider({ ...config.aiImage, timeoutMs: 10000 })
        : null;
    const composition = createInvitationStudioServices(
      prisma,
      storage,
      ai,
      config.invitationStudio?.publicOrigin ?? null,
      now,
    );
    const router = Router();
    router.use(createMediaRouter(composition.service, composition.identity.resolver));
    router.use(createStudioRouter(composition, composition.identity.resolver));
    const { staff, seating } = createStaffSeatingServices(prisma, composition, now);
    router.use(createSeatingRouter(seating.seating, seating.resolver));
    router.use(createStaffRouter(staff));
    const logger = createLogger({ level: 'warn', runtimeEnvironment: config.runtime.environment });
    const reconciler = startSeatingReconciler(seating.seating, (failures) =>
      logger.warn({ failures }, 'Seating reconciliation needs retry'),
    );
    return Object.freeze({
      router,
      providers: Object.freeze({
        templateSelection: createInvitationTemplateSelectionProvider(prisma),
        seatingPlan: seating.seating,
        seatingGuidance: seating.seating,
        attendance: staff.readers,
      }),
      resource: Object.freeze({
        name: 'invitation-studio-database',
        close: async () => {
          await reconciler.close();
          await prisma.$disconnect();
        },
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}
