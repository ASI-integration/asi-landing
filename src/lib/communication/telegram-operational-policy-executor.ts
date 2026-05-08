import {
  classifyCanonicalCheckinTime,
  decideCanonicalTelegramAction,
  getTelegramOperationalRule,
  type TelegramOperationalAction,
  type TelegramOperationalScenarioFamily,
} from './telegram-communication-canon';

type KnownContext = {
  objectLabel?: string | null;
  bookingReference?: string | null;
  cleaningStatusKnown?: boolean;
};

type TelegramOperationalPolicyMessage = {
  role: 'guest' | 'bot';
  text: string;
  update_id?: number;
};

export type TelegramOperationalPolicySessionMemory = {
  knownContext?: KnownContext;
  lastScenarioFamily?: TelegramOperationalScenarioFamily | null;
  lastSlowAckUpdateId?: number | null;
  unknownOperationalAttemptCount?: number;
};

export type TelegramOperationalPolicyInput = {
  messageText: string;
  update_id?: number;
  sessionMemory?: TelegramOperationalPolicySessionMemory | null;
  knownContext?: KnownContext | null;
  history?: TelegramOperationalPolicyMessage[] | null;
};

export type TelegramOperationalPolicyResult = {
  action: TelegramOperationalAction;
  scenarioFamily: TelegramOperationalScenarioFamily;
  confidence: number;
  requiredContext: string[];
  safeReplyFacts: string[];
  forbiddenClaims: string[];
  nextSessionMemory: TelegramOperationalPolicySessionMemory;
};

export type TelegramOperationalMultiIntentResult = {
  intents: TelegramOperationalPolicyResult[];
  nextSessionMemory: TelegramOperationalPolicySessionMemory;
};

function hasKnownObjectOrBooking(ctx: KnownContext | null | undefined): boolean {
  return Boolean((ctx?.objectLabel && ctx.objectLabel.trim()) || (ctx?.bookingReference && ctx.bookingReference.trim()));
}

