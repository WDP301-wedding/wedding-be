import { commercialConflict } from '../../booking-lifecycle/domain/commercial-contract.js';

export function requireExpenseApproval(
  policy: number | null,
  revision: number,
  total: number,
  review: {
    type: string;
    state: string;
    draftRevision: number;
    managerAccountId: string;
    coupleAccountId: string | null;
    coupleApprovedAt: Date | null;
  } | null,
) {
  if (policy === null) return;
  if (
    review?.state !== 'APPROVED' ||
    review.draftRevision !== revision ||
    (review.type === 'NONE'
      ? total !== 0
      : review.type !== 'EXPENSES' ||
        review.coupleApprovedAt === null ||
        review.coupleAccountId === null ||
        review.managerAccountId === review.coupleAccountId)
  )
    throw commercialConflict('EXPENSE_APPROVAL_REQUIRED');
}
