import type { CommunicationAutopilotContext } from './autopilot';
import { normalizeBookingWordingRu, sanitizeGuestFacingReply } from './guest-facing-ru';

export type WifiBookingRequestReason =
  | 'object_unknown'
  | 'booking_unknown'
  | 'escalation_context'
  | 'required_secret'
  | null;

export type WifiEscalationAudit = {
  object_resolved: boolean;
  booking_resolved: boolean;
  escalation_needed: boolean;
  booking_request_reason: WifiBookingRequestReason;
};

export type WifiProblemSubtype =
  | 'worked_then_stopped'
  | 'connected_but_no_pages'
  | 'cannot_connect'
  | 'unknown_wifi_problem';

export type WifiProblemStep = 1 | 2 | 3;

export const WIFI_OBJECT_UNKNOWN_ASK_RU =
  'Чтобы проверить именно ваш объект, напишите, пожалуйста, адрес или номер бронирования.';

export const WIFI_DIAGNOSTIC_FAILED_OBJECT_RESOLVED_RU =
  'Зафиксирую проблему по интернету для этого объекта. Напишите, пожалуйста, сеть Wi-Fi видна в списке и показывает ли устройство подключение без интернета.';

export const WIFI_ESCALATION_OPERATOR_OBJECT_RESOLVED_RU =
  'Понял. Передаю проблему с Wi-Fi оператору для проверки и решения.';

export const WIFI_ESCALATION_OPERATOR_OBJECT_UNKNOWN_RU =
  'Понял. Передаю проблему с Wi-Fi оператору. Чтобы проверить именно ваш объект, напишите, пожалуйста, адрес или номер бронирования.';

const WIFI_PROBLEM_SUBTYPE_REPLIES: Record<WifiProblemSubtype, string> = {
  worked_then_stopped:
    'Хорошо, похоже, интернет работал, а потом соединение пропало. Попробуйте выключить и снова включить Wi-Fi на устройстве и открыть любой другой сайт. Если не поможет, напишите, пожалуйста, показывает ли устройство подключение к Wi-Fi без интернета.',
  connected_but_no_pages:
    'Хорошо, если Wi-Fi подключён, но сайты не открываются, попробуйте открыть любой другой сайт и на минуту выключить/включить Wi-Fi на устройстве. Если не поможет, напишите, пожалуйста, показывает ли устройство подключение без интернета.',
  cannot_connect:
    'Хорошо, уточните, пожалуйста: сеть Wi-Fi видна в списке, но не подключается, или сеть вообще не отображается? Пароль я могу подсказать только после проверки бронирования.',
  unknown_wifi_problem:
    'Хорошо, если Wi-Fi подключён, но сайты не открываются, попробуйте открыть любой другой сайт и на минуту выключить/включить Wi-Fi на устройстве. Если не поможет, напишите, пожалуйста, показывает ли устройство подключение без интернета.',
};

const WIFI_PROBLEM_STEP2_REPLY_RU =
  'Тогда, пожалуйста, проверьте, показывает ли устройство подключение к Wi-Fi без интернета. Если да, я зафиксирую проблему по интернету для этого объекта.';

function has(text: string, ...needles: string[]): boolean {
  const lowered = text.toLocaleLowerCase('ru-RU');
  return needles.some((needle) => lowered.includes(needle.toLocaleLowerCase('ru-RU')));
}

export function isObjectResolved(context: CommunicationAutopilotContext | undefined): boolean {
  return Boolean(
    context?.propertyResolved ||
      context?.object?.id ||
      context?.object?.name ||
      context?.object?.address,
  );
}

export function isBookingResolved(context: CommunicationAutopilotContext | undefined): boolean {
  return Boolean(context?.bookingVerified || context?.booking?.verified || context?.booking?.id);
}

export function isWifiContextFullyResolved(context: CommunicationAutopilotContext | undefined): boolean {
  return isObjectResolved(context) && isBookingResolved(context);
}

export function wifiReplyHasFirstStepAdvice(text: string): boolean {
  const lowered = text.toLocaleLowerCase('ru-RU');
  return (lowered.includes('выключ') || lowered.includes('выключить/включить')) && lowered.includes('другой сайт');
}

export function wifiReplyHasDiagnosticCapture(text: string): boolean {
  const lowered = text.toLocaleLowerCase('ru-RU');
  return (
    lowered.includes('зафиксирую проблему по интернету') ||
    (lowered.includes('показывает ли устройство') && lowered.includes('подключение'))
  );
}