function parseTime(text: string): string | null {
  const m = String(text ?? '').match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseTimes(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\b(\d{1,2}):(\d{2})\b/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) continue;
    const t = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function scenarioByCheckinTime(time: string): TelegramOperationalScenarioFamily {
  return classifyCanonicalCheckinTime(time).scenarioFamily ?? 'UNKNOWN_OPERATIONAL_REQUEST';
}

function hasCheckinIntent(t: string): boolean {
  return /\bcheck[-\s]?in\b|заезд|засел|заехать|заеду|приезд|приех/i.test(t);
}

function isCheckinFamily(s: TelegramOperationalScenarioFamily | null | undefined): boolean {
  return s === 'CHECK_IN_STANDARD' || s === 'CHECK_IN_EARLY' || s === 'CHECK_IN_VERY_EARLY';
}

function hasObjectClarificationIntent(t: string): boolean {
  if (hasAddressFindObjectIntent(t)) return false;
  return /на\s+тверск|booking\s+ref|reservation\s+id|та\s+же\s+брон/i.test(t);
}

function hasLateCheckoutIntent(t: string): boolean {
  return /\blate\s*check[-\s]?out\b|поздн(ий|его|ему)?\s+(выезд|checkout)|выезд\s+до\s*\d{1,2}|выезд\s+попозже/i.test(t);
}

function hasAccessKeyIssueIntent(t: string): boolean {
  return /не\s+могу\s+войти|не\s+открыва|код.{0,30}(не\s+работает|не\s+подходит|не\s+открыва)|не\s+работает.{0,20}код|замок|домофон|cannot\s+enter|locked\s*out|door\s+code/i.test(t);
}

function hasAddressFindObjectIntent(t: string): boolean {
  return /как\s+найти|как\s+доехать|как\s+пройти|где.*вход|как\s+вас\s+найти|какой\s+адрес|how\s+to\s+find|where\s+is\s+entrance|address/i.test(t);
}

function hasWifiIntent(t: string): boolean {
  return /\bwi(?:[\-\u2010-\u2015 ]?)fi\b|вайфай|интернет|пароль\s+от\s+wi|router/i.test(t);
}

function hasParkingIntent(t: string): boolean {
  return /парков|машин|авто|garage|parking|park\s+car/i.test(t);
}

function hasPetsIntent(t: string): boolean {
  return /питом|собак|кошк|кот|pet|dog|cat/i.test(t);
}

function hasExtraGuestsIntent(t: string): boolean {
  return /доп(олнительн)?\s+гост|extra\s+guest|нас\s+будет\s+\d|plus\s+one|еще\s+один\s+человек/i.test(t);
}

function hasDocumentsPassportIntent(t: string): boolean {
  return /паспорт|документ|регистрац|passport|document|id\s+upload/i.test(t);
}

function hasPaymentDepositIntent(t: string): boolean {
  return /оплат|платеж|плат[её]ж|залог|депозит|payment|deposit|refund\s+status/i.test(t);
}

function hasCancellationRefundIntent(t: string): boolean {
  return /отмен|refund|cancell|вернуть\s+деньги|возврат/i.test(t);
}

function hasCleaningLinenTowelsIntent(t: string): boolean {
  return /уборк|полотен|постел|бель[её]|cleaning|housekeeping|linen|towel/i.test(t);
}

function hasEmergencyUrgentIntent(t: string): boolean {
  return /пожар|дым|газ|затоп|скор|полици|человеку\s+плохо|fire|smoke|gas\s+leak|flood|ambulance|police/i.test(t);
}

function hasUrgentAccessIntent(t: string): boolean {
  return hasAccessKeyIssueIntent(t) && /срочн|urgent|немедл|прямо\s+сейчас|cannot\s+enter\s+now|locked\s+out\s+now/i.test(t);
}

function hasOperatorHandoffIntent(t: string): boolean {
  return /соедините.*(оператор|менеджер)|позовите.*(оператор|менеджер|живого\s+человека)|нужен.*(оператор|менеджер)|human\s+agent|live\s+agent|connect\s+me/i.test(t);
}

function hasComplaintsProblemsIntent(t: string): boolean {
  return /жалоб|проблем|не\s+работает|сломал|complaint|problem|issue|broken/i.test(t);
}

function mergeKnownContext(input: TelegramOperationalPolicyInput): KnownContext {
  return {
    objectLabel: input.knownContext?.objectLabel ?? input.sessionMemory?.knownContext?.objectLabel ?? null,
    bookingReference: input.knownContext?.bookingReference ?? input.sessionMemory?.knownContext?.bookingReference ?? null,
    cleaningStatusKnown: Boolean(
      input.knownContext?.cleaningStatusKnown ?? input.sessionMemory?.knownContext?.cleaningStatusKnown ?? false,
    ),
  };
}

function splitOperationalMessage(messageText: string): string[] {
  const text = String(messageText ?? '').trim();
  if (!text) return [];
  const parts = text
    .split(/[,\.\n\r;!?]+|(?:\s+(?:и\s+)?(?:ещ[её]|также)\s+)/gi)
    .map((p) => p.trim())
    .filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(part);
    }
  }
  return uniq.length > 0 ? uniq : [text];
}

