type Revision = Readonly<{
  state: string;
  revisionNumber: number;
  documentDigest: string;
  approvals: readonly Readonly<{ party: string; documentDigest: string }>[];
}>;

/** Only the current proposal can block completion; superseded history is retained. */
export function completionAppendix(revision: Revision | null | undefined) {
  const managerApproved =
    revision?.approvals.some(
      (a) => a.party === 'MANAGER' && a.documentDigest === revision.documentDigest,
    ) ?? false;
  const coupleApproved =
    revision?.approvals.some(
      (a) => a.party === 'COUPLE' && a.documentDigest === revision.documentDigest,
    ) ?? false;
  const pending = Boolean(
    revision &&
    revision.state !== 'SUPERSEDED' &&
    (revision.state !== 'APPROVED' || !managerApproved || !coupleApproved),
  );
  return {
    pending,
    appendixRevisionNumber: revision?.revisionNumber ?? null,
    managerApproved,
    coupleApproved,
  };
}
