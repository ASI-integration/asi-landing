import { describe, expect, it } from 'vitest';
import {
  lookupPropertyKnowledge,
  upsertPropertyKnowledge,
} from '../property-knowledge';

function query(result: { data: unknown; error: { message: string } | null }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    ilike: () => chain,
    limit: async () => result,
    maybeSingle: async () => result,
    single: async () => result,
  };
  return chain;
}

describe('Booking Ops property knowledge', () => {
  it('looks up a property by property_id first', async () => {
    const db = {
      from: () => query({
        data: {
          property_id: 'prop-1',
          object_name: 'Студия',
          address: 'Москва, Тверская, 1',
          wifi_name: 'Guest Wi-Fi',
        },
        error: null,
      }),
    };

    const result = await lookupPropertyKnowledge(
      { propertyId: 'prop-1', propertyLabel: 'Другое название' },
      db,
    );

    expect(result.match).toBe('property_id');
    expect(result.knowledge?.address).toBe('Москва, Тверская, 1');
  });

  it('uses a unique exact property label fallback and rejects ambiguous matches', async () => {
    const responses = [
      { data: null, error: null },
      { data: [{ property_id: 'prop-2', object_name: 'Студия' }], error: null },
    ];
    const db = { from: () => query(responses.shift()!) };
    const unique = await lookupPropertyKnowledge({ propertyId: 'missing', propertyLabel: 'Студия' }, db);
    expect(unique.match).toBe('property_label');
    expect(unique.knowledge?.propertyId).toBe('prop-2');

    const ambiguousResponses = [
      { data: null, error: null },
      {
        data: [
          { property_id: 'prop-2', object_name: 'Студия' },
          { property_id: 'prop-3', object_name: 'Студия' },
        ],
        error: null,
      },
    ];
    const ambiguousDb = { from: () => query(ambiguousResponses.shift()!) };
    const ambiguous = await lookupPropertyKnowledge(
      { propertyId: 'missing', propertyLabel: 'Студия' },
      ambiguousDb,
    );
    expect(ambiguous.match).toBe('ambiguous');
    expect(ambiguous.knowledge).toBeNull();
  });

  it('keeps a missing lookup non-fatal', async () => {
    const responses = [
      { data: null, error: null },
      { data: [], error: null },
    ];
    const db = { from: () => query(responses.shift()!) };
    const result = await lookupPropertyKnowledge({ propertyId: 'missing', propertyLabel: 'Нет объекта' }, db);
    expect(result).toEqual({ knowledge: null, match: 'none' });
  });

  it('does not overwrite private_operator_notes unless explicitly provided', async () => {
    let upserted: Record<string, unknown> = {};
    const chain: any = {
      upsert: (row: Record<string, unknown>) => { upserted = row; return chain; },
      select: () => chain,
      single: async () => ({ data: { property_id: 'prop-1', ...upserted }, error: null }),
    };
    const db = { from: () => chain };

    const result = await upsertPropertyKnowledge({ propertyId: 'prop-1', address: 'Новый адрес' }, db);
    expect(result.ok).toBe(true);
    expect(upserted).not.toHaveProperty('private_operator_notes');
    expect(upserted.address).toBe('Новый адрес');
  });
});