export function isWifiProblemFailureContinuation(messageText: string): boolean {
  const text = messageText.trim().toLocaleLowerCase('ru-RU');
  if (!text) return false;
  if (/^(да|ага|угу|да да|да, именно|именно)$/i.test(text)) return true;
  return has(
    text,
    'сайт всё равно не грузится',
    'сайт все равно не грузится',
    'сайт не грузится',
    'сайт не грузит',
    'всё равно не работает',
    'все равно не работает',
    'сайты не открываются',
    'сайты всё равно не открываются',
    'сайты все равно не открываются',
    'страницы не открываются',
    'ничего не грузит',
    'ничего не загружается',
    'подключение есть, но сайты',
    'сеть есть, но сайты',
    'не помогло',
    'не помогла',
  );
}

export function detectWifiProblemSubtype(messageText: string, continuationUsed = false): WifiProblemSubtype {
  const text = messageText.toLocaleLowerCase('ru-RU');
  if (
    has(
      text,
      'не могу подключиться к wi-fi',
      'не могу подключиться к wifi',
      'не подключается к сети',
      'не подключается к wi-fi',
      'не подключается к wifi',
      'пароль не подходит',
      'сеть не видит',
      'не видит сеть',
      'не вижу сеть',
      'сеть не отображается',
      'не отображается сеть',
      'не получается подключиться',
    )
  ) {
    return 'cannot_connect';
  }
  if (
    has(
      text,
      'сперва работал',
      'сначала работало',
      'сначала работал',
      'раньше грузило',
      'раньше работало',
      'работал, а потом',
      'потом перестал',
      'потом сайты перестали',
      'интернет сперва работал',
      'интернет сначала работал',
    )
  ) {
    return 'worked_then_stopped';
  }
  if (
    has(
      text,
      'wi-fi подключён',
      'wi-fi подключен',
      'wifi подключён',
      'wifi подключен',
      'подключён, но сайт',
      'подключен, но сайт',
      'сайт не грузится',
      'сайты не грузятся',
      'страницы не открываются',
      'подключение есть, но интернета нет',
      'подключение есть, но сайты',
      'ничего не грузит',
      'сеть есть, но сайты',
    )
  ) {
    return 'connected_but_no_pages';
  }
  if (continuationUsed) return 'connected_but_no_pages';
  return 'unknown_wifi_problem';
}

export function inferWifiProblemStep(params: {
  previousReply: string | null;
  continuationUsed: boolean;
  previousIntent: string | null;
  messageText: string;
}): WifiProblemStep {
  if (params.previousIntent !== 'wifi_problem') return 1;
  if (!params.previousReply || !params.continuationUsed) return 1;
  const prev = params.previousReply;
  if (wifiReplyHasDiagnosticCapture(prev)) return 3;
  if (wifiReplyHasFirstStepAdvice(prev)) {
    return isWifiProblemFailureContinuation(params.messageText) ? 3 : 2;
  }
  return 1;
}

function guestSafeWifiReply(text: string): string {
  return sanitizeGuestFacingReply(normalizeBookingWordingRu(text) ?? text) ?? text;
}

export function composeWifiProblemSubtypeReplyRu(params: {
  subtype: WifiProblemSubtype;
  wifiName?: string | null;
  previousReply?: string | null;
  continuationUsed?: boolean;
}): string {
  if (params.continuationUsed && params.previousReply && wifiReplyHasFirstStepAdvice(params.previousReply)) {
    return guestSafeWifiReply(WIFI_PROBLEM_STEP2_REPLY_RU);
  }
  const primary = WIFI_PROBLEM_SUBTYPE_REPLIES[params.subtype] ?? WIFI_PROBLEM_SUBTYPE_REPLIES.unknown_wifi_problem;
  if (
    params.previousReply &&
    wifiReplyHasFirstStepAdvice(params.previousReply) &&
    wifiReplyHasFirstStepAdvice(primary)
  ) {
    return guestSafeWifiReply(WIFI_PROBLEM_STEP2_REPLY_RU);
  }
  const name = params.wifiName?.trim();
  if (name && params.subtype !== 'cannot_connect') {
    return guestSafeWifiReply(`${primary} Сеть Wi-Fi: ${name}.`);
  }
  return guestSafeWifiReply(primary);
}

export function buildWifiEscalationAudit(params: {
  context?: CommunicationAutopilotContext;
  escalationNeeded: boolean;
  bookingRequestReason: WifiBookingRequestReason;
}): WifiEscalationAudit {
  return {
    object_resolved: isObjectResolved(params.context),
    booking_resolved: isBookingResolved(params.context),
    escalation_needed: params.escalationNeeded,
    booking_request_reason: params.bookingRequestReason,
  };
}

