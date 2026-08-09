import { supabase } from '@/lib/supabase';

export const GUEST_MEMORY_MAX_PREFERENCES = 12;
export const GUEST_MEMORY_MAX_EVENTS = 50;
export const GUEST_MEMORY_CONTEXT_MAX_EVENTS = 3;

export type GuestMemoryLanguage = 'ru' | 'en';
export type GuestCommunicationMode = 'text' | 'voice';
export type GuestPreferenceKey =
  | 'quiet_room'
  | 'parking'
  | 'late_checkout'
  | 'accessibility'
  | 'crib'
  | 'pet';
export type GuestMemoryEventType =
  | 'completed_stay'
  | 'booking_verified'
  | 'maintenance_resolution'
  | 'operator_confirmed_resolution'
  | 'refund_outcome'
  | 'access_incident'
  | 'house_rule_violation'
  | 'late_checkout_history';
export type GuestMemorySource =
  | 'explicit_guest'
  | 'verified_booking'
  | 'operator_confirmed'
  | 'deterministic_system';

export type GuestMemoryProfile = {
  guestId: string;
  preferredLanguage: GuestMemoryLanguage | null;
  preferredCommunicationMode: GuestCommunicationMode | null;
  stayCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastStayAt: string | null;
};

export type GuestMemoryPreference = {
  id: string;
  key: GuestPreferenceKey;
  value: string;
  source: GuestMemorySource;
  sourceRef: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type GuestMemoryEvent = {
  id: string;
  type: GuestMemoryEventType;
  summary: string;
  bookingReference: string | null;
  source: Exclude<GuestMemorySource, 'explicit_guest'>;
  sourceRef: string | null;
  confidence: number;
  occurredAt: string;
  createdAt: string;
  historyOnly: boolean;
};

export type GuestLongTermMemory = {
  profile: GuestMemoryProfile | null;
  preferences: GuestMemoryPreference[];
  events: GuestMemoryEvent[];
};

export type RelevantGuestMemoryContext = {
  preferredLanguage: GuestMemoryLanguage | null;
  preferredCommunicationMode: GuestCommunicationMode | null;
  returningGuest: boolean;
  stayCount: number;
  lastStayAt: string | null;
  preferences: GuestMemoryPreference[];
  events: GuestMemoryEvent[];
};

export type GuestMemoryInboundObservation = {
  observed: boolean;
  preferenceOnly: boolean;
  sensitiveRejected: boolean;
};

type SupabaseLike = { from: (table: string) => any };

const PREFERENCE_KEYS = new Set<GuestPreferenceKey>([
  'quiet_room',
  'parking',
  'late_checkout',
  'accessibility',
  'crib',
  'pet',
]);
const EVENT_TYPES = new Set<GuestMemoryEventType>([
  'completed_stay',
  'booking_verified',
  'maintenance_resolution',
  'operator_confirmed_resolution',
  'refund_outcome',
  'access_incident',
  'house_rule_violation',
  'late_checkout_history',
]);
const SOURCES = new Set<GuestMemorySource>([
  'explicit_guest',
  'verified_booking',
  'operator_confirmed',
  'deterministic_system',
]);

function boundedText(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeGuestId(value: unknown): string {
  const guestId = boundedText(value, 120);
  if (!guestId) throw new Error('guest_id_required');
  return guestId;
}

function safeSourceRef(value: unknown): string | null {
  const sourceRef = boundedText(value, 160);
  return sourceRef || null;
}

function safeConfidence(value: unknown): number {
  const confidence = Number(value ?? 1);
  if (!Number.isFinite(confidence)) return 1;
  return Math.max(0, Math.min(1, confidence));
}

export function containsForbiddenGuestMemoryContent(value: unknown): boolean {
  const text = String(value ?? '');
  const compactDigits = text.replace(/[^0-9]/g, '');
  return (
    /(?:door[_\s-]?code|код\s+(?:двери|замка)|парол[ья])\s*[:=]\s*\S+/iu.test(text) ||
    /(?:passport|паспорт|document[_\s-]?contents?|данные\s+документ)/iu.test(text) ||
    /(?:raw[_\s-]?(?:voice|audio)|recording[_\s-]?url|transcript[_\s-]?(?:body|text)|полная\s+расшифровка)/iu.test(text) ||
    /(?:card[_\s-]?(?:number|data)|cvv|cvc|данные\s+карт)/iu.test(text) ||
    compactDigits.length >= 13
  );
}

function assertSafeMemoryText(value: unknown, max: number, field: string): string {
  const text = boundedText(value, max);
  if (!text) throw new Error(`${field}_required`);
  if (containsForbiddenGuestMemoryContent(text)) throw new Error('forbidden_sensitive_memory_content');
  return text;
}

async function responseData(query: any): Promise<any> {
  const response = typeof query?.then === 'function' ? await query : await Promise.resolve(query);
  if (response?.error) throw new Error(response.error.message ?? 'guest_memory_query_failed');
  return response?.data ?? null;
}

async function maybeOne(query: any): Promise<any | null> {
  const response = typeof query?.maybeSingle === 'function' ? await query.maybeSingle() : await query;
  if (response?.error && response.error.code !== 'PGRST116') {
    throw new Error(response.error.message ?? 'guest_memory_query_failed');
  }
  const data = response?.data ?? null;
  return Array.isArray(data) ? data[0] ?? null : data;
}

function profileFromRow(row: any): GuestMemoryProfile | null {
  if (!row?.guest_id) return null;
  return {
    guestId: String(row.guest_id),
    preferredLanguage: row.preferred_language === 'ru' || row.preferred_language === 'en'
      ? row.preferred_language
      : null,
    preferredCommunicationMode: row.preferred_communication_mode === 'voice' || row.preferred_communication_mode === 'text'
      ? row.preferred_communication_mode
      : null,
    stayCount: Math.max(0, Number(row.stay_count) || 0),
    firstSeenAt: String(row.first_seen_at ?? row.created_at ?? ''),
    lastSeenAt: String(row.last_seen_at ?? row.updated_at ?? ''),
    lastStayAt: row.last_stay_at ? String(row.last_stay_at) : null,
  };
}

function preferenceFromRow(row: any): GuestMemoryPreference | null {
  if (!row?.id || !PREFERENCE_KEYS.has(row.preference_key)) return null;
  if (!SOURCES.has(row.source_kind)) return null;
  return {
    id: String(row.id),
    key: row.preference_key,
    value: boundedText(row.preference_value, 240),
    source: row.source_kind,
    sourceRef: row.source_ref ? String(row.source_ref) : null,
    confidence: safeConfidence(row.confidence),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function eventFromRow(row: any): GuestMemoryEvent | null {
  if (!row?.id || !EVENT_TYPES.has(row.event_type)) return null;
  if (!SOURCES.has(row.source_kind) || row.source_kind === 'explicit_guest') return null;
  return {
    id: String(row.id),
    type: row.event_type,
    summary: boundedText(row.summary, 600),
    bookingReference: row.booking_reference ? boundedText(row.booking_reference, 80) : null,
    source: row.source_kind,
    sourceRef: row.source_ref ? String(row.source_ref) : null,
    confidence: safeConfidence(row.confidence),
    occurredAt: String(row.occurred_at ?? row.created_at ?? ''),
    createdAt: String(row.created_at ?? ''),
    historyOnly: row.event_type === 'late_checkout_history',
  };
}

export function boundGuestLongTermMemory(memory: GuestLongTermMemory): GuestLongTermMemory {
  const preferences = memory.preferences
    .filter((item) => PREFERENCE_KEYS.has(item.key))
    .slice(0, GUEST_MEMORY_MAX_PREFERENCES);
  const events = memory.events
    .filter((item) => EVENT_TYPES.has(item.type))
    .slice(0, GUEST_MEMORY_MAX_EVENTS);
  return { profile: memory.profile, preferences, events };
}

export async function loadGuestLongTermMemory(
  guestIdInput: string,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<GuestLongTermMemory> {
  const guestId = safeGuestId(guestIdInput);
  const [profileRow, preferenceRows, eventRows] = await Promise.all([
    maybeOne(db.from('guest_memory_profiles').select('*').eq('guest_id', guestId)),
    responseData(
      db.from('guest_memory_preferences')
        .select('*')
        .eq('guest_id', guestId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(GUEST_MEMORY_MAX_PREFERENCES),
    ),
    responseData(
      db.from('guest_memory_events')
        .select('*')
        .eq('guest_id', guestId)
        .eq('status', 'active')
        .order('occurred_at', { ascending: false })
        .limit(GUEST_MEMORY_MAX_EVENTS),
    ),
  ]);
  return boundGuestLongTermMemory({
    profile: profileFromRow(profileRow),
    preferences: (Array.isArray(preferenceRows) ? preferenceRows : []).map(preferenceFromRow).filter(Boolean) as GuestMemoryPreference[],
    events: (Array.isArray(eventRows) ? eventRows : []).map(eventFromRow).filter(Boolean) as GuestMemoryEvent[],
  });
}

export async function recordGuestSeen(input: {
  guestId: string;
  preferredLanguage?: GuestMemoryLanguage | null;
  preferredCommunicationMode?: GuestCommunicationMode | null;
  source?: 'explicit_guest' | 'deterministic_system';
  seenAt?: string;
  db?: SupabaseLike;
}): Promise<void> {
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  const source = input.source ?? 'deterministic_system';
  const record: Record<string, unknown> = {
    guest_id: safeGuestId(input.guestId),
    last_seen_at: input.seenAt ?? new Date().toISOString(),
  };
  if (input.preferredLanguage === 'ru' || input.preferredLanguage === 'en') {
    record.preferred_language = input.preferredLanguage;
    record.preferred_language_source = source;
  }
  if (input.preferredCommunicationMode === 'text' || input.preferredCommunicationMode === 'voice') {
    record.preferred_communication_mode = input.preferredCommunicationMode;
    record.preferred_communication_mode_source = source;
  }
  await responseData(db.from('guest_memory_profiles').upsert(record, { onConflict: 'guest_id' }));
}

export async function upsertGuestPreference(input: {
  guestId: string;
  key: GuestPreferenceKey;
  value: string;
  source: GuestMemorySource;
  sourceRef?: string | null;
  confidence?: number;
  db?: SupabaseLike;
}): Promise<void> {
  if (!PREFERENCE_KEYS.has(input.key)) throw new Error('unsupported_preference_key');
  if (!SOURCES.has(input.source)) throw new Error('unsupported_memory_source');
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  await responseData(db.from('guest_memory_preferences').upsert({
    guest_id: safeGuestId(input.guestId),
    preference_key: input.key,
    preference_value: assertSafeMemoryText(input.value, 240, 'preference_value'),
    source_kind: input.source,
    source_ref: safeSourceRef(input.sourceRef),
    confidence: safeConfidence(input.confidence),
    status: 'active',
  }, { onConflict: 'guest_id,preference_key' }));
}

export async function recordGuestOperationalEvent(input: {
  guestId: string;
  type: GuestMemoryEventType;
  summary: string;
  source: Exclude<GuestMemorySource, 'explicit_guest'>;
  sourceRef?: string | null;
  bookingReference?: string | null;
  confidence?: number;
  occurredAt?: string;
  db?: SupabaseLike;
}): Promise<void> {
  if (!EVENT_TYPES.has(input.type)) throw new Error('unsupported_memory_event_type');
  if (!SOURCES.has(input.source)) {
    throw new Error('unverified_memory_event_source');
  }
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  await responseData(db.from('guest_memory_events').insert({
    guest_id: safeGuestId(input.guestId),
    event_type: input.type,
    summary: assertSafeMemoryText(input.summary, 600, 'event_summary'),
    booking_reference: input.bookingReference ? assertSafeMemoryText(input.bookingReference, 80, 'booking_reference') : null,
    source_kind: input.source,
    source_ref: safeSourceRef(input.sourceRef),
    confidence: safeConfidence(input.confidence),
    status: 'active',
    occurred_at: input.occurredAt ?? new Date().toISOString(),
  }));
}

export async function correctGuestOperationalEvent(input: {
  guestId: string;
  itemId: string;
  summary: string;
  sourceRef?: string | null;
  db?: SupabaseLike;
}): Promise<void> {
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  await responseData(
    db.from('guest_memory_events')
      .update({
        summary: assertSafeMemoryText(input.summary, 600, 'event_summary'),
        source_kind: 'operator_confirmed',
        source_ref: safeSourceRef(input.sourceRef),
        confidence: 1,
        status: 'active',
      })
      .eq('guest_id', safeGuestId(input.guestId))
      .eq('id', boundedText(input.itemId, 80)),
  );
}

export async function deleteGuestMemoryItem(input: {
  guestId: string;
  kind: 'preference' | 'event';
  itemId: string;
  db?: SupabaseLike;
}): Promise<void> {
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  const table = input.kind === 'preference' ? 'guest_memory_preferences' : 'guest_memory_events';
  await responseData(
    db.from(table)
      .update({ status: 'deleted' })
      .eq('guest_id', safeGuestId(input.guestId))
      .eq('id', boundedText(input.itemId, 80)),
  );
}

export async function forgetGuestLongTermMemory(
  guestIdInput: string,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<void> {
  const guestId = safeGuestId(guestIdInput);
  await responseData(db.from('guest_memory_preferences').delete().eq('guest_id', guestId));
  await responseData(db.from('guest_memory_events').delete().eq('guest_id', guestId));
  await responseData(db.from('guest_memory_profiles').delete().eq('guest_id', guestId));
}

const RELEVANCE: Record<GuestPreferenceKey | GuestMemoryEventType, RegExp> = {
  quiet_room: /тих|тиш|шум|quiet|noise/iu,
  parking: /парков|машин|parking|car/iu,
  late_checkout: /поздн.*выезд|выезд.*поздн|late\s+check.?out/iu,
  accessibility: /доступн|коляск|пандус|лифт|accessib|wheelchair/iu,
  crib: /кроватк|младен|реб[её]н|crib|baby/iu,
  pet: /животн|собак|кошк|\bpets?\b|\bdogs?\b|\bcats?\b/iu,
  completed_stay: /прожив|брон|stay|booking/iu,
  booking_verified: /брон|booking|reservation/iu,
  maintenance_resolution: /ремонт|не\s+работ|полом|maintenance|broken/iu,
  operator_confirmed_resolution: /соглас|решен|оператор|agreement|operator/iu,
  refund_outcome: /возврат|компенсац|refund|compensation/iu,
  access_incident: /доступ|замок|не\s+могу\s+войти|access|lockout|lock/iu,
  house_rule_violation: /правил|тишин|курен|вечерин|rule|noise|smok/iu,
  late_checkout_history: /поздн.*выезд|late\s+check.?out/iu,
};

export function buildRelevantGuestMemoryContext(
  memory: GuestLongTermMemory,
  requestText: string,
): RelevantGuestMemoryContext {
  const bounded = boundGuestLongTermMemory(memory);
  const text = boundedText(requestText, 2_000);
  const firstSeenMs = Date.parse(bounded.profile?.firstSeenAt ?? '');
  const lastSeenMs = Date.parse(bounded.profile?.lastSeenAt ?? '');
  const returnedAfterSessionWindow = Number.isFinite(firstSeenMs) && Number.isFinite(lastSeenMs)
    ? lastSeenMs - firstSeenMs >= 24 * 60 * 60 * 1_000
    : false;
  const preferences = text
    ? bounded.preferences.filter((item) => RELEVANCE[item.key].test(text))
    : bounded.preferences;
  const events = (text
    ? bounded.events.filter((item) => RELEVANCE[item.type].test(text))
    : bounded.events
  ).slice(0, GUEST_MEMORY_CONTEXT_MAX_EVENTS);
  return {
    preferredLanguage: bounded.profile?.preferredLanguage ?? null,
    preferredCommunicationMode: bounded.profile?.preferredCommunicationMode ?? null,
    returningGuest: returnedAfterSessionWindow || (bounded.profile?.stayCount ?? 0) > 0,
    stayCount: bounded.profile?.stayCount ?? 0,
    lastStayAt: bounded.profile?.lastStayAt ?? null,
    preferences,
    events,
  };
}

function clearlyUsesLanguage(text: string): GuestMemoryLanguage | null {
  const naturalWords = text.match(/[A-Za-zА-Яа-яЁё]{2,}/g) ?? [];
  if (naturalWords.length < 2) return null;
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillic >= 3 && cyrillic > latin * 1.5) return 'ru';
  if (latin >= 3 && latin > cyrillic * 1.5) return 'en';
  return null;
}

export function resolveLanguageWithGuestMemory(input: {
  messageText: string;
  detectedLanguage: GuestMemoryLanguage;
  memory: RelevantGuestMemoryContext | null | undefined;
}): GuestMemoryLanguage {
  if (/\b(?:switch|reply|speak)\s+(?:to|in)\s+(?:english|russian)\b|\b(?:english|russian) please\b|(?:переключись|ответь|говори).*(?:на\s+)?(?:английск|русск)/iu.test(input.messageText)) {
    return input.detectedLanguage;
  }
  const fragment = String(input.messageText ?? '').trim();
  if (
    /^(?=.{4,40}$)(?=.*\d)[A-ZА-Я0-9][A-ZА-Я0-9._/-]*$/iu.test(fragment) ||
    /^(?:до\s+|к\s+|until\s+|at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?$/iu.test(fragment)
  ) {
    return input.detectedLanguage;
  }
  return clearlyUsesLanguage(input.messageText) ?? input.memory?.preferredLanguage ?? input.detectedLanguage;
}

export function extractExplicitGuestPreferences(messageText: string): Array<{
  key: GuestPreferenceKey;
  value: string;
}> {
  const text = boundedText(messageText, 1_000);
  if (!text || /\b(?:может|возможно|наверное|probably|maybe|might)\b/iu.test(text)) return [];
  const explicit = /(?:я\s+(?:всегда\s+)?(?:предпочитаю|люблю|обычно\s+прошу)|мне\s+(?:всегда\s+)?нужн|i\s+(?:always\s+)?prefer|i\s+(?:usually|always)\s+need)/iu.test(text);
  if (!explicit) return [];
  const found: Array<{ key: GuestPreferenceKey; value: string }> = [];
  if (/тих|тиш|quiet/iu.test(text)) found.push({ key: 'quiet_room', value: 'Предпочитает тихое размещение' });
  if (/парков|parking/iu.test(text)) found.push({ key: 'parking', value: 'Обычно нужна парковка' });
  if (/поздн.*выезд|late\s+check.?out/iu.test(text)) found.push({ key: 'late_checkout', value: 'Часто запрашивает поздний выезд' });
  if (/пандус|коляск|доступн|wheelchair|accessib/iu.test(text)) found.push({ key: 'accessibility', value: 'Нужны условия доступности' });
  if (/кроватк|crib/iu.test(text)) found.push({ key: 'crib', value: 'Обычно нужна детская кроватка' });
  if (/животн|собак|кошк|\bpets?\b|\bdogs?\b|\bcats?\b/iu.test(text)) found.push({ key: 'pet', value: 'Путешествует с животным' });
  return found.slice(0, 3);
}

function extractExplicitProfilePreferences(messageText: string): {
  language: GuestMemoryLanguage | null;
  mode: GuestCommunicationMode | null;
} {
  const text = boundedText(messageText, 1_000);
  const explicit = /(?:предпочитаю|прошу|хочу|люблю|i\s+(?:would\s+)?prefer|please)/iu.test(text);
  if (!explicit) return { language: null, mode: null };
  const language = /(?:по-русски|на\s+русск|in\s+russian|russian\s+(?:language|please))/iu.test(text)
    ? 'ru'
    : /(?:по-английски|на\s+английск|in\s+english|english\s+(?:language|please))/iu.test(text)
      ? 'en'
      : null;
  const mode = /(?:текстом|текстов(?:ые|ыми)\s+сообщени|(?:by|via|and)\s+text|text\s+messages?)/iu.test(text)
    ? 'text'
    : /(?:голосом|голосов(?:ые|ыми)\s+сообщени|by\s+voice|voice\s+messages?)/iu.test(text)
      ? 'voice'
      : null;
  return { language, mode };
}

export function isExplicitGuestPreferenceOnlyMessage(messageText: string): boolean {
  const text = boundedText(messageText, 1_000);
  const profile = extractExplicitProfilePreferences(text);
  const preferences = extractExplicitGuestPreferences(text);
  if (!profile.language && !profile.mode && preferences.length === 0) return false;
  return !(
    /\?/u.test(text) ||
    /(?:не\s+работ|сломал|проблем|сроч|помог|подскаж|где\b|когда\b|как\b|почему\b|можно\s+ли|can\s+you|could\s+you|where\b|when\b|how\b|why\b|doesn['’]?t\s+work|not\s+working|broken|urgent|help\b)/iu.test(text)
  );
}

export async function observeGuestCommunication(input: {
  guestId: string;
  messageText: string;
  language: GuestMemoryLanguage;
  transport: string;
  sourceRef?: string | null;
  db?: SupabaseLike;
}): Promise<void> {
  if (containsForbiddenGuestMemoryContent(input.messageText)) {
    throw new Error('forbidden_sensitive_memory_content');
  }
  const explicitProfile = extractExplicitProfilePreferences(input.messageText);
  const mode: GuestCommunicationMode = explicitProfile.mode ?? (/voice|phone|audio/i.test(input.transport) ? 'voice' : 'text');
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  const preferences = extractExplicitGuestPreferences(input.messageText);
  await recordGuestSeen({
    guestId: input.guestId,
    preferredLanguage: explicitProfile.language ?? clearlyUsesLanguage(input.messageText) ?? input.language,
    preferredCommunicationMode: mode,
    source: 'deterministic_system',
    db,
  });
  await Promise.all(preferences.map((preference) => upsertGuestPreference({
    guestId: input.guestId,
    ...preference,
    source: 'explicit_guest',
    sourceRef: input.sourceRef,
    confidence: 1,
    db,
  })));
}

export async function observeResolvedGuestInbound(input: {
  guestId: string | null | undefined;
  senderIdentity: string | null | undefined;
  messageText: string;
  language: GuestMemoryLanguage;
  transport: string;
  sourceRef?: string | null;
  db?: SupabaseLike;
}): Promise<GuestMemoryInboundObservation> {
  const eligible = Boolean(input.guestId) && (input.senderIdentity === 'guest' || input.senderIdentity === 'test_guest');
  if (!eligible) return { observed: false, preferenceOnly: false, sensitiveRejected: false };
  if (containsForbiddenGuestMemoryContent(input.messageText)) {
    return { observed: false, preferenceOnly: false, sensitiveRejected: true };
  }
  await observeGuestCommunication({
    guestId: input.guestId!,
    messageText: input.messageText,
    language: input.language,
    transport: input.transport,
    sourceRef: input.sourceRef,
    db: input.db,
  });
  return {
    observed: true,
    preferenceOnly: isExplicitGuestPreferenceOnlyMessage(input.messageText),
    sensitiveRejected: false,
  };
}

export async function loadRelevantGuestMemory(input: {
  guestId: string | null | undefined;
  requestText: string;
  db?: SupabaseLike;
}): Promise<RelevantGuestMemoryContext | null> {
  if (!input.guestId) return null;
  try {
    const memory = await loadGuestLongTermMemory(input.guestId, input.db);
    return buildRelevantGuestMemoryContext(memory, input.requestText);
  } catch (error) {
    console.warn('[guest-long-term-memory] load failed', {
      guestId: boundedText(input.guestId, 120),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
