export type TelegramEmergencyKind =
  | 'fire'
  | 'smoke'
  | 'gas'
  | 'flood'
  | 'threat'
  | 'neighbors'
  | 'medical'
  | 'distress_unknown';

export type TelegramEmergencySeverity = 'critical' | 'high';

export type TelegramEmergencyDecision = {
  kind: TelegramEmergencyKind;
  severity: TelegramEmergencySeverity;
  crmPriority: TelegramEmergencySeverity;
  replyText: string;
  isExplicitTestProbe: boolean;
};

const TEST_COMMAND_RE = /^\/emergency_test(?:@\w+)?(?:\s|$)/i;

function normalizeEmergencyText(text: string): string {
  return String(text ?? '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}/@\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isExplicitEmergencyTestProbe(text: string): boolean {
  const normalized = normalizeEmergencyText(text);
  if (TEST_COMMAND_RE.test(String(text ?? '').trim())) return true;
  return /(^|\s)(тест|проверка|симуляция|тестовый|тестовая|тестовое|test|simulation)(\s|$)/i.test(normalized) ||
    /(не\s+реально|ненастоящ|учебн)/i.test(normalized);
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function detectKind(normalized: string): TelegramEmergencyKind | null {
  if (hasAny(normalized, [/пожар|горит|загорел|огонь|возгорание|fire/])) return 'fire';
  if (hasAny(normalized, [/дым|задымлен|smoke/])) return 'smoke';
  if (hasAny(normalized, [/газ|пахнет\s+газом|утечк.{0,12}газа|gas\s+leak/])) return 'gas';
  if (hasAny(normalized, [/потоп|затоп|заливает|залило|прорвало|трубу\s+прорвало|flood/])) return 'flood';
  if (hasAny(normalized, [/скорая|врач|плохо\s+сердц|не\s+дыш|потерял.{0,10}сознание|кровь|умира|medical|ambulance/])) {
    return 'medical';
  }
  if (hasAny(normalized, [/угрож|напал|напали|ломятся|взлом|опасно|нож|оружие|убьют|драка|assault|threat/])) {
    return 'threat';
  }
  if (hasAny(normalized, [/сосед|соседи|neighbor/])) return 'neighbors';
  if (hasAny(normalized, [/что\s*то\s+(произошло|случилось)|что-то\s+(произошло|случилось)|произошло|случилось|помогите|help/])) {
    return 'distress_unknown';
  }
  return null;
}

function severityForKind(kind: TelegramEmergencyKind): TelegramEmergencySeverity {
  if (kind === 'flood' || kind === 'neighbors' || kind === 'distress_unknown') return 'high';
  return 'critical';
}

function replyForKind(kind: TelegramEmergencyKind): string {
  switch (kind) {
    case 'fire':
      return 'Если есть пожар или сильный дым, выйдите в безопасное место и звоните 112. При пожаре также можно звонить 101. Я передам сообщение оператору ASI.';
    case 'smoke':
      return 'Если есть дым или трудно дышать, выйдите в безопасное место и звоните 112. Если это пожар, можно звонить 101. Я передам сообщение оператору ASI.';
    case 'gas':
      return 'Если пахнет газом, не включайте свет и электроприборы, откройте окна, выйдите в безопасное место и звоните 112. Я передам сообщение оператору ASI.';
    case 'medical':
      return 'Если человеку плохо, есть риск жизни или нужна срочная помощь, звоните 112 или 103. Я передам сообщение оператору ASI.';
    case 'threat':
      return 'Если есть угроза жизни или безопасности, уйдите в безопасное место и звоните 112. Я передам сообщение оператору ASI.';
    case 'flood':
      return 'Если безопасно, перекройте воду и отключите электроприборы рядом с водой. Если есть угроза людям, звоните 112. Я передам сообщение оператору ASI.';
    case 'neighbors':
      return 'Если соседи угрожают вам или есть опасность, не вступайте в конфликт и звоните 112. Я передам сообщение оператору ASI.';
    case 'distress_unknown':
      return 'Понял, что что-то произошло. Если есть угроза жизни или безопасности, звоните 112 прямо сейчас. Я передам сообщение оператору ASI.';
  }
}

export function resolveTelegramEmergencyProtocol(text: string): TelegramEmergencyDecision | null {
  const normalized = normalizeEmergencyText(text);
  const kind = detectKind(normalized);
  if (!kind) return null;
  const severity = severityForKind(kind);
  return {
    kind,
    severity,
    crmPriority: severity,
    replyText: replyForKind(kind),
    isExplicitTestProbe: isExplicitEmergencyTestProbe(text),
  };
}

export function emergencyTestReply(): string {
  return 'Тест Emergency Protocol включен. Реальная critical эскалация не создана. В реальной угрозе жизни звоните 112, при пожаре можно 101, для скорой 103.';
}
