import { getAutonomousSessionOperationalCaseV1, setAutonomousSessionOperationalCaseV1 } from './conversation-session-store';
import type { CommunicationChannel, TelegramOperationalSessionCaseStatusV1, TelegramOperationalSessionCaseV1 } from './types';
import { tryTelegramOperationalIntake, type TelegramOperationalFinalAction, type TelegramOperationalIntakeHit } from './telegram-operational-intake';
import { matchTelegramOperationalEntitiesV1 } from './telegram-operational-matching';
import { loadTelegramPropertyKnowledgeV1, logTelegramPropertyKnowledgeLookup } from './telegram-property-knowledge';

type SurfaceLang = 'en' | 'ru';

export type TelegramSessionMemoryResult =
  | {
      handled: true;
      hit: TelegramOperationalIntakeHit;
      case: TelegramOperationalSessionCaseV1;
      /** Whether we updated/merged an existing case, vs starting a new one. */
      mode: 'new_case' | 'merge_case' | 'followup_fragment';
    }
  | { handled: false };

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function logSessionMemoryUpdate(params: {
  session_id: number;
  update_id: number;
  previous_state: TelegramOperationalSessionCaseV1 | null;
  new_state: TelegramOperationalSessionCaseV1;
  merged_facts: Record<string, unknown>;
  remaining_missing_facts: string[];
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'session_memory_update',
        session_id: params.session_id,
        previous_state: params.previous_state,
        new_state: params.new_state,
        merged_facts: params.merged_facts,
        remaining_missing_facts: params.remaining_missing_facts,
        update_id: `tg:${params.session_id}:${params.update_id}`,
      }),
    );
  } catch {
    // never throw from logging
  }
}

function buildEscalationSummaryForCase(params: {
  category: string | undefined;
  extractedFacts: Record<string, unknown>;
  missingFacts: string[];
}): string {
  const cat = params.category ?? 'unknown';
  const facts = params.extractedFacts ?? {};
  const missing = params.missingFacts ?? [];
  const guest = (facts as any).guest_name ?? (facts as any).guestName ?? null;
  const prop = (facts as any).property_hint ?? (facts as any).property ?? null;
  const time = (facts as any).time_hint ?? (facts as any).requestedTime ?? null;
  const parts: string[] = [
    `category=${cat}`,
    guest ? `guest=${String(guest)}` : null,
    prop ? `property=${String(prop)}` : null,
    time ? `time=${String(time)}` : null,
    missing.length > 0 ? `missing=${missing.join(',')}` : null,
  ].filter(Boolean) as string[];
  return parts.join('; ');
}

function buildOperatorEscalationSummaryV1(params: {
  scenario: string;
  urgency: 'normal' | 'urgent';
  extractedFacts: Record<string, unknown>;
  missingFacts: string[];
  matchConfidence: string | null;
  matchedReservationId: string | null;
  matchedPropertyLabel: string | null;
}): string {
  const facts = params.extractedFacts ?? {};
  const guest = (facts as any).guest_name ?? (facts as any).guestName ?? null;
  const propertyHint = (facts as any).property_hint ?? (facts as any).property ?? null;
  const addressHint = (facts as any).address_hint ?? null;
  const timeHint = (facts as any).time_hint ?? (facts as any).requestedTime ?? null;
  const knownFacts: string[] = [];
  if (guest) knownFacts.push(`guest_name=${String(guest)}`);
  if (propertyHint) knownFacts.push(`property_hint=${String(propertyHint)}`);
  if (addressHint) knownFacts.push(`address_hint=${String(addressHint)}`);
  if (timeHint) knownFacts.push(`time_hint=${String(timeHint)}`);

  const missingFacts = (params.missingFacts ?? []).map(String);
  const suggestedNextAction =
    params.urgency === 'urgent'
      ? 'Handle urgently: contact guest and validate access/service immediately.'
      : 'Resolve: confirm property/reservation context, then proceed with scenario playbook.';

  return [
    `scenario=${params.scenario}`,
    `urgency=${params.urgency}`,
    guest ? `guest_name=${String(guest)}` : 'guest_name=unknown',
    params.matchedPropertyLabel ? `property=${params.matchedPropertyLabel}` : propertyHint ? `property=${String(propertyHint)}` : 'property=unknown',
    params.matchedReservationId ? `reservation_id=${params.matchedReservationId}` : 'reservation_id=unknown',
    params.matchConfidence ? `match_confidence=${params.matchConfidence}` : 'match_confidence=unknown',
    knownFacts.length ? `known_facts=${knownFacts.join('|')}` : 'known_facts=none',
    missingFacts.length ? `missing_facts=${missingFacts.join('|')}` : 'missing_facts=none',
    `suggested_next_action=${suggestedNextAction}`,
  ].join('; ');
}

function logOperationalMatch(params: {
  session_id: number;
  update_id: number;
  scenario: string;
  extracted_facts: Record<string, unknown>;
  match: Awaited<ReturnType<typeof matchTelegramOperationalEntitiesV1>>;
  clarification_question_used: boolean;
  escalated: boolean;
  reason: string;
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'telegram_operational_match',
        scenario: params.scenario,
        extracted_facts: params.extracted_facts,
        reservation_match_status: params.match.reservation_match_status,
        property_match_status: params.match.property_match_status,
        match_confidence: params.match.match_confidence,
        matched_guest: params.match.matched_guest,
        matched_property: params.match.matched_property,
        matched_reservation_id: params.match.matched_reservation_id,
        clarification_question_used: params.clarification_question_used,
        escalated: params.escalated,
        reason: params.reason,
        update_id: `tg:${params.session_id}:${params.update_id}`,
      }),
    );
  } catch {
    // never throw from logging
  }
}

