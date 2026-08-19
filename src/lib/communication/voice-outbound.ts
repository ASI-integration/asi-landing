import { loadAutonomousSession } from './conversation-session-store';
import { resolvePropertyTimezone } from './property-timezone';
import { getVoiceBudgetSnapshot } from './voice-budget-store';
import {
  evaluateVoiceResponsePolicy,
  type VoiceInboundTransport,
  type VoiceMessageRisk,
  type VoiceResponseDecision,
} from './voice-response-policy';
import {
  loadChatVoiceUserSettings,
  resolvePropertyVoicePolicy,
  RESPONSE_MODALITY_CHOICE_RU,
  VOICE_FIRST_NOTICE_RU,
  type PropertyVoicePolicySettings,
} from './voice-response-settings';
import { isTtsConfigured } from './voice-tts';
import { resolveTelegramTextMeta } from './telegram-text-meta-handler';
import type { InboundMessageEnvelope } from './types';

export type VoiceOutboundContext = {
  envelope: InboundMessageEnvelope;
  replyText: string;
  chatId: number;
  detectedIntent?: string;
  domainZone?: 'core' | 'adjacent' | 'out_of_domain';
  responseMode?: string;
  role?: string;
  propertyId?: string | null;
  propertyTimezone?: string | null;
  propertyVoicePolicy?: Partial<PropertyVoicePolicySettings>;
  messageRisk?: VoiceMessageRisk;
  isUrgent?: boolean;
  isEscalation?: boolean;
};

function inboundTransport(envelope: InboundMessageEnvelope): VoiceInboundTransport {
  const metadata = envelope.metadata;
  const originalMessageType =
    typeof metadata?.originalMessageType === 'string'
      ? metadata.originalMessageType
      : typeof (metadata as any)?.voice?.originalMessageType === 'string'
        ? (metadata as any).voice.originalMessageType
        : '';
  const isVoice =
    Boolean((metadata as any)?.voice) || originalMessageType === 'voice' || originalMessageType === 'audio';
  return isVoice ? 'telegram_voice' : 'telegram_text';
}

function inferMessageRisk(params: VoiceOutboundContext): VoiceMessageRisk {
  if (params.messageRisk) return params.messageRisk;
  if (params.domainZone === 'out_of_domain') return 'out_of_domain';
  if (params.detectedIntent === 'money_sensitive') return 'sensitive_money';
  if (
    params.detectedIntent === 'personal_data_sensitive' ||
    params.isEscalation ||
    params.responseMode === 'operator_escalation'
  ) {
    return 'sensitive_internal';
  }
  return 'normal';
}

function inferVoiceResponseMode(params: VoiceOutboundContext, transport: VoiceInboundTransport): string | undefined {
  if (params.responseMode) return params.responseMode;
  if (transport !== 'telegram_voice') return undefined;

  const telegramLangCode = String(
    (params.envelope.metadata as Record<string, unknown> | undefined)?.telegram_user_language_code ?? '',
  ).trim() || undefined;
  const meta = resolveTelegramTextMeta({
    baseText: String(params.envelope.messageText ?? ''),
    telegramLangCode,
  });
  return meta ? 'telegram_meta_voice_reply' : undefined;
}

export function resolveVoiceResponseDecision(params: VoiceOutboundContext): VoiceResponseDecision {
  const session = loadAutonomousSession(params.chatId);
  const userSettings = loadChatVoiceUserSettings(session?.collected_data);
  const propertyTz = resolvePropertyTimezone(params.propertyTimezone);
  const propertyVoiceSettings = resolvePropertyVoicePolicy({
    ...params.propertyVoicePolicy,
    timezone: propertyTz.timezone,
  });
  const transport = inboundTransport(params.envelope);
  const responseMode = inferVoiceResponseMode(params, transport);

  return evaluateVoiceResponsePolicy({
    role: params.role,
    detectedIntent: params.detectedIntent,
    domainZone: params.domainZone,
    responseMode,
    propertyId: params.propertyId,
    propertyTimezone: propertyTz,
    inboundTransport: transport,
    messageRisk: inferMessageRisk({ ...params, responseMode }),
    userVoiceSettings: userSettings,
    propertyVoiceSettings,
    budget: getVoiceBudgetSnapshot(params.chatId),
    replyText: params.replyText,
    ttsConfigured: isTtsConfigured(),
    isUrgent: params.isUrgent,
  });
}