export function executeTelegramOperationalPolicyMultiIntent(
  input: TelegramOperationalPolicyInput,
): TelegramOperationalMultiIntentResult {
  const text = String(input.messageText ?? '').trim();
  if (!text) {
    const single = executeTelegramOperationalPolicy(input);
    return { intents: [single], nextSessionMemory: single.nextSessionMemory };
  }

  const times = parseTimes(text);
  const clauses = splitOperationalMessage(text);
  const intents: TelegramOperationalPolicyResult[] = [];
  let memory: TelegramOperationalPolicySessionMemory =
    input.sessionMemory ?? {
      knownContext: input.knownContext ?? undefined,
      lastScenarioFamily: null,
      lastSlowAckUpdateId: null,
      unknownOperationalAttemptCount: 0,
    };
  let hasSlowAckForUpdate = false;

  const pushIntent = (res: TelegramOperationalPolicyResult) => {
    if (res.action === 'slow_ack') {
      if (hasSlowAckForUpdate) return;
      hasSlowAckForUpdate = true;
    }
    intents.push(res);
    memory = res.nextSessionMemory;
  };

  for (const t of times) {
    const res = executeTelegramOperationalPolicy({
      ...input,
      messageText: `заезд в ${t}`,
      sessionMemory: memory,
    });
    if (isCheckinFamily(res.scenarioFamily)) {
      pushIntent(res);
    }
  }

  for (const clause of clauses) {
    const normalized = clause.toLowerCase();
    if (hasCheckinIntent(normalized) && parseTime(clause)) continue;
    if (hasUrgentAccessIntent(normalized)) {
      pushIntent({
        ...executeTelegramOperationalPolicy({
          ...input,
          messageText: clause,
          sessionMemory: memory,
        }),
        action: 'escalate',
        scenarioFamily: 'ACCESS_KEY_ISSUE',
      });
      continue;
    }
    if (
      !hasLateCheckoutIntent(normalized) &&
      !hasAccessKeyIssueIntent(normalized) &&
      !hasAddressFindObjectIntent(normalized) &&
      !hasWifiIntent(normalized) &&
      !hasParkingIntent(normalized) &&
      !hasPetsIntent(normalized) &&
      !hasDocumentsPassportIntent(normalized) &&
      !hasCancellationRefundIntent(normalized) &&
      !hasComplaintsProblemsIntent(normalized) &&
      !hasEmergencyUrgentIntent(normalized) &&
      !hasOperatorHandoffIntent(normalized) &&
      !hasCheckinIntent(normalized)
    ) {
      continue;
    }

    const res = executeTelegramOperationalPolicy({
      ...input,
      messageText: clause,
      sessionMemory: memory,
    });
    pushIntent(res);
  }

  if (intents.length === 0) {
    const single = executeTelegramOperationalPolicy({ ...input, sessionMemory: memory });
    pushIntent(single);
  }

  return { intents, nextSessionMemory: memory };
}

