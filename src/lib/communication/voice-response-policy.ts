import { formatVoiceSafeText } from './voice/formatter';
import {
  VOICE_SAFE_MONEY_HANDOFF_RU,
  VOICE_SAFE_URGENT_HANDOFF_RU,
  type PropertyVoicePolicySettings,
  type ChatVoiceUserSettings,
} from './voice-response-settings';
import { getLocalTimeParts, isWithinNightWindow, type PropertyTimezoneResolution } from './property-timezone';
import type { VoiceBudgetSnapshot } from './voice-budget-store';

export type VoiceResponseDecisionReason =
  | 'urgent_intent'
  | 'night_core_stay_issue'
  | 'inbound_voice_allowed'
  | 'inbound_voice_with_companion_text'
  | 'preferred_voice'
  | 'copyable_data_text_only'
  | 'disabled_by_user'
  | 'out_of_domain'
  | 'sensitive_internal'
  | 'budget_cap_reached'
  | 'not_needed'
  | 'tts_missing_env';

export type VoiceResponseDecision = {
  shouldSendVoice: boolean;
  reason: VoiceResponseDecisionReason;
  voiceText?: string;
  /** Exact copyable data sent as a short text after the voice bubble. */
  companionText?: string;
  maxDurationSeconds?: number;
  timezoneSource?: 'property' | 'fallback';
};

export type VoiceInboundTransport = 'telegram_text' | 'telegram_voice';

export type VoiceMessageRisk =
  | 'normal'
  | 'sensitive_money'
  | 'sensitive_internal'
  | 'prompt_injection'
  | 'out_of_domain';

export type VoiceResponsePolicyInput = {
  role?: string;
  detectedIntent?: string;
  domainZone?: 'core' | 'adjacent' | 'out_of_domain';
  responseMode?: string;
  propertyId?: string | null;
  propertyTimezone?: PropertyTimezoneResolution;
  inboundTransport: VoiceInboundTransport;
  messageRisk?: VoiceMessageRisk;
  userVoiceSettings: ChatVoiceUserSettings;
  propertyVoiceSettings: PropertyVoicePolicySettings;
  budget: VoiceBudgetSnapshot;
  replyText: string;
  ttsConfigured: boolean;
  isUrgent?: boolean;
  now?: Date;
};

const URGENT_INTENTS = new Set([
  'emergency_or_damage',
  'complaint_or_conflict',
]);

const CORE_STAY_INTENTS = new Set([
  'guest_checkin',
  'guest_property_question',
  'guest_rules_question',
  'guest_booking_lookup',
]);

const CORE_STAY_RESPONSE_MODES = new Set([
  'answer_from_property',
  'answer_from_global_rule',
  'ask_clarifying_question',
]);

const INTERNAL_RESPONSE_MODES = new Set(['operator_escalation']);
const META_VOICE_RESPONSE_MODES = new Set(['telegram_meta_voice_reply']);

const MONEY_INTENT = 'money_sensitive';

