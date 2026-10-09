import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../src/generated/prisma/client.js';

/** Metadata-only DB constraint fixture; never claims that a Storage object exists. */
export async function insertDatabaseMedia(
  tx: Prisma.TransactionClient,
  bookingId: string,
  sizeBytes: number,
) {
  const id = randomUUID(),
    fileId = randomUUID(),
    attemptId = randomUUID();
  const digest = createHash('sha256').update(fileId).digest('hex');
  const objectKey = `private-wedding-media/${bookingId}/${digest}.png`;
  await tx.invitationMediaUploadAttempt.create({
    data: {
      id: attemptId,
      bookingId,
      objectKey,
      checksumSha256: digest,
      contentType: 'image/png',
      sizeBytes,
      intentKeyDigest: digest,
      commandDigest: digest,
      createdAt: new Date('2026-10-09T00:00:00Z'),
      policyRevision: 0,
    },
  });
  await tx.invitationMediaAsset.create({
    data: { id, bookingId, revision: 1, currentFileRevisionId: fileId },
  });
  await tx.invitationMediaFile.create({
    data: {
      id: fileId,
      bookingId,
      assetId: id,
      revision: 1,
      objectKey,
      checksumSha256: digest,
      contentType: 'image/png',
      sizeBytes,
      width: 1,
      height: 1,
      altText: 'Database quota fixture',
      acceptedAt: new Date('2026-10-09T00:00:00Z'),
      cutoffAt: new Date('2026-10-12T00:00:00Z'),
      policyRevision: 0,
      uploadAttemptId: attemptId,
    },
  });
  return id;
}
