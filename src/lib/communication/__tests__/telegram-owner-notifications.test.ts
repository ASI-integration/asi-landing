import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendTelegramMessageToChat = vi.fn();
const mockSaveCommunicationAutopilotDecision = vi.fn();

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessageToChat: (...args: unknown[]) => mockSendTelegramMessageToChat(...args),
}));

vi.mock('@/lib/communication/persistence', () => ({
  saveCommunicationAutopilotDecision: (...args: unknown[]) => mockSaveCommunicationAutopilotDecision(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: async () => ({ error: null }),
    }),
  },
}));

import {
  formatTelegramOwnerNotification,
  isGuestChatSameAsOwnerNotify,
  notifyTelegramOwner,
} from '../telegram-owner-notifications';

describe('Telegram owner notifications', () => {
  beforeEach(() => {
    mockSendTelegramMessageToChat.mockReset();
    mockSaveCommunicationAutopilotDecision.mockReset();
    mockSendTelegramMessageToChat.mockResolvedValue(true);
    mockSaveCommunicationAutopilotDecision.mockResolvedValue(undefined);
    process.env.ASI_FEEDBACK_BOT_TOKEN = 'feedback-token';
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '-100admin';
    delete process.env.TELEGRAM_OWNER_NOTIFY_CHAT_ID;
    delete process.env.TELEGRAM_OWNER_CHAT_IDS;
  });

  it('formats detailed operator notification with internal fields', () => {
    const text = formatTelegramOwnerNotification({
      type: 'missing_data',
      guestChatId: 8101,
      guestName: 'Гость',
      guestUsername: 'guest_tester',
      messageText: 'Какой адрес?',
      replyText: 'Сейчас уточню точный адрес у оператора и напишу вам здесь.',
      propertyId: 'prop_A',
      propertyName: 'Тестовая квартира',
      intent: 'address_instruction',
      escalationReason: 'address_directions',
      missingFields: ['object.address', 'object.directionsText'],
    });

    expect(text).toContain('Гость:');
    expect(text).toContain('Намерение: address_instruction');
    expect(text).toContain('object.address');
    expect(text).toContain('Ответ ASI:');
  });

  it('sends operator notification only to owner chat when guest chat differs', async () => {
    const result = await notifyTelegramOwner({
      type: 'missing_data',
      guestChatId: 8101,
      guestName: 'Гость',
      messageText: 'Какой адрес?',
      propertyId: 'prop_A',
      intent: 'address_instruction',
      missingFields: ['object.address'],
      updateId: 42,
    });

    expect(result.sentToTelegram).toBe(true);
    expect(mockSendTelegramMessageToChat).toHaveBeenCalledWith(
      '-100admin',
      expect.stringContaining('Намерение: address_instruction'),
      expect.any(Object),
    );
    expect(mockSaveCommunicationAutopilotDecision).toHaveBeenCalled();
  });

  it('does not send operator notification to Telegram when admin chat equals guest chat', async () => {
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '8101';

    expect(isGuestChatSameAsOwnerNotify(8101)).toBe(true);

    const result = await notifyTelegramOwner({
      type: 'missing_data',
      guestChatId: 8101,
      guestName: 'Гость',
      messageText: 'Какой адрес?',
      propertyId: 'prop_A',
      intent: 'address_instruction',
      missingFields: ['object.address'],
      updateId: 43,
    });

    expect(result.sentToTelegram).toBe(false);
    expect(result.skippedReason).toBe('guest_chat_is_owner_chat');
    expect(mockSendTelegramMessageToChat).not.toHaveBeenCalled();
    expect(mockSaveCommunicationAutopilotDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 8101,
        intent: 'address_instruction',
        missing_context: ['object.address'],
      }),
    );
  });
});
