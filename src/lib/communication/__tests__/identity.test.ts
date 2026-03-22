import { describe, it, expect } from 'vitest';
import { createOrMergeIdentity, resolveGuestIdentity } from '../identity';

describe('Identity Resolution', () => {
  it('unifies identities from phone and email correctly', async () => {
    // Envelope 1: User emails first
    const identity1 = await createOrMergeIdentity({
      channel: 'email',
      externalUserId: 'test@email.com',
      email: 'guest@example.com',
      receivedAt: new Date()
    }, 'guest123');

    expect(identity1.guestId).toBe('guest123');
    expect(identity1.knownEmails).toContain('guest@example.com');

    // Envelope 2: User messages on Telegram, but we already knew their phone (hypothetically)
    // Actually let's simulate updating the profile
    const identity2 = await createOrMergeIdentity({
      channel: 'telegram',
      externalUserId: '10000',
      chatId: '10000',
      receivedAt: new Date()
    }, 'guest123');

    expect(identity2.guestId).toBe('guest123');
    expect(identity2.knownChatIds).toContain('10000');

    // Envelope 3: Resolve based on just chatId
    const resolved = await resolveGuestIdentity({
      channel: 'telegram',
      externalUserId: '10000',
      chatId: '10000',
      receivedAt: new Date()
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.guestId).toBe('guest123');
    expect(resolved?.knownEmails).toContain('guest@example.com');
  });
});
