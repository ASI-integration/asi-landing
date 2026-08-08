import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAutonomousSessionStoreForTests,
  savePendingIdentityMessage,
  takePendingIdentityMessage,
} from '../conversation-session-store';

describe('pending identity replay', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  it('replays the most recent message instead of a stale earlier probe', () => {
    const chatId = 931919812;

    savePendingIdentityMessage({
      chatId,
      channel: 'telegram',
      messageText: 'voice test',
      metadata: { update_id: 1 },
    });

    savePendingIdentityMessage({
      chatId,
      channel: 'telegram',
      messageText: 'А ты понимаешь мое сообщение?',
      metadata: { update_id: 2, original_message_type: 'voice' },
    });

    expect(takePendingIdentityMessage(chatId)).toEqual({
      text: 'А ты понимаешь мое сообщение?',
      metadata: { update_id: 2, original_message_type: 'voice' },
    });
    expect(takePendingIdentityMessage(chatId)).toBeNull();
  });
});
