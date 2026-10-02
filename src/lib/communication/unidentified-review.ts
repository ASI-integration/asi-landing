import { opsAdminAllowlist } from '@/lib/crm/access';
import { getEscalationReview, listEscalationReviews, sendOperatorReply } from './operator-review';
import { lockSessionForOperator } from './handoff-lock';

export const UNIDENTIFIED_CLARIFICATION =
  'Чтобы проверить бронирование, сообщите, пожалуйста, его номер и название объекта. Не отправляйте пароли, коды доступа или данные документов.';
export function canReviewUnidentified(session: { userId?: string; email?: string }): boolean {
  // Explicit platform capability only, in ALL environments. No tenant role,
  // domain suffix or development fallback grants access to the quarantine.
  return !!session.userId && !!session.email
    && opsAdminAllowlist().has(session.email.trim().toLowerCase());
}
export function listUnidentifiedReviews() {
  return listEscalationReviews({ limit: 1000 })
    .filter((review) => !review.accountId && review.status !== 'closed')
    .map(({ reviewId, channel, status, updatedAt }) => ({ reviewId, channel, status, updatedAt }));
}
export async function actOnUnidentifiedReview(input: {
  reviewId: string; operatorId: string; action: 'acknowledge' | 'request_identity';
}) {
  const review = getEscalationReview(input.reviewId);
  if (!review || review.accountId || review.status === 'closed') return { ok: false, error: 'not_found' };
  // No tenant assignment, guest-memory access, fact draft or AI release here.
  lockSessionForOperator({ reviewId: review.reviewId, operatorId: input.operatorId });
  if (input.action === 'acknowledge') return { ok: true };
  const result = await sendOperatorReply({ reviewId: review.reviewId, operatorId: input.operatorId,
    replyText: UNIDENTIFIED_CLARIFICATION, resumeAutomation: false });
  return { ok: result.ok, duplicatePrevented: result.duplicatePrevented,
    ...(result.ok ? {} : { error: 'clarification_not_confirmed' }) };
}
