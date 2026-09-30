import { resolveAccountIdsForUser } from '@/lib/accounts';
import { getEscalationReview, type EscalationReview } from './operator-review';

export async function resolveOperatorReviewAccountScope(userId: string): Promise<Set<string>> {
  return new Set(await resolveAccountIdsForUser(userId));
}

export function isReviewInAccountScope(
  review: EscalationReview | null | undefined,
  accountScope: ReadonlySet<string>,
): review is EscalationReview {
  return Boolean(review?.accountId && accountScope.has(review.accountId));
}

export async function getAuthorizedEscalationReview(
  reviewId: string,
  userId: string,
): Promise<EscalationReview | null> {
  const accountScope = await resolveOperatorReviewAccountScope(userId);
  const review = getEscalationReview(reviewId);
  return isReviewInAccountScope(review, accountScope) ? review : null;
}
