import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  GUEST_MEMORY_MAX_EVENTS,
  boundGuestLongTermMemory,
  buildRelevantGuestMemoryContext,
  containsForbiddenGuestMemoryContent,
  deleteGuestMemoryItem,
  extractExplicitGuestPreferences,
  loadGuestLongTermMemory,
  observeGuestCommunication,
  recordGuestOperationalEvent,
  recordGuestSeen,
  resolveLanguageWithGuestMemory,
  upsertGuestPreference,
  type GuestLongTermMemory,
} from '../guest-long-term-memory';
import { runCommunicationAutopilotV1 } from '../communication-autopilot-v1';
import type { TelegramPropertyObjectV1 } from '../telegram-booking-object-memory';

type Row = Record<string, any>;

class FakeQuery implements PromiseLike<{ data: any; error: null }> {
  private operation: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | null = null;
  private filters: Array<[string, unknown]> = [];
  private maxRows: number | null = null;
  private orderBy: { field: string; ascending: boolean } | null = null;
  private conflict = '';

  constructor(private db: FakeMemoryDb, private table: string) {}

  select(): this { this.operation = 'select'; return this; }
  eq(field: string, value: unknown): this { this.filters.push([field, value]); return this; }
  order(field: string, options?: { ascending?: boolean }): this {
    this.orderBy = { field, ascending: options?.ascending !== false };
    return this;
  }
  limit(value: number): this { this.maxRows = value; return this; }
  upsert(payload: Row, options?: { onConflict?: string }): this {
    this.operation = 'upsert'; this.payload = payload; this.conflict = options?.onConflict ?? ''; return this;
  }
  insert(payload: Row): this { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: Row): this { this.operation = 'update'; this.payload = payload; return this; }
  delete(): this { this.operation = 'delete'; return this; }

  async maybeSingle(): Promise<{ data: any; error: null }> {
    const result = this.execute();
    return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null };
  }

  then<TResult1 = { data: any; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(([field, value]) => row[field] === value);
  }

  private execute(): { data: any; error: null } {
    const rows = this.db.rows(this.table);
    if (this.operation === 'select') {
      let selected = rows.filter((row) => this.matches(row)).map((row) => ({ ...row }));
      if (this.orderBy) {
        const { field, ascending } = this.orderBy;
        selected = selected.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (ascending ? 1 : -1));
      }
      if (this.maxRows !== null) selected = selected.slice(0, this.maxRows);
      return { data: selected, error: null };
    }

    if (this.operation === 'insert' && this.payload) {
      rows.push(this.db.decorate(this.table, this.payload));
      if (this.table === 'guest_memory_events') {
        const guestRows = rows
          .filter((row) => row.guest_id === this.payload?.guest_id && row.status === 'active')
          .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
        for (const extra of guestRows.slice(GUEST_MEMORY_MAX_EVENTS)) {
          rows.splice(rows.indexOf(extra), 1);
        }
      }
      return { data: null, error: null };
    }

    if (this.operation === 'upsert' && this.payload) {
      const keys = this.conflict.split(',').map((key) => key.trim()).filter(Boolean);
      const existing = rows.find((row) => keys.length > 0 && keys.every((key) => row[key] === this.payload?.[key]));
      if (existing) Object.assign(existing, this.payload, { updated_at: this.db.now() });
      else rows.push(this.db.decorate(this.table, this.payload));
      return { data: null, error: null };
    }

    if (this.operation === 'update' && this.payload) {
      rows.filter((row) => this.matches(row)).forEach((row) => Object.assign(row, this.payload, { updated_at: this.db.now() }));
      return { data: null, error: null };
    }

    if (this.operation === 'delete') {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (this.matches(rows[i])) rows.splice(i, 1);
      }
      return { data: null, error: null };
    }

    return { data: null, error: null };
  }
}

class FakeMemoryDb {
  private tables = new Map<string, Row[]>();
  private sequence = 0;

  from(table: string): FakeQuery { return new FakeQuery(this, table); }
  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  now(): string { return `2026-08-09T12:${String(this.sequence++).padStart(2, '0')}:00.000Z`; }
  decorate(table: string, payload: Row): Row {
    const now = this.now();
    return {
      ...(table !== 'guest_memory_profiles' ? { id: `memory-${this.sequence}` } : {}),
      created_at: now,
      updated_at: now,
      ...(table === 'guest_memory_profiles' ? { first_seen_at: now, last_seen_at: now, stay_count: 0 } : {}),
      ...payload,
    };
  }
}

