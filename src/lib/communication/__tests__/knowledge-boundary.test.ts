import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(() => { throw new Error('No live DB'); }) } }));
import { prepareRuntimeKnowledgeReply, requestedCommunicationFacts, prepareCommunicationFactReply,
  objectKnowledgeFact, canDeliverPreparedFacts } from '../knowledge-boundary';
const now = Date.parse('2026-10-01T12:00:00Z');
const scope = { accountId: 'a', propertyId: 'p', bookingId: 'b', guestId: 'g', sessionId: 'telegram:123' };
const entry = { entry_id: 'e', object_id: 'p', property_id: 'p', key: 'checkout_time',
  value_text: 'Выезд до 12:00.', source_type: 'owner', confidence: 'high',
  last_verified_at: new Date(now).toISOString(), stale_after_days: 7, valid_from: null, valid_to: null,
  sensitivity: 'normal', visibility: 'guest_public' };
type Db = NonNullable<Parameters<typeof prepareRuntimeKnowledgeReply>[1]>;
function fixture(options: { evidence?: unknown; fail?: string; changeOwner?: boolean; foreignBooking?: boolean } = {}) {
  let ownerReads = 0;
  const from = vi.fn((table: string) => {
    const data = () => {
      if (table === options.fail) return { data: null, error: { message: 'SECRET provider error' } };
      if (table === 'tg_guest_reservations') return { data: [{ id: 'b', property_id: options.foreignBooking ? 'foreign' : 'p', guest_id: 'g', chat_id: 123 }], error: null };
      if (table === 'properties') return { data: { id: 'p', account_id: options.changeOwner && ++ownerReads >= 3 ? 'foreign' : 'a' }, error: null };
      return { data: options.evidence ?? [entry], error: null };
    };
    const query = { select: () => query, eq: () => query, in: () => query,
      limit: async () => data(), maybeSingle: async () => data(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(data()).then(resolve) };
    return query;
  });
  return { db: { from } as unknown as Db, from };
}
const input = { message: 'Когда выезд?', channel: 'telegram', chatId: 123, ru: true, propertyId: 'p', reservationId: 'b' };
describe('runtime knowledge preparation', () => {
  it.each(['Какой код от двери?', 'Какой пароль Wi-Fi?', 'Залог уже вернули?', 'Можно заехать сейчас?',
    'Где ключи?', 'Уборка закончена?', 'Когда выезд?', 'Мой договор подписан?'])('requires evidence: %s', (message) => {
    expect(requestedCommunicationFacts(message).length).toBeGreaterThan(0);
  });
  it('renders a verified normal fact from the actual adapter', async () => {
    const { db } = fixture();
    expect(await prepareRuntimeKnowledgeReply(input, db, () => now))
      .toMatchObject({ reviewRequired: false, text: 'Выезд до 12:00.' });
  });
  it.each(['properties', 'tg_guest_reservations', 'object_knowledge_entries'])('fails closed on %s failure', async (fail) => {
    const { db } = fixture({ fail });
    const result = await prepareRuntimeKnowledgeReply(input, db, () => now);
    expect(result?.reviewRequired).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('rejects ownership change after source read', async () => {
    const { db } = fixture({ changeOwner: true });
    expect((await prepareRuntimeKnowledgeReply(input, db, () => now))?.reviewRequired).toBe(true);
  });
  it('rejects wrong booking/property binding before loading evidence', async () => {
    const { db, from } = fixture({ foreignBooking: true });
    expect((await prepareRuntimeKnowledgeReply(input, db, () => now))?.reviewRequired).toBe(true);
    expect(from.mock.calls.some(([table]) => table === 'object_knowledge_entries')).toBe(false);
  });
  it.each([{}, { ...entry, property_id: 'foreign' }, { ...entry, object_id: 'foreign' },
    { ...entry, last_verified_at: null }, { ...entry, source_type: 'synthetic' },
    { ...entry, sensitivity: 'password' }, { ...entry, visibility: 'internal' },
    { ...entry, valid_to: '2026-09-01T00:00:00Z' }])('rejects invalid/untrusted entry %#', async (evidence) => {
    const { db } = fixture({ evidence: [evidence] });
    expect((await prepareRuntimeKnowledgeReply(input, db, () => now))?.reviewRequired).toBe(true);
  });
  it('missing evidence cannot be filled from a plausible generated answer', async () => {
    const { db } = fixture({ evidence: [] });
    const result = await prepareRuntimeKnowledgeReply(input, db, () => now);
    expect(result?.text).toContain('Нужна проверка оператора');
    expect(result?.text).not.toContain('12:00');
  });
  it('unknown channel binding requires review without DB lookup', async () => {
    const { db, from } = fixture();
    expect((await prepareRuntimeKnowledgeReply({ ...input, channel: 'email' }, db, () => now))?.reviewRequired).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
  it('safe non-fact message does not perform retrieval', async () => {
    const { db, from } = fixture();
    expect(await prepareRuntimeKnowledgeReply({ ...input, message: 'Спасибо!' }, db, () => now)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
  it('preserves source and verification date, never substitutes fetch time', () => {
    expect(objectKnowledgeFact(entry, scope, now)).toMatchObject({
      observedAt: entry.last_verified_at, source: 'object_knowledge_entries', origin: 'manual', reference: 'e', scope,
    });
  });
  it('an empty success flag cannot approve an answer', () => {
    expect(prepareCommunicationFactReply({ ready: true, decisions: [] }).reviewRequired).toBe(true);
  });
});

describe('delivery revalidation preserves initial identity', () => {
  const prepared = () => prepareCommunicationFactReply({ ready: true, decisions: [{
    key: 'checkout_time', use: 'automatic', reason: 'verified', fact: objectKnowledgeFact(entry, scope, now),
  }] });
  it.each(['accountId', 'propertyId', 'bookingId', 'guestId', 'sessionId'] as const)(
    'cannot independently re-derive a different %s even with identical text', (dimension) => {
      const original = prepared();
      const fresh = prepared();
      fresh.result.decisions[0].fact!.scope = { ...scope, [dimension]: 'foreign' };
      expect(canDeliverPreparedFacts(original, fresh)).toBe(false);
    },
  );
  it('accepts the same still-verified identity and value', () => {
    expect(canDeliverPreparedFacts(prepared(), prepared())).toBe(true);
  });
  it('rejects a newly unavailable source', () => {
    expect(canDeliverPreparedFacts(prepared(), prepareCommunicationFactReply({
      ready: false, decisions: [{ key: 'checkout_time', use: 'unusable', reason: 'dependency_failed' }],
    }))).toBe(false);
  });
});
