import { getAutonomousSessionOperationalCaseV1, setAutonomousSessionOperationalCaseV1 } from './conversation-session-store';
import type { CommunicationChannel, TelegramOperationalSessionCaseStatusV1, TelegramOperationalSessionCaseV1 } from './types';
import { tryTelegramOperationalIntake, type TelegramOperationalFinalAction, type TelegramOperationalIntakeHit } from './telegram-operational-intake';

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

function normalizeText(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[“”„"']/g, '')
    .replace(/[?!.,;:(){}\[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (/(nevsky|невский|tversk|тверск|ул\.?\s|улиц|проспект|набережн)/i.test(normalized)) return true;
  if (/\b\d{1,4}\s*[A-Za-zА-Яа-яЁё.-]+(?:st|street|str|ave|просп|пер|шоссе)\b/i.test(normalized)) return true;
  return false;
}

function extractPropertySnippet(text: string): string | null {
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

export function processTelegramOperationalIntakeWithSessionMemory(params: {
  chatId: number;
  channel: CommunicationChannel;
  text: string;
  surfaceLang: SurfaceLang;
  update_id: number;
}): TelegramSessionMemoryResult {
  const prevCase = getAutonomousSessionOperationalCaseV1(params.chatId);
  const ru = params.surfaceLang === 'ru';

  const hit = tryTelegramOperationalIntake({
    text: params.text,
    surfaceLang: params.surfaceLang,
    update_id: params.update_id,
    chat_id: params.chatId,
  });

  // If we got a fresh deterministic hit, decide whether to start new case or merge.
  if (hit) {
    const previous_state = prevCase ? safeJsonClone(prevCase) : null;

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
        actionReason: 'missing_facts_policy:clarification_already_used',
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