function shouldOfferResponseModalityChoice(params: {
  context: VoiceOutboundContext;
  transport: VoiceInboundTransport;
  decision: VoiceResponseDecision;
  preferredResponseModality?: 'text' | 'voice' | null;
  promptAlreadySent?: boolean;
}): boolean {
  if (params.transport !== 'telegram_text') return false;
  if (params.preferredResponseModality) return false;
  if (params.promptAlreadySent) return false;
  if (params.context.isUrgent || params.context.isEscalation) return false;
  if (inferMessageRisk(params.context) !== 'normal') return false;
  if (params.context.responseMode === 'operator_escalation') return false;
  if (params.context.responseMode === 'ask_clarifying_question') return false;
  if (params.decision.shouldSendVoice) return false;
  return true;
}

export function buildVoiceOutboundMetadata(params: VoiceOutboundContext): Record<string, unknown> {
  const decision = resolveVoiceResponseDecision(params);
  const session = loadAutonomousSession(params.chatId);
  const userSettings = loadChatVoiceUserSettings(session?.collected_data);
  const transport = inboundTransport(params.envelope);
  const offerModalityChoice = shouldOfferResponseModalityChoice({
    context: params,
    transport,
    decision,
    preferredResponseModality: userSettings.preferredResponseModality,
    promptAlreadySent: userSettings.modalityPreferencePromptSent,
  });

  return {
    voice_response_decision: decision,
    // Legacy notice is superseded by the one-time modality choice prompt.
    voice_append_first_notice: false,
    voice_first_notice_text: undefined,
    response_modality_prompt: offerModalityChoice,
    response_modality_prompt_text: offerModalityChoice ? RESPONSE_MODALITY_CHOICE_RU : undefined,
    voice_policy_property_timezone: params.propertyTimezone ?? null,
    voice_policy_timezone_source: decision.timezoneSource ?? null,
  };
}

export function appendVoiceFirstNoticeIfNeeded(text: string, metadata?: Record<string, unknown>): string {
  if (!metadata?.voice_append_first_notice) return text;
  const notice = String(metadata.voice_first_notice_text ?? VOICE_FIRST_NOTICE_RU).trim();
  if (!notice || text.includes(notice)) return text;
  return `${text}\n\n${notice}`;
}

export function appendResponseModalityPromptIfNeeded(text: string, metadata?: Record<string, unknown>): string {
  if (!metadata?.response_modality_prompt) return text;
  const prompt = String(metadata.response_modality_prompt_text ?? RESPONSE_MODALITY_CHOICE_RU).trim();
  if (!prompt || text.includes(prompt)) return text;
  return `${text}\n\n${prompt}`;
}

export function inferDomainZoneForVoice(params: {
  detectedIntent?: string;
  domainZone?: 'core' | 'adjacent' | 'out_of_domain';
}): 'core' | 'adjacent' | 'out_of_domain' | undefined {
  if (params.domainZone) return params.domainZone;
  const intent = String(params.detectedIntent ?? '').trim();
  if (intent === 'guest_local_recommendation') return 'adjacent';
  if (intent === 'lead_connection' || intent === 'owner_internal_request' || intent === 'unclear_role') {
    return 'out_of_domain';
  }
  if (
    intent.startsWith('guest_') ||
    intent === 'emergency_or_damage' ||
    intent === 'complaint_or_conflict' ||
    intent === 'money_sensitive'
  ) {
    return 'core';
  }
  return undefined;
}
