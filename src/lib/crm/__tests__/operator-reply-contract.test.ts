import { describe, expect, it } from 'vitest';
import {
  getActiveOperatorFollowupEvent,
  OPERATOR_REPLY_MAX_LENGTH,
  shouldShowOperatorReplyBox,
} from '../operator-reply-contract';
import type { CrmContactViewModel } from '../types';

function contact(partial: Partial<CrmContactViewModel>): CrmContactViewModel {
  return {
    id: 'contact-1',
    name: 'Гость',
    role: 'guest',
    roleLabel: 'Гость',
    source: 'test',
    sourceLabel: 'Тест',
    contact: null,
    telegramUserId: '9101',
    telegramUsername: null,
    telegramChatId: '8101',
    telegramDisplay: null,
    status: 'needs_reaction',
    statusLabel: 'Нужна реакция',
    effectiveStatus: 'needs_reaction',
    effectiveStatusLabel: 'Нужна реакция',
    propertyId: 'prop-1',
    propertySummary: null,
    propertyCount: null,
    pilotApplication: null,
    pilotOnboardingProgress: null,
    notes: '',
    nextAction: 'Ответить гостю',
    nextActionIsSuggested: false,
    nextActionHref: null,
    nextActionDueAt: null,
    lastMessage: null,
    lastActivityAt: null,
    leadId: null,
    awaitingReply: false,
    escalationCount: 1,
    unresolvedEscalationCount: 1,
    needsReaction: true,
    needsReactionReasons: ['Пользователь ждёт ответа'],
    createdAt: '2026-06-18T10:00:00.000Z',
    updatedAt: '2026-06-18T10:00:00.000Z',
    recentEvents: [],
    missingDataFields: [],
    missingDataActions: [],
    guestTestResults: [],
    guestTestSummary: null,
    guestTestListStatus: 'needs_reaction',
    guestTestListStatusLabel: 'Нужна реакция',
    hasOperatorFollowupPending: false,
    ...partial,
  };
}

describe('operator reply CRM contract', () => {
  it('shows CRM reply box for active operator escalation', () => {
    expect(shouldShowOperatorReplyBox(contact({ hasOperatorFollowupPending: true }))).toBe(true);
    expect(shouldShowOperatorReplyBox(contact({ awaitingReply: true }))).toBe(true);
    expect(shouldShowOperatorReplyBox(contact({ awaitingReply: false, hasOperatorFollowupPending: false }))).toBe(false);
  });

  it('finds active operator escalation for reply metadata', () => {
    const active = getActiveOperatorFollowupEvent(contact({
      recentEvents: [
        {
          id: 'esc-1',
          eventType: 'operator_followup_required',
          messageText: 'Можно поздний выезд?',
          propertyId: 'prop-1',
          metadata: {},
          acknowledgedAt: null,
          createdAt: '2026-06-18T10:00:00.000Z',
          label: 'Нужен ответ оператора',
        },
      ],
    }));

    expect(active?.id).toBe('esc-1');
    expect(OPERATOR_REPLY_MAX_LENGTH).toBe(2000);
  });
});
