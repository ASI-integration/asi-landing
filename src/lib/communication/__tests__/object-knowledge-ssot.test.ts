import { describe, expect, it, beforeEach } from 'vitest';
import {
  get_guest_visible_knowledge,
  type ObjectKnowledgeEntry,
} from '../object-knowledge';
import {
  composeCommunicationAutopilotContextReply,
  decideCommunicationAutopilotResponse,
  decideCommunicationAutopilotResponseWithLlmRouter,
} from '../autopilot';
import {
  applyCommAgentSessionContinuation,
  resetCommAgentSessionMemoryForTests,
  updateCommAgentSessionMemory,
} from '../comm-agent-session-memory';

type QueryFilter =
  | { op: 'eq'; col: string; val: any }
  | { op: 'in'; col: string; val: any[] };

function makeDb(rows: Record<string, any[]>) {
  return {
    from: (table: string) => {
      const q: any = {
        _table: table,
        _filters: [] as QueryFilter[],
        _limit: null as number | null,
        select: () => q,
        eq: (col: string, val: any) => {
          q._filters.push({ op: 'eq', col, val });
          return q;
        },
        in: (col: string, val: any[]) => {
          q._filters.push({ op: 'in', col, val });
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          q._limit = n;
          return q;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: materialize(q), error: null }).then(resolve, reject),
      };
      return q;
    },
  };

  function materialize(q: any): any[] {
    let data = [...(rows[q._table] ?? [])];
    for (const filter of q._filters as QueryFilter[]) {
      if (filter.op === 'eq') data = data.filter((row) => String(row[filter.col] ?? '') === String(filter.val));
      if (filter.op === 'in') data = data.filter((row) => filter.val.map(String).includes(String(row[filter.col] ?? '')));
    }
    if (typeof q._limit === 'number') data = data.slice(0, q._limit);
    return data;
  }
}

function entry(overrides: Partial<ObjectKnowledgeEntry>): ObjectKnowledgeEntry {
  return {
    object_id: 'obj-ssot-1',
    property_id: 'obj-ssot-1',
    category: 'operations',
    key: 'baby_crib_note',
    value_text: 'По запросу поставим кроватку до заезда.',
    value_json: null,
    visibility: 'guest_public',
    sensitivity: 'normal',
    source_type: 'operator',
    confidence: 'high',
    last_verified_at: '2026-06-01T00:00:00.000Z',
    stale_after_days: 30,
    valid_from: null,
    valid_to: null,
    ...overrides,
  };
}

describe('Object Knowledge SSOT for guest household intents', () => {
  beforeEach(() => {
    resetCommAgentSessionMemoryForTests();
  });

  it('asks for booking or address when baby crib intent has no object context', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Есть ли детская кроватка?',
      context: { session: { language: 'ru' } },
    });

    expect(decision.metadata.intent).toBe('baby_crib_request');
    expect(decision.action).toBe('needs_context');
    expect(composeCommunicationAutopilotContextReply({ decision, lang: 'ru' })).toMatch(/номер бронирования или адрес объекта/i);
  });

  it('answers baby crib request from Object Knowledge when the field exists', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Нужна детская кроватка',
      context: {
        session: { language: 'ru' },
        object: {
          id: 'obj-ssot-1',
          babyCribNote: 'Кроватку можно поставить в спальне.',
          knowledgeStatus: { baby_crib_note: 'found' },
        },
        propertyResolved: true,
      },
    });

    expect(decision.action).toBe('auto_reply');
    expect(decision.replyText).toMatch(/Кроватку можно поставить/);
  });

  it('answers waste disposal from Object Knowledge trash_bins_location', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Где мусорные баки?',
      context: {
        session: { language: 'ru' },
        object: {
          id: 'obj-ssot-1',
          trashBinsLocation: 'Баки находятся во дворе справа от арки.',
          knowledgeStatus: { trash_bins_location: 'found' },
        },
        propertyResolved: true,
      },
    });

    expect(decision.metadata.intent).toBe('waste_disposal_info');
    expect(decision.action).toBe('auto_reply');
    expect(decision.replyText).toMatch(/во дворе справа/);
  });

  it('says it will clarify when object is known but the requested field is missing', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Куда вынести мусор?',
      context: {
        session: { language: 'ru' },
        object: { id: 'obj-ssot-1' },
        propertyResolved: true,
      },
    });

    expect(decision.action).toBe('needs_context');
    expect(composeCommunicationAutopilotContextReply({ decision, lang: 'ru' })).toMatch(/не вижу точной информации/i);
  });

  it('blocks sensitive knowledge without booking verification', async () => {
    const db = makeDb({
      object_knowledge_entries: [
        entry({
          category: 'wifi',
          key: 'wifi_password',
          value_text: 'secret-pass',
          visibility: 'guest_after_booking_verified',
          sensitivity: 'password',
        }),
      ],
    });

    const result = await get_guest_visible_knowledge({
      object_id: 'obj-ssot-1',
      key: 'wifi_password',
      booking_verified: false,
      db,
    });

    expect(result.status).toBe('blocked_sensitive');
  });

  it('marks stale knowledge and uses a cautious reply', async () => {
    const db = makeDb({
      object_knowledge_entries: [
        entry({
          last_verified_at: '2026-01-01T00:00:00.000Z',
          stale_after_days: 10,
        }),
      ],
    });

    const result = await get_guest_visible_knowledge({
      object_id: 'obj-ssot-1',
      key: 'baby_crib_note',
      booking_verified: true,
      now: new Date('2026-06-02T00:00:00.000Z'),
      db,
    });

    expect(result.status).toBe('stale');

    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Есть ли детская кроватка?',
      context: {
        session: { language: 'ru' },
        object: {
          id: 'obj-ssot-1',
          babyCribNote: result.entry?.value_text ?? undefined,
          knowledgeStatus: { baby_crib_note: result.status },
        },
      },
    });

    expect(decision.replyText).toMatch(/По последней информации/i);
  });

  it('does not let previous session memory override a fresh baby crib intent', () => {
    updateCommAgentSessionMemory('telegram', '920001', {
      last_intent: 'wifi',
      last_requested_identifier: 'booking_reference',
      last_known_booking_id: null,
      last_known_property_id: null,
      last_safe_reply: null,
      pending_operator_reason: null,
      last_message_at: new Date().toISOString(),
    });

    const continuation = applyCommAgentSessionContinuation({
      channel: 'telegram',
      sessionId: '920001',
      messageText: 'Есть ли детская кроватка?',
    });

    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: continuation.enriched_message_text,
      context: { session: { language: 'ru' } },
    });

    expect(decision.metadata.intent).toBe('baby_crib_request');
  });

  it('keeps the LLM-router wrapper path deterministic for Object Knowledge intents', async () => {
    const decision = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'Где мусорные баки?',
      context: {
        session: { language: 'ru' },
        object: {
          id: 'obj-ssot-1',
          trashBinsLocation: 'Баки у служебного выхода.',
        },
      },
    });

    expect(decision.metadata.intent).toBe('waste_disposal_info');
    expect(decision.metadata.llmRouter).toBeUndefined();
    expect(decision.replyText).toMatch(/Баки у служебного выхода/);
  });
});
