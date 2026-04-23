/**
 * Deterministic Telegram operational intake — runs before LLM / generic escalation copy.
 * Matches obvious staff→ops guest relay patterns without LLM confidence.
 */

export type TelegramOperationalCategory = 'access_issue' | 'late_checkout' | 'urgent_maintenance';

export type TelegramOperationalFinalAction = 'reply' | 'clarify' | 'escalate';

export type TelegramOperationalIntakeHit = {
  category: TelegramOperationalCategory;
  reply: string;
  extractedFacts: Record<string, unknown>;
  missingFacts: string[];
  finalAction: TelegramOperationalFinalAction;
};

export type TelegramOperationalIntakeParams = {
  text: string;
  surfaceLang: 'en' | 'ru';
  update_id: number;
  chat_id: number;
};

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function hasLateCheckoutIntent(n: string): boolean {
  return (
    /\blate\s+checkout\b/i.test(n) ||
    /\blate\s+check[-\s]?out\b/i.test(n) ||
    /поздн(ий|его|ему)?\s+выезд/i.test(n) ||
    (/выезд/i.test(n) && /до\s*\d{1,2}/i.test(n) && /поздн|до\s*13|до\s*14/i.test(n))
  );
}

function hasUrgentMaintenanceIntent(n: string): boolean {
  return (
    /no\s+heating|without\s+heating|no\s+heat\b|heating\s+(doesn'?t|does\s+not|isn'?t|is\s+not)\s+work|heating\s+(off|broken)|\bheating\b.*\b(not|no)\b/i.test(
      n,
    ) ||
    /нет\s+отоплен|отоплен(ие|ия)\s+нет|отопление\s+не\s+работает|батаре(и|я)\s+холодн/i.test(n) ||
    (/(very\s+cold|freezing|no\s+warm)/i.test(n) && /(apartment|flat|unit|room|квартир|апарт|жиль)/i.test(n)) ||
    (/холодно/i.test(n) && /(квартир|апарт|в\s+жиль|в\s+номер)/i.test(n))
  );
}

