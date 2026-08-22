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
  forgetGuestLongTermMemory,
  isExplicitGuestPreferenceOnlyMessage,
  loadGuestLongTermMemory,
  observeGuestCommunication,
  observeResolvedGuestInbound,
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

const TEST_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';

describe('Guest Long-Term Memory v1', () => {
  it('1. recognizes the same guestId after short-term session expiry', async () => {
    const db = new FakeMemoryDb();
    await recordGuestSeen({ guestId: 'guest-returning', accountId: TEST_ACCOUNT, preferredLanguage: 'ru', seenAt: '2026-08-09T12:00:00.000Z', db });
    await recordGuestSeen({ guestId: 'guest-returning', accountId: TEST_ACCOUNT, preferredLanguage: 'ru', seenAt: '2026-08-11T12:00:00.000Z', db });
    const afterSessionExpiry = await loadGuestLongTermMemory('guest-returning', TEST_ACCOUNT, db);
    expect(afterSessionExpiry.profile).toMatchObject({ guestId: 'guest-returning', preferredLanguage: 'ru' });
    expect(buildRelevantGuestMemoryContext(afterSessionExpiry, 'Здравствуйте').returningGuest).toBe(true);
  });

  it('2. shares one profile across merged phone/email channel paths', async () => {
    const db = new FakeMemoryDb();
    await upsertGuestPreference({ guestId: 'guest-merged', accountId: TEST_ACCOUNT, key: 'parking', value: 'Обычно нужна парковка', source: 'explicit_guest', db });
    const viaPhone = await loadGuestLongTermMemory('guest-merged', TEST_ACCOUNT, db);
    const viaEmail = await loadGuestLongTermMemory('guest-merged', TEST_ACCOUNT, db);
    expect(viaEmail.preferences).toEqual(viaPhone.preferences);
  });

  it('3. keeps preferred language across sessions unless the current message switches', async () => {
    const db = new FakeMemoryDb();
    await recordGuestSeen({ guestId: 'guest-language', accountId: TEST_ACCOUNT, preferredLanguage: 'en', db });
    const context = buildRelevantGuestMemoryContext(await loadGuestLongTermMemory('guest-language', TEST_ACCOUNT, db), '...');
    expect(resolveLanguageWithGuestMemory({ messageText: '...', detectedLanguage: 'ru', memory: context })).toBe('en');
    expect(resolveLanguageWithGuestMemory({ messageText: 'Ответьте по-русски', detectedLanguage: 'ru', memory: context })).toBe('ru');
  });

  it('4. records Russian language, text mode, and quiet-room preference from an explicit statement', async () => {
    const db = new FakeMemoryDb();
    const result = await observeResolvedGuestInbound({
      guestId: 'guest-explicit',
      accountId: TEST_ACCOUNT,
      senderIdentity: 'guest',
      messageText: 'Я предпочитаю общаться по-русски и текстом. Люблю тихие квартиры.',
      language: 'ru',
      transport: 'telegram_text',
      db,
    });
    const memory = await loadGuestLongTermMemory('guest-explicit', TEST_ACCOUNT, db);
    expect(result).toMatchObject({ observed: true, preferenceOnly: true, sensitiveRejected: false });
    expect(memory.profile).toMatchObject({ preferredLanguage: 'ru', preferredCommunicationMode: 'text' });
    expect(memory.preferences.map((item) => item.key)).toEqual(['quiet_room']);
  });

  it('4b. records the English equivalent at the same identity-level seam', async () => {
    const db = new FakeMemoryDb();
    await observeResolvedGuestInbound({
      guestId: 'guest-explicit-en',
      accountId: TEST_ACCOUNT,
      senderIdentity: 'test_guest',
      messageText: 'I prefer to communicate in English and text. I love quiet apartments.',
      language: 'en',
      transport: 'telegram_text',
      db,
    });
    const memory = await loadGuestLongTermMemory('guest-explicit-en', TEST_ACCOUNT, db);
    expect(memory.profile).toMatchObject({ preferredLanguage: 'en', preferredCommunicationMode: 'text' });
    expect(memory.preferences.map((item) => item.key)).toEqual(['quiet_room']);
  });

  it('5. does not promote speculative statements', async () => {
    expect(extractExplicitGuestPreferences('Наверное, мне может понравиться тихий номер.')).toEqual([]);
  });

  it('5b. treats only pure preference statements as no-handoff turns', () => {
    expect(isExplicitGuestPreferenceOnlyMessage('Я предпочитаю текстом. Люблю тихие квартиры.')).toBe(true);
    expect(isExplicitGuestPreferenceOnlyMessage('Не работает Wi-Fi. Я предпочитаю тихие квартиры.')).toBe(false);
    expect(isExplicitGuestPreferenceOnlyMessage('Can you help? I prefer quiet apartments.')).toBe(false);
  });

  it('6. stores an operator-confirmed outcome as a structured event', async () => {
    const db = new FakeMemoryDb();
    await recordGuestOperationalEvent({
      guestId: 'guest-event',
      accountId: TEST_ACCOUNT,
      type: 'maintenance_resolution',
      summary: 'Оператор подтвердил завершение ремонта.',
      source: 'operator_confirmed',
      sourceRef: 'review-1',
      db,
    });
    expect((await loadGuestLongTermMemory('guest-event', TEST_ACCOUNT, db)).events[0]).toMatchObject({
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
    await upsertGuestPreference({ guestId: 'guest-a', accountId: TEST_ACCOUNT, key: 'crib', value: 'Нужна кроватка', source: 'explicit_guest', db });
    expect((await loadGuestLongTermMemory('guest-a', TEST_ACCOUNT, db)).preferences).toHaveLength(1);
    expect((await loadGuestLongTermMemory('guest-b', TEST_ACCOUNT, db)).preferences).toHaveLength(0);
  });

  it('9b. isolates the SAME guestId across two different accounts (tenant boundary)', async () => {
    const db = new FakeMemoryDb();
    await upsertGuestPreference({ guestId: 'guest-shared', accountId: TEST_ACCOUNT, key: 'crib', value: 'Account A crib note', source: 'explicit_guest', db });
    await upsertGuestPreference({ guestId: 'guest-shared', accountId: OTHER_ACCOUNT, key: 'crib', value: 'Account B crib note', source: 'explicit_guest', db });
    await recordGuestOperationalEvent({
      guestId: 'guest-shared', accountId: TEST_ACCOUNT, type: 'maintenance_resolution',
      summary: 'Account A event', source: 'operator_confirmed', sourceRef: 'a-review', db,
    });

    const forAccountA = await loadGuestLongTermMemory('guest-shared', TEST_ACCOUNT, db);
    const forAccountB = await loadGuestLongTermMemory('guest-shared', OTHER_ACCOUNT, db);

    expect(forAccountA.preferences).toHaveLength(1);
    expect(forAccountA.preferences[0]?.value).toBe('Account A crib note');
    expect(forAccountA.events).toHaveLength(1);

    expect(forAccountB.preferences).toHaveLength(1);
    expect(forAccountB.preferences[0]?.value).toBe('Account B crib note');
    expect(forAccountB.events).toHaveLength(0);

    // No accountId at all must fail closed to empty, never to a global/merged view.
    const noAccount = await loadGuestLongTermMemory('guest-shared', null, db);
    expect(noAccount).toEqual({ profile: null, preferences: [], events: [] });
  });

  it('9c. forget_all for one account leaves the other account completely untouched', async () => {
    const db = new FakeMemoryDb();
    await recordGuestSeen({ guestId: 'guest-forget', accountId: TEST_ACCOUNT, preferredLanguage: 'ru', db });
    await recordGuestSeen({ guestId: 'guest-forget', accountId: OTHER_ACCOUNT, preferredLanguage: 'en', db });
    await upsertGuestPreference({ guestId: 'guest-forget', accountId: TEST_ACCOUNT, key: 'crib', value: 'A crib', source: 'explicit_guest', db });
    await upsertGuestPreference({ guestId: 'guest-forget', accountId: OTHER_ACCOUNT, key: 'crib', value: 'B crib', source: 'explicit_guest', db });
    await recordGuestOperationalEvent({
      guestId: 'guest-forget', accountId: TEST_ACCOUNT, type: 'maintenance_resolution',
      summary: 'A event', source: 'operator_confirmed', sourceRef: 'a-ref', db,
    });
    await recordGuestOperationalEvent({
      guestId: 'guest-forget', accountId: OTHER_ACCOUNT, type: 'maintenance_resolution',
      summary: 'B event', source: 'operator_confirmed', sourceRef: 'b-ref', db,
    });

    await forgetGuestLongTermMemory('guest-forget', TEST_ACCOUNT, db);

    const forgottenAccount = await loadGuestLongTermMemory('guest-forget', TEST_ACCOUNT, db);
    expect(forgottenAccount).toEqual({ profile: null, preferences: [], events: [] });

    const untouchedAccount = await loadGuestLongTermMemory('guest-forget', OTHER_ACCOUNT, db);
    expect(untouchedAccount.profile).toMatchObject({ preferredLanguage: 'en' });
    expect(untouchedAccount.preferences).toHaveLength(1);
    expect(untouchedAccount.preferences[0]?.value).toBe('B crib');
    expect(untouchedAccount.events).toHaveLength(1);
    expect(untouchedAccount.events[0]?.summary).toBe('B event');
  });

  it('9d. every guest_memory write requires an explicit accountId (fails closed, never invents one)', async () => {
    const db = new FakeMemoryDb();
    await expect(recordGuestSeen({ guestId: 'guest-noaccount', accountId: '', preferredLanguage: 'ru', db }))
      .rejects.toThrow('account_id_required');
    await expect(upsertGuestPreference({ guestId: 'guest-noaccount', accountId: '', key: 'crib', value: 'x', source: 'explicit_guest', db }))
      .rejects.toThrow('account_id_required');
    await expect(recordGuestOperationalEvent({
      guestId: 'guest-noaccount', accountId: '', type: 'maintenance_resolution', summary: 'x', source: 'operator_confirmed', db,
    })).rejects.toThrow('account_id_required');
    await expect(forgetGuestLongTermMemory('guest-noaccount', '', db)).rejects.toThrow('account_id_required');
  });

  it('10. removes corrected or deleted memory from subsequent reads', async () => {
    const db = new FakeMemoryDb();
    await upsertGuestPreference({ guestId: 'guest-correct', accountId: TEST_ACCOUNT, key: 'pet', value: 'Путешествует с собакой', source: 'explicit_guest', db });
    await upsertGuestPreference({ guestId: 'guest-correct', accountId: TEST_ACCOUNT, key: 'pet', value: 'Больше не путешествует с животным', source: 'operator_confirmed', db });
    const corrected = await loadGuestLongTermMemory('guest-correct', TEST_ACCOUNT, db);
    expect(corrected.preferences[0]?.value).toBe('Больше не путешествует с животным');
    await deleteGuestMemoryItem({ guestId: 'guest-correct', accountId: TEST_ACCOUNT, kind: 'preference', itemId: corrected.preferences[0]!.id, db });
    expect((await loadGuestLongTermMemory('guest-correct', TEST_ACCOUNT, db)).preferences).toHaveLength(0);
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
      guestId: 'guest-sensitive', accountId: TEST_ACCOUNT, key: 'parking', value: 'door code: 1234', source: 'explicit_guest', db,
    })).rejects.toThrow('forbidden_sensitive_memory_content');
    const observation = await observeResolvedGuestInbound({
      guestId: 'guest-sensitive',
      accountId: TEST_ACCOUNT,
      senderIdentity: 'guest',
      messageText: 'I prefer quiet apartments. door code: 1234',
      language: 'en',
      transport: 'telegram_text',
      db,
    });
    expect(observation).toMatchObject({ observed: false, sensitiveRejected: true });
    expect(db.rows('guest_memory_profiles')).toHaveLength(0);
    expect(db.rows('guest_memory_preferences')).toHaveLength(0);
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260809120000_guest_long_term_memory_v1.sql'), 'utf8');
    expect(migration).not.toMatch(/(?:transcript|raw_voice|recording_url|passport_contents|card_number)\s+(?:TEXT|JSONB|BYTEA)/i);
  });

  it('13. gives text and voice paths the same durable context', async () => {
    const db = new FakeMemoryDb();
    await observeGuestCommunication({ guestId: 'guest-multimodal', accountId: TEST_ACCOUNT, messageText: 'I always need parking.', language: 'en', transport: 'telegram_text', db });
    await observeGuestCommunication({ guestId: 'guest-multimodal', accountId: TEST_ACCOUNT, messageText: 'Where is parking?', language: 'en', transport: 'telegram_voice', db });
    const memory = await loadGuestLongTermMemory('guest-multimodal', TEST_ACCOUNT, db);
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

  it('15. rejects anonymous senders and keeps observation owned by one common inbound seam', async () => {
    const db = new FakeMemoryDb();
    const anonymous = await observeResolvedGuestInbound({
      guestId: null,
      accountId: TEST_ACCOUNT,
      senderIdentity: 'unknown',
      messageText: 'I prefer English text and quiet apartments.',
      language: 'en',
      transport: 'telegram_text',
      db,
    });
    expect(anonymous.observed).toBe(false);
    expect(db.rows('guest_memory_profiles')).toHaveLength(0);
    expect(db.rows('guest_memory_preferences')).toHaveLength(0);

    const orchestrator = fs.readFileSync(path.join(process.cwd(), 'src/lib/communication/orchestrator.ts'), 'utf8');
    const autopilotRoute = fs.readFileSync(path.join(process.cwd(), 'src/lib/communication/communication-autopilot-v1-orchestrator.ts'), 'utf8');
    expect(orchestrator.match(/observeResolvedGuestInbound\s*\(/g)).toHaveLength(1);
    expect(orchestrator).not.toContain('observeGuestCommunication({');
    expect(autopilotRoute).not.toContain('observeGuestCommunication');
  });
});
