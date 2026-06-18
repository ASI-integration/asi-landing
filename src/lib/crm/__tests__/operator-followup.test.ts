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
        const query = {
          filter: { col: '', value: '' },
          select: () => query,
          eq: (col: string, value: string) => {
            query.filter = { col, value };
            return query;
          },
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            if (query.filter.col === 'telegram_chat_id') {
              return {
                data: Array.from(contactRows.values()).find((row) => row.telegram_chat_id === query.filter.value) ?? null,
                error: null,
              };
            }
            return {
              data: contactRows.get(query.filter.value) ?? null,
              error: null,
            };
          },
        };
        return query;
      }
      if (table === 'crm_events') {
        const query = {
          contactId: '',
          eventTypes: [] as string[],
          updatePatch: null as Record<string, unknown> | null,
          select: () => query,
          insert: async (row: Record<string, unknown>) => {
            eventRows.push({ id: `inserted-${eventRows.length + 1}`, ...row });
            return { error: null };
          },
          update: (patch: Record<string, unknown>) => {
            query.updatePatch = patch;
            return query;
          },
          eq: (col: string, value: string) => {
            if (col === 'contact_id') query.contactId = value;
            if (col === 'id' && query.updatePatch) {
              const row = eventRows.find((item) => item.id === value);
              if (row) Object.assign(row, query.updatePatch);
            }
            return query;
          },
          in: (_col: string, values: string[]) => {
            query.eventTypes = values;
            return query;
          },
          is: () => query,
          order: () => query,
          limit: async () => ({
            data: eventRows.filter((row) =>
              row.contact_id === query.contactId &&
              query.eventTypes.includes(String(row.event_type)) &&
              !row.acknowledged_at,
            ),
            error: null,
          }),
        };
        return query;
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
  sendOperatorReplyToTelegram,
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

  it('does not send empty operator reply', async () => {
    contactRows.set('contact-1', {
      id: 'contact-1',
      telegram_chat_id: '8101',
      telegram_user_id: '9101',
      property_id: 'prop-1',
      name: 'Гость',
    });

    const result = await sendOperatorReplyToTelegram({
      contactId: 'contact-1',
      replyText: '   ',
      operatorId: 'ops@asi.global',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty_reply');
    expect(mockReplyToTelegram).not.toHaveBeenCalled();
  });

  it('does not send operator reply without ASI Feedback bot token', async () => {
    process.env.ASI_FEEDBACK_BOT_TOKEN = '';
    contactRows.set('contact-1', {
      id: 'contact-1',
      telegram_chat_id: '8101',
      telegram_user_id: '9101',
      property_id: 'prop-1',
      name: 'Гость',
    });

    const result = await sendOperatorReplyToTelegram({
      contactId: 'contact-1',
      replyText: 'Добрый день! Ответ оператора.',
      operatorId: 'ops@asi.global',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('bot_token_missing');
    expect(mockReplyToTelegram).not.toHaveBeenCalled();
  });

  it('keeps needs reaction when another active problem remains', async () => {
    contactRows.set('contact-1', {
      id: 'contact-1',
      telegram_chat_id: '8101',
      telegram_user_id: '9101',
      property_id: 'prop-1',
      name: 'Гость',
    });
    eventRows.push(
      {
        id: 'esc-1',
        contact_id: 'contact-1',
        event_type: 'operator_followup_required',
        message_text: 'Можно поздний выезд?',
        property_id: 'prop-1',
        metadata: { intent: 'operator' },
        acknowledged_at: null,
        created_at: '2026-06-18T10:00:00.000Z',
      },
      {
        id: 'missing-1',
        contact_id: 'contact-1',
        event_type: 'guest_test_missing_data',
        message_text: 'Какой Wi-Fi?',
        property_id: 'prop-1',
        metadata: { missing_fields: ['object.wifiPassword'] },
        acknowledged_at: null,
        created_at: '2026-06-18T10:01:00.000Z',
      },
    );

    const result = await sendOperatorReplyToTelegram({
      contactId: 'contact-1',
      replyText: 'Поздний выезд возможен до 13:00.',
      relatedEscalationId: 'esc-1',
      operatorId: 'ops@asi.global',
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateCrmContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        status: 'needs_reaction',
        nextAction: 'Разобрать эскалацию',
      }),
    );
    expect(eventRows.find((row) => row.id === 'missing-1')?.acknowledged_at).toBeNull();
  });

  it('sends operator reply with related guest question context', async () => {
    contactRows.set('contact-1', {
      id: 'contact-1',
      telegram_chat_id: '8101',
      telegram_user_id: '9101',
      property_id: 'prop-1',
      name: 'Гость',
    });
    eventRows.push({
      id: 'esc-1',
      contact_id: 'contact-1',
      event_type: 'operator_followup_required',
      message_text: 'Можно поздний выезд?',
      property_id: 'prop-1',
      metadata: { intent: 'operator' },
      acknowledged_at: null,
      created_at: '2026-06-18T10:00:00.000Z',
    });

    const result = await sendOperatorFollowupToTelegram({
      contactId: 'contact-1',
      replyText: 'Лучше не оставлять в подъезде.',
      operatorId: 'ops@asi.global',
    });

    expect(result.ok).toBe(true);
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('Вы спрашивали'),
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('Ответ: Лучше не оставлять в подъезде.'),
      expect.any(Object),
      expect.any(Object),
    );
    expect(eventRows.some((row) => row.event_type === 'operator_reply_sent')).toBe(true);
    expect(eventRows.find((row) => row.event_type === 'operator_reply_sent')?.metadata).toMatchObject({
      related_question: 'Можно поздний выезд?',
      related_escalation_id: 'esc-1',
      channel: 'telegram',
    });
    expect(eventRows.find((row) => row.id === 'esc-1')?.acknowledged_at).toBeTruthy();
    expect(mockUpdateCrmContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        status: 'testing_communication',
        nextAction: 'Продолжить тест гостя',
        awaitingReply: false,
      }),
    );
  });

  it('uses fallback wrapper when related guest question is missing', async () => {
    contactRows.set('contact-1', {
      id: 'contact-1',
      telegram_chat_id: '8101',
      telegram_user_id: '9101',
      property_id: 'prop-1',
      name: 'Гость',
    });

    const result = await sendOperatorReplyToTelegram({
      contactId: 'contact-1',
      replyText: 'Можно оставить у стойки администратора.',
      operatorId: 'ops@asi.global',
    });

    expect(result.ok).toBe(true);
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      'Уточнили по вашему вопросу:\n\nМожно оставить у стойки администратора.',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('does not send raw operator text without wrapper', async () => {
    contactRows.set('contact-1', {
      id: 'contact-1',
      telegram_chat_id: '8101',
      telegram_user_id: '9101',
      property_id: 'prop-1',
      name: 'Гость',
    });
    eventRows.push({
      id: 'esc-1',
      contact_id: 'contact-1',
      event_type: 'operator_followup_required',
      message_text: 'а можно поставить велосипед в подъезде?',
      property_id: 'prop-1',
      metadata: { intent: 'operator' },
      acknowledged_at: null,
      created_at: '2026-06-18T10:00:00.000Z',
    });

    const rawReply = 'Лучше не оставлять в подъезде.';
    const result = await sendOperatorReplyToTelegram({
      contactId: 'contact-1',
      replyText: rawReply,
      operatorId: 'ops@asi.global',
    });

    expect(result.ok).toBe(true);
    expect(mockReplyToTelegram).not.toHaveBeenCalledWith(
      8101,
      rawReply,
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      'Вы спрашивали: «а можно поставить велосипед в подъезде?»\n\nОтвет: Лучше не оставлять в подъезде.',
      expect.any(Object),
      expect.any(Object),
    );
  });
});
