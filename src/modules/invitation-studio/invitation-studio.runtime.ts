import { Router } from 'express';
import { createInvitationTemplateSelectionReader } from './infrastructure/template-selection.reader.js';
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

export type InvitationStudioRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
  providers: Readonly<{ templateSelection: InvitationTemplateSelectionReader }>;
}>;

/** Runtime never substitutes fake Storage or fake confirmed owner facts. */
export async function createInvitationStudioRuntime(
  config: Config,
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
    );
    const router = Router();
    router.use(createMediaRouter(composition.service, composition.identity.resolver));
    router.use(createStudioRouter(composition, composition.identity.resolver));
    return Object.freeze({
      router,
      providers: Object.freeze({
        templateSelection: createInvitationTemplateSelectionReader(prisma),
      }),
      resource: Object.freeze({
        name: 'invitation-studio-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}