export function executeTelegramOperationalPolicy(input: TelegramOperationalPolicyInput): TelegramOperationalPolicyResult {
  const text = String(input.messageText ?? '').trim();
  const normalized = text.toLowerCase();
  const knownContext = mergeKnownContext(input);
  const knownObjectOrBooking = hasKnownObjectOrBooking(knownContext);
  const updateId = typeof input.update_id === 'number' ? input.update_id : null;

  const baseMemory: TelegramOperationalPolicySessionMemory = {
    knownContext,
    lastScenarioFamily: input.sessionMemory?.lastScenarioFamily ?? null,
    lastSlowAckUpdateId: input.sessionMemory?.lastSlowAckUpdateId ?? null,
    unknownOperationalAttemptCount: input.sessionMemory?.unknownOperationalAttemptCount ?? 0,
  };

  const withResult = (
    action: TelegramOperationalAction,
    scenarioFamily: TelegramOperationalScenarioFamily,
    confidence: number,
    mutate?: (m: TelegramOperationalPolicySessionMemory) => void,
  ): TelegramOperationalPolicyResult => {
    const next = { ...baseMemory };
    next.lastScenarioFamily = scenarioFamily;
    if (mutate) mutate(next);
    const rule = getTelegramOperationalRule(scenarioFamily);
    const canonicalAction = decideCanonicalTelegramAction({
      scenarioFamily,
      hasKnownObjectOrBooking: knownObjectOrBooking,
      requestedAction: action,
    });
    const forbiddenClaims = rule.forbiddenClaims.filter((claim) => {
      if (claim === 'do_not_mention_cleaning_without_explicit_cleaning_context') return !knownContext.cleaningStatusKnown;
      return true;
    });
    return {
      action: canonicalAction,
      scenarioFamily,
      confidence,
      requiredContext: [...rule.requiredContext],
      safeReplyFacts: [...rule.safeReplyFacts],
      forbiddenClaims,
      nextSessionMemory: next,
    };
  };

  if (hasObjectClarificationIntent(normalized)) {
    const object = /тверск/i.test(text) ? 'на Тверской' : null;
    const booking = /та\s+же\s+брон/i.test(normalized) ? 'same_booking' : null;
    return withResult('auto_reply', 'BOOKING_CONTEXT', 0.9, (m) => {
      m.knownContext = {
        ...m.knownContext,
        objectLabel: object ?? m.knownContext?.objectLabel ?? null,
        bookingReference: booking ?? m.knownContext?.bookingReference ?? null,
      };
    });
  }

  if (hasEmergencyUrgentIntent(normalized)) {
    return withResult('escalate', 'EMERGENCY_URGENT_ISSUE', 0.98);
  }

  if (hasOperatorHandoffIntent(normalized)) {
    return withResult('escalate', 'OPERATOR_HANDOFF', 0.95);
  }

  if (hasAccessKeyIssueIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'escalate' : 'clarify', 'ACCESS_KEY_ISSUE', 0.95);
  }

  if (hasCancellationRefundIntent(normalized)) {
    return withResult('escalate', 'CANCELLATION_REFUND', 0.92);
  }

  if (hasLateCheckoutIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'LATE_CHECKOUT', 0.92);
  }

  if (hasAddressFindObjectIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'ADDRESS_FIND_OBJECT', 0.9);
  }

  if (hasWifiIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'WIFI', 0.9);
  }

  if (hasParkingIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'PARKING', 0.89);
  }

  if (hasPetsIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'PETS', 0.88);
  }

  if (hasExtraGuestsIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'EXTRA_GUESTS', 0.88);
  }

  if (hasDocumentsPassportIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'DOCUMENTS_PASSPORT', 0.87);
  }

  if (hasPaymentDepositIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'PAYMENT_DEPOSIT', 0.88);
  }

  if (hasCleaningLinenTowelsIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'CLEANING_LINEN_TOWELS', 0.9);
  }

  if (hasComplaintsProblemsIntent(normalized)) {
    return withResult(knownObjectOrBooking ? 'auto_reply' : 'clarify', 'COMPLAINTS_PROBLEMS', 0.84);
  }

  const time = parseTime(text);
  const implicitCheckinFollowup = Boolean(time) && knownObjectOrBooking && /(а\s+если|если\s+в\s*\d{1,2}:\d{2})/i.test(normalized);
  if (time && (hasCheckinIntent(normalized) || isCheckinFamily(baseMemory.lastScenarioFamily) || implicitCheckinFollowup)) {
    const scenario = scenarioByCheckinTime(time);
    if (scenario === 'CHECK_IN_STANDARD' || scenario === 'CHECK_IN_EARLY' || scenario === 'CHECK_IN_VERY_EARLY') {
      const needsClarification = !knownObjectOrBooking;
      return withResult(needsClarification ? 'clarify' : 'auto_reply', scenario, 0.95);
    }
  }

  if (hasCheckinIntent(normalized) && !time) {
    return withResult(!knownObjectOrBooking ? 'clarify' : 'auto_reply', 'OBJECT_CLARIFICATION', 0.72);
  }

  const unknownAttempt = (baseMemory.unknownOperationalAttemptCount ?? 0) + 1;
  if (updateId !== null && baseMemory.lastSlowAckUpdateId === updateId) {
    return withResult('escalate', 'ESCALATE_TO_OPERATOR', 0.85, (m) => {
      m.unknownOperationalAttemptCount = unknownAttempt;
    });
  }
  if (unknownAttempt <= 1) {
    return withResult('slow_ack', 'SLOW_ACK', 0.61, (m) => {
      m.lastSlowAckUpdateId = updateId;
      m.unknownOperationalAttemptCount = unknownAttempt;
    });
  }
  return withResult('escalate', 'UNKNOWN_OPERATIONAL_REQUEST', 0.7, (m) => {
    m.unknownOperationalAttemptCount = unknownAttempt;
  });
}

