import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecordCrmEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/crm/repository', () => ({
  recordCrmEventFromOwnerNotification: (...args: unknown[]) => mockRecordCrmEvent(...args),
}));

vi.mock('@/lib/communication/persistence', () => ({
  saveCommunicationAutopilotDecision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessageToChat: vi.fn().mockResolvedValue(undefined),
}));

import { notifyTelegramOwner } from '../telegram-owner-notifications';

describe('telegram-owner-notifications CRM integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_OWNER_NOTIFY_CHAT_ID = '';
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '';
  });

  it('records CRM event when owner notification is persisted', async () => {
    await notifyTelegramOwner({
      type: 'missing_data',
      guestChatId: 8101,
      guestName: 'Гость',
      guestUsername: 'guest_tester',
      messageText: 'Какой пароль от Wi-Fi?',
      propertyId: 'test-prop-tg-live',
      missingFields: ['wifi_password'],
      crmAllowCreateContact: true,
      crmSource: 'test',
      crmRole: 'guest',
    });

    expect(mockRecordCrmEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'missing_data',
        guestChatId: 8101,
        allowCreateContact: true,
        source: 'test',
      }),
    );
  });
});
