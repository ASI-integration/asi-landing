import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplyToTelegram = vi.fn();
const mockUpdateCrmContact = vi.fn();
const mockRecordCrmCommunicationEvent = vi.fn();

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

vi.mock('@/lib/crm/repository', () => ({
  recordCrmCommunicationEvent: (...args: unknown[]) => mockRecordCrmCommunicationEvent(...args),
  updateCrmContact: (...args: unknown[]) => mockUpdateCrmContact(...args),
}));

const contactRows = new Map<string, Record<string, unknown>>();
const eventRows: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'crm_contacts') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({
                data: contactRows.get(id) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'crm_events') {
        return {
          insert: async (row: Record<string, unknown>) => {
            eventRows.push(row);
            return { error: null };
          },
          update: () => ({
            eq: () => ({
              eq: () => ({
                is: async () => ({ error: null }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  },
}));

import {
  createOperatorFollowupRequired,
  sendOperatorFollowupToTelegram,
} from '@/lib/crm/operator-followup';

describe('operator follow-up v1', () => {
  beforeEach(() => {
    contactRows.clear();
    eventRows.length = 0;
    mockReplyToTelegram.mockReset();
    mockUpdateCrmContact.mockReset();
    mockRecordCrmCommunicationEvent.mockReset();
    mockReplyToTelegram.mockResolvedValue(true);
    mockRecordCrmCommunicationEvent.mockResolvedValue(undefined);
    mockUpdateCrmContact.mockResolvedValue({});
    process.env.ASI_FEEDBACK_BOT_TOKEN = 'token';
  });

  it('creates operator_followup_required CRM task', async () => {
    const result = await createOperatorFollowupRequired({
      telegramUserId: '9101',
      telegramChatId: 8101,
      propertyId: 'prop-1',
      guestQuestion: 'Нужен человек',
      contactId: 'contact-1',
    });

    expect(result.ok).toBe(true);
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'operator_followup_required',
        messageText: 'Нужен человек',
      }),
    );
    expect(mockUpdateCrmContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        nextAction: 'Ответить гостю',
        awaitingReply: true,
      }),
    );
  });

  it('sends operator reply to telegram and records operator_followup_sent', async () => {
    contactRows.set('contact-1', {
      telegram_chat_id: '8101',
      telegram_user_id: '9101',
      property_id: 'prop-1',
      name: 'Гость',
    });

    const result = await sendOperatorFollowupToTelegram({
      contactId: 'contact-1',
      replyText: 'Добрый день! Ответ оператора.',
      operatorId: 'ops@asi.global',
    });

    expect(result.ok).toBe(true);
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      'Добрый день! Ответ оператора.',
      expect.any(Object),
      expect.any(Object),
    );
    expect(eventRows.some((row) => row.event_type === 'operator_followup_sent')).toBe(true);
    expect(mockUpdateCrmContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        awaitingReply: false,
      }),
    );
  });
});
