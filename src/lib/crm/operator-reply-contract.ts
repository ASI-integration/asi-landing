import type { CrmContactViewModel, CrmEventViewModel } from './types';

export const OPERATOR_REPLY_MAX_LENGTH = 2000;

export function shouldShowOperatorReplyBox(
  contact: Pick<CrmContactViewModel, 'awaitingReply' | 'hasOperatorFollowupPending'>,
): boolean {
  return contact.awaitingReply || contact.hasOperatorFollowupPending;
}

export function getActiveOperatorFollowupEvent(
  contact: Pick<CrmContactViewModel, 'recentEvents'>,
): CrmEventViewModel | null {
  return contact.recentEvents.find(
    (event) => event.eventType === 'operator_followup_required' && !event.acknowledgedAt,
  ) ?? null;
}
