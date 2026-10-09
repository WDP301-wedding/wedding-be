import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { StorageProvider } from '../../../integrations/storage/storage-provider.js';
import type { AiImageProvider } from '../../../integrations/ai-image/ai-image-provider.js';
import { createInvitationEditorReader } from '../../identity-access/authorization/invitation-editor.reader.js';
import { createPrismaPlanningSnapshotReader } from '../../booking-lifecycle/infrastructure/prisma-planning-snapshot.reader.js';
import { createPrismaSelectionEligibilityReader } from '../../venue-catalog/infrastructure/prisma-selection-eligibility.reader.js';
import { createLayoutService } from '../../venue-catalog/application/layout.service.js';
import { createPersistentMediaService } from './media.composition.js';
import { StudioRepository } from './studio.repository.js';
import { StudioAuthorization } from './studio-authorization.js';
import { DesignService } from './design.service.js';
import { DerivedAssetsService } from './derived-assets.service.js';
import { GenerationService } from './generation.service.js';
import { PublicationService } from './publication.service.js';
import { createPrismaBillingAdapter } from '../../payments-billing/infrastructure/prisma-billing.adapter.js';
import { PrintableService } from './printable.service.js';
import { PrintOrderService } from './print-order.service.js';
import { PrismaInvitationAutomationReader } from './prisma-automation.reader.js';
import { PrismaInvitationReportingReader } from './prisma-reporting.reader.js';

export function createInvitationStudioServices(
  prisma: PrismaClient,
  storage: StorageProvider,
  ai: AiImageProvider | null,
  publicOrigin: string | null,
  now: () => Date = () => new Date(),
) {
  const media = createPersistentMediaService(prisma, storage, now);
  const editor = createInvitationEditorReader(prisma, media.boundary, media.identity.resolver);
  const repository = new StudioRepository(prisma, media.boundary);
  const authorization = new StudioAuthorization(
    media.guard,
    editor,
    (bookingId, context) => media.repository.recordDeniedAccess(bookingId, context),
    (context) => repository.recordTemplateDeniedAccess(context),
  );
  const designs = new DesignService(repository, authorization, now);
  const derivedAssets = new DerivedAssetsService(repository, authorization, storage);
  const generation = new GenerationService(repository, authorization, media.service, ai);
  const publication = new PublicationService(
    repository,
    authorization,
    media.booking,
    media.timeline,
    publicOrigin,
    now,
  );
  const planning = createPrismaPlanningSnapshotReader(media.boundary);
  const venue = createPrismaSelectionEligibilityReader(media.boundary);
  const layout = createLayoutService(prisma);
  const printable = new PrintableService(
    repository,
    editor,
    media.booking,
    media.timeline,
    planning,
    venue,
    publication,
    { resolveLayoutTemplateVersion: (id) => layout.resolveVersion(id) },
  );
  const billing = createPrismaBillingAdapter(prisma, media.boundary);
  const printOrders = new PrintOrderService(
    repository,
    authorization,
    printable,
    billing,
    media.booking,
    media.timeline,
    now,
  );
  const automation = new PrismaInvitationAutomationReader(prisma);
  const reporting = new PrismaInvitationReportingReader(prisma);
  return {
    ...media,
    studioRepository: repository,
    designs,
    derivedAssets,
    generation,
    publication,
    printable,
    billing,
    printOrders,
    automation,
    reporting,
    editor,
    planning,
    venue,
  };
}
