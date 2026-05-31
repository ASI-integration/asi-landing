import type { TelegramOperationalScenarioFamily } from './communication-canon';

export type CommunicationIntentHint =
  | 'wifi'
  | 'access'
  | 'checkin_instructions'
  | 'late_checkout'
  | 'parking'
  | 'pets'
  | 'cancellation_refund'
  | 'complaint'
  | 'operator_handoff';

export type CommunicationIntentConfidence = {
  intent: CommunicationIntentHint;
  scenarioFamily: TelegramOperationalScenarioFamily;
  confidence: number;
  signals: string[];
};

export type CommunicationLanguageHint = {
  current: 'ru' | 'en' | 'mixed' | 'unknown';
  dominant: 'ru' | 'en' | 'unknown';
  confidence: number;
};

export type CommunicationToneHint = {
  level: 'neutral' | 'confused' | 'stressed' | 'angry';
  angry: boolean;
  stressed: boolean;
  confused: boolean;
  signals: string[];
};

export type CommunicationSemanticReferenceHint = {
  previousMessage: boolean;
  sameBooking: boolean;
  sameObject: boolean;
  needsStoredContext: boolean;
};

export type CommunicationCanonNormalization = {
  intents: CommunicationIntentHint[];
  scenarioFamilies: TelegramOperationalScenarioFamily[];
  intentDetails: CommunicationIntentConfidence[];
  confidence: number;
  lowConfidence: boolean;
  urgency: {
    urgent: boolean;
    accessBlocked: boolean;
  };
  language: CommunicationLanguageHint;
  tone: CommunicationToneHint;
  semanticReferences: CommunicationSemanticReferenceHint;
};

