import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetTelegramIdentityMemoryForTests,
  loadTelegramConversationMemory,
  memoryToRoutingSession,
  patchTelegramIdentityMemory,
  routingRoleToMemoryRole,
} from '../telegram-identity-memory';

describe('telegram identity memory v1', () => {
  beforeEach(() => {
    __resetTelegramIdentityMemoryForTests();
  });

  it('does not create duplicate memory rows for the same telegram user', async () => {
    await patchTelegramIdentityMemory({
      telegramUserId: '9101',
      chatId: 8101,
      telegramUsername: 'guest_tester',
      displayName: 'Гость',
      role: 'guest',
    });
    await patchTelegramIdentityMemory({
      telegramUserId: '9101',
      chatId: 8101,
      telegramUsername: 'guest_tester_new',
      displayName: 'Гость',
      role: 'guest',
    });

    const memory = await loadTelegramConversationMemory('9101');
    expect(memory?.telegramUsername).toBe('guest_tester_new');
    expect(memory?.chatId).toBe(8101);
  });

  it('preserves role between memory patches', async () => {
    await patchTelegramIdentityMemory({
      telegramUserId: '9101',
      chatId: 8101,
      role: 'owner',
      activeScenario: 'owner_onboarding',
    });
    await patchTelegramIdentityMemory({
      telegramUserId: '9101',
      chatId: 8101,
      displayName: 'Владелец',
    });

    const memory = await loadTelegramConversationMemory('9101');
    expect(memory?.role).toBe('owner');
    expect(memory?.activeScenario).toBe('owner_onboarding');
  });

  it('binds guest_test chat to property id', async () => {
    await patchTelegramIdentityMemory({
      telegramUserId: '9101',
      chatId: 8101,
      role: 'tester',
      activeScenario: 'guest_test',
      propertyId: 'prop-guest-test-1',
      guestTestActive: true,
    });

    const memory = await loadTelegramConversationMemory('9101');
    expect(memory?.guestTestActive).toBe(true);
    expect(memory?.propertyId).toBe('prop-guest-test-1');

    const session = memoryToRoutingSession(memory!);
    expect(session.testGuest).toBe(true);
    expect(session.testPropertyId).toBe('prop-guest-test-1');
    expect(routingRoleToMemoryRole(session.role, session.testGuest)).toBe('tester');
  });
});
