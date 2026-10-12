import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NotFoundError, ProviderError } from '../../../core/errors/app-error.js';
import type { StorageProvider } from '../../../integrations/storage/storage-provider.js';
import { createStorageObjectReference } from '../../../integrations/storage/storage-provider.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { digest, id, parseStudio, studioConflict } from '../domain/studio-policy.js';
import { contractContext, type StudioRepository } from './studio.repository.js';
import type { StudioAuthorization } from './studio-authorization.js';
import {
  PRINT_MAX_IMAGE_BYTES,
  printableFileContentSchema,
  printLimit,
  renderPrintablePdf,
} from './print-file.renderer.js';

const storedImage = z.strictObject({
  objectKey: z.string(),
  purpose: z.literal('PRIVATE_WEDDING_MEDIA'),
  resourceId: id,
  contentType: z.literal('image/png'),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.int().positive().max(PRINT_MAX_IMAGE_BYTES),
});
export class PrintFileService {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly storage: StorageProvider,
  ) {}
  async read(bookingValue: string, revisionValue: string, context: MediaRequestContext) {
    const bookingId = parseStudio(id, bookingValue),
      printableRevisionId = parseStudio(id, revisionValue);
    const load = () =>
      this.repository.boundary.run(
        { bookingId, context: contractContext(context) },
        async (scope) => {
          const scoped = { ...context, transactionScopeId: scope.transactionScopeId! };
          await this.access.booking(bookingId, scoped);
          const tx = this.repository.boundary.requireScope(bookingId, scope);
          const row = await tx.invitationPrintableRevision.findFirst({
            where: { id: printableRevisionId, bookingId },
          });
          if (row === null) throw new NotFoundError();
          if (digest(row.content) !== row.contentDigest)
            throw studioConflict('PRINTABLE_DIGEST_CONFLICT');
          const content = parseStudio(printableFileContentSchema, row.content);
          if (content.design.derivedAssetIds.length > 8) printLimit('PRINT_ASSET_LIMIT');
          const assets = await tx.invitationDerivedAsset.findMany({
            where: { bookingId, id: { in: content.design.derivedAssetIds } },
          });
          if (assets.length !== content.design.derivedAssetIds.length)
            throw new ProviderError('failure');
          return { row, assets };
        },
      );
    const { row, assets } = await load();
    const images = new Map<string, Uint8Array>();
    let total = 0;
    for (const asset of assets) {
      if (this.storage.read === undefined) throw new ProviderError('unavailable');
      const parsed = storedImage.safeParse(asset.object);
      if (!parsed.success || parsed.data.resourceId !== asset.id)
        throw new ProviderError('failure');
      const object = parsed.data;
      total += object.sizeBytes;
      if (total > PRINT_MAX_IMAGE_BYTES) printLimit('PRINT_ASSET_LIMIT');
      let reference;
      try {
        reference = createStorageObjectReference(object);
      } catch {
        throw new ProviderError('failure');
      }
      if (!reference.objectKey.endsWith(`/${object.checksumSha256}.png`))
        throw new ProviderError('failure');
      const bytes = await this.storage.read(reference);
      if (
        bytes.byteLength !== object.sizeBytes ||
        createHash('sha256').update(bytes).digest('hex') !== object.checksumSha256
      )
        throw new ProviderError('failure');
      images.set(asset.id, bytes);
    }
    const output = await renderPrintablePdf({
      content: row.content,
      contentDigest: row.contentDigest,
      createdAt: row.createdAt,
      images,
    });
    // Reauthorize the actual session/booking after external IO. Read immutable rows,
    // never the current design/publication/media head; no billing operation occurs.
    const latest = await load();
    if (latest.row.contentDigest !== row.contentDigest)
      throw studioConflict('PRINTABLE_DIGEST_CONFLICT');
    return { ...output, contentDigest: row.contentDigest };
  }
}
