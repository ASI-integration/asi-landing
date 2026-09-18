/**
 * P0-02 focused acceptance: canonical object_knowledge_entries as guest-fact SSOT
 * for the live Telegram Path A loader (loadTelegramPropertyKnowledgeV1).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  GUEST_FACT_CANONICAL_KEYS,
  buildCanonicalGuestFactUpserts,
  resolveGuestPropertyKnowledge,
} from '../guest-property-knowledge';
import { loadTelegramPropertyKnowledgeV1 } from '../telegram-property-knowledge';
import { buildPilotObjectKnowledgeRows, normalizePilotObjectInput } from '../pilot-object-intake';
import { composeTelegramOperationalReply } from '../telegram-reply-composer';
import { processTelegramOperationalIntakeWithSessionMemory } from '../telegram-session-memory';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';

type QueryFilter =
  | { op: 'eq'; col: string; val: any }
  | { op: 'in'; col: string; val: any[] }
  | { op: 'ilike'; col: string; val: any }
  | { op: 'gte'; col: string; val: any }
  | { op: 'lte'; col: string; val: any };

function makeTableDb(rows: Record<string, any[]>) {
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
        ilike: (col: string, val: any) => {
          q._filters.push({ op: 'ilike', col, val });
          return q;
        },
        gte: (col: string, val: any) => {
          q._filters.push({ op: 'gte', col, val });
          return q;
        },
        lte: (col: string, val: any) => {
          q._filters.push({ op: 'lte', col, val });
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          q._limit = n;
          return q;
        },
        maybeSingle: async () => {
          const data = materialize(q);
          return { data: data[0] ?? null, error: null };
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
      if (filter.op === 'ilike') {
        const needle = String(filter.val).replace(/%/g, '').toLowerCase();
        data = data.filter((row) => String(row[filter.col] ?? '').toLowerCase().includes(needle));
      }
    }
    if (typeof q._limit === 'number') data = data.slice(0, q._limit);
    return data;
  }
}

function okEntry(overrides: Record<string, unknown>) {
  return {
    entry_id: 'e1',
    object_id: 'prop_a',
    property_id: 'prop_a',
    category: 'wifi',
    key: 'wifi_name',
    value_text: 'CanonicalNet',
    visibility: 'guest_public',
    sensitivity: 'normal',
    source_type: 'owner',
    confidence: 'high',
    last_verified_at: '2026-09-01T00:00:00.000Z',
    stale_after_days: 90,
    valid_from: null,
    valid_to: null,
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('P0-02 guest property knowledge SSOT', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
  });
  afterEach(() => {
    __resetAutonomousSessionStoreForTests();
    vi.restoreAllMocks();
  });

  it('1. canonical knowledge overrides conflicting legacy tg_property_knowledge', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({ key: 'parking_text', category: 'parking', value_text: 'Canonical courtyard parking' }),
      ],
      tg_property_knowledge: [
        { property_id: 'prop_a', parking_rules: 'LEGACY street parking only', parking_text: 'LEGACY street' },
      ],
    });

    const result = await loadTelegramPropertyKnowledgeV1({
      matched_property_id: 'prop_a',
      booking_verified: true,
      db,
    });

    expect(result.knowledge.parking_rules).toBe('Canonical courtyard parking');
    expect(result.knowledge.parking_rules).not.toMatch(/LEGACY/);
    const parking = result.field_resolutions?.find((r) => r.field === 'parking_rules');
    expect(parking?.source).toBe('canonical');
    expect(parking?.usable).toBe(true);
  });

  it('2. missing canonical fact cannot be fabricated from generic fallback', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [],
      tg_property_knowledge: [{ property_id: 'prop_a' }],
    });

    const result = await loadTelegramPropertyKnowledgeV1({
      matched_property_id: 'prop_a',
      booking_verified: true,
      db,
    });

    expect(result.status).toBe('property_found_but_knowledge_missing');
    expect(result.knowledge.wifi_name).toBeNull();
    expect(result.knowledge.wifi_password).toBeNull();
    expect(result.knowledge.parking_rules).toBeNull();
    expect(result.available_fields).toEqual([]);
  });

  it('3. stale canonical fact is not used as current fact', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({
          key: 'parking_text',
          category: 'parking',
          value_text: 'Stale parking behind building',
          last_verified_at: '2025-01-01T00:00:00.000Z',
          stale_after_days: 30,
        }),
      ],
      tg_property_knowledge: [{ property_id: 'prop_a', parking_rules: 'Legacy must not win over stale' }],
    });

    const result = await loadTelegramPropertyKnowledgeV1({
      matched_property_id: 'prop_a',
      booking_verified: true,
      db,
      now: new Date('2026-09-18T00:00:00.000Z'),
    });

    const parking = result.field_resolutions?.find((r) => r.field === 'parking_rules');
    expect(parking?.status).toBe('stale');
    expect(parking?.source).toBe('canonical');
    expect(parking?.usable).toBe(false);
    expect(result.knowledge.parking_rules).toBeNull();
  });

  it('4. low-confidence canonical fact is not used as certain fact', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({
          key: 'checkout_time',
          category: 'checkout',
          value_text: 'до 12:00 (unverified guess)',
          confidence: 'low',
        }),
      ],
      tg_property_knowledge: [],
    });

    const result = await loadTelegramPropertyKnowledgeV1({
      matched_property_id: 'prop_a',
      booking_verified: true,
      db,
    });

    const checkout = result.field_resolutions?.find((r) => r.field === 'checkout_notes');
    expect(checkout?.status).toBe('low_confidence');
    expect(checkout?.usable).toBe(false);
    expect(result.knowledge.checkout_notes).toBeNull();
  });

  it('5. unverified guest cannot receive Wi-Fi password/access secret', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({
          key: 'wifi_password',
          value_text: 'SecretPass99',
          visibility: 'guest_after_booking_verified',
          sensitivity: 'password',
        }),
        okEntry({
          key: 'wifi_name',
          value_text: 'GuestSSID',
          visibility: 'guest_after_booking_verified',
          sensitivity: 'normal',
        }),
      ],
      tg_property_knowledge: [],
    });

    const result = await loadTelegramPropertyKnowledgeV1({
      matched_property_id: 'prop_a',
      booking_verified: false,
      db,
    });

    expect(result.knowledge.wifi_password).toBeNull();
    expect(result.knowledge.wifi_name).toBeNull();
    const pwd = result.field_resolutions?.find((r) => r.field === 'wifi_password');
    expect(pwd?.status).toBe('blocked_sensitive');
    expect(pwd?.usable).toBe(false);
  });

  it('6. verified guest can receive allowed fresh canonical Wi-Fi credentials', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({
          key: 'wifi_name',
          value_text: 'GuestSSID',
          visibility: 'guest_after_booking_verified',
        }),
        okEntry({
          key: 'wifi_password',
          value_text: 'SecretPass99',
          visibility: 'guest_after_booking_verified',
          sensitivity: 'password',
        }),
      ],
      tg_property_knowledge: [],
    });

    const result = await loadTelegramPropertyKnowledgeV1({
      matched_property_id: 'prop_a',
      booking_verified: true,
      db,
    });

    expect(result.status).toBe('knowledge_found');
    expect(result.knowledge.wifi_name).toBe('GuestSSID');
    expect(result.knowledge.wifi_password).toBe('SecretPass99');
    expect(result.knowledge_source).toBe('canonical');
  });

  it('7+8. parking comes from matched property only; two properties never cross-use', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({
          object_id: 'prop_a',
          property_id: 'prop_a',
          key: 'parking_text',
          category: 'parking',
          value_text: 'Park at Prop A gate',
        }),
        okEntry({
          object_id: 'prop_b',
          property_id: 'prop_b',
          key: 'parking_text',
          category: 'parking',
          value_text: 'Park at Prop B lot',
        }),
      ],
      tg_property_knowledge: [],
    });

    const a = await loadTelegramPropertyKnowledgeV1({ matched_property_id: 'prop_a', booking_verified: true, db });
    const b = await loadTelegramPropertyKnowledgeV1({ matched_property_id: 'prop_b', booking_verified: true, db });

    expect(a.knowledge.parking_rules).toBe('Park at Prop A gate');
    expect(b.knowledge.parking_rules).toBe('Park at Prop B lot');
    expect(a.knowledge.parking_rules).not.toBe(b.knowledge.parking_rules);
  });

  it('9. canonical checkout/check-in facts compose correctly', async () => {
    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({
          key: 'check_in_text',
          category: 'access',
          value_text: 'Заезд с 15:00, ключ в сейфе 1234',
          visibility: 'guest_after_booking_verified',
        }),
        okEntry({
          key: 'checkout_time',
          category: 'checkout',
          value_text: 'Выезд до 11:00',
        }),
      ],
      tg_property_knowledge: [],
    });

    const result = await loadTelegramPropertyKnowledgeV1({
      matched_property_id: 'prop_a',
      booking_verified: true,
      db,
    });

    expect(result.knowledge.checkin_instructions).toBe('Заезд с 15:00, ключ в сейфе 1234');
    expect(result.knowledge.checkout_notes).toBe('Выезд до 11:00');

    const composed = composeTelegramOperationalReply({
      update_id: 901,
      category: 'parking_question',
      action: 'reply',
      lang: 'ru',
      text: 'парковка?',
      extractedFacts: {
        matched_property_id: 'prop_a',
        property_knowledge: result.knowledge,
        property_knowledge_status: result.status,
      },
      missingFacts: [],
      urgency: 'normal',
      linkingState: null,
      sessionCase: null,
      sessionMemory: null,
    });
    // Parking missing → non-inventing hold, not fabricated parking rules.
    expect(composed.text).not.toMatch(/Заезд с 15:00/);
    expect(composed.text.toLowerCase()).not.toMatch(/secret|password|паркуйтесь у ворот/i);
  });

  it('10. late checkout policy requiring approval escalates (not auto-approval)', async () => {
    const db = makeTableDb({
      tg_guest_reservations: [
        {
          id: 'res_late',
          property_id: 'prop_lit',
          guest_name: 'Anna Petrova',
          check_in: '2026-04-22T14:00:00.000Z',
          check_out: '2026-04-25T11:00:00.000Z',
        },
      ],
      tg_property_knowledge: [
        {
          property_id: 'prop_lit',
          location: 'Liteyny 12',
          late_checkout_policy: 'Поздний выезд только по согласованию с менеджером',
        },
      ],
      object_knowledge_entries: [
        okEntry({
          object_id: 'prop_lit',
          property_id: 'prop_lit',
          key: 'late_checkout_policy',
          category: 'checkout',
          value_text: 'Поздний выезд только по согласованию с менеджером',
        }),
      ],
    });

    const r = await processTelegramOperationalIntakeWithSessionMemory({
      chatId: 9101,
      channel: 'telegram',
      surfaceLang: 'ru',
      update_id: 9101,
      text: 'Гость Anna Petrova просит поздний выезд завтра до 14:00 на Liteyny 12.',
      db,
    });
    expect(r.handled).toBe(true);
    if (!r.handled) throw new Error('expected handled');
    expect(r.hit.category).toBe('late_checkout');
    expect(r.hit.finalAction).toBe('escalate_operator');
    expect((r.hit.extractedFacts as any).late_checkout_requires_approval).toBe(true);
    expect(r.hit.actionReason).toMatch(/policy_requires_approval/);
  });

  it('11. pilot intake creates keys the canonical reader understands', async () => {
    const input = normalizePilotObjectInput({
      objectId: 'pilot_obj_1',
      city: 'Псков',
      objectName: 'Студия',
      addressOrArea: 'Центр',
      wifiName: 'ASI-Guest',
      wifiPassword: 'pilot-secret',
      accessInstructions: 'Ключ в сейфе',
      parkingText: 'Двор бесплатно',
      checkoutTime: 'до 12:00',
      houseRules: 'Тишина после 22:00',
    });
    const rows = buildPilotObjectKnowledgeRows(input, new Date('2026-09-18T12:00:00.000Z'));
    const keys = rows.map((r) => r.key);

    const readable = new Set(Object.values(GUEST_FACT_CANONICAL_KEYS).flat());
    expect(keys).toEqual(expect.arrayContaining(['wifi_name', 'wifi_password', 'check_in_text', 'parking_text', 'checkout_time', 'house_rules_text']));
    for (const key of ['wifi_name', 'wifi_password', 'check_in_text', 'parking_text', 'checkout_time', 'house_rules_text']) {
      expect(readable.has(key)).toBe(true);
    }

    const db = makeTableDb({
      object_knowledge_entries: rows.map((r) => ({ ...r, entry_id: `e-${r.key}` })),
      tg_property_knowledge: [],
    });
    const resolved = await resolveGuestPropertyKnowledge({
      property_id: 'pilot_obj_1',
      booking_verified: true,
      db,
    });
    expect(resolved.knowledge.wifi_name).toBe('ASI-Guest');
    expect(resolved.knowledge.wifi_password).toBe('pilot-secret');
    expect(resolved.knowledge.checkin_instructions).toBe('Ключ в сейфе');
    expect(resolved.knowledge.parking_rules).toBe('Двор бесплатно');
    expect(resolved.knowledge.checkout_notes).toBe('до 12:00');
    expect(resolved.knowledge.house_rules).toBe('Тишина после 22:00');
    expect(resolved.has_canonical_guest_entries).toBe(true);
  });

  it('12. legacy adapter is marked and cannot override canonical status/value', async () => {
    const audits: any[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      try {
        const parsed = typeof line === 'string' ? JSON.parse(line) : null;
        if (parsed?.object_knowledge_reply_audit) audits.push(parsed.object_knowledge_reply_audit);
      } catch {
        /* ignore */
      }
    });

    const db = makeTableDb({
      object_knowledge_entries: [
        okEntry({
          key: 'wifi_name',
          value_text: 'CanonicalSSID',
          visibility: 'guest_public',
        }),
        // Canonical blocked password — legacy must not fill it.
        okEntry({
          key: 'wifi_password',
          value_text: 'CanonicalSecret',
          visibility: 'guest_after_booking_verified',
          sensitivity: 'password',
        }),
      ],
      tg_property_knowledge: [
        {
          property_id: 'prop_a',
          wifi_name: 'LegacySSID',
          wifi_password: 'LegacySecret',
          parking_rules: 'Legacy parking only field',
        },
      ],
    });

    const blocked = await resolveGuestPropertyKnowledge({
      property_id: 'prop_a',
      booking_verified: false,
      db,
      audit_message_id: 'tg:test:12',
    });

    expect(blocked.knowledge.wifi_name).toBe('CanonicalSSID');
    expect(blocked.knowledge.wifi_password).toBeNull();
    const pwd = blocked.field_resolutions.find((r) => r.field === 'wifi_password');
    expect(pwd?.source).toBe('canonical');
    expect(pwd?.status).toBe('blocked_sensitive');
    expect(pwd?.usable).toBe(false);

    const parking = blocked.field_resolutions.find((r) => r.field === 'parking_rules');
    expect(parking?.source).toBe('legacy_adapter');
    expect(parking?.status).toBe('legacy_found');
    expect(blocked.knowledge.parking_rules).toBe('Legacy parking only field');

    expect(audits.some((a) => a.knowledge_key === 'wifi_password' && a.knowledge_status === 'blocked_sensitive')).toBe(
      true,
    );
    expect(JSON.stringify(audits)).not.toMatch(/CanonicalSecret|LegacySecret/);
    spy.mockRestore();
  });

  it('buildCanonicalGuestFactUpserts maps admin fields to one canonical key each', () => {
    const rows = buildCanonicalGuestFactUpserts({
      property_id: 'prop_admin',
      fields: {
        wifi_name: 'Net',
        wifi_password: 'Pass',
        check_in_instructions: 'Door left',
        parking_instructions: 'Yard',
        check_out_time: '11:00',
        house_rules: 'No smoking',
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get('wifi_password')?.sensitivity).toBe('password');
    expect(byKey.get('check_in_text')?.value_text).toBe('Door left');
    expect(byKey.get('parking_text')?.value_text).toBe('Yard');
    expect(byKey.get('checkout_time')?.value_text).toBe('11:00');
    expect(rows.filter((r) => r.key === 'check_in_text')).toHaveLength(1);
  });
});
