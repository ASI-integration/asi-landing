import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabaseFrom = vi.fn();
const mockReplyToTelegram = vi.fn();
const mockRecordCrmCommunicationEvent = vi.fn();
const mockUpdateCrmContact = vi.fn();
const mockPatchTelegramRoutingSession = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

vi.mock('@/lib/crm/repository', () => ({
  recordCrmCommunicationEvent: (...args: unknown[]) => mockRecordCrmCommunicationEvent(...args),
  updateCrmContact: (...args: unknown[]) => mockUpdateCrmContact(...args),
}));

vi.mock('@/lib/communication/telegram-routing-session', () => ({
  patchTelegramRoutingSession: (...args: unknown[]) => mockPatchTelegramRoutingSession(...args),
}));

import {
  dispatchGuestTestToChat,
  syncGuestTestOnPropertyReady,
} from '@/lib/crm/guest-test-flow';

function chain(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    update: vi.fn(() => builder),
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

describe('guest test flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplyToTelegram.mockResolvedValue(undefined);
    mockRecordCrmCommunicationEvent.mockResolvedValue(undefined);
    mockUpdateCrmContact.mockResolvedValue(undefined);
    mockPatchTelegramRoutingSession.mockReturnValue({});
  });

  it('records guest_test_ready and dispatches guest_test_started for linked telegram', async () => {
    const ownerContact = {
      id: 'contact-1',
      name: 'Owner',
      role: 'owner',
      source: 'pilot_form',
      contact: '@owner',
      telegram_user_id: '1001',
      telegram_username: 'owner',
      telegram_chat_id: '8101',
      status: 'object_filled',
      property_id: 'prop-1',
      property_count: 1,
      notes: null,
      next_action: 'Запустить тест гостя',
      next_action_due_at: null,
      last_message: null,
      last_activity_at: null,
      lead_id: null,
      awaiting_reply: false,
      created_at: '2026-06-16T00:00:00.000Z',
      updated_at: '2026-06-16T00:00:00.000Z',
    };

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'crm_contacts') {
        return chain({ data: [ownerContact], error: null });
      }
      if (table === 'crm_events') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    await syncGuestTestOnPropertyReady('prop-1');

    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'guest_test_ready', propertyId: 'prop-1' }),
    );
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('Тестовый режим гостя'),
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'guest_test_started', propertyId: 'prop-1' }),
    );
    expect(mockUpdateCrmContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        status: 'testing_communication',
        nextAction: 'Проверить результат теста гостя',
      }),
    );
  });

  it('dispatches guest test session for telegram start payload', async () => {
    await dispatchGuestTestToChat({
      chatId: 8101,
      telegramUserId: '1001',
      telegramUsername: 'owner',
      firstName: 'Owner',
      propertyId: 'prop-1',
      source: 'telegram_start',
    });

    expect(mockPatchTelegramRoutingSession).toHaveBeenCalledWith(
      8101,
      expect.objectContaining({
        testGuest: true,
        testPropertyId: 'prop-1',
      }),
    );
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'guest_test_started',
        propertyId: 'prop-1',
        metadata: expect.objectContaining({ source: 'telegram_start' }),
      }),
    );
  });
});
