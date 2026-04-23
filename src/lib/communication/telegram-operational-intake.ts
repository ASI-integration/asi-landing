/**
 * Deterministic Telegram operational intake — runs before LLM / generic escalation copy.
 * Matches obvious staff→ops guest relay patterns without LLM confidence.
 */

export type TelegramOperationalCategory =
  | 'access_issue'
  | 'late_checkout'
  | 'early_checkin'
  | 'no_heating'
  | 'noise_complaint'
  | 'cleaning_request'
  | 'extension_request'
  | 'wifi_issue'
  | 'parking_question'
  | 'payment_confirmation';

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

function normalizeSpace(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPunctForMatch(s: string): string {
  return normalizeSpace(String(s ?? '').toLowerCase().replace(/[“”„"']/g, '').replace(/[?!.,;:(){}\[\]<>]/g, ' '));
}

function hasLateCheckoutIntent(n: string): boolean {
  return (
    /\blate\s+checkout\b/i.test(n) ||
    /\blate\s+check[-\s]?out\b/i.test(n) ||
    /поздн(ий|его|ему)?\s+выезд/i.test(n) ||
    (/выезд/i.test(n) && /до\s*\d{1,2}/i.test(n) && /поздн|до\s*13|до\s*14/i.test(n))
  );
}

function hasEarlyCheckinIntent(n: string): boolean {
  return (
    /\bearly\s+check[-\s]?in\b/i.test(n) ||
    /\bearlier\s+check[-\s]?in\b/i.test(n) ||
    /\bcheck[-\s]?in\s+early\b/i.test(n) ||
    /ранн(ий|его|ему)?\s+(заезд|засел)/i.test(n) ||
    (/заезд|засел/i.test(n) && /(раньше|пораньше|с\s*\d{1,2}(:\d{2})?)/i.test(n))
  );
}

function hasNoHeatingIntent(n: string): boolean {
  return (
    /no\s+heating|without\s+heating|no\s+heat\b|heating\s+(doesn'?t|does\s+not|isn'?t|is\s+not)\s+work|heating\s+(off|broken)|\bheating\b.*\b(not|no)\b/i.test(
      n,
    ) ||
    /\bheating\b.{0,25}\boff\b/i.test(n) ||
    /\bheating\b.{0,25}\bbroken\b/i.test(n) ||
    /нет\s+отоплен|отоплен(ие|ия)\s+нет|отопление\s+не\s+работает|батаре(и|я)\s+холодн/i.test(n) ||
    (/(very\s+cold|freezing|no\s+warm)/i.test(n) && /(apartment|flat|unit|room|квартир|апарт|жиль)/i.test(n)) ||
    (/холодно/i.test(n) && /(квартир|апарт|в\s+жиль|в\s+номер)/i.test(n))
  );
}

function hasAccessIssueIntent(n: string): boolean {
  if (hasLateCheckoutIntent(n)) return false;

  // Do NOT treat pure "door code" or "check-in info" as access issues.
  // Access_issue should require a failure/lockout signal, not just access data.
  const failureOrLockout =
    /(can'?t|cannot)\s+(get\s+in|enter|open)/i.test(n) ||
    /locked\s+out|lockout/i.test(n) ||
    /не\s+могу\s+(войти|попасть)|не\s+попад(а|у)ю|закры(т|та)\s+снаружи/i.test(n) ||
    /не\s+открыва(ется|ть)?|не\s+работает|не\s+подходит/i.test(n);

  const codeDoor =
    // "door/access/entry code" only counts if it's failing / lockout
    (/(door\s+code|access\s+code|entry\s+code|код(\s+от)?\s+двери|код)/i.test(n) && failureOrLockout) ||
    (/(code|код)/i.test(n) && /(doesn'?t\s+work|does\s+not\s+work|not\s+work|не\s+работает|не\s+подходит|не\s+открыва)/i.test(n)) ||
    (/(lock|замок)/i.test(n) && /(doesn'?t|does\s+not|не\s+работает|не\s+открыва|failed)/i.test(n)) ||
    (/(door|дверь)/i.test(n) && /(doesn'?t|does\s+not|не\s+открыва|won'?t\s+open|not\s+open)/i.test(n));

  const mentionsAccessSurface = /(code|код|door|дверь|lock|замок|intercom|домофон)/i.test(n);

  return Boolean(codeDoor || (mentionsAccessSurface && failureOrLockout));
}

function hasNoiseComplaintIntent(n: string): boolean {
  return (
    /\bnoise\b|\bloud\b|\bneighbou?r\b|\bparty\b|\bmusic\b|\bshouting\b|\bscream/i.test(n) ||
    /шум|громк|сосед|вечеринк|музык|крики?|орут|сверлят|жалоб/i.test(n)
  );
}

function hasCleaningRequestIntent(n: string): boolean {
  return (
    /\bclean(?:ing)?\b|\bhousekeep(?:ing)?\b|\bmaid\b|\bchange\s+(towels|linen|beds?)\b|\bextra\s+towels?\b/i.test(
      n,
    ) ||
    /уборк|клининг|горничн|смен(ить|а)\s+(полотенц|постел|бель)/i.test(n) ||
    /доп\s*полотенц|полотенц(а|е)\s+нужн/i.test(n) ||
    /\bservice\b/i.test(n) ||
    /сервис/i.test(n)
  );
}

function hasExtensionRequestIntent(n: string): boolean {
  return (
    /\bextend\b|\bextension\b|\bstay\s+longer\b|\bextra\s+nights?\b|\badd\s+night\b/i.test(n) ||
    /продл(ить|ение)|остаться\s+ещ[её]|доп(олнительно)?\s+ноч/i.test(n)
  );
}

function hasWifiIssueIntent(n: string): boolean {
  return (
    /\bwifi\b|\bwi-fi\b|\binternet\b|\brouter\b|\bnetwork\b|\bpassword\b/i.test(n) ||
    /вайфай|wi-?fi|интернет|роутер|маршрутизатор|парол/i.test(n)
  );
}

function hasParkingQuestionIntent(n: string): boolean {
  return (
    /\bparking\b|\bpark\b|\bcar\b|\bgarage\b|\bwhere\s+to\s+park\b/i.test(n) ||
    /парковк|парковат|машин|авто|гараж|где\s+поставить/i.test(n)
  );
}

function hasPaymentConfirmationIntent(n: string): boolean {
  // "I paid / sent payment / payment done / transfer made / screenshot" (confirmation, not request for a link)
  return (
    /\bpaid\b|\bpayment\s+(sent|done|completed|confirmed)\b|\btransfer\b|\bsent\s+the\s+money\b|\bproof\b|\breceipt\b/i.test(
      n,
    ) ||
    /оплат(ил|ила|или|а)|плат(ёж|еж)\s+(отправ|сделан|прош[её]л|подтвержд)|перев(е|ё)л|чек|квитанц|скрин/i.test(n)
  );
}

function hasPropertyHint(text: string, n: string): boolean {
  if (/по\s+адресу/i.test(text)) return true;
  // "at 11:00" is not a property; guard against time-only captures
  const atOrAtSign = text.match(/\b(?:at|@)\s+([^.\n?]+)/i);
  if (atOrAtSign) {
    const snippet = atOrAtSign[1].trim().slice(0, 40);
    if (!/^\d{1,2}:\d{2}$/.test(snippet) && !/^\d{1,2}$/.test(snippet)) return true;
  }
  if (/(nevsky|невский|tversk|тверск|ул\.?\s|улиц|проспект|набережн)/i.test(n)) return true;
  if (/\b\d{1,4}\s*[A-Za-zА-Яа-яЁё.-]+(?:st|street|str|ave|просп|пер|шоссе)\b/i.test(n)) return true;
  return false;
}

function hasTimingHint(n: string): boolean {
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

function extractDateLikeToken(n: string): 'today' | 'tomorrow' | null {
  if (/\b(today|сегодня)\b/i.test(n)) return 'today';
  if (/\b(tomorrow|завтра)\b/i.test(n)) return 'tomorrow';
  return null;
}

function extractAmountLike(text: string): string | null {
  const t = String(text ?? '');
  const m =
    t.match(/(\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?\b)\s*(rub|rur|₽|eur|€|usd|\$)/i) ??
    t.match(/(rub|rur|₽|eur|€|usd|\$)\s*(\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?\b)/i);
  if (!m) return null;
  if (m[1] && /\d/.test(m[1])) return normalizeSpace(m[1] + ' ' + (m[2] ?? '')).trim();
  if (m[2] && /\d/.test(m[2])) return normalizeSpace((m[1] ?? '') + ' ' + m[2]).trim();
  return null;
}

function extractPropertySnippet(text: string): string | null {
  const m1 = text.match(/по\s+адресу\s+([^.\n?]+)/i);
  if (m1) {
    const s = m1[1].trim().slice(0, 120);
    // Avoid capturing a time or trivial token as "property"
    if (/^\d{1,2}:\d{2}$/.test(s)) return null;
    return s;
  }
  const m2 = text.match(/\b(?:at|@)\s+([^.\n?]+)/i);
  if (m2) {
    const s = m2[1].trim().slice(0, 120);
    // "at 11:00" is timing, not a property reference
    if (/^\d{1,2}:\d{2}$/.test(s)) return null;
    if (/^\d{1,2}$/.test(s)) return null;
    return s;
  }
  return null;
}

function isUrgentOrRisky(n: string): boolean {
  // Hard escalation triggers only (safety / violence / police / medical / fire / gas / flood).
  // Keep this intentionally narrow to avoid over-escalation.
  return (
    /\bpolice\b|\bambulance\b|\bfire\b|\bsmoke\b|\bgas\b|\bflood\b|\bthreat\b|\bviolent\b|\bfight\b/i.test(n) ||
    /полици|скорая|пожар|дым|газ|затоп|угроз|драка|насили/i.test(n)
  );
}

function pickSingleClarifyingQuestion(
  category: TelegramOperationalCategory,
  missingFacts: string[],
  ru: boolean,
): string {
  const key = missingFacts[0] ?? '';
  if (key === 'property') {
    return ru ? 'Уточните, пожалуйста, для какого объекта/адреса это?' : 'Which property/address is this for?';
  }
  if (key === 'requested_time') {
    return ru ? 'На какое время это нужно?' : 'What time do you need it for?';
  }
  if (key === 'requested_date') {
    return ru ? 'На какую дату это нужно?' : 'What date is this for?';
  }
  if (key === 'wifi_details') {
    return ru
      ? 'Что именно не работает: нет сети, не подключается или пароль не подходит?'
      : 'What exactly fails: no network, can’t connect, or password not working?';
  }
  if (key === 'payment_reference') {
    return ru
      ? 'Пришлите, пожалуйста, сумму и время/скрин оплаты (или последние 4 цифры карты), чтобы сверить.'
      : 'Please share the amount and time/screenshot of payment (or last 4 digits) so we can confirm.';
  }
  if (key === 'vehicle_details') {
    return ru ? 'Уточните, пожалуйста: вы на машине? Нужна парковка на ночь или на несколько часов?' : 'Are you arriving by car, and do you need overnight parking or short-term?';
  }
  if (key === 'cleaning_scope') {
    return ru ? 'Что нужно: уборка, смена полотенец или постельного белья?' : 'What do you need: cleaning, towel change, or linen change?';
  }
  if (key === 'noise_details') {
    return ru ? 'Шум сейчас продолжается? Это музыка/вечеринка или ремонт?' : 'Is the noise ongoing right now, and is it music/party or renovation?';
  }

  // Fallback question is still deterministic and category-scoped, never "generic fallback".
  return category === 'parking_question'
    ? ru
      ? 'Уточните, пожалуйста, у объекта нужен паркинг или рядом на улице?'
      : 'Do you need on-site parking or nearby street parking?'
    : ru
      ? 'Уточните, пожалуйста, один ключевой факт, чтобы помочь: для какого адреса/объекта это?'
      : 'Please share one key detail so we can help: which property/address is this for?';
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
  const loose = stripPunctForMatch(raw);
  const ru = params.surfaceLang === 'ru';

  // Urgent/risk signal always escalates (but still categorized deterministically if possible).
  const risky = isUrgentOrRisky(loose);

  // 1) Access / door code / lock / check-in access
  if (hasAccessIssueIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const dateToken = extractDateLikeToken(loose);
    const hasFail = hasFailureModeHint(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasFail) missing.push('failure_mode');

    const facts: Record<string, unknown> = {
      guestName: guest ?? null,
      property: prop ?? (hasProp ? 'hint_present' : null),
      requestedTime: time ?? null,
      requestedDateToken: dateToken ?? null,
      failureModeHint: hasFail,
    };

    const finalAction: TelegramOperationalFinalAction = risky ? 'escalate' : missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Зафиксировал(а) проблему с доступом (код/замок/дверь). Команда сейчас проверит и поможет гостю попасть внутрь.'
          : 'Understood — access issue logged (code/lock/door). Our team will verify and help the guest get inside now.'
        : finalAction === 'escalate'
          ? ru
            ? 'Понял(а). Похоже на срочную ситуацию с доступом. Передаю в операционную команду прямо сейчас.'
            : 'Understood. This looks urgent (access/safety). I’m escalating this now.'
          : pickSingleClarifyingQuestion('access_issue', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'access_issue',
      reply,
      extractedFacts: facts,
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 2) No heating / cold apartment
  if (hasNoHeatingIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);

    const urgentCold =
      risky ||
      /\bvery\s+cold\b|\bfreezing\b|\bno\s+heat\b/i.test(loose) ||
      /очень\s+холодно|замерза|нет\s+отоплен/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const finalAction: TelegramOperationalFinalAction = urgentCold ? 'escalate' : missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'escalate'
        ? ru
          ? 'Понял(а). Это срочно. Передаю заявку по отоплению в операционную команду прямо сейчас.'
          : 'Understood. This is urgent. I’m escalating the heating issue right now.'
        : finalAction === 'reply'
          ? ru
            ? 'Понял(а). Зафиксировал(а) проблему с отоплением; команда проверит и вернётся с обновлением.'
            : 'Understood. Heating issue logged; the team will check and update you shortly.'
          : pickSingleClarifyingQuestion('no_heating', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'no_heating',
      reply,
      extractedFacts: { guestName: guest ?? null, property: prop ?? (hasProp ? 'hint_present' : null), requestedTime: time ?? null },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 3) Late checkout
  if (hasLateCheckoutIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const dateToken = extractDateLikeToken(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const finalAction: TelegramOperationalFinalAction = missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Зафиксировал(а) запрос на поздний выезд; проверим возможность и вернёмся с ответом.'
          : 'Understood. I’ve logged the late checkout request and will confirm availability shortly.'
        : pickSingleClarifyingQuestion('late_checkout', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'late_checkout',
      reply,
      extractedFacts: {
        guestName: guest ?? null,
        property: prop ?? (hasProp ? 'hint_present' : null),
        requestedTime: time ?? null,
        requestedDateToken: dateToken ?? null,
      },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 4) Early check-in
  if (hasEarlyCheckinIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const dateToken = extractDateLikeToken(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const finalAction: TelegramOperationalFinalAction = missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Зафиксировал(а) запрос на ранний заезд; проверим возможность и вернёмся с подтверждением.'
          : 'Understood. I’ve logged the early check-in request and will confirm availability shortly.'
        : pickSingleClarifyingQuestion('early_checkin', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'early_checkin',
      reply,
      extractedFacts: {
        guestName: guest ?? null,
        property: prop ?? (hasProp ? 'hint_present' : null),
        requestedTime: time ?? null,
        requestedDateToken: dateToken ?? null,
      },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 5) Noise complaint
  if (hasNoiseComplaintIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const urgent = risky || /\bnow\b|\bright\s+now\b|\bcan'?t\s+sleep\b/i.test(loose) || /сейчас|прямо\s+сейчас|не\s+могу\s+спать/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    // "noise" / "шум" alone is not enough — ask what kind (party/music/renovation/etc).
    const hasAnyNoiseKeyword = /\bnoise\b|\bloud\b|шум|громк/i.test(loose);
    const hasTypeKeyword = /(party|music|neighbor|neighbou?r|shouting|scream|ремонт|музык|сосед|вечеринк|крики?|орут|сверлят)/i.test(
      loose,
    );
    if (hasAnyNoiseKeyword && !hasTypeKeyword) missing.push('noise_details');

    const finalAction: TelegramOperationalFinalAction = urgent ? 'escalate' : missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'escalate'
        ? ru
          ? 'Понял(а). Передаю шумовую жалобу в операционную команду прямо сейчас.'
          : 'Understood. I’m escalating the noise complaint to the ops team now.'
        : finalAction === 'reply'
          ? ru
            ? 'Понял(а). Зафиксировал(а) жалобу на шум; команда свяжется и постарается быстро решить.'
            : 'Understood. Noise complaint logged; the team will reach out and resolve it as quickly as possible.'
          : pickSingleClarifyingQuestion('noise_complaint', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'noise_complaint',
      reply,
      extractedFacts: {
        guestName: guest ?? null,
        property: prop ?? (hasProp ? 'hint_present' : null),
        requestedTime: time ?? null,
      },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 6) Cleaning request (incl. towels/linen)
  if (hasCleaningRequestIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const dateToken = extractDateLikeToken(loose);
    const wantsTowels = /\btowel/i.test(loose) || /полотенц/i.test(loose);
    const wantsLinen = /\blinen|beds?/i.test(loose) || /постел|бель/i.test(loose);
    // Require explicit cleaning words; "housekeeping/service/горничная" without details should trigger clarification.
    const wantsCleaning = /\bclean\b|\bcleaning\b/i.test(loose) || /уборк|клининг/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!(wantsTowels || wantsLinen || wantsCleaning)) missing.push('cleaning_scope');

    const finalAction: TelegramOperationalFinalAction = missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Зафиксировал(а) запрос на уборку/сервис; согласуем время и вернёмся с подтверждением.'
          : 'Understood. Housekeeping request logged; we’ll coordinate timing and confirm shortly.'
        : pickSingleClarifyingQuestion('cleaning_request', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'cleaning_request',
      reply,
      extractedFacts: {
        guestName: guest ?? null,
        property: prop ?? (hasProp ? 'hint_present' : null),
        requestedTime: time ?? null,
        requestedDateToken: dateToken ?? null,
        scope: { cleaning: wantsCleaning, towels: wantsTowels, linen: wantsLinen },
      },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 7) Extension request (stay longer)
  if (hasExtensionRequestIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const dateToken = extractDateLikeToken(loose);
    const time = extractTimeLike(raw);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const finalAction: TelegramOperationalFinalAction = missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Зафиксировал(а) запрос на продление проживания; проверим доступность и стоимость и вернёмся с ответом.'
          : 'Understood. Extension request logged; we’ll confirm availability and pricing shortly.'
        : pickSingleClarifyingQuestion('extension_request', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'extension_request',
      reply,
      extractedFacts: {
        guestName: guest ?? null,
        property: prop ?? (hasProp ? 'hint_present' : null),
        requestedDateToken: dateToken ?? null,
        requestedTime: time ?? null,
      },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 8) Wi‑Fi issue
  if (hasWifiIssueIntent(loose) && !hasPaymentConfirmationIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const hasDetails =
      /\bpassword\b|\bwrong\b|\bdoesn'?t\s+work\b|\bcan'?t\s+connect\b|\bno\s+internet\b|\brouter\b/i.test(loose) ||
      /парол|не\s+подход|не\s+работает|не\s+подключ|нет\s+интернет|роутер/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasDetails) missing.push('wifi_details');

    const finalAction: TelegramOperationalFinalAction = missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Зафиксировал(а) проблему с Wi‑Fi; команда проверит сеть/пароль и вернётся с решением.'
          : 'Understood. Wi‑Fi issue logged; the team will check the network/password and get back with a fix.'
        : pickSingleClarifyingQuestion('wifi_issue', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'wifi_issue',
      reply,
      extractedFacts: { guestName: guest ?? null, property: prop ?? (hasProp ? 'hint_present' : null), hasDetails },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 9) Parking question
  if (hasParkingQuestionIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const hasVehicleDetails = /\bcar\b|\bvehicle\b|\bplate\b|\bparking\s+overnight\b/i.test(loose) || /машин|авто|номер\s+машин/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasVehicleDetails) missing.push('vehicle_details');

    const finalAction: TelegramOperationalFinalAction = missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Уточню правила парковки для этого адреса и вернусь с инструкцией (где можно/нельзя, платно/бесплатно).'
          : 'Understood. I’ll confirm parking options for this address and return with clear instructions (where to park, paid/free).'
        : pickSingleClarifyingQuestion('parking_question', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'parking_question',
      reply,
      extractedFacts: { guestName: guest ?? null, property: prop ?? (hasProp ? 'hint_present' : null), hasVehicleDetails },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  // 10) Payment confirmation (guest says they paid)
  if (hasPaymentConfirmationIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const amount = extractAmountLike(raw);
    const time = extractTimeLike(raw);
    const hasReference = Boolean(amount || time || /\breceipt\b|\bscreenshot\b/i.test(loose) || /чек|скрин/i.test(loose));

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasReference) missing.push('payment_reference');

    const finalAction: TelegramOperationalFinalAction = missing.length === 0 ? 'reply' : 'clarify';
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял(а). Спасибо — передаю подтверждение оплаты в операционную команду для сверки. Если есть чек/скрин, пришлите — это ускорит.'
          : 'Understood, thank you — I’m forwarding the payment confirmation to ops to verify. If you have a receipt/screenshot, please share it to speed things up.'
        : pickSingleClarifyingQuestion('payment_confirmation', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'payment_confirmation',
      reply,
      extractedFacts: {
        guestName: guest ?? null,
        property: prop ?? (hasProp ? 'hint_present' : null),
        amount: amount ?? null,
        time: time ?? null,
      },
      missingFacts: missing,
      finalAction,
    };
    logIntake(params, hit);
    return hit;
  }

  return null;
}
