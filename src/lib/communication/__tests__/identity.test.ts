import { beforeEach, describe, expect, it, vi } from 'vitest';

type ContactRow = Record<string, unknown> & { id: string };

const contactStore = vi.hoisted(() => ({
  rows: [] as ContactRow[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let filters: Array<[string, unknown]> = [];
      let updatePayload: Record<string, unknown> | null = null;
      const matchingRows = () => contactStore.rows.filter((row) =>
        filters.every(([field, value]) => row[field] === value),
      );
      const query: any = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          filters.push([field, value]);
          return query;
        },
        maybeSingle: async () => ({
          data: table === 'tg_contacts' ? matchingRows()[0] ?? null : null,
          error: null,
        }),
        upsert: async (payload: ContactRow) => {
          if (table !== 'tg_contacts') return { data: null, error: null };
          const byId = contactStore.rows.find((row) => row.id === payload.id);
          const telegramConflict = payload.telegram_id
            ? contactStore.rows.find((row) => row.telegram_id === payload.telegram_id && row.id !== payload.id)
            : null;
          if (telegramConflict) return { data: null, error: { message: 'duplicate telegram_id' } };
          if (byId) Object.assign(byId, payload);
          else contactStore.rows.push({ ...payload });
          return { data: null, error: null };
        },
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload;
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve().then(() => {
            if (table === 'tg_contacts' && updatePayload) {
              matchingRows().forEach((row) => Object.assign(row, updatePayload));
            }
            return { data: null, error: null };
          }).then(resolve, reject),
      };
      return query;
    },
  },
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({ status: 'unmatched', confidence: 0 }),
}));

import { bindIdentity } from '../identity-binding';
import { matchReservation } from '../reservation';
import {
  __resetIdentityCacheForTests,
  createOrMergeIdentity,
  resolveGuestIdentity,
} from '../identity';

function telegramEnvelope(chatId: string, messageText = 'Здравствуйте') {
  return {
    channel: 'telegram' as const,
    externalUserId: chatId,
    chatId,
    messageText,
    receivedAt: new Date('2026-08-09T12:00:00.000Z'),
    metadata: { telegram_chat_id: chatId },
  };
}

describe('Identity Resolution', () => {
  beforeEach(() => {
    contactStore.rows.length = 0;
    __resetIdentityCacheForTests();
    vi.unstubAllEnvs();
    vi.mocked(matchReservation).mockResolvedValue({ status: 'unmatched', confidence: 0 });
  });

  it('unifies identities from email and Telegram correctly', async () => {
    const identity1 = await createOrMergeIdentity({
      channel: 'email',
      externalUserId: 'test@email.com',
      email: 'guest@example.com',
      receivedAt: new Date(),
    }, 'guest123');

    expect(identity1.guestId).toBe('guest123');
    expect(identity1.knownEmails).toContain('guest@example.com');

    const identity2 = await createOrMergeIdentity(telegramEnvelope('10000'), 'guest123');
    expect(identity2.guestId).toBe('guest123');
    expect(identity2.knownChatIds).toContain('10000');

    const resolved = await resolveGuestIdentity(telegramEnvelope('10000'));
    expect(resolved).toMatchObject({ guestId: 'guest123' });
    expect(resolved?.knownEmails).toContain('guest@example.com');
  });

  it('persists the configured test chat and resolves the same guestId after cache reset', async () => {
    vi.stubEnv('TELEGRAM_TEST_CHAT_ID', '4242');
    const first = await bindIdentity(telegramEnvelope('4242', 'I prefer English text.'));

    expect(first).toMatchObject({ role: 'test_guest', status: 'resolved' });
    expect(first.guestId).toBeTruthy();
    expect(contactStore.rows).toHaveLength(1);
    expect(contactStore.rows[0]).toMatchObject({ id: first.guestId, telegram_id: '4242' });

    __resetIdentityCacheForTests();
    const afterRestart = await bindIdentity(telegramEnvelope('4242', 'Hello again'));
    expect(afterRestart.guestId).toBe(first.guestId);
    expect(afterRestart.role).toBe('test_guest');
    expect(contactStore.rows).toHaveLength(1);
  });

  it('converges concurrent test-chat creation without duplicate contacts', async () => {
    vi.stubEnv('TELEGRAM_AUTOPILOT_TEST_CHAT_ID', '5252');
    const [first, second] = await Promise.all([
      bindIdentity(telegramEnvelope('5252')),
      bindIdentity(telegramEnvelope('5252')),
    ]);
    expect(first.guestId).toBe(second.guestId);
    expect(contactStore.rows.filter((row) => row.telegram_id === '5252')).toHaveLength(1);
  });

  it('does not create a durable identity for an anonymous unknown sender', async () => {
    const identity = await bindIdentity(telegramEnvelope('9999', 'I prefer quiet apartments.'));
    expect(identity).toMatchObject({ role: 'unknown', status: 'unresolved', reason: 'no_identity' });
    expect(identity.guestId).toBeUndefined();
    expect(contactStore.rows).toHaveLength(0);
  });

  it('does not re-run identity onboarding for a previously identified guest contact', async () => {
    await createOrMergeIdentity(telegramEnvelope('6666'), 'known-guest');
    __resetIdentityCacheForTests();
    const identity = await bindIdentity(telegramEnvelope('6666', 'Hello again'));
    expect(identity).toMatchObject({
      role: 'guest',
      status: 'resolved',
      reason: 'contact_known_guest',
      guestId: 'known-guest',
    });
    expect(contactStore.rows).toHaveLength(1);
  });

  it('creates a contact only after a normal sender is verified against a reservation', async () => {
    vi.mocked(matchReservation).mockResolvedValue({
      status: 'matched',
      confidence: 0.95,
      reservationId: 'reservation-1',
      propertyId: 'property-1',
      guestId: 'guest-from-reservation',
    });
    const identity = await bindIdentity(telegramEnvelope('7777', 'Where is the apartment?'));
    expect(identity).toMatchObject({
      role: 'guest',
      status: 'resolved',
      guestId: 'guest-from-reservation',
      reservationId: 'reservation-1',
    });
    expect(contactStore.rows).toEqual([
      expect.objectContaining({ id: 'guest-from-reservation', telegram_id: '7777' }),
    ]);
  });
});