const property: TelegramPropertyObjectV1 = {
  object_id: 'property-current',
  object_name: 'Current object',
  address: 'Test address',
  directions_text: 'Current directions',
  parking_text: 'Текущая парковка находится во дворе.',
  trash_bins_location: 'Current bins',
  waste_disposal_text: 'Current disposal',
  wifi_name: 'Test Wi-Fi',
  wifi_password: 'test-only-password',
  baby_crib_available: true,
  baby_crib_note: 'Current crib rule',
  check_in_text: 'После 15:00',
  checkout_time: '12:00',
  house_rules_text: 'Current rules',
  door_code_notes: 'Available only after verification',
  communication_autopilot: 'enabled',
};

describe('Guest Long-Term Memory v1', () => {
  it('1. recognizes the same guestId after short-term session expiry', async () => {
    const db = new FakeMemoryDb();
    await recordGuestSeen({ guestId: 'guest-returning', preferredLanguage: 'ru', seenAt: '2026-08-09T12:00:00.000Z', db });
    await recordGuestSeen({ guestId: 'guest-returning', preferredLanguage: 'ru', seenAt: '2026-08-11T12:00:00.000Z', db });
    const afterSessionExpiry = await loadGuestLongTermMemory('guest-returning', db);
    expect(afterSessionExpiry.profile).toMatchObject({ guestId: 'guest-returning', preferredLanguage: 'ru' });
    expect(buildRelevantGuestMemoryContext(afterSessionExpiry, 'Здравствуйте').returningGuest).toBe(true);
  });

  it('2. shares one profile across merged phone/email channel paths', async () => {
    const db = new FakeMemoryDb();
    await upsertGuestPreference({ guestId: 'guest-merged', key: 'parking', value: 'Обычно нужна парковка', source: 'explicit_guest', db });
    const viaPhone = await loadGuestLongTermMemory('guest-merged', db);
    const viaEmail = await loadGuestLongTermMemory('guest-merged', db);
    expect(viaEmail.preferences).toEqual(viaPhone.preferences);
  });

  it('3. keeps preferred language across sessions unless the current message switches', async () => {
    const db = new FakeMemoryDb();
    await recordGuestSeen({ guestId: 'guest-language', preferredLanguage: 'en', db });
    const context = buildRelevantGuestMemoryContext(await loadGuestLongTermMemory('guest-language', db), '...');
    expect(resolveLanguageWithGuestMemory({ messageText: '...', detectedLanguage: 'ru', memory: context })).toBe('en');
    expect(resolveLanguageWithGuestMemory({ messageText: 'Ответьте по-русски', detectedLanguage: 'ru', memory: context })).toBe('ru');
  });

  it('4. retains only clearly explicit stable preferences', async () => {
    const db = new FakeMemoryDb();
    await observeGuestCommunication({
      guestId: 'guest-explicit',
      messageText: 'Я всегда предпочитаю тихий номер и обычно нужна парковка.',
      language: 'ru',
      transport: 'telegram_text',
      db,
    });
    expect((await loadGuestLongTermMemory('guest-explicit', db)).preferences.map((item) => item.key).sort()).toEqual(['parking', 'quiet_room']);
  });

  it('5. does not promote speculative statements', async () => {
    expect(extractExplicitGuestPreferences('Наверное, мне может понравиться тихий номер.')).toEqual([]);
  });

  it('6. stores an operator-confirmed outcome as a structured event', async () => {
    const db = new FakeMemoryDb();
    await recordGuestOperationalEvent({
      guestId: 'guest-event',
      type: 'maintenance_resolution',
      summary: 'Оператор подтвердил завершение ремонта.',
      source: 'operator_confirmed',
      sourceRef: 'review-1',
      db,
    });
    expect((await loadGuestLongTermMemory('guest-event', db)).events[0]).toMatchObject({
      type: 'maintenance_resolution', source: 'operator_confirmed', sourceRef: 'review-1',
    });
  });

  it('7. treats prior late checkout as history, never current approval', () => {
    const guestMemory = buildRelevantGuestMemoryContext({
      profile: null,
      preferences: [],
      events: [{
        id: 'event-late', type: 'late_checkout_history', summary: 'Поздний выезд был согласован в прошлом.',
        bookingReference: null, source: 'operator_confirmed', sourceRef: 'review-old', confidence: 1,
        occurredAt: '2026-07-01T12:00:00.000Z', createdAt: '2026-07-01T12:00:00.000Z', historyOnly: true,
      }],
    }, 'Можно поздний выезд?');
    const result = runCommunicationAutopilotV1({ messageText: 'Можно поздний выезд?', property, bookingVerified: true, guestMemory });
    expect(result.action).not.toBe('auto_reply');
    expect(result.requestedMissingField).toBe('requested_time');
  });

  it('8. lets current property facts override stale preference history', () => {
    const guestMemory = buildRelevantGuestMemoryContext({
      profile: null,
      preferences: [{
        id: 'pref-old', key: 'parking', value: 'Раньше парковка была на улице', source: 'explicit_guest',
        sourceRef: null, confidence: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      }],
      events: [],
    }, 'Где парковка?');
    const result = runCommunicationAutopilotV1({ messageText: 'Где парковка?', property, bookingVerified: true, guestMemory });
    expect(result.replyText).toContain('Текущая парковка находится во дворе.');
    expect(result.replyText).not.toContain('на улице');
  });

  it('9. isolates different guests', async () => {
    const db = new FakeMemoryDb();
    await upsertGuestPreference({ guestId: 'guest-a', key: 'crib', value: 'Нужна кроватка', source: 'explicit_guest', db });
    expect((await loadGuestLongTermMemory('guest-a', db)).preferences).toHaveLength(1);
    expect((await loadGuestLongTermMemory('guest-b', db)).preferences).toHaveLength(0);
  });

  it('10. removes corrected or deleted memory from subsequent reads', async () => {
    const db = new FakeMemoryDb();
    await upsertGuestPreference({ guestId: 'guest-correct', key: 'pet', value: 'Путешествует с собакой', source: 'explicit_guest', db });
    await upsertGuestPreference({ guestId: 'guest-correct', key: 'pet', value: 'Больше не путешествует с животным', source: 'operator_confirmed', db });
    const corrected = await loadGuestLongTermMemory('guest-correct', db);
    expect(corrected.preferences[0]?.value).toBe('Больше не путешествует с животным');
    await deleteGuestMemoryItem({ guestId: 'guest-correct', kind: 'preference', itemId: corrected.preferences[0]!.id, db });
    expect((await loadGuestLongTermMemory('guest-correct', db)).preferences).toHaveLength(0);
  });

  it('11. bounds in-memory reads and database retention at 50 events', () => {
    const events = Array.from({ length: 80 }, (_, index) => ({
      id: `event-${index}`, type: 'completed_stay' as const, summary: `Stay ${index}`, bookingReference: null,
      source: 'verified_booking' as const, sourceRef: null, confidence: 1, occurredAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      createdAt: '2026-01-01', historyOnly: false,
    }));
    expect(boundGuestLongTermMemory({ profile: null, preferences: [], events }).events).toHaveLength(50);
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260809120000_guest_long_term_memory_v1.sql'), 'utf8');
    expect(migration).toContain('OFFSET 50');
    expect(migration).toContain('REFERENCES public.tg_contacts(id)');
    const migrationNames = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
    const numericPrefixes = migrationNames.map((name) => name.match(/^(\d+)/)?.[1]).filter(Boolean);
    expect(new Set(numericPrefixes).size).toBe(numericPrefixes.length);
    expect(migrationNames.at(-1)).toBe('20260809120000_guest_long_term_memory_v1.sql');
  });

  it('12. rejects sensitive payloads and provides no transcript/blob columns', async () => {
    const db = new FakeMemoryDb();
    expect(containsForbiddenGuestMemoryContent('door code: 1234')).toBe(true);
    await expect(upsertGuestPreference({
      guestId: 'guest-sensitive', key: 'parking', value: 'door code: 1234', source: 'explicit_guest', db,
    })).rejects.toThrow('forbidden_sensitive_memory_content');
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260809120000_guest_long_term_memory_v1.sql'), 'utf8');
    expect(migration).not.toMatch(/(?:transcript|raw_voice|recording_url|passport_contents|card_number)\s+(?:TEXT|JSONB|BYTEA)/i);
  });

  it('13. gives text and voice paths the same durable context', async () => {
    const db = new FakeMemoryDb();
    await observeGuestCommunication({ guestId: 'guest-multimodal', messageText: 'I always need parking.', language: 'en', transport: 'telegram_text', db });
    await observeGuestCommunication({ guestId: 'guest-multimodal', messageText: 'Where is parking?', language: 'en', transport: 'telegram_voice', db });
    const memory = await loadGuestLongTermMemory('guest-multimodal', db);
    const context = buildRelevantGuestMemoryContext(memory, 'Where is parking?');
    const text = runCommunicationAutopilotV1({ messageText: 'Where is parking?', property, bookingVerified: true, guestMemory: context });
    const voice = runCommunicationAutopilotV1({ messageText: 'Where is parking?', property, bookingVerified: true, guestMemory: context });
    expect({ action: voice.action, reply: voice.replyText }).toEqual({ action: text.action, reply: text.replyText });
    expect(memory.profile?.preferredCommunicationMode).toBe('voice');
  });

  it('14. uses Supabase only and introduces no external provider requirement', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/communication/guest-long-term-memory.ts'), 'utf8');
    expect(source).toContain("from '@/lib/supabase'");
    expect(source).not.toMatch(/fetch\(|axios|openai|provider/i);
  });
});
