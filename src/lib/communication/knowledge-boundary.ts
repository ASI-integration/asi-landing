import { supabase } from '@/lib/supabase';
import {
  resolveCommunicationFacts, communicationFactReviewSummary, sameCommunicationScope, readCommunicationDependency,
  type CommunicationFact, type CommunicationFactScope, type CommunicationFactsResult,
} from './knowledge-provenance';

const topicPatterns: Array<[string, RegExp]> = [
  ['wifi', /wi[ -]?fi|вай.?фай|интернет|пароль/iu],
  ['access', /код.*двер|двер.*код|ключ|доступ|засел|заехать|check.?in|door|keys?|access/iu],
  ['deposit', /залог|депозит|возврат|вернул|оплат|refund|deposit|payment|paid/iu],
  ['contract', /договор|подписан|документ|паспорт|contract|document|passport/iu],
  ['cleaning', /уборк|чистот|cleaning|cleaned/iu],
  ['checkout_time', /выезд|выселен|check.?out/iu],
  ['address', /адрес|address|where.*apartment/iu],
  ['parking', /парков|parking/iu],
  ['house_rules', /правил.*дом|house rules/iu],
];
export function requestedCommunicationFacts(message: string): string[] {
  return topicPatterns.filter(([, pattern]) => pattern.test(message)).map(([key]) => key);
}

/**
 * Routing only: this does not authorize Wi-Fi disclosure. The Telegram booking/object
 * autopilot still requires its own verified reservation before returning credentials.
 */