function normalizeText(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[“”„"']/g, '')
    .replace(/[?!.,;:(){}\[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKnownRuStreetForms(snippet: string): string {
  let s = String(snippet ?? '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(невск)(ий|ого|ому|ом|ая|ую|ой|им)\b/iu, 'Невский');
  s = s.replace(/\b(литейн)(ый|ого|ому|ом|ая|ую|ой|ым)\b/iu, 'Литейный');
  return s;
}

function extractExplicitRuPropertyLabel(text: string): string | null {
  const t = String(text ?? '');
  // Unicode-safe "word boundary" for Cyrillic: avoid `\b` (ASCII-centric).
  const m = t.match(/(?:^|[^\p{L}])((?:невск[\p{L}]*|литейн[\p{L}]*)\s+\d{1,4}(?:\s*к\d+)?)\b/iu);
  if (!m) return null;
  const s = normalizeKnownRuStreetForms(String(m[1] ?? '').trim()).slice(0, 120);
  if (!s) return null;
  if (/^\d{1,2}:\d{2}$/.test(s)) return null;
  return s;
}

function extractTimeLike(text: string): string | null {
  const t = String(text ?? '');
  const m = t.match(/\b(\d{1,2}:\d{2})\b/);
  if (m) return m[1];
  const m2 = t.match(/\bдо\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\b/i);
  if (m2) {
    const hh = m2[1].padStart(2, '0');
    const mm = (m2[2] ?? '00').padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const m3 = t.match(/\bfrom\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\b/i);
  if (m3) {
    const hh = m3[1].padStart(2, '0');
    const mm = (m3[2] ?? '00').padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return null;
}

function extractDateToken(normalized: string): 'today' | 'tomorrow' | null {
  if (/\b(today|сегодня)\b/i.test(normalized)) return 'today';
  if (/\b(tomorrow|завтра)\b/i.test(normalized)) return 'tomorrow';
  return null;
}

function extractGuestName(text: string): string | null {
  const m =
    text.match(/\bguest\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u) ??
    text.match(/\bгость\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u);
  return m ? m[1].trim() : null;
}

function looksLikePropertyHint(text: string, normalized: string): boolean {
  if (/по\s+адресу/i.test(text)) return true;
  if (/(nevsky|невск|liteyn|литейн|tversk|тверск|ул\.?\s|улиц|проспект|набережн)/i.test(normalized)) return true;
  if (/(?:\bв|\bна)\s+[а-яёa-z.\-]{3,40}\s+\d{1,4}\b/i.test(normalized)) return true;
  if (/\b\d{1,4}\s*[A-Za-zА-Яа-яЁё.-]+(?:st|street|str|ave|просп|пер|шоссе)\b/i.test(normalized)) return true;
  return false;
}

function extractPropertySnippet(text: string): string | null {
  const explicit = extractExplicitRuPropertyLabel(text);
  if (explicit) return explicit;

  const m1 = text.match(/по\s+адресу\s+([^.\n?]+)/i);
  if (m1) {
    const s = m1[1].trim().slice(0, 120);
    if (/^\d{1,2}:\d{2}$/.test(s)) return null;
    return s;
  }
  const m2 = text.match(/\b(?:at|@)\s+([^.\n?]+)/i);
  if (m2) {
    const s = m2[1].trim().slice(0, 120);
    if (/^\d{1,2}:\d{2}$/.test(s)) return null;
    if (/^\d{1,2}$/.test(s)) return null;
    return s;
  }
  const m3 = text.match(/(?:^|[^\p{L}])(в|на)\s+([А-Яа-яЁёA-Za-z.\-]{3,60}\s+\d{1,4}(?:\s*к\d+)*)\b/iu);
  if (m3) {
    const s = normalizeKnownRuStreetForms(String(m3[2] ?? '').trim()).slice(0, 120);
    if (s && !/^\d{1,2}:\d{2}$/.test(s)) return s;
  }
  const m4 = text.match(/\b([А-Яа-яЁёA-Za-z.\-]{3,60}\s+\d{1,4}(?:\s*к\d+)*)\b/u);
  if (m4) {
    const candidate = String(m4[1] ?? '').trim();
    if (candidate && (/(невск|литейн|tversk|тверск|ул\.?|улиц|просп|наб\.)/iu.test(candidate))) {
      const s = normalizeKnownRuStreetForms(candidate).slice(0, 120);
      if (s && !/^\d{1,2}:\d{2}$/.test(s)) return s;
    }
  }
  // if the entire message looks like a property clue, keep it verbatim (short).
  const trimmed = String(text ?? '').trim();
  if (trimmed.length > 0 && trimmed.length <= 80 && looksLikePropertyHint(trimmed, normalizeText(trimmed))) {
    return trimmed;
  }
  return null;
}

function hasFailureModeHint(normalized: string): boolean {
  if (/не\s+работает|не\s+подходит|не\s+открыва(ется|ть)?/i.test(normalized)) return true;
  return (
    (/(code|код)/i.test(normalized) && /(work|подходит|открыва|open|doesn|does\s+not)/i.test(normalized)) ||
    /(lock|замок)/i.test(normalized) ||
    /(door|дверь)/i.test(normalized)
  );
}

function hasWifiDetails(normalized: string): boolean {
  return (
    /\bpassword\b|\bwrong\b|\bdoesn'?t\s+work\b|\bcan'?t\s+connect\b|\bno\s+internet\b|\brouter\b/i.test(normalized) ||
    /парол|не\s+подход|не\s+работает|не\s+подключ|нет\s+интернет|роутер/i.test(normalized)
  );
}

function hasVehicleDetails(normalized: string): boolean {
  return /\bcar\b|\bvehicle\b|\bplate\b|\bparking\s+overnight\b/i.test(normalized) || /машин|авто|номер\s+машин/i.test(normalized);
}

function hasPaymentReference(normalized: string, raw: string): boolean {
  if (/\breceipt\b|\bscreenshot\b/i.test(normalized) || /чек|скрин/i.test(normalized)) return true;
  if (extractTimeLike(raw)) return true;
  // amount-like token: "5000 rub" / "руб 5000" etc.
  return (
    /(\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?\b)\s*(rub|rur|₽|eur|€|usd|\$)/i.test(raw) ||
    /(rub|rur|₽|eur|€|usd|\$)\s*(\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,\s]\d{3})*(?:[.,]\d{2})?\b)/i.test(raw)
  );
}

function pickClarifyingQuestion(missingFacts: string[], ru: boolean): string {
  const key = missingFacts[0] ?? '';
  if (key === 'property') return ru ? 'Уточните, пожалуйста, для какого объекта/адреса это?' : 'Which property/address is this for?';
  if (key === 'requested_time') return ru ? 'На какое время это нужно?' : 'What time do you need it for?';
  if (key === 'requested_date') return ru ? 'На какую дату это нужно?' : 'What date is this for?';
  if (key === 'wifi_details')
    return ru ? 'Что именно не работает: нет сети, не подключается или пароль не подходит?' : 'What exactly fails: no network, can’t connect, or password not working?';
  if (key === 'payment_reference')
    return ru
      ? 'Пришлите, пожалуйста, сумму и время/скрин оплаты (или последние 4 цифры карты), чтобы сверить.'
      : 'Please share the amount and time/screenshot of payment (or last 4 digits) so we can confirm.';
  if (key === 'vehicle_details')
    return ru
      ? 'Уточните, пожалуйста: вы на машине? Нужна парковка на ночь или на несколько часов?'
      : 'Are you arriving by car, and do you need overnight parking or short-term?';
  if (key === 'cleaning_scope') return ru ? 'Что нужно: уборка, смена полотенец или постельного белья?' : 'What do you need: cleaning, towel change, or linen change?';
  if (key === 'noise_details') return ru ? 'Шум сейчас продолжается? Это музыка/вечеринка или ремонт?' : 'Is the noise ongoing right now, and is it music/party or renovation?';
  return ru
    ? 'Уточните, пожалуйста, один ключевой факт, чтобы помочь: для какого адреса/объекта это?'
    : 'Please share one key detail so we can help: which property/address is this for?';
}

function defaultReplyForCategory(category: string, ru: boolean): string {
  // Keep copy aligned with telegram-operational-intake replies.
  if (category === 'access_issue') {
    return ru
      ? 'Понял(а). Зафиксировал(а) проблему с доступом (код/замок/дверь). Команда сейчас проверит и поможет гостю попасть внутрь.'
      : 'Understood — access issue logged (code/lock/door). Our team will verify and help the guest get inside now.';
  }
  if (category === 'no_heating') {
    return ru
      ? 'Понял(а). Зафиксировал(а) проблему с отоплением; команда проверит и вернётся с обновлением.'
      : 'Understood. Heating issue logged; the team will check and update you shortly.';
  }
  if (category === 'late_checkout') {
    return ru
      ? 'Понял(а). Зафиксировал(а) запрос на поздний выезд; проверим возможность и вернёмся с ответом.'
      : 'Understood. I’ve logged the late checkout request and will confirm availability shortly.';
  }
  if (category === 'early_checkin') {
    return ru
      ? 'Понял(а). Зафиксировал(а) запрос на ранний заезд; проверим возможность и вернёмся с подтверждением.'
      : 'Understood. I’ve logged the early check-in request and will confirm availability shortly.';
  }
  if (category === 'noise_complaint') {
    return ru
      ? 'Понял(а). Зафиксировал(а) жалобу на шум; команда свяжется и постарается быстро решить.'
      : 'Understood. Noise complaint logged; the team will reach out and resolve it as quickly as possible.';
  }
  if (category === 'cleaning_request') {
    return ru
      ? 'Понял(а). Зафиксировал(а) запрос на уборку/сервис; согласуем время и вернёмся с подтверждением.'
      : 'Understood. Housekeeping request logged; we’ll coordinate timing and confirm shortly.';
  }
  if (category === 'extension_request') {
    return ru
      ? 'Понял(а). Зафиксировал(а) запрос на продление проживания; проверим доступность и стоимость и вернёмся с ответом.'
      : 'Understood. Extension request logged; we’ll confirm availability and pricing shortly.';
  }
  if (category === 'wifi_issue') {
    return ru
      ? 'Понял(а). Зафиксировал(а) проблему с Wi‑Fi; команда проверит сеть/пароль и вернётся с решением.'
      : 'Understood. Wi‑Fi issue logged; the team will check the network/password and get back with a fix.';
  }
  if (category === 'parking_question') {
    return ru
      ? 'Понял(а). Уточню правила парковки для этого адреса и вернусь с инструкцией (где можно/нельзя, платно/бесплатно).'
      : 'Understood. I’ll confirm parking options for this address and return with clear instructions (where to park, paid/free).';
  }
  if (category === 'payment_confirmation') {
    return ru
      ? 'Понял(а). Спасибо — передаю подтверждение оплаты в операционную команду для сверки. Если есть чек/скрин, пришлите — это ускорит.'
      : 'Understood, thank you — I’m forwarding the payment confirmation to ops to verify. If you have a receipt/screenshot, please share it to speed things up.';
  }
  return ru
    ? 'Понял(а). Зафиксировал(а) запрос; команда проверит и вернётся с обновлением.'
    : 'Understood. I’ve logged the request; the team will check and update you shortly.';
}

function determineUrgency(hit: TelegramOperationalIntakeHit): 'normal' | 'urgent' {
  if (hit.finalAction === 'escalate_urgent') return 'urgent';
  return 'normal';
}

function buildCaseFromHit(params: { hit: TelegramOperationalIntakeHit; update_id: number }): TelegramOperationalSessionCaseV1 {
  const ts = nowIso();
  const extractedFacts = safeJsonClone(params.hit.extractedFacts ?? {});
  const clarification_count = params.hit.finalAction === 'clarify' ? 1 : 0;
  return {
    version: 1,
    category: params.hit.category,
    guest_name: (extractedFacts as any)?.guest_name
      ? String((extractedFacts as any).guest_name)
      : (extractedFacts as any)?.guestName
        ? String((extractedFacts as any).guestName)
        : null,
    property:
      (extractedFacts as any)?.property_hint && (extractedFacts as any).property_hint !== 'hint_present'
        ? String((extractedFacts as any).property_hint)
        : (extractedFacts as any)?.property && (extractedFacts as any).property !== 'hint_present'
          ? String((extractedFacts as any).property)
          : null,
    date_time: null,
    urgency: determineUrgency(params.hit),
    extracted_facts: extractedFacts,
    missing_facts: [...(params.hit.missingFacts ?? [])],
    last_question_asked: params.hit.finalAction === 'clarify' ? params.hit.reply : null,
    clarification_count,
    status:
      params.hit.finalAction === 'escalate_operator' || params.hit.finalAction === 'escalate_urgent'
        ? 'escalated'
        : params.hit.finalAction === 'clarify'
          ? 'clarifying'
          : 'resolved',
    created_at: ts,
    updated_at: ts,
    last_update_id: params.update_id,
  };
}

function mergeMissingFacts(prev: string[], next: string[]): string[] {
  const s = new Set<string>();
  for (const k of prev ?? []) s.add(String(k));
  for (const k of next ?? []) s.add(String(k));
  return Array.from(s);
}

function mergeExtractedFactsPreferExisting(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(next ?? {})) {
    // Never overwrite existing non-empty value with null/undefined.
    if (v === null || v === undefined) continue;
    // Special-case: 'hint_present' is a weaker signal than a concrete snippet.
    if (v === 'hint_present' && out[k] && out[k] !== 'hint_present') continue;
    out[k] = v;
  }
  return out;
}

function applyFragmentToCase(params: {
  prev: TelegramOperationalSessionCaseV1;
  text: string;
  surfaceLang: SurfaceLang;
  update_id: number;
}): { next: TelegramOperationalSessionCaseV1; mergedFacts: Record<string, unknown> } {
  const raw = String(params.text ?? '');
  const normalized = normalizeText(raw);
  const prev = params.prev;

  const mergedFacts: Record<string, unknown> = {};
  const missing = new Set<string>(prev.missing_facts ?? []);
  const extracted = { ...(prev.extracted_facts ?? {}) };

  const guest = extractGuestName(raw);
  if (guest && !prev.guest_name) {
    mergedFacts.guest_name = guest;
    extracted.guestName = guest;
  }

  const prop = extractPropertySnippet(raw);
  if (prop && !prev.property) {
    mergedFacts.property = prop;
    extracted.property = prop;
    missing.delete('property');
  } else if (!prev.property && looksLikePropertyHint(raw, normalized)) {
    // Even if we can't extract a clean snippet, a hint should satisfy "property" for routing.
    mergedFacts.property = mergedFacts.property ?? 'hint_present';
    extracted.property = extracted.property ?? 'hint_present';
    missing.delete('property');
  }

  const time = extractTimeLike(raw);
  const dateToken = extractDateToken(normalized);
  if (time) {
    extracted.requestedTime = extracted.requestedTime ?? time;
    if (missing.has('requested_time')) {
      mergedFacts.requested_time = time;
      missing.delete('requested_time');
    }
  }
  if (dateToken) {
    extracted.requestedDateToken = extracted.requestedDateToken ?? dateToken;
    if (missing.has('requested_date')) {
      mergedFacts.requested_date = dateToken;
      missing.delete('requested_date');
    }
  }
  if (!prev.date_time && (time || dateToken)) {
    const dt = [dateToken ?? null, time ?? null].filter(Boolean).join(' ');
    mergedFacts.date_time = dt;
  }

  if (missing.has('failure_mode') && hasFailureModeHint(normalized)) {
    mergedFacts.failure_mode = true;
    extracted.failureModeHint = true;
    missing.delete('failure_mode');
  }

  if (missing.has('wifi_details') && hasWifiDetails(normalized)) {
    mergedFacts.wifi_details = true;
    extracted.hasDetails = true;
    missing.delete('wifi_details');
  }

  if (missing.has('vehicle_details') && hasVehicleDetails(normalized)) {
    mergedFacts.vehicle_details = true;
    extracted.hasVehicleDetails = true;
    missing.delete('vehicle_details');
  }

  if (missing.has('payment_reference') && hasPaymentReference(normalized, raw)) {
    mergedFacts.payment_reference = true;
    extracted.paymentReference = true;
    missing.delete('payment_reference');
  }

  const nextMissing = Array.from(missing);
  const wantsSecondClarification = (prev.clarification_count ?? 0) >= 1 && nextMissing.length > 0;
  const nextStatus: TelegramOperationalSessionCaseStatusV1 =
    prev.status === 'resolved'
      ? 'resolved'
      : prev.status === 'escalated'
        ? (nextMissing.length === 0 ? 'resolved' : 'escalated')
        : nextMissing.length === 0
          ? 'resolved'
          : wantsSecondClarification
            ? 'escalated'
            : 'clarifying';

  const ru = params.surfaceLang === 'ru';
  const lastQuestion =
    nextStatus === 'clarifying'
      ? pickClarifyingQuestion(nextMissing, ru)
      : nextStatus === 'resolved'
        ? null
        : prev.last_question_asked ?? null;

  const next: TelegramOperationalSessionCaseV1 = {
    ...prev,
    guest_name: prev.guest_name ?? (guest ? guest : prev.guest_name ?? null),
    property: prev.property ?? (prop ? prop : prev.property ?? null),
    date_time: (prev.date_time ?? null) ?? (typeof mergedFacts.date_time === 'string' ? (mergedFacts.date_time as string) : null),
    extracted_facts: extracted,
    missing_facts: nextMissing,
    last_question_asked: lastQuestion,
    clarification_count:
      nextStatus === 'clarifying'
        ? Math.max(1, prev.clarification_count ?? 0)
        : prev.clarification_count ?? 0,
    status: nextStatus,
    updated_at: nowIso(),
    last_update_id: params.update_id,
  };

  return { next, mergedFacts };
}

function isCaseOpen(c: TelegramOperationalSessionCaseV1 | undefined): boolean {
  if (!c) return false;
  if (c.status === 'intake' || c.status === 'clarifying') return true;
  // If we already escalated but are still missing facts, allow follow-up fragments
  // to fill in key fields (address/time) for operator context.
  if (c.status === 'escalated' && (c.missing_facts ?? []).length > 0) return true;
  return false;
}

export async function processTelegramOperationalIntakeWithSessionMemory(params: {
  chatId: number;
  channel: CommunicationChannel;
  text: string;
  surfaceLang: SurfaceLang;
  update_id: number;
  /** Override db for deterministic matching tests */
  db?: any;
}): Promise<TelegramSessionMemoryResult> {
  const prevCase = getAutonomousSessionOperationalCaseV1(params.chatId);
  const ru = params.surfaceLang === 'ru';
  const explicitProp = params.surfaceLang === 'ru' ? extractExplicitRuPropertyLabel(params.text) : null;
  const explicit_property_detected = Boolean(explicitProp);

  const hit = tryTelegramOperationalIntake({
    text: params.text,
    surfaceLang: params.surfaceLang,
    update_id: params.update_id,
    chat_id: params.chatId,
  });

  // If we got a fresh deterministic hit, decide whether to start new case or merge.
  if (hit) {
    const previous_state = prevCase ? safeJsonClone(prevCase) : null;
    // If the message already contains an explicit property/address clue, never ask "which property" again.
    // This is critical for RU live Telegram flows like "в Невском 24".
    const propSnippet = extractPropertySnippet(params.text);
    const normalized = normalizeText(params.text);
    const hasAnyPropClue = Boolean(propSnippet) || Boolean(explicitProp) || looksLikePropertyHint(params.text, normalized);
    if (hasAnyPropClue) {
      hit.missingFacts = (hit.missingFacts ?? []).filter(k => k !== 'property');
      const bestHint = (propSnippet ?? explicitProp ?? null) as string | null;
      // Never degrade explicit property into 'hint_present' — it breaks DB location matching.
      if (bestHint) {
        (hit.extractedFacts as any).property_hint = bestHint;
        (hit.extractedFacts as any).property = bestHint;
      } else {
        // Keep back-compat boolean hint only when we truly cannot capture a snippet.
        (hit.extractedFacts as any).property_hint =
          (hit.extractedFacts as any).property_hint && (hit.extractedFacts as any).property_hint !== 'hint_present'
            ? (hit.extractedFacts as any).property_hint
            : 'hint_present';
      }
    }

    (hit.extractedFacts as any).explicit_property_detected = explicit_property_detected;

    // Matching layer: try to ground to guest/reservation/property before deciding clarify/escalate.
    let match: Awaited<ReturnType<typeof matchTelegramOperationalEntitiesV1>> | null = null;
    try {
      match = await matchTelegramOperationalEntitiesV1({
        surfaceLang: params.surfaceLang,
        update_id: params.update_id,
        scenario: hit.category,
        extracted_facts: hit.extractedFacts as any,
        db: params.db,
      });
    } catch {
      match = null;
    }

    if (match) {
      // Attach match results into extracted facts for downstream reply + operator review.
      (hit.extractedFacts as any).reservation_match_status = match.reservation_match_status;
      (hit.extractedFacts as any).property_match_status = match.property_match_status;
      (hit.extractedFacts as any).match_confidence = match.match_confidence;
      (hit.extractedFacts as any).matched_guest = match.matched_guest;
      (hit.extractedFacts as any).matched_property_id = match.matched_property?.property_id ?? null;
      (hit.extractedFacts as any).matched_property_label = match.matched_property?.location ?? null;
      (hit.extractedFacts as any).matched_reservation_id = match.matched_reservation_id;
      (hit.extractedFacts as any).match_reason = match.reason;

      const alreadyUsedClarification = Boolean(prevCase && isCaseOpen(prevCase) && (prevCase.clarification_count ?? 0) >= 1);
      const prevHasProperty = Boolean(prevCase?.property);
      const shouldForceEscalate =
        alreadyUsedClarification &&
        hit.finalAction === 'clarify' &&
        !prevHasProperty &&
        (match.match_confidence === 'low_confidence_match' || match.match_confidence === 'no_match');

      if (shouldForceEscalate) {
        hit.finalAction = 'escalate_operator';
        hit.reply = ru ? 'Понял(а). Передаю оператору.' : 'Understood. I’m escalating to an operator.';
        hit.actionReason = 'matching:unresolved_after_one_clarification';
      } else if (match.match_confidence === 'high_confidence_match') {
        // Grounded match → never ask generic questions.
        // If intake wanted clarify due to missing property/failure_mode, but we have a match, switch to reply.
        hit.finalAction = hit.finalAction === 'escalate_urgent' ? 'escalate_urgent' : hit.finalAction === 'escalate_operator' ? 'escalate_operator' : 'reply';
        hit.actionReason = `matching:high:${match.reason}`;
      } else if (match.match_confidence === 'medium_confidence_match') {
        // Exactly ONE targeted clarification (if any) else proceed.
        if (match.suggested_clarification_question && hit.finalAction !== 'escalate_urgent') {
          hit.finalAction = 'clarify';
          hit.reply = match.suggested_clarification_question;
          hit.actionReason = `matching:medium:clarify:${match.reason}`;
        } else if (hit.finalAction !== 'escalate_urgent') {
          hit.finalAction = 'reply';
          hit.actionReason = `matching:medium:reply:${match.reason}`;
        }
      } else if (match.match_confidence === 'low_confidence_match' || match.match_confidence === 'no_match') {
        // One best missing question (never generic); otherwise escalate if already used.
        const alreadyHasProperty = Boolean((hit.extractedFacts as any)?.property_hint) || Boolean((hit.extractedFacts as any)?.property);
        if (alreadyHasProperty) {
          // Don't downgrade to "which property" when property is already present.
        } else if (match.suggested_clarification_question && hit.finalAction !== 'escalate_urgent') {
          hit.finalAction = 'clarify';
          hit.reply = match.suggested_clarification_question;
          hit.actionReason = `matching:${match.match_confidence}:clarify:${match.reason}`;
        }
      }

      logOperationalMatch({
        session_id: params.chatId,
        update_id: params.update_id,
        scenario: hit.category,
        extracted_facts: safeJsonClone(hit.extractedFacts ?? {}),
        match,
        clarification_question_used: hit.finalAction === 'clarify',
        escalated: hit.finalAction === 'escalate_operator' || hit.finalAction === 'escalate_urgent',
        reason: hit.actionReason ?? 'n/a',
      });

      // Property knowledge lookup (Task 8): after matching but before reply composition.
      const matchedPropertyId = match.matched_property?.property_id ?? null;
      const propertyMatchConfidence = match.match_confidence;
      const isPriorityScenario = hit.category === 'wifi_issue' || hit.category === 'late_checkout' || hit.category === 'access_issue';
      const shouldLookup =
        Boolean(matchedPropertyId) &&
        (isPriorityScenario
          ? // Priority live scenarios: if property is deterministically matched, do not skip.
            match.property_match_status === 'matched' && propertyMatchConfidence !== 'no_match'
          : // Other scenarios: keep existing conservative rule to avoid unnecessary DB lookups.
            (propertyMatchConfidence === 'high_confidence_match' || propertyMatchConfidence === 'medium_confidence_match'));

      if (shouldLookup && matchedPropertyId) {
        const kn = await loadTelegramPropertyKnowledgeV1({
          matched_property_id: matchedPropertyId,
          db: params.db,
        });

        (hit.extractedFacts as any).property_knowledge_status = kn.status;
        (hit.extractedFacts as any).property_knowledge_fields = kn.available_fields;
        (hit.extractedFacts as any).property_knowledge = kn.knowledge;

        // Category-specific grounded-reply upgrade: when we have the data a guest needs,
        // turn clarify/escalate_operator into a grounded reply.
        let groundedReply = false;
        if (kn.status === 'knowledge_found' && hit.finalAction === 'clarify') {
          const k = kn.knowledge;
          const wifiOk = !!(k.wifi_name || k.wifi_password || k.wifi_notes);
          const parkingOk = !!(k.parking_rules || k.parking_paid_or_free || k.parking_location_notes);
          const lateOk = !!k.late_checkout_policy;
          const earlyOk = !!k.early_checkin_policy;

          if (hit.category === 'wifi_issue' && wifiOk) {
            hit.finalAction = 'reply';
            hit.actionReason = `knowledge:wifi_issue:grounded`;
            groundedReply = true;
          } else if (hit.category === 'parking_question' && parkingOk) {
            hit.finalAction = 'reply';
            hit.actionReason = `knowledge:parking_question:grounded`;
            groundedReply = true;
          } else if (hit.category === 'late_checkout' && lateOk) {
            hit.finalAction = 'reply';
            hit.actionReason = `knowledge:late_checkout:grounded`;
            groundedReply = true;
          } else if (hit.category === 'early_checkin' && earlyOk) {
            hit.finalAction = 'reply';
            hit.actionReason = `knowledge:early_checkin:grounded`;
            groundedReply = true;
          }
        }

        // Late checkout policy-aware behavior: if policy explicitly requires approval, say so and escalate.
        if (hit.category === 'late_checkout' && kn.status === 'knowledge_found' && kn.knowledge?.late_checkout_policy) {
          const p = String(kn.knowledge.late_checkout_policy).toLowerCase();
          const requiresApproval =
            /согласован|по\s+согласован|только\s+по\s+согласован|нужно\s+одобрен|только\s+с\s+разрешен|требует\s+одобрен/.test(p);
          if (requiresApproval) {
            hit.finalAction = 'escalate_operator';
            hit.actionReason = 'knowledge:late_checkout:policy_requires_approval';
            (hit.extractedFacts as any).late_checkout_requires_approval = true;
          }
        }

        logTelegramPropertyKnowledgeLookup({
          update_id: params.update_id,
          chat_id: params.chatId,
          scenario: hit.category,
          matched_property_id: matchedPropertyId,
          property_match_confidence: propertyMatchConfidence,
          knowledge_lookup_attempted: true,
          knowledge_lookup_result: kn.status,
          knowledge_fields_available: kn.available_fields,
          reply_used_grounded_property_data:
            groundedReply || (hit.finalAction === 'escalate_urgent' && kn.status === 'knowledge_found'),
          clarification_question_used: hit.finalAction === 'clarify',
          escalated: hit.finalAction === 'escalate_operator' || hit.finalAction === 'escalate_urgent',
          reason: hit.actionReason ?? 'n/a',
        });
      } else {
        const skipReason = !isPriorityScenario
          ? !matchedPropertyId
            ? 'skip:no_matched_property_id'
            : !(propertyMatchConfidence === 'high_confidence_match' || propertyMatchConfidence === 'medium_confidence_match')
              ? `skip:match_confidence_${propertyMatchConfidence}`
              : 'skip:unknown'
          : !matchedPropertyId
            ? 'skip:no_matched_property_id'
            : match.property_match_status !== 'matched'
              ? `skip:property_match_status_${match.property_match_status}`
              : propertyMatchConfidence === 'no_match'
                ? 'skip:match_confidence_no_match'
                : 'skip:unknown';
        (hit.extractedFacts as any).knowledge_skip_reason = skipReason;
        logTelegramPropertyKnowledgeLookup({
          update_id: params.update_id,
          chat_id: params.chatId,
          scenario: hit.category,
          matched_property_id: matchedPropertyId,
          property_match_confidence: propertyMatchConfidence,
          knowledge_lookup_attempted: false,
          knowledge_lookup_result: 'skipped',
          knowledge_fields_available: [],
          reply_used_grounded_property_data: false,
          clarification_question_used: hit.finalAction === 'clarify',
          escalated: hit.finalAction === 'escalate_operator' || hit.finalAction === 'escalate_urgent',
          reason: hit.actionReason ?? 'n/a',
        });
      }
    }

    // Missing-facts policy: never ask more than ONE clarification question in a row.
    // If we already asked once and still lack info, escalate with a summary.
    if (
      prevCase &&
      isCaseOpen(prevCase) &&
      prevCase.category === hit.category &&
      hit.finalAction === 'clarify' &&
      (prevCase.clarification_count ?? 0) >= 1
    ) {
      const mergedExtracted = mergeExtractedFactsPreferExisting(
        prevCase.extracted_facts ?? {},
        (hit.extractedFacts ?? {}) as Record<string, unknown>,
      );
      let mergedMissing = mergeMissingFacts(prevCase.missing_facts ?? [], hit.missingFacts ?? []);

      // If we already know a fact, do not re-add it to missing.
      const knownProperty =
        Boolean(prevCase.property) || Boolean((mergedExtracted as any)?.property && (mergedExtracted as any).property !== 'hint_present');
      if (knownProperty) mergedMissing = mergedMissing.filter(k => k !== 'property');
      const hasWifiDetailFlag = Boolean((mergedExtracted as any)?.hasDetails);
      if (hasWifiDetailFlag) mergedMissing = mergedMissing.filter(k => k !== 'wifi_details');
      const hasFailureModeFlag = Boolean((mergedExtracted as any)?.failureModeHint);
      if (hasFailureModeFlag) mergedMissing = mergedMissing.filter(k => k !== 'failure_mode');
      const hasVehicleDetailFlag = Boolean((mergedExtracted as any)?.hasVehicleDetails);
      if (hasVehicleDetailFlag) mergedMissing = mergedMissing.filter(k => k !== 'vehicle_details');
      const hasPaymentRefFlag = Boolean((mergedExtracted as any)?.paymentReference);
      if (hasPaymentRefFlag) mergedMissing = mergedMissing.filter(k => k !== 'payment_reference');

      // If merging the new fragment would fully resolve missing facts, do NOT force escalation.
      if (mergedMissing.length === 0) {
        // Fall through to normal merge_case handling below.
      } else {
      const nextCase: TelegramOperationalSessionCaseV1 = {
        ...prevCase,
        extracted_facts: safeJsonClone(mergedExtracted),
        missing_facts: mergedMissing,
        status: 'escalated',
        last_question_asked: null,
        clarification_count: prevCase.clarification_count ?? 1,
        updated_at: nowIso(),
        last_update_id: params.update_id,
      };
      const opSummary = buildOperatorEscalationSummaryV1({
        scenario: String(nextCase.category ?? 'unknown'),
        urgency: (nextCase.urgency ?? 'normal') as any,
        extractedFacts: nextCase.extracted_facts,
        missingFacts: nextCase.missing_facts,
        matchConfidence: (nextCase.extracted_facts as any)?.match_confidence ?? null,
        matchedReservationId: (nextCase.extracted_facts as any)?.matched_reservation_id ?? null,
        matchedPropertyLabel: (nextCase.extracted_facts as any)?.matched_property_label ?? null,
      });
      const reply = ru
        ? `Понял(а). Я уже уточнял(а) детали — передаю оператору. (${buildEscalationSummaryForCase({
            category: nextCase.category,
            extractedFacts: nextCase.extracted_facts,
            missingFacts: nextCase.missing_facts,
          })})`
        : `Understood. We already asked one clarification — escalating to an operator. (${buildEscalationSummaryForCase({
            category: nextCase.category,
            extractedFacts: nextCase.extracted_facts,
            missingFacts: nextCase.missing_facts,
          })})`;
      const forcedHit: TelegramOperationalIntakeHit = {
        category: hit.category,
        reply,
        extractedFacts: safeJsonClone(nextCase.extracted_facts ?? {}),
        missingFacts: [...(nextCase.missing_facts ?? [])],
        finalAction: 'escalate_operator',
        urgencySignals: hit.urgencySignals ?? [],
        actionReason: `missing_facts_policy:clarification_already_used; operator_summary=${opSummary}`,
      };
      setAutonomousSessionOperationalCaseV1({ chatId: params.chatId, channel: params.channel, operationalCase: nextCase });
      logSessionMemoryUpdate({
        session_id: params.chatId,
        update_id: params.update_id,
        previous_state,
        new_state: nextCase,
        merged_facts: safeJsonClone(hit.extractedFacts ?? {}),
        remaining_missing_facts: [...(nextCase.missing_facts ?? [])],
      });
      return { handled: true, hit: forcedHit, case: nextCase, mode: 'merge_case' };
      }
    }

    const startNew =
      !prevCase ||
      prevCase.status === 'resolved' ||
      // A new category while awaiting clarification is treated as a new/unrelated case.
      (isCaseOpen(prevCase) && prevCase.category && prevCase.category !== hit.category);

    if (startNew) {
      const nextCase = buildCaseFromHit({ hit, update_id: params.update_id });
      setAutonomousSessionOperationalCaseV1({ chatId: params.chatId, channel: params.channel, operationalCase: nextCase });
      logSessionMemoryUpdate({
        session_id: params.chatId,
        update_id: params.update_id,
        previous_state,
        new_state: nextCase,
        merged_facts: safeJsonClone(nextCase.extracted_facts ?? {}),
        remaining_missing_facts: [...(nextCase.missing_facts ?? [])],
      });
      return { handled: true, hit, case: nextCase, mode: 'new_case' };
    }

    // Merge same-category hit into existing open case.
    if (prevCase && isCaseOpen(prevCase) && prevCase.category === hit.category) {
      let mergedMissing = mergeMissingFacts(prevCase.missing_facts ?? [], hit.missingFacts ?? []);
      const mergedExtracted = mergeExtractedFactsPreferExisting(
        prevCase.extracted_facts ?? {},
        (hit.extractedFacts ?? {}) as Record<string, unknown>,
      );

      // If we already know a fact, do not re-add it to missing.
      const knownProperty = Boolean(prevCase.property) || Boolean((mergedExtracted as any)?.property && (mergedExtracted as any).property !== 'hint_present');
      if (knownProperty) mergedMissing = mergedMissing.filter(k => k !== 'property');
      const hasWifiDetailFlag = Boolean((mergedExtracted as any)?.hasDetails);
      if (hasWifiDetailFlag) mergedMissing = mergedMissing.filter(k => k !== 'wifi_details');
      const hasFailureModeFlag = Boolean((mergedExtracted as any)?.failureModeHint);
      if (hasFailureModeFlag) mergedMissing = mergedMissing.filter(k => k !== 'failure_mode');
      const hasVehicleDetailFlag = Boolean((mergedExtracted as any)?.hasVehicleDetails);
      if (hasVehicleDetailFlag) mergedMissing = mergedMissing.filter(k => k !== 'vehicle_details');
      const hasPaymentRefFlag = Boolean((mergedExtracted as any)?.paymentReference);
      if (hasPaymentRefFlag) mergedMissing = mergedMissing.filter(k => k !== 'payment_reference');

      const wouldClarifyAgain = mergedMissing.length > 0 && (prevCase.clarification_count ?? 0) >= 1;
      const nextStatus: TelegramOperationalSessionCaseStatusV1 =
        hit.finalAction === 'escalate_operator' || hit.finalAction === 'escalate_urgent'
          ? 'escalated'
          : mergedMissing.length === 0
            ? 'resolved'
            : wouldClarifyAgain
              ? 'escalated'
              : 'clarifying';
      const nextCase: TelegramOperationalSessionCaseV1 = {
        ...prevCase,
        version: 1,
        category: hit.category,
        urgency: determineUrgency(hit),
        extracted_facts: safeJsonClone(mergedExtracted),
        missing_facts: mergedMissing,
        last_question_asked: nextStatus === 'clarifying' ? pickClarifyingQuestion(mergedMissing, ru) : null,
        clarification_count:
          nextStatus === 'clarifying'
            ? Math.max(1, prevCase.clarification_count ?? 0, hit.finalAction === 'clarify' ? 1 : 0)
            : prevCase.clarification_count ?? 0,
        status: nextStatus,
        updated_at: nowIso(),
        last_update_id: params.update_id,
      };

      const replyForMerged: string = nextStatus === 'resolved'
        ? defaultReplyForCategory(String(nextCase.category ?? ''), ru)
        : nextStatus === 'escalated'
          ? (ru
              ? `Понял(а). Нужны дополнительные детали, но я уже задавал(а) один уточняющий вопрос — передаю оператору. (${buildEscalationSummaryForCase({
                  category: nextCase.category,
                  extractedFacts: nextCase.extracted_facts,
                  missingFacts: nextCase.missing_facts,
                })})`
              : `Understood. We still need more details, but we already asked one clarification — escalating to an operator. (${buildEscalationSummaryForCase({
                  category: nextCase.category,
                  extractedFacts: nextCase.extracted_facts,
                  missingFacts: nextCase.missing_facts,
                })})`)
          : (nextCase.last_question_asked ?? pickClarifyingQuestion(nextCase.missing_facts ?? [], ru));
      const finalActionForMerged: TelegramOperationalFinalAction =
        nextStatus === 'resolved'
          ? 'reply'
          : nextStatus === 'escalated'
            ? 'escalate_operator'
            : 'clarify';
      const mergedHit: TelegramOperationalIntakeHit = {
        category: hit.category,
        reply: replyForMerged,
        extractedFacts: safeJsonClone(nextCase.extracted_facts ?? {}),
        missingFacts: [...(nextCase.missing_facts ?? [])],
        finalAction: finalActionForMerged,
        urgencySignals: hit.urgencySignals ?? [],
        actionReason: nextStatus === 'escalated'
          ? 'missing_facts_policy:second_clarification_blocked'
          : (hit.actionReason ?? 'merged_case'),
      };

      setAutonomousSessionOperationalCaseV1({ chatId: params.chatId, channel: params.channel, operationalCase: nextCase });
      logSessionMemoryUpdate({
        session_id: params.chatId,
        update_id: params.update_id,
        previous_state,
        new_state: nextCase,
        merged_facts: safeJsonClone(hit.extractedFacts ?? {}),
        remaining_missing_facts: [...(nextCase.missing_facts ?? [])],
      });
      return { handled: true, hit: mergedHit, case: nextCase, mode: 'merge_case' };
    }

    // Fall back to starting a new case when state is ambiguous.
    const nextCase = buildCaseFromHit({ hit, update_id: params.update_id });
    setAutonomousSessionOperationalCaseV1({ chatId: params.chatId, channel: params.channel, operationalCase: nextCase });
    logSessionMemoryUpdate({
      session_id: params.chatId,
      update_id: params.update_id,
      previous_state,
      new_state: nextCase,
      merged_facts: safeJsonClone(nextCase.extracted_facts ?? {}),
      remaining_missing_facts: [...(nextCase.missing_facts ?? [])],
    });
    return { handled: true, hit, case: nextCase, mode: 'new_case' };
  }

  // No deterministic hit — but we might be mid-case and the message is a fragment answering the last question.
  if (prevCase && isCaseOpen(prevCase)) {
    const previous_state = safeJsonClone(prevCase);
    const { next, mergedFacts } = applyFragmentToCase({
      prev: prevCase,
      text: params.text,
      surfaceLang: params.surfaceLang,
      update_id: params.update_id,
    });

    // If fragment didn't add any facts, do not claim we handled it.
    if (Object.keys(mergedFacts).length === 0) return { handled: false };

    // If case is now resolved, reply with the category-specific deterministic acknowledgement.
    const finalAction: TelegramOperationalFinalAction =
      next.status === 'resolved' ? 'reply' : next.status === 'escalated' ? 'escalate_operator' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? defaultReplyForCategory(String(next.category ?? ''), ru)
        : finalAction === 'escalate_operator'
          ? (ru
              ? `Понял(а). Нужны дополнительные детали — передаю оператору. (${buildEscalationSummaryForCase({
                  category: next.category,
                  extractedFacts: next.extracted_facts ?? {},
                  missingFacts: next.missing_facts ?? [],
                })})`
              : `Understood. We still need more details — escalating to an operator. (${buildEscalationSummaryForCase({
                  category: next.category,
                  extractedFacts: next.extracted_facts ?? {},
                  missingFacts: next.missing_facts ?? [],
                })})`)
          : (next.last_question_asked ?? pickClarifyingQuestion(next.missing_facts ?? [], ru));

    const bridgedHit: TelegramOperationalIntakeHit = {
      category: (next.category as any) ?? 'access_issue',
      reply,
      extractedFacts: safeJsonClone(next.extracted_facts ?? {}),
      missingFacts: [...(next.missing_facts ?? [])],
      finalAction,
      urgencySignals: [],
      actionReason: finalAction === 'escalate_operator'
        ? 'missing_facts_policy:followup_still_missing'
        : 'followup_fragment',
    };

    const nextCase: TelegramOperationalSessionCaseV1 = {
      ...next,
      last_question_asked: finalAction === 'clarify' ? reply : null,
      status: finalAction === 'clarify' ? 'clarifying' : finalAction === 'escalate_operator' ? 'escalated' : 'resolved',
      updated_at: nowIso(),
      last_update_id: params.update_id,
    };

    setAutonomousSessionOperationalCaseV1({ chatId: params.chatId, channel: params.channel, operationalCase: nextCase });
    logSessionMemoryUpdate({
      session_id: params.chatId,
      update_id: params.update_id,
      previous_state,
      new_state: nextCase,
      merged_facts: safeJsonClone(mergedFacts),
      remaining_missing_facts: [...(nextCase.missing_facts ?? [])],
    });
    return { handled: true, hit: bridgedHit, case: nextCase, mode: 'followup_fragment' };
  }

  return { handled: false };
}

