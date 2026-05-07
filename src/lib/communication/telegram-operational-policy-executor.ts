import {
  TELEGRAM_OPERATIONAL_KNOWLEDGE_V1,
  type TelegramOperationalAction,
  type TelegramOperationalScenarioFamily,
} from './telegram-operational-knowledge';

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

function scenarioByCheckinTime(time: string): TelegramOperationalScenarioFamily {
  const hh = Number(time.slice(0, 2));
  if (hh >= 6 && hh <= 8) return 'CHECK_IN_VERY_EARLY';
  if (hh === 12) return 'CHECK_IN_EARLY';
  if (hh === 15) return 'CHECK_IN_STANDARD';
  if (hh >= 9 && hh <= 14) return 'CHECK_IN_EARLY';
  return 'UNKNOWN_OPERATIONAL_REQUEST';
}

function hasCheckinIntent(t: string): boolean {
  return /\bcheck[-\s]?in\b|заезд|засел|заехать|заеду|приезд|приех/i.test(t);
}

function isCheckinFamily(s: TelegramOperationalScenarioFamily | null | undefined): boolean {
  return s === 'CHECK_IN_STANDARD' || s === 'CHECK_IN_EARLY' || s === 'CHECK_IN_VERY_EARLY';
}

function hasObjectClarificationIntent(t: string): boolean {
  return /объект|адрес|на\s+тверск|брон[ьи]|booking|reservation|та\s+же\s+брон/i.test(t);
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
    const rule = TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[scenarioFamily];
    const forbiddenClaims = rule.forbiddenClaims.filter((claim) => {
      if (claim === 'do_not_mention_cleaning_without_explicit_cleaning_context') return !knownContext.cleaningStatusKnown;
      return true;
    });
    return {
      action,
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