const COPYABLE_LABEL_PATTERN = /(?:\b(?:password|passcode|pin|ssid)\b|\b(?:door|access)\s+code\b|\b(?:address|phone(?:\s+number)?)\s*:|парол(?:ь|я|ем|и)?|пин(?:-?код)?|код\s+(?:доступа|двери|домофона|замка)|(?:адрес|телефон)\s*:)/iu;
const BOOKING_COPYABLE_VALUE_PATTERN = /(?:\b(?:booking|reservation)\s+(?:reference|number)\s*(?::|#|=|\bis\b)\s*[A-Z0-9][A-Z0-9._/-]{3,}\b|номер\s+бронирования\s*(?::|№|#|=)\s*[A-ZА-Я0-9][A-ZА-Я0-9._/-]{3,}\b)/iu;
const WIFI_COPYABLE_PATTERN = /(?:\bwi[-\s]?fi\b|вай[-\s]?фай).{0,80}(?:\bssid\b|сеть\s*:|network\s*:|парол|password)/iu;
const URL_OR_EMAIL_PATTERN = /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i;
const PHONE_LIKE_PATTERN = /\+?\d(?:[\s().-]*\d){7,}/;
const CREDENTIAL_TOKEN_PATTERN = /\b(?=[A-Za-z0-9_-]{6,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/;

export function containsCopyableGuestData(replyText: string): boolean {
  const text = String(replyText ?? '').trim();
  if (!text) return false;
  return (
    COPYABLE_LABEL_PATTERN.test(text) ||
    BOOKING_COPYABLE_VALUE_PATTERN.test(text) ||
    WIFI_COPYABLE_PATTERN.test(text) ||
    URL_OR_EMAIL_PATTERN.test(text) ||
    PHONE_LIKE_PATTERN.test(text) ||
    CREDENTIAL_TOKEN_PATTERN.test(text)
  );
}

export function splitCopyableGuestData(replyText: string): {
  voiceText: string;
  companionText: string | null;
} {
  const source = String(replyText ?? '').trim();
  if (!source) return { voiceText: '', companionText: null };

  const captured: string[] = [];
  let voiceText = source;
  const patterns: RegExp[] = [
    /(?:адрес|address)\s*:\s*[^.!?\n]+[.!]?/giu,
    /(?:ssid|сеть)\s*:\s*[^.!?\n]+[.!]?/giu,
    /(?:парол(?:ь|я)?(?:\s+wi[-\s]?fi)?|password|passcode|pin|пин(?:-?код)?)\s*:\s*[^,;.!?\n]+[.!]?/giu,
    /(?:номер\s+бронирования|booking\s+(?:reference|number)|reservation\s+(?:reference|number))\s*(?::|№|#|=|\bis\b)\s*[A-ZА-Я0-9][A-ZА-Я0-9._/-]{3,}/giu,
    /(?:https?:\/\/|www\.)\S+/giu,
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    /(?:телефон|phone)\s*:\s*\+?\d(?:[\s().-]*\d){7,}/giu,
  ];

  for (const pattern of patterns) {
    voiceText = voiceText.replace(pattern, (match) => {
      const clean = match.trim();
      if (clean) captured.push(clean);
      return ' ';
    });
  }

  const companionText = [...new Set(captured)].join('\n').trim() || null;
  voiceText = voiceText
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
    .trim();

  if (companionText && voiceText.length < 8) {
    voiceText = 'Я отправила точные данные отдельным сообщением, чтобы их было удобно скопировать.';
  }
  return { voiceText, companionText };
}

function isUrgentIntent(input: VoiceResponsePolicyInput): boolean {
  if (input.isUrgent) return true;
  const intent = String(input.detectedIntent ?? '').trim();
  if (URGENT_INTENTS.has(intent)) return true;
  if (intent === MONEY_INTENT) return false;
  return false;
}

function isCoreStayTopic(input: VoiceResponsePolicyInput): boolean {
  const intent = String(input.detectedIntent ?? '').trim();
  if (CORE_STAY_INTENTS.has(intent)) return true;
  if (input.domainZone === 'core') return true;
  const mode = String(input.responseMode ?? '').trim();
  if (CORE_STAY_RESPONSE_MODES.has(mode) && input.domainZone !== 'out_of_domain') return true;
  return false;
}

function isAdjacentTopic(input: VoiceResponsePolicyInput): boolean {
  return input.domainZone === 'adjacent';
}

function isStaffRole(role?: string): boolean {
  const r = String(role ?? '').trim().toLowerCase();
  return r === 'staff' || r === 'owner' || r === 'operator';
}

function estimateVoiceSeconds(text: string): number {
  const chars = text.length;
  return Math.min(45, Math.max(3, Math.ceil(chars / 14)));
}

function isOperatorEscalation(input: VoiceResponsePolicyInput): boolean {
  return INTERNAL_RESPONSE_MODES.has(String(input.responseMode ?? '').trim());
}

function isMetaVoiceReply(input: VoiceResponsePolicyInput): boolean {
  return META_VOICE_RESPONSE_MODES.has(String(input.responseMode ?? '').trim());
}

function needsUrgentSafeHandoff(input: VoiceResponsePolicyInput): boolean {
  return input.messageRisk === 'sensitive_internal' || isOperatorEscalation(input);
}

function buildUrgentVoiceDecision(
  input: VoiceResponsePolicyInput,
  settings: PropertyVoicePolicySettings,
  maxDurationSeconds: number,
  timezoneSource: 'property' | 'fallback' | undefined,
): VoiceResponseDecision | null {
  if (!settings.voiceForUrgent || !isUrgentIntent(input)) return null;

  const sourceText = needsUrgentSafeHandoff(input)
    ? VOICE_SAFE_URGENT_HANDOFF_RU
    : input.replyText;
  const voiceText = prepareVoiceTextForTts(sourceText, settings.maxVoiceTextChars);
  if (voiceText.length < 8) return null;

  return {
    shouldSendVoice: true,
    reason: 'urgent_intent',
    voiceText,
    maxDurationSeconds,
    timezoneSource,
  };
}

export function prepareVoiceTextForTts(replyText: string, maxChars: number): string {
  return formatVoiceSafeText(replyText, { maxChars: Math.min(maxChars, 700) });
}

export function evaluateVoiceResponsePolicy(input: VoiceResponsePolicyInput): VoiceResponseDecision {
  const settings = input.propertyVoiceSettings;
  const maxDurationSeconds = settings.maxVoiceReplySeconds;
  const timezoneSource = input.propertyTimezone?.timezoneSource;

  if (!input.ttsConfigured) {
    return { shouldSendVoice: false, reason: 'tts_missing_env', timezoneSource };
  }

  if (!settings.voiceRepliesEnabled) {
    return { shouldSendVoice: false, reason: 'not_needed', timezoneSource };
  }

  if (!input.userVoiceSettings.voiceRepliesEnabled) {
    return { shouldSendVoice: false, reason: 'disabled_by_user', timezoneSource };
  }

  if (input.budget.dailyCapReached || input.budget.monthlyCapReached) {
    return { shouldSendVoice: false, reason: 'budget_cap_reached', timezoneSource };
  }

  if (input.messageRisk === 'prompt_injection') {
    return { shouldSendVoice: false, reason: 'sensitive_internal', timezoneSource };
  }

  if (input.messageRisk === 'out_of_domain' || input.domainZone === 'out_of_domain') {
    return { shouldSendVoice: false, reason: 'out_of_domain', timezoneSource };
  }

  // Explicit saved choice wins. Without one, mirror the transport the guest used:
  // text in -> text out, voice in -> voice out (subject to the safety gates below).
  const modalityAllowsVoice =
    input.userVoiceSettings.preferredResponseModality === 'voice' ||
    (!input.userVoiceSettings.preferredResponseModality && input.inboundTransport === 'telegram_voice');

  if (modalityAllowsVoice) {
    const urgentDecision = buildUrgentVoiceDecision(input, settings, maxDurationSeconds, timezoneSource);
    if (urgentDecision) return urgentDecision;
  }

  if (input.messageRisk === 'sensitive_internal' || isOperatorEscalation(input)) {
    return { shouldSendVoice: false, reason: 'sensitive_internal', timezoneSource };
  }

  if (containsCopyableGuestData(input.replyText)) {
    const hybridAllowed =
      modalityAllowsVoice &&
      !isStaffRole(input.role) &&
      (isCoreStayTopic(input) || isAdjacentTopic(input) || isMetaVoiceReply(input));
    if (hybridAllowed) {
      const split = splitCopyableGuestData(input.replyText);
      if (split.companionText) {
        const voiceText = prepareVoiceTextForTts(split.voiceText, settings.maxVoiceTextChars);
        if (voiceText.length >= 8 && voiceText.length <= settings.maxVoiceTextChars) {
          return {
            shouldSendVoice: true,
            reason: 'inbound_voice_with_companion_text',
            voiceText,
            companionText: split.companionText,
            maxDurationSeconds,
            timezoneSource,
          };
        }
      }
    }
    return { shouldSendVoice: false, reason: 'copyable_data_text_only', timezoneSource };
  }

  if (!modalityAllowsVoice) {
    return { shouldSendVoice: false, reason: 'not_needed', timezoneSource };
  }

  if (
    input.userVoiceSettings.preferredResponseModality === 'voice' &&
    !isStaffRole(input.role) &&
    (isCoreStayTopic(input) || isAdjacentTopic(input) || isMetaVoiceReply(input))
  ) {
    const voiceText = prepareVoiceTextForTts(input.replyText, settings.maxVoiceTextChars);
    if (voiceText.length >= 8 && voiceText.length <= settings.maxVoiceTextChars) {
      return {
        shouldSendVoice: true,
        reason: 'preferred_voice',
        voiceText,
        maxDurationSeconds,
        timezoneSource,
      };
    }
  }

  if (input.inboundTransport === 'telegram_voice' && isMetaVoiceReply(input)) {
    const voiceText = prepareVoiceTextForTts(input.replyText, settings.maxVoiceTextChars);
    if (voiceText.length >= 8 && voiceText.length <= settings.maxVoiceTextChars) {
      return {
        shouldSendVoice: true,
        reason: 'inbound_voice_allowed',
        voiceText,
        maxDurationSeconds,
        timezoneSource,
      };
    }
  }

  if (isStaffRole(input.role)) {
    return { shouldSendVoice: false, reason: 'not_needed', timezoneSource };
  }

  const tz = input.propertyTimezone?.timezone ?? settings.timezone;
  const localParts = getLocalTimeParts(tz, input.now);
  const isNight = isWithinNightWindow(localParts, settings.nightStart, settings.nightEnd);

  const moneySensitive = input.messageRisk === 'sensitive_money' || input.detectedIntent === MONEY_INTENT;
  if (moneySensitive) {
    if ((isNight || input.inboundTransport === 'telegram_voice') && settings.voiceForUrgent) {
      const voiceText = prepareVoiceTextForTts(VOICE_SAFE_MONEY_HANDOFF_RU, settings.maxVoiceTextChars);
      return {
        shouldSendVoice: true,
        reason: isNight ? 'night_core_stay_issue' : 'inbound_voice_allowed',
        voiceText,
        maxDurationSeconds,
        timezoneSource,
      };
    }
    return { shouldSendVoice: false, reason: 'sensitive_internal', timezoneSource };
  }

  if (settings.voiceForNightCoreIssues && isNight && isCoreStayTopic(input)) {
    const voiceText = prepareVoiceTextForTts(input.replyText, settings.maxVoiceTextChars);
    if (voiceText.length >= 8) {
      return {
        shouldSendVoice: true,
        reason: 'night_core_stay_issue',
        voiceText,
        maxDurationSeconds,
        timezoneSource,
      };
    }
  }

  if (input.inboundTransport === 'telegram_voice') {
    const allowedByPolicy = settings.voiceForAllInboundVoice
      ? isCoreStayTopic(input) || isAdjacentTopic(input)
      : isCoreStayTopic(input);

    if (allowedByPolicy) {
      const voiceText = prepareVoiceTextForTts(input.replyText, settings.maxVoiceTextChars);
      if (voiceText.length >= 8 && voiceText.length <= settings.maxVoiceTextChars) {
        return {
          shouldSendVoice: true,
          reason: 'inbound_voice_allowed',
          voiceText,
          maxDurationSeconds,
          timezoneSource,
        };
      }
    }
  }

  return { shouldSendVoice: false, reason: 'not_needed', timezoneSource };
}

export { estimateVoiceSeconds };
