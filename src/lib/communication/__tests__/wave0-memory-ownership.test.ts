import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no live DB'); } } }));
import { resolveGuestMemoryAccountId, loadRelevantGuestMemory, observeResolvedGuestInbound } from '../guest-long-term-memory';

function database(property: unknown, reservation: unknown) {
  const from = vi.fn((table: string) => {
    if (table.startsWith('guest_memory_')) throw new Error('unauthorized memory access');
    return { select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: table === 'properties' ? property : reservation, error: null }),
    }) }) };
  });
  return { from };
}
describe('canonical guest-memory ownership', () => {
  it.each([
    ['different owners', { account_id: 'A' }, { account_id: 'B', property_id: 'p' }, undefined],
    ['different property', { account_id: 'A' }, { account_id: 'A', property_id: 'other' }, undefined],
    ['forged explicit account', { account_id: 'A' }, { account_id: 'A', property_id: 'p' }, 'B'],
    ['missing property', null, { account_id: 'A', property_id: 'p' }, 'A'],
    ['missing reservation', { account_id: 'A' }, null, 'A'],
  ])('%s makes zero memory calls', async (_label, property, reservation, accountId) => {
    const db = database(property, reservation);
    const scope = { propertyId: 'p', reservationId: 'r', accountId, db };
    expect(await resolveGuestMemoryAccountId(scope)).toBeNull();
    expect(await loadRelevantGuestMemory({ ...scope, guestId: 'shared', requestText: 'quiet room' })).toBeNull();
    const result = await observeResolvedGuestInbound({
      ...scope, guestId: 'shared', senderIdentity: 'guest', messageText: 'I prefer a quiet room',
      language: 'en', transport: 'telegram',
    });
    expect(result.observed).toBe(false);
    expect(db.from.mock.calls.every(([table]) => !table.startsWith('guest_memory_'))).toBe(true);
  });
  it('accepts consistent canonical evidence', async () => {
    const db = database({ account_id: 'A' }, { account_id: 'A', property_id: 'p' });
    expect(await resolveGuestMemoryAccountId({ db, accountId: 'A', propertyId: 'p', reservationId: 'r' })).toBe('A');
  });
  it('does not infer ownership from guest-controlled metadata', async () => {
    const db = database(null, null);
    expect(await resolveGuestMemoryAccountId({ db, ...{ source: { account_id: 'B' }, guestId: 'B' } })).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
});