function looseText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[“”„"']/g, '')
    .replace(/[?!.,;:(){}\[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function detectLanguage(raw: string): CommunicationLanguageHint {
  const text = String(raw ?? '');
  const ruLetters = (text.match(/[а-яё]/gi) ?? []).length;
  const latinWords = (text.match(/[a-z]{2,}/gi) ?? []).length;
  if (ruLetters === 0 && latinWords === 0) {
    return { current: 'unknown', dominant: 'unknown', confidence: 0.2 };
  }
  if (ruLetters > 0 && latinWords > 0) {
    const ruScore = ruLetters;
    const enScore = latinWords * 4;
    const dominant = ruScore > enScore * 1.25 ? 'ru' : enScore > ruScore * 1.25 ? 'en' : 'unknown';
    const total = ruScore + enScore;
    const confidence = dominant === 'unknown' ? 0.58 : Math.max(0.62, Math.max(ruScore, enScore) / total);
    return { current: 'mixed', dominant, confidence: clampConfidence(confidence) };
  }
  if (ruLetters > 0) return { current: 'ru', dominant: 'ru', confidence: 0.94 };
  return { current: 'en', dominant: 'en', confidence: 0.9 };
}

const ANGRY_TONE_PATTERNS = [
  /\b(angry|furious|ridiculous|unacceptable|terrible|awful|wtf)\b/i,
  /ужас|кошмар|злюсь|зол|неприемлем|безобраз|сколько\s+можно|что\s+за/i,
];

const STRESSED_TONE_PATTERNS = [
  /\b(stress|stressed|panic|panicking|asap|urgent|help|stuck|locked\s*out)\b/i,
  /срочн|паник|помогите|помощь|застрял|не\s+могу\s+попасть|я\s+у\s+(двери|входа)/i,
];

const CONFUSED_TONE_PATTERNS = [
  /\b(confused|don'?t\s+understand|where|how)\b/i,
  /не\s+понимаю|непонятно|куда|как\s+(это|мне|попасть|заселиться)/i,
];

function detectTone(text: string): CommunicationToneHint {
  const signals: string[] = [];
  const angry = matchesAny(text, ANGRY_TONE_PATTERNS);
  const stressed = matchesAny(text, STRESSED_TONE_PATTERNS);
  const confused = matchesAny(text, CONFUSED_TONE_PATTERNS);
  if (angry) signals.push('angry');
  if (stressed) signals.push('stressed');
  if (confused) signals.push('confused');
  const level = angry ? 'angry' : stressed ? 'stressed' : confused ? 'confused' : 'neutral';
  return { level, angry, stressed, confused, signals };
}

function detectSemanticReferences(text: string): CommunicationSemanticReferenceHint {
  const previousMessage = matchesAny(text, [
    /я\s+уже\s+писал|как\s+я\s+говорил|я\s+же\s+писал|уже\s+отправлял/i,
    /\b(i\s+already\s+wrote|as\s+i\s+said|like\s+i\s+said|mentioned\s+before)\b/i,
  ]);
  const sameBooking = matchesAny(text, [
    /та\s+же\s+брон|та\s+же\s+брон[ьиь]|по\s+той\s+же\s+брон/i,
    /\bsame\s+(booking|reservation)\b/i,
  ]);
  const sameObject = matchesAny(text, [
    /тот\s+же\s+объект|та\s+же\s+(квартира|квартир|апарт|апартам)|тот\s+же\s+адрес/i,
    /\bsame\s+(apartment|property|flat|unit|address)\b/i,
  ]);
  return {
    previousMessage,
    sameBooking,
    sameObject,
    needsStoredContext: sameBooking || sameObject,
  };
}

const WIFI_PATTERNS = [
  /\bwi[\s-]?fi\b/i,
  /\bwifi\b/i,
  /вай[\s-]?фай/i,
  /ви[\s-]?фи/i,
  /вафл|вафля/i,
  /инет|интернет/i,
  /\brouter\b/i,
  /\bpass(word)?\b.{0,16}\bwi[\s-]?fi\b/i,
  /\bwi[\s-]?fi\b.{0,16}\b(pass|code|password)\b/i,
  /парол[ья]?.{0,18}(wifi|wi[\s-]?fi|вай[\s-]?фай|интернет)/i,
];

const ACCESS_FAILURE_PATTERNS = [
  /код.{0,24}(не\s+работает|не\s+подходит|not\s+work|doesnt\s+work|does\s+not\s+work)/i,
  /(door\s+code|access\s+code|entry\s+code).{0,24}(not\s+work|doesnt\s+work|does\s+not\s+work)/i,
  /(can'?t|cannot|cant)\s+(enter|get\s+in|open)/i,
  /locked\s*out/i,
  /не\s+могу\s+(войти|попасть|открыть)/i,
  /не\s+открыва(ется|ет|ю)/i,
  /не\s+попада(ю|ем)|не\s+попасть/i,
];

const CHECKIN_READINESS_ACCESS_PATTERNS = [
  /квартир[аыуе].{0,32}(готов|готовности|готова)/i,
  /(объект|номер|апартамент).{0,24}(готов|готовности|готова)/i,
  /готовност[ьи].{0,24}(квартир|объекта|номера|объект)/i,
  /(хочу|нужно|можно|надо).{0,40}(уточнить|проверить|узнать).{0,40}(готов|готовности)/i,
  /(нужен|нужна|нужно|дайте|пришлите|хочу).{0,28}(ключ|код).{0,28}(доступ|вход)/i,
  /(ключ|код).{0,20}(доступ|вход|заселен)/i,
  /доступ.{0,16}(ключ|код)/i,
];

const ACCESS_INSTRUCTION_PATTERNS = [
  /как\s+(заселиться|попасть|войти|найти\s+вход)/i,
  /как\s+открыть/i,
  /я\s+у\s+(двери|входа)/i,
  /мы\s+у\s+(двери|входа)/i,
  /\bu\s+at\s+(door|entrance)\b/i,
  /\bat\s+the\s+(door|entrance)\b/i,
  /\b(checkin|check\s+in)\s+(info|instructions|code)\b/i,
  /\bcan\s+u\s+send\s+(checkin|check\s+in)\b/i,
  /\bsend\s+(checkin|check\s+in)\b/i,
  /\bhow\s+(to\s+)?(get\s+in|enter|check\s+in)\b/i,
  ...CHECKIN_READINESS_ACCESS_PATTERNS,
];

const LATE_CHECKOUT_PATTERNS = [
  /\blate\s*check[-\s]?out\b/i,
  /\bcheckout\s+later\b/i,
  /поздн(ий|его|ему)?\s+выезд/i,
  /выезд\s+попозже/i,
  /можно\s+позже\s+выех/i,
  /позже\s+выех/i,
];

const PARKING_PATTERNS = [
  /\bparking\b/i,
  /\bpark(ing)?\s+(car|spot)?\b/i,
  /\bu\s+have\s+parking\b/i,
  /парков|паркинг|машин|авто/i,
];

const PETS_PATTERNS = [
  /\bpets?\s*(ok|allowed)?\b/i,
  /\bpet\s*friendly\b/i,
  /\bdog\b|\bcat\b/i,
  /с\s+(собак|кот|кошк|животн)/i,
  /питом|животн|собак|кошк|кот/i,
  /\bsobak|kot|zhivotn/i,
];

const CANCELLATION_REFUND_PATTERNS = [
  /\brefund\b|\bcancell?ation\b|\bcancel\b/i,
  /отмен|возврат|вернуть\s+деньги/i,
];

const COMPLAINT_PATTERNS = [
  /\bcomplaint\b|\bterrible\b|\bunacceptable\b|\bscam\b|\bfraud\b/i,
  /жалоб|ужас|неприемлемо|обман|мошен/i,
];

const OPERATOR_PATTERNS = [
  /\boperator\b|\bhuman\s+(agent|person)\b|\blive\s+agent\b/i,
  /оператор|менеджер|жив(ой|ого)\s+человек/i,
];

const URGENT_PATTERNS = [
  /\burgent\b|\basap\b|\bright\s+now\b|\bnow\b/i,
  /срочн|прямо\s+сейчас|немедленно|сейчас/i,
];

export function normalizeGuestMessageForCanon(messageText: string): CommunicationCanonNormalization {
  const raw = String(messageText ?? '');
  const text = looseText(messageText);
  const intents: CommunicationIntentHint[] = [];
  const scenarioFamilies: TelegramOperationalScenarioFamily[] = [];
  const intentDetails: CommunicationIntentConfidence[] = [];

  const addIntent = (
    intent: CommunicationIntentHint,
    scenarioFamily: TelegramOperationalScenarioFamily,
    confidence: number,
    signals: string[],
  ): void => {
    pushUnique(intents, intent);
    pushUnique(scenarioFamilies, scenarioFamily);
    const existing = intentDetails.find((detail) => detail.intent === intent && detail.scenarioFamily === scenarioFamily);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, clampConfidence(confidence));
      existing.signals = Array.from(new Set([...existing.signals, ...signals]));
      return;
    }
    intentDetails.push({
      intent,
      scenarioFamily,
      confidence: clampConfidence(confidence),
      signals,
    });
  };

  const wifi = matchesAny(text, WIFI_PATTERNS);
  const accessFailure = matchesAny(text, ACCESS_FAILURE_PATTERNS);
  const accessInstructions = matchesAny(text, ACCESS_INSTRUCTION_PATTERNS);
  const lateCheckout = matchesAny(text, LATE_CHECKOUT_PATTERNS);
  const parking = matchesAny(text, PARKING_PATTERNS);
  const pets = matchesAny(text, PETS_PATTERNS);
  const cancellationRefund = matchesAny(text, CANCELLATION_REFUND_PATTERNS);
  const complaint = matchesAny(text, COMPLAINT_PATTERNS);
  const operator = matchesAny(text, OPERATOR_PATTERNS);
  const atDoor = /(^|\s)(я|мы)\s+у\s+(двери|входа)(\s|$)|\bat\s+the\s+(door|entrance)\b/i.test(text);
  const urgent = matchesAny(text, URGENT_PATTERNS);
  const accessBlocked = accessFailure || (atDoor && (urgent || operator));
  const ambiguousCodeOnly =
    /(^|\s)(код|code|парол[ья]?|password)(\s|$)/i.test(text) &&
    !wifi &&
    !accessFailure &&
    !accessInstructions &&
    text.length <= 36;
  const language = detectLanguage(raw);
  const tone = detectTone(text);
  const semanticReferences = detectSemanticReferences(text);

  if (wifi) {
    addIntent('wifi', 'WIFI', /вафл|вафля/i.test(text) ? 0.78 : 0.9, ['wifi_pattern']);
  }
  if (accessFailure || accessBlocked) {
    addIntent('access', 'ACCESS_KEY_ISSUE', accessFailure ? 0.93 : 0.58, accessFailure ? ['access_failure'] : ['urgent_at_door']);
  } else if (accessInstructions) {
    addIntent('checkin_instructions', 'ADDRESS_FIND_OBJECT', 0.86, ['access_instructions']);
  }
  if (lateCheckout) {
    addIntent('late_checkout', 'LATE_CHECKOUT', 0.9, ['late_checkout_pattern']);
  }
  if (parking) {
    addIntent('parking', 'PARKING', 0.88, ['parking_pattern']);
  }
  if (pets) {
    addIntent('pets', 'PETS', 0.88, ['pets_pattern']);
  }
  if (cancellationRefund) {
    addIntent('cancellation_refund', 'CANCELLATION_REFUND', 0.91, ['cancellation_refund_pattern']);
  }
  if (complaint) {
    addIntent('complaint', 'COMPLAINTS_PROBLEMS', 0.86, ['complaint_pattern']);
  }
  if (operator) {
    addIntent('operator_handoff', 'OPERATOR_HANDOFF', 0.91, ['operator_pattern']);
  }

  const confidence = clampConfidence(
    intentDetails.length > 0
      ? Math.max(...intentDetails.map((detail) => detail.confidence))
      : ambiguousCodeOnly || semanticReferences.previousMessage || semanticReferences.needsStoredContext
        ? 0.48
        : 0.35,
  );

  return {
    intents,
    scenarioFamilies,
    intentDetails,
    confidence,
    lowConfidence: confidence < 0.65,
    urgency: {
      urgent: urgent || accessBlocked,
      accessBlocked,
    },
    language,
    tone,
    semanticReferences,
  };
}