export function resolveWifiBookingRequestReason(params: {
  context?: CommunicationAutopilotContext;
  escalationNeeded: boolean;
  step: WifiProblemStep;
  needsSecret?: boolean;
}): WifiBookingRequestReason {
  if (params.needsSecret && !isBookingResolved(params.context)) return 'required_secret';
  if (params.escalationNeeded && !isObjectResolved(params.context)) return 'escalation_context';
  if (!isObjectResolved(params.context)) {
    if (params.step >= 2 || params.escalationNeeded) return 'object_unknown';
    return 'object_unknown';
  }
  if (!isBookingResolved(params.context) && params.needsSecret) return 'booking_unknown';
  return null;
}

export type WifiProblemPolicyResult = {
  replyText: string;
  step: WifiProblemStep;
  escalationNeeded: boolean;
  bookingRequestReason: WifiBookingRequestReason;
  audit: WifiEscalationAudit;
  action: 'auto_reply' | 'needs_context' | 'escalate';
};

export function resolveWifiProblemPolicy(input: {
  messageText: string;
  context?: CommunicationAutopilotContext;
  previousReply?: string | null;
  continuationUsed?: boolean;
  previousIntent?: string | null;
  forceEscalation?: boolean;
}): WifiProblemPolicyResult {
  const continuationUsed = Boolean(input.continuationUsed);
  const step = inferWifiProblemStep({
    previousReply: input.previousReply ?? null,
    continuationUsed,
    previousIntent: input.previousIntent ?? null,
    messageText: input.messageText,
  });
  const escalationNeeded = Boolean(input.forceEscalation);
  const objectResolved = isObjectResolved(input.context);
  const bookingResolved = isBookingResolved(input.context);
  const fullyResolved = objectResolved && bookingResolved;

  let replyText: string;
  let action: WifiProblemPolicyResult['action'] = 'auto_reply';
  let bookingRequestReason: WifiBookingRequestReason = null;

  if (escalationNeeded) {
    action = 'escalate';
    if (objectResolved) {
      replyText = WIFI_ESCALATION_OPERATOR_OBJECT_RESOLVED_RU;
    } else {
      replyText = WIFI_ESCALATION_OPERATOR_OBJECT_UNKNOWN_RU;
      bookingRequestReason = 'escalation_context';
      action = 'needs_context';
    }
  } else if (step === 3) {
    if (fullyResolved) {
      replyText = WIFI_DIAGNOSTIC_FAILED_OBJECT_RESOLVED_RU;
      bookingRequestReason = null;
    } else if (!objectResolved) {
      replyText = WIFI_OBJECT_UNKNOWN_ASK_RU;
      bookingRequestReason = 'object_unknown';
      action = 'needs_context';
    } else {
      replyText = WIFI_DIAGNOSTIC_FAILED_OBJECT_RESOLVED_RU;
      bookingRequestReason = bookingResolved ? null : 'booking_unknown';
    }
  } else if (!objectResolved && step >= 3) {
    replyText = WIFI_OBJECT_UNKNOWN_ASK_RU;
    bookingRequestReason = 'object_unknown';
    action = 'needs_context';
  } else if (!objectResolved && step >= 2) {
    replyText = WIFI_OBJECT_UNKNOWN_ASK_RU;
    bookingRequestReason = 'object_unknown';
    action = 'needs_context';
  } else if (!objectResolved && step === 1) {
    const subtype = detectWifiProblemSubtype(input.messageText, continuationUsed);
    replyText = composeWifiProblemSubtypeReplyRu({
      subtype,
      wifiName: input.context?.object?.wifiName,
      previousReply: input.previousReply,
      continuationUsed,
    });
    if (subtype === 'cannot_connect' && !bookingResolved) {
      bookingRequestReason = 'required_secret';
      action = 'needs_context';
    } else {
      bookingRequestReason = 'object_unknown';
      action = 'auto_reply';
    }
  } else {
    const subtype = detectWifiProblemSubtype(input.messageText, continuationUsed);
    replyText = composeWifiProblemSubtypeReplyRu({
      subtype,
      wifiName: input.context?.object?.wifiName,
      previousReply: input.previousReply,
      continuationUsed,
    });
    bookingRequestReason = resolveWifiBookingRequestReason({
      context: input.context,
      escalationNeeded: false,
      step,
      needsSecret: subtype === 'cannot_connect' && !bookingResolved,
    });
    if (bookingRequestReason) action = 'needs_context';
  }

  replyText = guestSafeWifiReply(replyText);
  const audit = buildWifiEscalationAudit({
    context: input.context,
    escalationNeeded,
    bookingRequestReason,
  });

  return {
    replyText,
    step,
    escalationNeeded,
    bookingRequestReason,
    audit,
    action,
  };
}

export function guestReplyContainsForbiddenBookingWording(text: string): boolean {
  return /\bброни\b/i.test(text);
}