export function shouldDeferTelegramWifiToVerifiedAutopilot(message: string, channel: string): boolean {
  if (channel !== 'telegram') return false;
  const requested = requestedCommunicationFacts(message);
  return requested.length === 1 && requested[0] === 'wifi';
}
export const KNOWLEDGE_REVIEW_REPLY_RU = 'Не могу подтвердить эти сведения. Нужна проверка оператора.';
export type PreparedKnowledgeReply = {
  text: string; reviewRequired: boolean; result: CommunicationFactsResult; summary: string;
};
export function prepareCommunicationFactReply(result: CommunicationFactsResult, ru = true): PreparedKnowledgeReply {
  const ready = result.ready && result.decisions.length > 0
    && result.decisions.every((decision) => decision.use === 'automatic' && decision.fact);
  return {
    // Render only approved values; no LLM/session/passport string can fill a gap.
    text: ready ? result.decisions.map((decision) => String(decision.fact!.value)).join('\n')
      : ru ? KNOWLEDGE_REVIEW_REPLY_RU : 'I cannot confirm these details. An operator needs to check them.',
    reviewRequired: !ready, result, summary: communicationFactReviewSummary(result),
  };
}
/** An independently re-derived owner after await must still be the ORIGINAL owner. */
export function canDeliverPreparedFacts(initial: PreparedKnowledgeReply, fresh: PreparedKnowledgeReply): boolean {
  return !initial.reviewRequired && !fresh.reviewRequired && initial.text === fresh.text
    && initial.result.decisions.length === fresh.result.decisions.length
    && initial.result.decisions.every((old, index) => {
      const current = fresh.result.decisions[index];
      return old.key === current.key && !!old.fact && !!current.fact
        && sameCommunicationScope(old.fact.scope, current.fact.scope);
    });
}type RuntimeInput = {
  message: string; channel: string; chatId: number; ru: boolean;
  propertyId?: string; reservationId?: string; coverUnclassified?: boolean;
};
type KnowledgeDb = typeof supabase;
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_knowledge_row');
  return value as Row;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('missing_knowledge_identity');
  return value;
}
async function resolveRuntimeScope(input: RuntimeInput, db: KnowledgeDb): Promise<CommunicationFactScope> {
  // V1 automatic facts require the persisted Telegram chat binding, not a guest-supplied booking reference.
  // Other channels explicitly require review until an equivalent authoritative binding adapter exists.
  if (input.channel !== 'telegram' || !Number.isSafeInteger(input.chatId) || input.chatId <= 0) {
    throw new Error('unsupported_knowledge_binding');
  }
  const reservations = await db.from('tg_guest_reservations')
    .select('id,property_id,guest_id,chat_id').eq('chat_id', input.chatId).limit(2);
  if (reservations.error || !Array.isArray(reservations.data) || reservations.data.length !== 1) {
    throw new Error('ambiguous_knowledge_binding');
  }
  const booking = row(reservations.data[0]);
  const propertyId = id(booking.property_id);
  const bookingId = id(booking.id);
  if (String(booking.chat_id) !== String(input.chatId)
    || (input.propertyId && input.propertyId !== propertyId)
    || (input.reservationId && input.reservationId !== bookingId)) throw new Error('foreign_knowledge_binding');
  const property = await db.from('properties').select('id,account_id').eq('id', propertyId).maybeSingle();
  if (property.error || !property.data) throw new Error('unavailable_knowledge_owner');
  const owned = row(property.data);
  if (owned.id !== propertyId) throw new Error('foreign_knowledge_owner');
  return { accountId: id(owned.account_id), propertyId, bookingId,
    guestId: id(booking.guest_id), sessionId: 'telegram:' + input.chatId };
}
const sourceOrigins: Record<string, CommunicationFact['origin']> = {
  owner: 'manual', manager: 'manual', operator: 'manual', cleaner: 'manual',
  system: 'canonical', ota: 'external', guest_report: 'guest', photo: 'inferred',
  mock: 'synthetic', demo: 'synthetic', sample: 'synthetic', synthetic: 'synthetic',
};
export function objectKnowledgeFact(raw: unknown, scope: CommunicationFactScope, now: number): CommunicationFact {
  const entry = row(raw);
  // No alias substitution and no unbound legacy object adoption.
  if (entry.object_id !== scope.propertyId || entry.property_id !== scope.propertyId) {
    throw new Error('foreign_knowledge_entry');
  }
  const observedAt = id(entry.last_verified_at);
  const observed = Date.parse(observedAt);
  const staleDays = entry.stale_after_days;
  const validFrom = entry.valid_from === null ? -Infinity : Date.parse(id(entry.valid_from));
  const validTo = entry.valid_to === null ? Infinity : Date.parse(id(entry.valid_to));
  if (!Number.isFinite(observed) || !Number.isFinite(Number(staleDays)) || Number(staleDays) <= 0
    || Number.isNaN(validFrom) || Number.isNaN(validTo)) throw new Error('invalid_knowledge_freshness');
  if (!Number.isFinite(now)) throw new Error('invalid_knowledge_clock');
  const expires = Math.min(validTo, observed + Number(staleDays) * 86400_000);
  return {
    key: id(entry.key), value: entry.value_text as string,
    scope: { ...scope }, origin: sourceOrigins[String(entry.source_type)] ?? 'unknown',
    source: 'object_knowledge_entries', reference: id(entry.entry_id),
    observedAt,
    ...(Number.isFinite(validFrom) ? { validFrom: new Date(validFrom).toISOString() } : {}),
    validUntil: new Date(expires).toISOString(),
    verified: entry.confidence === 'high' && entry.visibility === 'guest_public',
    sensitivity: entry.sensitivity === 'normal' ? 'normal' : 'access',
  };
}
export async function prepareRuntimeKnowledgeReply(
  rawInput: RuntimeInput, db: KnowledgeDb = supabase, now: () => number = Date.now,
): Promise<PreparedKnowledgeReply | null> {
  const input = Object.freeze({ ...rawInput });
  const requested = requestedCommunicationFacts(input.message);
  const keys = requested.length ? requested : input.coverUnclassified ? ['operational_context'] : [];
  if (!keys.length) return null;
  try {
    const scope = Object.freeze(await readCommunicationDependency(() => resolveRuntimeScope(input, db)));
    const result = await resolveCommunicationFacts({ scope, requestedFacts: keys }, {
      now,
      authorize: async (expected) => {
        const current = await resolveRuntimeScope(input, db);
        return Object.entries(expected).every(([key, value]) => current[key as keyof CommunicationFactScope] === value);
      },
      load: async (expected, requested) => {
        const result = await db.from('object_knowledge_entries').select('*')
          .eq('property_id', expected.propertyId).in('key', [...requested]);
        if (result.error || !Array.isArray(result.data)) throw new Error('knowledge_read_failed');
        return result.data.map((entry) => objectKnowledgeFact(entry, expected, now()));
      },
    });
    return prepareCommunicationFactReply(result, input.ru);
  } catch {
    return prepareCommunicationFactReply({ ready: false,
      decisions: keys.map((key) => ({ key, use: 'unusable', reason: 'dependency_failed' })),
    }, input.ru);
  }
}


/** Closed, context-free social acts need no property facts or LLM prompt.
 * Follow-ups such as "and tomorrow?" still require evidence or human review. */
export function conversationalReply(message: string, ru = true): string | null {
  const text = message.trim().toLowerCase().replace(/[!?.。,]+$/u, '').trim();
  if (/^(?:привет|здравствуйте|добрый день|доброе утро|добрый вечер|hello|hi|hey)$/u.test(text)) {
    return ru ? 'Здравствуйте! Чем могу помочь?' : 'Hello! How can I help?';
  }
  if (/^(?:спасибо|благодарю|thanks|thank you)$/u.test(text)) {
    return ru ? 'Пожалуйста!' : 'You are welcome!';
  }
  if (/^(?:как дела|как ты|how are you|я устал|устал с дороги|хочу отдохнуть|i am tired|i'm tired)$/u.test(text)) {
    return ru ? 'Я здесь, если понадобится помощь. Желаю хорошего отдыха!' : 'I am here if you need help. Have a good rest!';
  }
  if (/^(?:до свидания|пока|goodbye|bye)$/u.test(text)) {
    return ru ? 'До свидания!' : 'Goodbye!';
  }
  return null;
}
