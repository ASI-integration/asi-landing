import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { lookupPropertyKnowledge, lookupPropertyKnowledgeBatch } from '../property-knowledge';
import { isCanonicalBookingId } from '../booking-reference';

function db() {
  const calls: string[] = [];
  const row = { property_id: 'foreign-id', object_name: 'Same name', intercom_code: 'PRIVATE' };
  return { calls, from: () => {
    let rows: typeof row[] = [];
    const q = { select: () => q, limit: () => q,
      eq: (key: string) => { calls.push(key); rows = key === 'object_name' ? [row] : []; return q; },
      in: (key: string) => { calls.push(key); rows = key === 'object_name' ? [row] : []; return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (r: unknown) => void) => resolve({ data: rows, error: null }),
    }; return q;
  } };
}
describe('Finishline scoped knowledge and reference boundaries', () => {
  it('never falls back from an explicit missing ID into foreign named knowledge', async () => {
    const client = db();
    expect(await lookupPropertyKnowledge({ propertyId: 'owned-id', propertyLabel: 'Same name' }, client)).toEqual({ knowledge: null, match: 'none' });
    expect(client.calls).toEqual(['property_id']);
  });
  it('batch lookup preserves the same explicit-ID boundary', async () => {
    const client = db();
    const result = await lookupPropertyKnowledgeBatch([{ key: 'owned', propertyId: 'owned-id', propertyLabel: 'Same name' }], client);
    expect(result.get('owned')).toEqual({ knowledge: null, match: 'none' });
    expect(client.calls).toEqual(['property_id']);
  });
  it('retains descriptive-only lookup compatibility', async () => {
    expect((await lookupPropertyKnowledge({ propertyLabel: 'Same name' }, db())).match).toBe('property_label');
  });
  it('does not mix named batch results into explicit missing IDs', async () => {
    const result = await lookupPropertyKnowledgeBatch([{ key: 'owned', propertyId: 'owned-id', propertyLabel: 'Same name' }, { key: 'legacy', propertyLabel: 'Same name' }], db());
    expect(result.get('owned')?.knowledge).toBeNull();
    expect(result.get('legacy')?.match).toBe('property_label');
  });
  it.each(['task32-main', 'external-123', '', '00000000-0000-0000-0000-00000000000Z'])('keeps external reference %s out of UUID predicates', value => expect(isCanonicalBookingId(value)).toBe(false));
  it('accepts canonical UUID including uppercase hex', () => expect(isCanonicalBookingId('29300000-0000-4000-8000-00000000000A')).toBe(true));
});
