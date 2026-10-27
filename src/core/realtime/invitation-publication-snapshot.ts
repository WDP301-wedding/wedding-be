import type { PrismaClient } from '../../generated/prisma/client.js';

/** Minimal owner-only snapshot; never include invitation content, assets or guest identities. */
export async function readPublicationSnapshots(
  prisma: PrismaClient,
  bookingIds: readonly string[],
) {
  const ids = [...new Set(bookingIds)];
  const identities = await prisma.invitationPublicIdentity.findMany({
    where: { bookingId: { in: ids } },
    select: { bookingId: true, revision: true, slug: true, currentPublicationId: true },
  });
  const revisions = await prisma.invitationPublishedRevision.findMany({
    where: {
      id: {
        in: identities.flatMap((row) =>
          row.currentPublicationId ? [row.currentPublicationId] : [],
        ),
      },
    },
    select: { id: true, bookingId: true, designRevisionId: true },
  });
  const heads = new Map(identities.map((row) => [row.bookingId, row]));
  const publications = new Map(revisions.map((row) => [row.id, row]));
  return new Map(
    ids.map((bookingId) => {
      const head = heads.get(bookingId);
      const publication = head?.currentPublicationId
        ? publications.get(head.currentPublicationId)
        : undefined;
      if (head?.currentPublicationId && publication?.bookingId !== bookingId) {
        throw new Error('INVITATION_PUBLICATION_HEAD_INVALID');
      }
      const published = publication?.bookingId === bookingId;
      return [
        bookingId,
        {
          publicationRevision: head?.revision ?? 0,
          published,
          publicSlug: published ? (head?.slug ?? null) : null,
          publishedRevisionId: published ? publication.id : null,
          designRevisionId: published ? publication.designRevisionId : null,
        },
      ];
    }),
  );
}