function hasAccessIssueIntent(n: string): boolean {
  if (hasLateCheckoutIntent(n)) return false;

  const codeDoor =
    /(door\s+code|access\s+code|entry\s+code|код\s+от\s+двери|код\s+не\s+работает|код\s+не\s+подходит|код\s+не\s+открывает)/i.test(
      n,
    ) ||
    (/(code|код)/i.test(n) && /(doesn'?t\s+work|does\s+not\s+work|not\s+work|не\s+работает|не\s+подходит|не\s+открыва)/i.test(n)) ||
    (/(lock|замок)/i.test(n) && /(doesn'?t|does\s+not|не\s+работает|не\s+открыва|failed)/i.test(n)) ||
    (/(door|дверь)/i.test(n) && /(doesn'?t|does\s+not|не\s+открыва|won'?t\s+open|not\s+open)/i.test(n));

  const checkinGuest =
    /(guest|гость|check[-\s]?in|checking\s+in|засел|заезд|приезж)/i.test(n) &&
    /(code|код|door|дверь|lock|замок|access|доступ|key|ключ)/i.test(n);

  return Boolean(codeDoor || checkinGuest);
}

function hasPropertyHint(text: string, n: string): boolean {
  if (/по\s+адресу/i.test(text)) return true;
  if (/\b(?:at|@)\s+[0-9A-Za-zА-Яа-яЁё][^.\n]{0,60}\d/i.test(text)) return true;
  if (/(nevsky|невский|tversk|тверск|ул\.?\s|улиц|проспект|набережн)/i.test(n)) return true;
  if (/\b\d{1,4}\s*[A-Za-zА-Яа-яЁё.-]+(?:st|street|str|ave|просп|пер|шоссе)\b/i.test(n)) return true;
  return false;
}

function hasCheckinTimingHint(n: string): boolean {
  return (
    /\b(today|tomorrow|tonight|сегодня|завтра|вечером)\b/i.test(n) ||
    /\d{1,2}:\d{2}/.test(n) ||
    /check[-\s]?in|заезд|засел|приезд|arriv/i.test(n)
  );
}

function hasFailureModeHint(n: string): boolean {
  if (/не\s+работает|не\s+подходит|не\s+открыва(ется|ть)?/i.test(n)) return true;
  return (
    (/(code|код)/i.test(n) && /(work|подходит|открыва|open|doesn|does\s+not)/i.test(n)) ||
    /(lock|замок)/i.test(n) ||
    /(door|дверь)/i.test(n)
  );
}

function extractGuestName(text: string): string | null {
  const m =
    text.match(/\bguest\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u) ??
    text.match(/\bгость\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u);
  return m ? m[1].trim() : null;
}

function extractPropertySnippet(text: string): string | null {
  const m1 = text.match(/по\s+адресу\s+([^.\n?]+)/i);
  if (m1) return m1[1].trim().slice(0, 120);
  const m2 = text.match(/\b(?:at|@)\s+([^.\n?]+)/i);
  if (m2) return m2[1].trim().slice(0, 120);
  return null;
}

function logIntake(
  params: TelegramOperationalIntakeParams,
  hit: TelegramOperationalIntakeHit,
): void {
  try {
    console.log(
      JSON.stringify({
        route: 'telegram_operational_intake',
        category: hit.category,
        extracted_facts: hit.extractedFacts,
        missing_facts: hit.missingFacts,
        final_action: hit.finalAction,
        update_id: params.update_id,
        chat_id: params.chat_id,
      }),
    );
  } catch {
    // never throw from logging
  }
}

/**
 * Returns a deterministic intake hit for Telegram operational guest-relay messages, or null.
 */
export function tryTelegramOperationalIntake(
  params: TelegramOperationalIntakeParams,
): TelegramOperationalIntakeHit | null {
  const raw = params.text ?? '';
  if (!raw.trim()) return null;

  const n = norm(raw);
  const ru = params.surfaceLang === 'ru';

  // 1) Urgent maintenance / no heating (highest priority)
  if (hasUrgentMaintenanceIntent(n)) {
    const guest = extractGuestName(raw);
    const hit: TelegramOperationalIntakeHit = {
      category: 'urgent_maintenance',
      reply: ru
        ? 'Понял(а). Это срочно. Передаю в операционную команду прямо сейчас.'
        : 'Understood. This looks urgent. I’m escalating this now.',
      extractedFacts: { guestName: guest ?? null, heatingOrCold: true },
      missingFacts: [],
      finalAction: 'escalate',
    };
    logIntake(params, hit);
    return hit;
  }

  // 2) Late checkout
  if (hasLateCheckoutIntent(n)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, n);
    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const hit: TelegramOperationalIntakeHit =
      missing.length === 0
        ? {
            category: 'late_checkout',
            reply: ru
              ? 'Понял(а). Зафиксировал(а) запрос на поздний выезд; проверим возможность и вернёмся с ответом.'
              : 'Understood. I’ve logged the late checkout request and will confirm availability shortly.',
            extractedFacts: { guestName: guest ?? null, property: prop ?? 'mentioned' },
            missingFacts: [],
            finalAction: 'reply',
          }
        : {
            category: 'late_checkout',
            reply: ru
              ? 'Понял(а). Проверю возможность позднего выезда. Для какого объекта/адреса это?'
              : 'Understood. I’ll check late checkout availability. What property is this for?',
            extractedFacts: { guestName: guest ?? null },
            missingFacts: missing,
            finalAction: 'clarify',
          };
    logIntake(params, hit);
    return hit;
  }

  // 3) Access / door code / lock / check-in access
  if (hasAccessIssueIntent(n)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, n);
    const hasTime = hasCheckinTimingHint(n);
    const hasFail = hasFailureModeHint(n);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasTime) missing.push('check_in_timing');
    if (!hasFail) missing.push('failure_mode');

    const facts: Record<string, unknown> = {
      guestName: guest ?? null,
      property: prop ?? (hasProp ? 'hint_present' : null),
      checkInTiming: hasTime,
      failureModeHint: hasFail,
    };

    const hit: TelegramOperationalIntakeHit =
      missing.length === 0
        ? {
            category: 'access_issue',
            reply: ru
              ? 'Понял(а). Зафиксировал(а) проблему с доступом для этого заезда (код/замок/дверь). Команда сейчас проверит доступ вместе с гостем.'
              : 'Understood — access issue logged for this check-in (code/lock/door). Our team will validate access with the guest now.',
            extractedFacts: facts,
            missingFacts: [],
            finalAction: 'reply',
          }
        : {
            category: 'access_issue',
            reply: ru
              ? 'Понял(а). Это заезд сегодня? И что именно не срабатывает: код, замок или дверь?'
              : 'Understood. Is this for today’s check-in, and what exactly fails: code, lock, or door?',
            extractedFacts: facts,
            missingFacts: missing,
            finalAction: 'clarify',
          };
    logIntake(params, hit);
    return hit;
  }

  return null;
}
