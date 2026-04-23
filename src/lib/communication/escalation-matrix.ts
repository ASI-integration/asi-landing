export type EscalationMatrixAction = 'reply' | 'clarify' | 'escalate_operator' | 'escalate_urgent';

export type EscalationMatrixDecision = {
  action: EscalationMatrixAction;
  /** Machine-parsable signals that led to the decision (kept short). */
  urgency_signals: string[];
  /** Human/audit-friendly reason (no full raw text). */
  reason: string;
};

type SurfaceLang = 'en' | 'ru';

function normalizeForSignals(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[“”„"']/g, '')
    .replace(/[?!.,;:(){}\[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSafetyRisk(n: string): boolean {
  return (
    /\bpolice\b|\bambulance\b|\bfire\b|\bsmoke\b|\bgas\b|\bflood\b|\bthreat\b|\bviolent\b|\bfight\b/i.test(n) ||
    /полици|скорая|пожар|дым|газ|затоп|угроз|драка|насили/i.test(n)
  );
}

function detectNightSignal(n: string): boolean {
  return /\bnight\b|\btonight\b|\blate\s+night\b/i.test(n) || /ноч(ью|и)?|поздно\s+ночью/i.test(n);
}

function detectChildSignal(n: string): boolean {
  return /\bchild\b|\bkid\b|\bbaby\b|\binfant\b/i.test(n) || /реб[её]нок|дет(и|ям|ский)|младен/i.test(n);
}

function detectActiveNow(n: string): boolean {
  return (
    /\b(now|right now|currently|at the door|at the entrance|at entrance)\b/i.test(n) ||
    /сейчас|прямо\s+сейчас|у\s+двери|у\s+входа|на\s+месте/i.test(n)
  );
}

function detectLockedOut(n: string): boolean {
  return (
    /\blocked\s+out\b|\blockout\b/i.test(n) ||
    /(can'?t|cannot)\s+(get\s+in|enter|open)/i.test(n) ||
    /не\s+могу\s+(войти|попасть)|не\s+попад(а|у)ю|стою\s+у\s+двери|стою\s+у\s+входа|закры(т|та)\s+снаружи/i.test(n)
  );
}

function detectCheckinContext(n: string): boolean {
  return /\bcheck[-\s]?in\b|\barriv(e|al)\b|\btoday\b|\btonight\b/i.test(n) || /заезд|засел|приезд|сегодня|сейчас/i.test(n);
}

function detectVeryCold(n: string): boolean {
  return /\bvery\s+cold\b|\bfreezing\b|\bno\s+heat\b/i.test(n) || /очень\s+холодно|замерза|нет\s+отоплен/i.test(n);
}

function detectUrgentWord(n: string): boolean {
  return /\burgent(ly)?\b|\basap\b|\bemergency\b/i.test(n) || /срочно|экстренн/i.test(n);
}

function detectNoiseActive(n: string): boolean {
  return detectActiveNow(n) || /\bcan'?t\s+sleep\b/i.test(n) || /не\s+могу\s+спать/i.test(n);
}

function detectPaymentConflict(n: string): boolean {
  return (
    /\bnot\s+found\b|\bno\s+booking\b|\bbooking\s+not\s+found\b|\bmismatch\b|\bwrong\s+amount\b|\bcharged\s+twice\b|\bdouble\s+charged\b/i.test(
      n,
    ) ||
    /не\s+нашл(и|а)\s+брон|брон(и|ь)\s+нет|не\s+видим\s+оплат|не\s+поступил[аи]?\s+оплат|не\s+совпада(ет|ют)|неверн(ая|ый)\s+сумм|списали\s+дважды|двойное\s+списан/i.test(
      n,
    )
  );
}

export function decideEscalationMatrixV1(input: {
  category:
    | 'access_issue'
    | 'no_heating'
    | 'no_hot_water'
    | 'noise_complaint'
    | 'payment_confirmation'
    | 'late_checkout'
    | 'early_checkin'
    | 'parking_question'
    | 'wifi_issue'
    | 'cleaning_request'
    | 'extension_request';
  text: string;
  surfaceLang: SurfaceLang;
  missingFacts: string[];
}): EscalationMatrixDecision {
  const n = normalizeForSignals(input.text);
  const urgency_signals: string[] = [];

  const safetyRisk = detectSafetyRisk(n);
  if (safetyRisk) urgency_signals.push('safety_risk');

  // Safety risk always wins, regardless of category.
  if (safetyRisk) {
    return { action: 'escalate_urgent', urgency_signals, reason: 'safety risk detected' };
  }

  // Global rules
  if (input.missingFacts.length > 0) {
    // Missing facts always means we should clarify first (unless safety/urgent escalation).
    // We keep this deterministic and category-scoped; the caller chooses the exact question copy.
    // Exceptions are handled below per-category.
  }

  if (input.category === 'access_issue') {
    const lockedOut = detectLockedOut(n);
    const checkinContext = detectCheckinContext(n);
    const activeNow = detectActiveNow(n);
    if (lockedOut) urgency_signals.push('locked_out');
    if (checkinContext) urgency_signals.push('checkin_context');
    if (activeNow) urgency_signals.push('active_now');

    const codeFailNow =
      activeNow &&
      /(code|код)/i.test(n) &&
      /(doesn'?t\s+work|does\s+not\s+work|not\s+work|не\s+работает|не\s+подходит|не\s+открыва)/i.test(n);
    if (codeFailNow) urgency_signals.push('code_fail_active_now');

    const blockedCheckin =
      lockedOut ||
      codeFailNow ||
      (checkinContext && activeNow && /(door|lock|код|code|дверь|замок|domofon|домофон)/i.test(n));
    if (blockedCheckin) urgency_signals.push('active_checkin_blocked');

    const explicitToday =
      /\b(today|tonight)\b/i.test(n) ||
      /\bchecking\s+in\s+today\b/i.test(n) ||
      /сегодня/i.test(n);
    const codeFailOnCheckinDay =
      explicitToday &&
      /(code|код)/i.test(n) &&
      /(doesn'?t\s+work|does\s+not\s+work|not\s+work|не\s+работает|не\s+подходит|не\s+открыва)/i.test(n);
    if (codeFailOnCheckinDay) urgency_signals.push('code_fail_checkin_context');

    if (blockedCheckin) return { action: 'escalate_urgent', urgency_signals, reason: 'guest locked out / check-in blocked' };
    if (codeFailOnCheckinDay) return { action: 'escalate_urgent', urgency_signals, reason: 'door code failing on check-in day' };
    if (input.missingFacts.length > 0) return { action: 'clarify', urgency_signals, reason: `missing_facts:${input.missingFacts.join(',')}` };
    return { action: 'reply', urgency_signals, reason: 'non-urgent access issue acknowledged' };
  }

  if (input.category === 'no_heating') {
    const veryCold = detectVeryCold(n);
    const night = detectNightSignal(n);
    const child = detectChildSignal(n);
    const urgentWord = detectUrgentWord(n);
    if (veryCold) urgency_signals.push('very_cold');
    if (night) urgency_signals.push('night');
    if (child) urgency_signals.push('child');
    if (urgentWord) urgency_signals.push('urgent_word');

    const urgent = veryCold || night || child || urgentWord;
    if (urgent) return { action: 'escalate_urgent', urgency_signals, reason: 'no_heating urgent signals present' };
    if (input.missingFacts.length > 0) return { action: 'clarify', urgency_signals, reason: `missing_facts:${input.missingFacts.join(',')}` };
    return { action: 'reply', urgency_signals, reason: 'non-urgent heating issue acknowledged' };
  }

  if (input.category === 'no_hot_water') {
    // Hot water outages are often urgent when "now" / "urgent" / night / child is mentioned.
    const activeNow = detectActiveNow(n);
    const night = detectNightSignal(n);
    const child = detectChildSignal(n);
    const urgentWord = detectUrgentWord(n);
    if (activeNow) urgency_signals.push('active_now');
    if (night) urgency_signals.push('night');
    if (child) urgency_signals.push('child');
    if (urgentWord) urgency_signals.push('urgent_word');

    const urgent = activeNow || night || child || urgentWord;
    if (urgent) return { action: 'escalate_urgent', urgency_signals, reason: 'no_hot_water urgent signals present' };
    if (input.missingFacts.length > 0) return { action: 'clarify', urgency_signals, reason: `missing_facts:${input.missingFacts.join(',')}` };
    return { action: 'reply', urgency_signals, reason: 'non-urgent hot water issue acknowledged' };
  }

  if (input.category === 'noise_complaint') {
    const active = detectNoiseActive(n);
    if (active) urgency_signals.push('active_disturbance');
    if (active) return { action: 'escalate_operator', urgency_signals, reason: 'noise complaint active now' };
    if (input.missingFacts.length > 0) return { action: 'clarify', urgency_signals, reason: `missing_facts:${input.missingFacts.join(',')}` };
    return { action: 'reply', urgency_signals, reason: 'noise complaint acknowledged (non-urgent)' };
  }

  if (input.category === 'payment_confirmation') {
    const conflict = detectPaymentConflict(n);
    if (conflict) urgency_signals.push('payment_conflict');
    if (conflict) return { action: 'escalate_operator', urgency_signals, reason: 'payment mismatch / no booking / conflict' };
    if (input.missingFacts.length > 0) return { action: 'clarify', urgency_signals, reason: `missing_facts:${input.missingFacts.join(',')}` };
    return { action: 'reply', urgency_signals, reason: 'payment confirmation acknowledged (no conflict)' };
  }

  // “Usually reply or clarify first” categories
  if (input.missingFacts.length > 0) return { action: 'clarify', urgency_signals, reason: `missing_facts:${input.missingFacts.join(',')}` };
  return { action: 'reply', urgency_signals, reason: 'standard operational request acknowledged' };
}

