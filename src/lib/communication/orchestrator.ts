import { getChannelAdapter } from './channels';
import { bindIdentity } from './identity-binding';
import { evictIdentityCacheForTelegramChatId } from './identity';
import { appendTimelineEvent } from './timeline';
import {
  auditDuplicate,
  auditDecision,
  auditDuplicateOutboundPrevented,
  auditEscalation,
  auditError,
  auditInbound,
  auditLLM,
  auditLlmRouter,
  auditOutbound,
  auditPromptInjectionBlocked,
  auditPromptInjectionRepeat,
  auditRetryAttempt,
  auditFailureEnqueued,
  auditTelegramGuestAgentShadow,
} from './audit';
import {
  buildIntelligentPrompt,
  classifyMessage,
  deterministicReply,
  SYSTEM_PROMPT,
} from './classifier';
import { checkAndMarkKey } from './idempotency';
import {
  saveAssistantTurn,
  saveUserTurn,
  upsertSession,
} from './persistence';
import {
  createEscalationEvent,
  deriveEscalationReason,
  shouldEscalate,
} from './escalation';
import {
  ProcessOutcome,
  ProcessResult,
  EscalationReason,
  CommunicationContext,
  InboundMessageEnvelope,
  IdentityResolution,
  IntentCategory,
  Lang,
  MessageCategory,
} from './types';

import { getContext, updateContext } from './memory';
import {
  loadAutonomousSession,
  mergeAutonomousSessionFromInbound,
  patchAutonomousSessionCollectedData,
  resetAutonomousSessionSnapshot,
  savePendingIdentityMessage,
  setAutonomousSessionIdentity,
  takePendingIdentityMessage,
} from './conversation-session-store';
import {
  appendSessionMessage,
  buildSessionContextForLLM,
  getOrCreateConversationSession,
  resolveActorId,
  resetConversationSessionForAcceptance,
  transitionConversationSessionState,
  updateSessionFactsAndSummary,
} from './conversation-session-engine';
import {
  extractStaffClues,
  hasMinimalStaffClues,
  buildStaffClarifyQuestion,
  detectStaffScenario,
} from './staff-bridge';
import { resolveEntities } from './entity-resolver';
import { buildDecisionAndPlan } from './scenario-engine';
import { pickSingleBestClarifyingQuestion } from './clarifying-question';
import { auditAutonomousDecision } from './audit';
import { detectIntent } from './intent';
import { createPaymentRequest } from '@/lib/payments/factory';
import { callLLM } from '@/lib/openai';
import { buildCommunicationContext } from './context';
import { evaluateActionSafety } from './action';
import { buildOperatorHandoff } from './handoff';
import {
  createOrUpdateEscalationReview,
  getActiveEscalationReviewIdForSession,
  forceCloseActiveReviewForSession,
} from './operator-review';
import { recordCommunicationEscalation } from './escalations';
import { canAiReply, recordHandoffAuditEvent } from './handoff-lock';
import {
  SessionStatus,
  setPaymentExpiry,
  transitionSessionStatus,
  forceResetSessionStatusForAcceptance,
} from './session-status';
import { getPropertyTemplates } from './templates';
import { createOpsTask, OpsTaskType, OpsTaskPriority } from '@/lib/ops/tasks';
import { shouldCreateTelegramOpsTaskDirectly } from '@/lib/ops/telegram-ops-guard';
import { evaluateCheckinReadiness } from '@/lib/ops/checkin-gate';
import { supabase } from '@/lib/supabase';
import { runInBackground } from './background';
import { retry, sha256Base64Url } from './reliability';
import { writeFailure } from './failure-store';
import { shouldEscalateByRules } from './escalation-policy';
import {
  answerTelegramCallbackQuery,
  editTelegramMessageReplyMarkup,
  editTelegramMessageText,
  replyToTelegram,
} from '@/lib/telegram';
import {
  clearTelegramPromptInjectionGuardForChat,
  detectTelegramPromptInjection,
  evaluateTelegramPromptInjectionGuard,
  TELEGRAM_PROMPT_INJECTION_BLOCKED_REPLY,
  TELEGRAM_PROMPT_INJECTION_FIRST_REPLY,
} from './telegram-prompt-injection-guard';
import { resolveTelegramTextMeta, type TelegramTextMetaKind } from './telegram-text-meta-handler';
import {
  isNoActionTelegramGuestCanonIntent,
  resolveTelegramGuestIntentCanon,
} from './telegram-guest-intent-canon';
import { processTelegramOperationalIntakeWithSessionMemory, clearDurableTelegramSessionForAcceptance } from './telegram-session-memory';
import { linkReservationOrPropertyDeterministicV1 } from './reservation-property-linking';
import {
  composeTelegramOperationalReply,
  composeTelegramOperationalMultiIntentReply,
} from './telegram-reply-composer';
import {
  executeTelegramOperationalPolicy,
  executeTelegramOperationalPolicyMultiIntent,
  type TelegramOperationalPolicyResult,
} from './telegram-operational-policy-executor';
import {
  canonicalUrgentAccessEscalationText,
  isCanonicalGuestCommunicationChannel,
} from './communication-canon';
import {
  normalizeGuestMessageForCanon,
  type CommunicationCanonNormalization,
} from './communication-normalizer';
import {
  bookingObjectContextToAutopilotFields,
  buildGuestMissingContextReplyRu,
  resolveEmailGuestBookingObjectContext,
  resolveTelegramGuestBookingObjectContext,
} from './telegram-booking-object-memory';
import {
  buildOperatorEscalationDetail,
  decideGuestCommunicationWithLlmSafeDomainLayer,
  patchCommunicationMemoryFromDecision,
  loadCommunicationMemoryFromSession,
} from './guest-communication-brain';
import { buildVoiceOutboundMetadata, inferDomainZoneForVoice } from './voice-outbound';
import { loadChatVoiceUserSettings } from './voice-response-settings';
import { loadPropertyTimezone } from './telegram-property-knowledge';
import { GUEST_MISSING_DATA_OPERATOR_REPLY, OPERATOR_HANDOFF_FAILED_REPLY } from './guest-test-answers';
import {
  canClassifyInboundCommunication,
  canSendAutonomousGuestReply,
  isCommunicationAutopilotEnabled,
} from './communication-autopilot-settings';
import {
  buildAutopilotSessionPatch,
  detectOperationalLanguage,
  runCommunicationAutopilotV1,
} from './communication-autopilot-v1';
import {
  shouldPreferCommunicationAutopilotV1,
  tryCommunicationAutopilotV1OrchestratorTurn,
} from './communication-autopilot-v1-orchestrator';
import { recordCommunicationAutopilotTurn } from './communication-autopilot-crm';
import {
  isExplicitGuestPreferenceOnlyMessage,
  loadRelevantGuestMemory,
  observeResolvedGuestInbound,
} from './guest-long-term-memory';
import {
  autopilotSessionFromCollectedData,
  patchAutopilotSessionCollectedData,
} from './communication-autopilot-session';
import { getGroundedKnowledge } from './knowledge';
import {
  createGuestConciergeAnsweredEvent,
  createGuestTestMissingDataEvent,
  createOperatorFollowupRequired,
  recordGuestTestQuestionOutcome,
} from '@/lib/crm/operator-followup';
import {
  audit_object_knowledge_reply,
  type ObjectKnowledgeStatus,
} from './object-knowledge';
import { isTelegramOutboundDryRun } from './telegram-outbound-safe-mode';
import { handleTelegramOpsAcceptanceEscalation } from './telegram-ops-acceptance-escalation';
import { shouldSuppressEmailOutbound } from './email-outbound-safe-mode';
import {
  applyCommAgentSessionContinuation,
  deriveSessionMemoryPatchFromDecision,
  getCommAgentSessionMemory,
  updateCommAgentSessionMemory,
} from './comm-agent-session-memory';
import { logCommAgentHandoffPreview, logCommAgentMetrics } from './comm-agent-metrics';
import { buildOperatorHandoffDecision } from './operator-handoff-decision';
import { stableEmailChatId } from './email-stable-chat-id';
import {
  decideCommunicationAutopilotResponseWithLlmRouter,
  composeCommunicationAutopilotContextReply,
  type CommunicationAutopilotDecision,
  type CommunicationAutopilotContext,
} from './autopilot';
import {
  upsertCommunicationOperationsAction,
  type CommunicationOperationsAction,
  type CommunicationOperationsActionSourceChannel,
} from './operations-action';
import {
  RESET_IDENTITY_CLARIFY_RU,
  resolveCommunicationIdentityRoute,
  shouldSavePendingIdentityMessage,
  TELEGRAM_IDENTITY_CALLBACKS,
  UNKNOWN_IDENTITY_INLINE_KEYBOARD,
} from './communication-identity-routing';
import { processTelegramOwnerOnboarding, type OwnerOnboardingEditInPlaceMode } from './telegram-owner-onboarding';

const GUEST_MISSING_BOOKING_CONTEXT = 'after_missing_booking_or_object_data';
const GUEST_BOOKING_IDENTIFIER_STATE = 'awaiting_guest_booking_identifier';
const GUEST_BOOKING_LOOKUP_DATA_STATE = 'awaiting_guest_booking_lookup_data';

const GUEST_BOOKING_LOOKUP_BY_NAME_REPLY =
  'Да, можно. Напишите, пожалуйста, имя и фамилию, дату заезда и, если есть, последние 4 цифры телефона из брони. Я передам это оператору для проверки.';

const GUEST_BOOKING_LOOKUP_RECEIVED_REPLY =
  'Спасибо, передал данные оператору для проверки. Вернусь с ответом здесь.';

type TgLivePriorityScenario = 'access_issue' | 'wifi_issue' | 'late_checkout';

function isTgLivePriorityScenario(s: unknown): s is TgLivePriorityScenario {
  return s === 'access_issue' || s === 'wifi_issue' || s === 'late_checkout';
}

async function createTelegramOpsTask(task: Parameters<typeof createOpsTask>[0]) {
  if (!shouldCreateTelegramOpsTaskDirectly()) {
    return { task_id: null as string | null, error: 'telegram_ops_escalation_only' };
  }
  return createOpsTask(task);
}

function shouldGreetTelegramOperationalReply(session: { memory?: { lastMessages?: Array<{ direction?: unknown; content?: unknown }> } }): boolean {
  const messages = session.memory?.lastMessages ?? [];
  return !messages.some((message) => {
    if (message.direction !== 'outbound') return false;
    return String(message.content ?? '').trim().length > 0;
  });
}

function readTelegramCallbackMessageId(metadata: InboundMessageEnvelope['metadata']): number | undefined {
  const raw = (metadata as Record<string, unknown> | undefined)?.telegram_callback_message_id;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function deliverOwnerOnboardingTelegramReply(params: {
  adapter: ReturnType<typeof getChannelAdapter>;
  targetId: string;
  replyText: string;
  replyMarkup?: Record<string, unknown>;
  editInPlace?: boolean;
  editInPlaceMode?: OwnerOnboardingEditInPlaceMode;
  callbackMessageId?: number;
  handler: string;
  update_id?: number;
  metadata: Record<string, unknown>;
}): Promise<boolean> {
  const messageId = params.callbackMessageId;
  if (params.editInPlace && typeof messageId === 'number') {
    const logCtx = {
      handler: params.handler,
      update_id: params.update_id,
      reply_markup: params.replyMarkup,
    };
    const edited =
      params.editInPlaceMode === 'text'
        ? await editTelegramMessageText(
            params.targetId,
            messageId,
            params.replyText,
            params.replyMarkup,
            logCtx,
          )
        : await editTelegramMessageReplyMarkup(
            params.targetId,
            messageId,
            params.replyMarkup ?? { inline_keyboard: [] },
            logCtx,
          );
    if (edited) return true;
  }

  return params.adapter.sendMessage(params.targetId, params.replyText, {
    ...params.metadata,
    reply_handler: params.handler,
    update_id: params.update_id,
    reply_markup: params.replyMarkup,
  });
}

function actionableCanonicalOperationalIntents(
  intents: TelegramOperationalPolicyResult[],
): TelegramOperationalPolicyResult[] {
  return intents.filter((intent) => intent.action !== 'slow_ack' && intent.scenarioFamily !== 'SLOW_ACK');
}

function composeCanonicalOperationalPolicyFallback(params: {
  intents: TelegramOperationalPolicyResult[];
  lang: Lang;
  channel: InboundMessageEnvelope['channel'];
}): string {
  const urgentAccess = params.intents.find(
    (intent) => intent.scenarioFamily === 'ACCESS_KEY_ISSUE' && intent.action === 'escalate',
  );
  if (urgentAccess) {
    const urgentText = canonicalUrgentAccessEscalationText({
      channel: params.channel,
      lang: params.lang,
      scenarioFamily: urgentAccess.scenarioFamily,
      action: urgentAccess.action,
    });
    if (urgentText) return urgentText;
  }

  if (params.lang === 'ru') {
    if (
      params.intents.every(
        (intent) =>
          intent.action === 'clarify' &&
          (intent.scenarioFamily === 'OBJECT_CLARIFICATION' || intent.scenarioFamily === 'BOOKING_CONTEXT'),
      )
    ) {
      return 'Уточните, пожалуйста: это про какой объект или номер брони?';
    }
    return composeTelegramOperationalMultiIntentReply({ intents: params.intents, lang: params.lang }).text;
  }

  if (params.intents.some((intent) => intent.action === 'escalate')) {
    return 'I’m passing this to an operator so we can check the booking/property policy before answering.';
  }
  if (params.intents.some((intent) => intent.action === 'clarify')) {
    return 'Please send the property or booking number so I can check the exact details.';
  }
  return 'I’ll check this against the booking/property details and get back with an update.';
}

function resolveCanonicalCommunicationLang(params: {
  normalization: CommunicationCanonNormalization;
  previousLang?: Lang | null;
  classifiedLang: Lang;
}): Lang {
  const hinted = params.normalization.language;
  const previous = params.previousLang === 'ru' || params.previousLang === 'en' ? params.previousLang : null;
  const classified = params.classifiedLang === 'ru' || params.classifiedLang === 'en' ? params.classifiedLang : 'en';

  if (hinted.current === 'ru' || hinted.current === 'en') return hinted.current;
  if (hinted.current === 'mixed') {
    if (previous) return previous;
    if (hinted.dominant === 'ru' || hinted.dominant === 'en') return hinted.dominant;
    return classified;
  }
  if (hinted.dominant === 'ru' || hinted.dominant === 'en') return hinted.dominant;
  return previous ?? classified;
}

function replySignature(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 32)
    .join(' ');
}

function signatureSimilarity(a: string, b: string): number {
  const left = new Set(a.split(/\s+/).filter(Boolean));
  const right = new Set(b.split(/\s+/).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.max(left.size, right.size);
}

function antiLoopClarification(lang: Lang): string {
  if (lang === 'ru') {
    return 'Чтобы не повторяться: пришлите, пожалуйста, объект или номер брони одним сообщением, и я проверю точные детали.';
  }
  return 'To avoid repeating myself: please send the property or booking number in one message, and I’ll check the exact details.';
}

function antiLoopEscalation(lang: Lang): string {
  if (lang === 'ru') return 'Вижу, что мы застряли на уточнении. Передаю оператору, чтобы помочь дальше.';
  return 'I can see we’re stuck on the same clarification. I’m passing this to an operator so they can help.';
}

function preventRepeatedCommunicationReply(params: {
  replyText: string;
  lang: Lang;
  memory: any;
  eligible?: boolean;
}): { replyText: string; signature: string; repeatedCount: number; prevented: boolean; escalated: boolean } {
  const currentSignature = replySignature(params.replyText);
  if (!params.eligible) {
    return {
      replyText: params.replyText,
      signature: currentSignature,
      repeatedCount: 0,
      prevented: false,
      escalated: false,
    };
  }
  const previousSignature = String(params.memory?.communicationSemanticMemory?.lastReplySignature ?? '');
  const previousCount = Number(params.memory?.communicationSemanticMemory?.repeatedReplyCount ?? 0);
  const repeated =
    currentSignature.length > 0 &&
    previousSignature.length > 0 &&
    (currentSignature === previousSignature || signatureSimilarity(currentSignature, previousSignature) >= 0.86);

  if (!repeated) {
    return {
      replyText: params.replyText,
      signature: currentSignature,
      repeatedCount: 0,
      prevented: false,
      escalated: false,
    };
  }

  const repeatedCount = previousCount + 1;
  const escalated = repeatedCount >= 2;
  const replyText = escalated ? antiLoopEscalation(params.lang) : antiLoopClarification(params.lang);
  return {
    replyText,
    signature: replySignature(replyText),
    repeatedCount,
    prevented: true,
    escalated,
  };
}

export const __preventRepeatedCommunicationReplyForTests = preventRepeatedCommunicationReply;

function isSafeAutopilotSelfServiceIntent(intent: string | null | undefined): boolean {
  return [
    'checkin_code_request',
    'booking_lookup_missing_details',
    'cleaning_issue',
    'maintenance_issue',
  ].includes(String(intent ?? ''));
}

function replySubject(subject: unknown): string {
  const raw = String(subject ?? '').trim();
  if (!raw) return 'Re: Your request';
  if (/^re:/i.test(raw)) return raw;
  return `Re: ${raw}`;
}

function metadataString(metadata: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function telegramOutboundTargetId(envelope: InboundMessageEnvelope): string | undefined {
  const metadata = envelope.metadata;
  const explicit =
    metadataString(metadata, ['telegram_chat_id', 'telegramChatId', 'telegram_chatId']) ??
    metadataString((metadata as any)?.telegram, ['chat_id', 'chatId', 'id']) ??
    metadataString((metadata as any)?.message?.chat, ['id']) ??
    metadataString((metadata as any)?.message, ['telegram_chat_id', 'chat_id', 'telegramChatId']) ??
    metadataString((metadata as any)?.chat, ['id']);

  if (explicit) return explicit;

  const fallback = String(envelope.chatId ?? '').trim() || undefined;
  if (!fallback) return undefined;

  const internalIds = [
    metadataString(metadata, ['guestId', 'identityGuestId', 'sessionId', 'userId', 'identityId', 'actorId']),
    metadataString((metadata as any)?.identity, ['id', 'guestId', 'userId']),
    metadataString((metadata as any)?.session, ['id', 'sessionId']),
  ].filter((value): value is string => Boolean(value));

  if (internalIds.includes(fallback)) return undefined;

  return fallback;
}

function resolveOutboundTargetId(
  envelope: InboundMessageEnvelope,
  identityGuestId?: string,
): string | undefined {
  if (envelope.channel === 'telegram') {
    return telegramOutboundTargetId(envelope);
  }

  return (String(envelope.chatId ?? '').trim() || undefined) ??
    (String(envelope.email ?? '').trim() || undefined) ??
    (String(envelope.phoneNumber ?? '').trim() || undefined) ??
    identityGuestId;
}

function buildOutboundTransportMetadata(params: {
  envelope: InboundMessageEnvelope;
  usedPath: string;
  update_id: number;
  category: MessageCategory;
  telegramMetaRouteKind?: TelegramTextMetaKind | null;
  isEscalation?: boolean;
  voiceExtras?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const replyHandler = `orchestrator:${params.usedPath}${
    params.telegramMetaRouteKind ? `:telegram_meta=${params.telegramMetaRouteKind}` : ''
  }:category=${params.category}`;

  if (params.envelope.channel === 'telegram') {
    return {
      reply_handler: replyHandler,
      update_id: params.update_id,
      ...(params.isEscalation ? { voice_reply_is_escalation: true } : {}),
      ...(params.usedPath.includes('payment') ? { voice_reply_is_payment: true } : {}),
      ...(params.usedPath.includes('checkin') || params.usedPath.includes('check_in') ? { voice_reply_is_checkin_instructions: true } : {}),
      ...(params.voiceExtras ?? {}),
    };
  }

  if (params.envelope.channel === 'email') {
    const metadata = params.envelope.metadata;
    const sourceMessageId = metadataString(metadata, ['message_id', 'messageId', 'providerMessageId', 'externalMessageId']);
    const inReplyTo = metadataString(metadata, ['in_reply_to', 'inReplyTo']) ?? sourceMessageId;
    return {
      reply_handler: replyHandler,
      update_id: params.update_id,
      subject: replySubject(params.envelope.subject ?? metadata?.subject),
      in_reply_to: inReplyTo,
      references: metadata?.references ?? inReplyTo,
    };
  }

  if (params.envelope.channel === 'max') {
    const metadata = params.envelope.metadata;
    return {
      reply_handler: replyHandler,
      update_id: params.update_id,
      chat_id: metadata?.chat_id ?? params.envelope.chatId ?? null,
      user_id: metadata?.user_id ?? params.envelope.externalUserId ?? null,
      max_chat_id: metadata?.chat_id ?? params.envelope.chatId ?? null,
      max_user_id: metadata?.user_id ?? params.envelope.externalUserId ?? null,
    };
  }

  return undefined;
}

async function buildTelegramVoiceExtras(params: {
  envelope: InboundMessageEnvelope;
  replyText: string;
  chatId: number;
  detectedIntent?: string;
  domainZone?: 'core' | 'adjacent' | 'out_of_domain';
  responseMode?: string;
  role?: string;
  propertyId?: string | null;
  isUrgent?: boolean;
  isEscalation?: boolean;
}): Promise<Record<string, unknown>> {
  const propertyTimezone = params.propertyId ? await loadPropertyTimezone(params.propertyId) : null;
  return buildVoiceOutboundMetadata({
    envelope: params.envelope,
    replyText: params.replyText,
    chatId: params.chatId,
    detectedIntent: params.detectedIntent,
    domainZone: params.domainZone,
    responseMode: params.responseMode,
    role: params.role,
    propertyId: params.propertyId,
    propertyTimezone,
    isUrgent: params.isUrgent,
    isEscalation: params.isEscalation,
  });
}

function firstUsefulText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    if (/^(information unavailable|unavailable|unknown|null)$/i.test(text)) continue;
    return text;
  }
  return undefined;
}

function objectKnowledgeKeyForAutopilotIntent(intent: string): string | null {
  switch (intent) {
    case 'baby_crib_request':
      return 'baby_crib_note';
    case 'waste_disposal_info':
      return 'trash_bins_location';
    case 'address_instruction':
      return 'directions_text';
    case 'parking':
      return 'parking_text';
    case 'wifi':
    case 'wifi_access':
      return 'wifi_password';
    case 'wifi_problem':
      return 'wifi_name';
    default:
      return null;
  }
}

function resolveObjectKnowledgeStatusForAudit(params: {
  key: string;
  context: CommunicationAutopilotContext;
  missingContext: string[];
}): ObjectKnowledgeStatus {
  const status = params.context.object?.knowledgeStatus?.[params.key];
  if (status) return status;
  if (params.missingContext.length > 0) return 'missing';
  return 'found';
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseWifiInstruction(value: unknown): { name?: string; password?: string } {
  const text = String(value ?? '').trim();
  if (!text || /^information unavailable\.?$/i.test(text)) return {};

  const name =
    text.match(/(?:network|ssid|wi-?fi)\s*:\s*([^,\n.;]+)/i)?.[1]?.trim() ??
    text.match(/(?:сеть|wi-?fi)\s*:\s*([^,\n.;]+)/i)?.[1]?.trim();
  const password =
    text.match(/(?:pass(?:word)?|пароль)\s*:\s*([^,\n.;]+)/i)?.[1]?.trim();

  return {
    name: firstUsefulText(name),
    password: firstUsefulText(password),
  };
}

function mergeAutopilotContext(
  base: CommunicationAutopilotContext,
  override: unknown,
): CommunicationAutopilotContext {
  if (!override || typeof override !== 'object') return base;
  const source = override as CommunicationAutopilotContext;
  return {
    session: { ...(base.session ?? {}), ...(source.session ?? {}) },
    booking: { ...(base.booking ?? {}), ...(source.booking ?? {}) },
    object: { ...(base.object ?? {}), ...(source.object ?? {}) },
    bookingVerified: source.bookingVerified ?? base.bookingVerified,
    propertyResolved: source.propertyResolved ?? base.propertyResolved,
  };
}

function buildAutopilotContext(params: {
  chatId: number;
  envelope: InboundMessageEnvelope;
  identity: Awaited<ReturnType<typeof bindIdentity>>;
  commContext: CommunicationContext;
  templates: Awaited<ReturnType<typeof getPropertyTemplates>> | null;
  lang: Lang;
  bookingMemoryFields?: ReturnType<typeof bookingObjectContextToAutopilotFields>;
}): CommunicationAutopilotContext {
  const wifi = parseWifiInstruction(params.commContext.knowledge?.wifiInstructions);
  const memory = params.commContext.memory as unknown as Record<string, unknown>;
  const reservation = params.commContext.reservation as unknown as Record<string, unknown>;
  const metadataContext = (params.envelope.metadata as Record<string, unknown> | undefined)?.autopilotContext;
  const dbMemory = params.bookingMemoryFields;

  const context: CommunicationAutopilotContext = {
    session: {
      id: String(params.chatId),
      guestName: firstUsefulText(
        dbMemory?.session?.guestName,
        params.identity.guestId,
        params.commContext.reservation.guestName,
        memory.guestName,
      ),
      language: params.lang,
    },
    booking: {
      id: firstUsefulText(
        dbMemory?.booking?.id,
        params.commContext.reservation.reservationId,
        params.identity.reservationId,
        memory.reservationId,
        memory.bookingReference,
      ),
      checkInDate: firstUsefulText(dbMemory?.booking?.checkInDate, (reservation as any).checkIn, (reservation as any).check_in, memory.checkInDate),
      checkInTime: firstUsefulText(dbMemory?.booking?.checkInTime, (reservation as any).checkInTime, (reservation as any).check_in_time),
      checkoutTime: firstUsefulText(dbMemory?.booking?.checkoutTime, (reservation as any).checkoutTime, (reservation as any).checkout_time),
      earlyCheckInAvailable: boolOrUndefined((reservation as any).earlyCheckInAvailable),
      lateCheckoutAvailable: boolOrUndefined((reservation as any).lateCheckoutAvailable),
      verified: dbMemory?.booking?.verified,
    },
    object: {
      id: firstUsefulText(
        dbMemory?.object?.id,
        params.commContext.reservation.propertyId,
        params.identity.propertyId,
        memory.propertyId,
      ),
      name: firstUsefulText(dbMemory?.object?.name, memory.propertyLocation, params.commContext.reservation.propertyId, params.identity.propertyId),
      address: firstUsefulText(dbMemory?.object?.address, memory.propertyLocation),
      directionsText: dbMemory?.object?.directionsText,
      parkingText: dbMemory?.object?.parkingText,
      accessInstructions: firstUsefulText(
        dbMemory?.object?.accessInstructions,
        params.templates?.pre_checkin_template,
        params.commContext.knowledge?.checkInInstructions,
      ),
      accessCode: dbMemory?.object?.accessCode,
      wifiName: firstUsefulText(dbMemory?.object?.wifiName, wifi.name),
      wifiPassword: firstUsefulText(dbMemory?.object?.wifiPassword, wifi.password),
      houseRules: dbMemory?.object?.houseRules,
    },
    bookingVerified: dbMemory?.bookingVerified,
    propertyResolved: dbMemory?.propertyResolved,
  };

  return mergeAutopilotContext(context, metadataContext);
}

function isLiveAutopilotInboundChannel(
  channel: InboundMessageEnvelope['channel'],
): channel is 'telegram' | 'email' {
  return channel === 'telegram' || channel === 'email';
}

function toAutopilotOperationsSourceChannel(
  channel: InboundMessageEnvelope['channel'],
): CommunicationOperationsActionSourceChannel {
  return channel === 'phone' ? 'phone-placeholder' : channel === 'email' ? 'email' : 'telegram';
}

function composeAutopilotContextClarifier(params: {
  decision: CommunicationAutopilotDecision;
  lang: Lang;
}): string {
  if (params.decision.replyText) return params.decision.replyText;

  const missing = params.decision.metadata.missingContext;
  if (params.lang === 'ru') {
    if (
      params.decision.metadata.intent === 'wifi' ||
      params.decision.metadata.intent === 'wifi_access' ||
      params.decision.metadata.intent === 'wifi_problem'
    ) {
      return buildGuestMissingContextReplyRu();
    }
    if (params.decision.metadata.intent === 'unknown') {
      return 'Поняла. Подскажите, вы про заселение, оплату, доступ к квартире или уже текущее проживание? Я помогу с нужным шагом.';
    }
    if (params.decision.metadata.intent === 'booking_lookup_missing_details') {
      return 'Напишите, пожалуйста, телефон или имя гостя, дату заезда и объект - найдем бронь.';
    }
    if (params.decision.metadata.intent === 'cleaning_issue') {
      return 'Принял, вопрос по уборке зарегистрирован. Напишите, пожалуйста, объект или номер брони.';
    }
    if (params.decision.metadata.intent === 'maintenance_issue') {
      return 'Принял, поломку зарегистрировал. Напишите, пожалуйста, объект или номер брони.';
    }
    if (params.decision.metadata.intent === 'check_in_access') {
      if (params.decision.metadata.matchedSignals.some((signal) => signal === 'checkin_readiness_access')) {
        return 'Поняла, проверю готовность квартиры и доступ к ключу. Напишите, пожалуйста, номер бронирования или адрес объекта, чтобы я сразу нашёл нужную бронь. Если данных не хватит, передам оператору.';
      }
      return 'Поняла, помогаю с заселением. Напишите, пожалуйста, объект или номер брони.';
    }
    if (params.decision.metadata.intent === 'address_instruction') {
      return 'Поняла, нужно подсказать маршрут до квартиры. Напишите, пожалуйста, адрес объекта или номер бронирования, и я подскажу, как добраться. Если адрес уже привязан к брони, сейчас найду его по бронированию.';
    }
    if (missing.some((field) => field.startsWith('object.'))) {
      return '\u0423\u0442\u043e\u0447\u043d\u0438\u0442\u0435, \u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430, \u043e\u0431\u044a\u0435\u043a\u0442 \u0438\u043b\u0438 \u043d\u043e\u043c\u0435\u0440 \u0431\u0440\u043e\u043d\u0438, \u0438 \u044f \u043f\u0440\u043e\u0432\u0435\u0440\u044e \u0442\u043e\u0447\u043d\u044b\u0435 \u0434\u0435\u0442\u0430\u043b\u0438.';
    }
    return '\u041d\u0443\u0436\u043d\u043e \u0443\u0442\u043e\u0447\u043d\u0438\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0435 \u043f\u043e \u0431\u0440\u043e\u043d\u0438 \u0438\u043b\u0438 \u043e\u0431\u044a\u0435\u043a\u0442\u0443. \u041f\u0440\u0438\u0448\u043b\u0438\u0442\u0435, \u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430, \u043d\u043e\u043c\u0435\u0440 \u0431\u0440\u043e\u043d\u0438 \u0438\u043b\u0438 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043e\u0431\u044a\u0435\u043a\u0442\u0430.';
  }

  if (missing.some((field) => field.startsWith('object.'))) {
    return 'Please send the property or booking number, and I will check the exact details.';
  }
  return 'I need one more booking or property detail before answering safely. Please send the booking number or property name.';
}

function composeAutopilotOperationsRegisteredReply(params: {
  decision: CommunicationAutopilotDecision;
  lang: Lang;
}): string | null {
  if (params.lang !== 'ru') return null;
  switch (params.decision.metadata.intent) {
    case 'cleaning_issue':
      return 'Принял, вопрос по уборке зарегистрирован. Передаю команде.';
    case 'maintenance_issue':
      return 'Принял, поломку зарегистрировал. Передаю команде.';
    case 'check_in_access':
      return 'Поняла, помогаю с заселением и доступом. Проверяю детали.';
    default:
      return null;
  }
}

function composeAutopilotHandoffReply(params: {
  decision: CommunicationAutopilotDecision;
  channel: InboundMessageEnvelope['channel'];
  lang: Lang;
}): string {
  if (params.decision.replyText) return params.decision.replyText;

  const canonical =
    params.decision.metadata.urgent
      ? canonicalUrgentAccessEscalationText({
          channel: params.channel,
          lang: params.lang,
          scenarioFamily: params.decision.metadata.intent === 'urgent_access_problem' ? 'ACCESS_KEY_ISSUE' : undefined,
          action: 'escalate',
        })
      : null;
  if (canonical) return canonical;

  if (params.lang === 'ru') {
    return params.decision.metadata.urgent
      ? '\u0421\u0440\u043e\u0447\u043d\u043e \u043f\u0435\u0440\u0435\u0434\u0430\u044e \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u043c\u043e\u0447\u044c \u0441 \u0434\u043e\u0441\u0442\u0443\u043f\u043e\u043c.'
      : '\u041f\u0435\u0440\u0435\u0434\u0430\u044e \u0432\u043e\u043f\u0440\u043e\u0441 \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443, \u0447\u0442\u043e\u0431\u044b \u043d\u0435 \u043e\u0442\u0432\u0435\u0447\u0430\u0442\u044c \u0431\u0435\u0437 \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043d\u043e\u0433\u043e \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u0430.';
  }

  return params.decision.metadata.urgent
    ? 'I am escalating this to an operator now so we can help with access.'
    : 'I am passing this to an operator so we do not answer without verified booking or property context.';
}

function roleLabelRu(role: unknown): string {
  switch (role) {
    case 'guest':
    case 'test_guest':
      return 'гость';
    case 'owner':
    case 'manager':
      return 'владелец / управляющий';
    case 'lead':
      return 'заявка';
    case 'support_problem':
      return 'поддержка';
    default:
      return 'unknown';
  }
}

function buildOperatorNotificationText(params: {
  role: unknown;
  intent?: string | null;
  topic: string;
  message: string;
  reason: string;
  recommendedReply?: string | null;
}): string {
  const recommended = String(params.recommendedReply ?? '').trim() || 'Проверить контекст и ответить вручную.';
  return [
    '⚠️ ASI: нужна проверка оператора',
    `Роль: ${roleLabelRu(params.role)}`,
    `Интент: ${String(params.intent ?? params.topic).trim() || 'неясно'}`,
    `Тема: ${params.topic}`,
    `Сообщение: ${String(params.message ?? '').trim() || 'Нет текста сообщения'}`,
    `Причина эскалации: ${params.reason}`,
    `Рекомендуемый ответ: ${recommended}`,
  ].join('\n');
}

function rememberedTelegramIdentityForRoute(chatId: number): 'guest' | 'owner' | 'manager' | 'lead' | null {
  const role = loadAutonomousSession(chatId)?.identity_role;
  if (role === 'guest' || role === 'owner' || role === 'manager' || role === 'lead') return role;
  return null;
}

function normalizeRuText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGuestBookingLookupByNameQuestion(messageText: string): boolean {
  const normalized = normalizeRuText(messageText);
  if (!normalized) return false;
  return [
    'можно по имени',
    'по фамилии',
    'номера нет',
    'нет номера бронирования',
    'могу назвать имя',
    'по имени и фамилии',
  ].some((needle) => normalized.includes(needle));
}

function extractGuestBookingLookupData(messageText: string): Record<string, string | null> {
  const textValue = String(messageText ?? '').trim();
  const normalized = normalizeRuText(textValue);
  const phoneLast4 = normalized.match(/(?:\b|\D)(\d{4})(?:\b|\D)/)?.[1] ?? null;
  const dateMatch =
    textValue.match(/\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/)?.[0] ??
    textValue.match(/\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i)?.[0] ??
    null;
  const nameMatch =
    textValue.match(/(?:имя(?:\s+и\s+фамилия)?|зовут|гость)\s*[:\-]?\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/)?.[1] ??
    textValue.match(/([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/)?.[1] ??
    null;
  return {
    guest_name: nameMatch,
    check_in_date: dateMatch,
    phone_last4: phoneLast4,
    raw_text: textValue,
  };
}

function hasGuestBookingLookupData(messageText: string): boolean {
  const data = extractGuestBookingLookupData(messageText);
  return Boolean(data.guest_name && data.check_in_date);
}

function hasAutopilotOperationsContext(context: CommunicationAutopilotContext): boolean {
  return Boolean(
    context.booking?.id ||
      context.object?.id ||
      context.object?.name ||
      context.object?.address,
  );
}

function resolveAutopilotOpsTask(params: {
  decision: CommunicationAutopilotDecision;
  context: CommunicationAutopilotContext;
  envelope: InboundMessageEnvelope;
  fallbackPropertyId?: string | null;
  fallbackReservationId?: string | null;
  chatId: number;
  updateId?: number;
  operationsLifecycle?: { action: CommunicationOperationsAction; lifecycle: 'created' | 'deduped' } | null;
}): { task: Parameters<typeof createOpsTask>[0]; action: CommunicationOperationsAction; lifecycle: 'created' | 'deduped' } | null {
  const action = params.decision.metadata.operationsAction;
  if (!action || !hasAutopilotOperationsContext(params.context)) return null;

  const propertyId = firstUsefulText(params.context.object?.id, params.fallbackPropertyId, 'unknown')!;
  const reservationId = firstUsefulText(params.context.booking?.id, params.fallbackReservationId) ?? null;
  const taskType =
    action.category === 'cleaning'
      ? OpsTaskType.Turnover
      : OpsTaskType.GuestIssue;
  const providerMessageId = firstUsefulText(
    params.envelope.metadata?.providerMessageId,
    params.envelope.metadata?.externalMessageId,
  );
  const lifecycle =
    params.operationsLifecycle ??
    upsertCommunicationOperationsAction({
      sourceChannel: toAutopilotOperationsSourceChannel(params.envelope.channel),
      category: action.category,
      priority: action.priority,
      reason: action.shortReason,
      reference: {
        guestId: firstUsefulText(params.context.session?.guestName, params.envelope.externalUserId),
        sessionId: firstUsefulText(params.context.session?.id),
        bookingId: reservationId ?? undefined,
        objectId: propertyId,
        chatId: params.chatId,
        updateId: params.updateId,
        providerMessageId,
      },
    });

  const task = {
    property_id: propertyId,
    reservation_id: reservationId,
    chat_id: params.chatId,
    task_type: taskType,
    title: action.title,
    description: [
      `Deterministic autopilot operations action.`,
      `Intent: ${params.decision.metadata.intent}.`,
      `Action ID: ${lifecycle.action.id}.`,
      `Category: ${action.category}.`,
    ].join(' '),
    priority: action.priority === 'high' ? OpsTaskPriority.Urgent : OpsTaskPriority.Normal,
    assigned_to: action.category,
    source_event: 'communication_autopilot',
    trigger_reason: action.shortReason,
    dedup_key: [
      'communication_autopilot',
      lifecycle.action.id,
      action.category,
      params.decision.metadata.intent,
      reservationId ?? `chat:${params.chatId}`,
    ].join(':'),
  };

  return { task, action: lifecycle.action, lifecycle: lifecycle.lifecycle };
}

function safeLogJson(tag: string, payload: Record<string, unknown>): void {
  try {
    console.log(tag, payload);
  } catch {
    // never throw from logging
  }
}

function logTelegramLivePath(params: {
  stage:
    | 'inbound'
    | 'intake'
    | 'matching'
    | 'knowledge_lookup'
    | 'reply_decision'
    | 'reply_composed'
    | 'escalation_payload';
  update_id: number;
  raw_text: string;
  scenario: string | null;
  extracted_facts: Record<string, unknown> | null;
  explicit_property_detected: boolean;
  property_hint: string | null;
  matched_property_id: string | null;
  property_match_confidence: string | null;
  matched_reservation_id: string | null;
  knowledge_lookup_attempted: boolean;
  knowledge_lookup_result: string;
  knowledge_skip_reason: string | null;
  knowledge_fields_available: string[];
  reply_mode: 'grounded_reply' | 'clarification' | 'escalation';
  clarification_question_used: boolean;
  clarification_question_used_text: string | null;
  escalation_reason: string | null;
  final_reply_text: string | null;
}): void {
  safeLogJson('[tg:live:path]', {
    update_id: params.update_id,
    raw_text: params.raw_text,
    scenario: params.scenario,
    extracted_facts: params.extracted_facts,
    explicit_property_detected: params.explicit_property_detected,
    property_hint: params.property_hint,
    matched_property_id: params.matched_property_id,
    property_match_confidence: params.property_match_confidence,
    matched_reservation_id: params.matched_reservation_id,
    knowledge_lookup_attempted: params.knowledge_lookup_attempted,
    knowledge_lookup_result: params.knowledge_lookup_result,
    knowledge_skip_reason: params.knowledge_skip_reason,
    knowledge_fields_available: params.knowledge_fields_available,
    reply_mode: params.reply_mode,
    clarification_question_used: params.clarification_question_used,
    clarification_question_used_text: params.clarification_question_used_text,
    escalation_reason: params.escalation_reason,
    final_reply_text: params.final_reply_text,
    stage: params.stage,
    ts: new Date().toISOString(),
  });
}

function pipelineDebugEnabled(envelope?: InboundMessageEnvelope): boolean {
  if (process.env.COMM_PIPELINE_DEBUG === '1') return true;
  if (process.env.RU_TELEGRAM_DEBUG === '1' && envelope?.channel === 'telegram') return true;
  if (process.env.TELEGRAM_DEBUG === '1' && envelope?.channel === 'telegram') return true;
  return false;
}

function stableNumericChatId(envelope: InboundMessageEnvelope, guestId?: string): number {
  if (envelope.channel === 'telegram') {
    const target = resolveOutboundTargetId(envelope, guestId);
    if (target) {
      const n = Number(target);
      if (Number.isFinite(n)) return n;
    }
  }

  // Prefer a real numeric chatId when available.
  if (envelope.chatId) {
    const n = Number(envelope.chatId);
    if (Number.isFinite(n)) return n;
  }

  // Fall back to a stable hash so session state and routing remain consistent.
  const basis =
    guestId ??
    envelope.externalUserId ??
    envelope.email ??
    envelope.phoneNumber ??
    `unknown:${envelope.channel}`;

  // FNV-1a 32-bit
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = (h | 0);
  return out === 0 ? 1 : out;
}

function parseAllowlistedChatIds(raw: string | undefined): Set<number> {
  const out = new Set<number>();
  const s = String(raw ?? '').trim();
  if (!s) return out;
  for (const part of s.split(/[,\s]+/g)) {
    const n = Number(String(part).trim());
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

function matchTelegramCommand(text: string, command: string): { matched: boolean; raw: string } {
  const t = String(text ?? '').trim();
  if (!t.startsWith('/')) return { matched: false, raw: '' };
  // Telegram may send `/cmd@BotName` in group chats, and may include args after whitespace.
  const m = t.match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/);
  if (!m) return { matched: false, raw: '' };
  const cmd = String(m[1] ?? '').toLowerCase();
  return { matched: cmd === command.toLowerCase(), raw: `/${m[1]}${m[2] ? `@${m[2]}` : ''}` };
}

function logSessionResetOrCaseReopen(params: {
  previous_status: string;
  new_status: string;
  reason: string;
  update_id: number;
  // Structured debug fields for Telegram command routing.
  command_raw_text?: string;
  command_raw?: string;
  normalized_command?: string;
  chat_id?: number;
  allowlisted?: boolean;
  prod_reset_enabled?: boolean;
  matched?: boolean;
  intercepted_before_escalation?: boolean;
  final_reply?: string | null;
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'session_reset_or_case_reopen',
        previous_status: params.previous_status,
        new_status: params.new_status,
        reason: params.reason,
        update_id: params.update_id,
        ...(typeof params.command_raw_text === 'string' ? { command_raw_text: params.command_raw_text } : {}),
        ...(typeof params.command_raw === 'string' ? { command_raw: params.command_raw } : {}),
        ...(typeof params.normalized_command === 'string' ? { normalized_command: params.normalized_command } : {}),
        ...(typeof params.chat_id === 'number' ? { chat_id: params.chat_id } : {}),
        ...(typeof params.allowlisted === 'boolean' ? { allowlisted: params.allowlisted } : {}),
        ...(typeof params.prod_reset_enabled === 'boolean' ? { prod_reset_enabled: params.prod_reset_enabled } : {}),
        ...(typeof params.matched === 'boolean' ? { matched: params.matched } : {}),
        ...(typeof params.intercepted_before_escalation === 'boolean'
          ? { intercepted_before_escalation: params.intercepted_before_escalation }
          : {}),
        ...(typeof params.final_reply === 'string' || params.final_reply === null ? { final_reply: params.final_reply } : {}),
      }),
    );
  } catch {
    // never throw from logging
  }
}

function normalizeTelegramSlashCommand(text: string): {
  raw_text: string;
  raw_command: string | null;
  normalized_command: string | null;
} {
  const raw_text = String(text ?? '');
  const t = raw_text.trim();
  if (!t.startsWith('/')) return { raw_text, raw_command: null, normalized_command: null };
  const m = t.match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/);
  if (!m) return { raw_text, raw_command: null, normalized_command: null };
  const raw_command = `/${m[1]}${m[2] ? `@${m[2]}` : ''}`;
  const normalized_command = String(m[1] ?? '').toLowerCase();
  return { raw_text, raw_command, normalized_command };
}

export async function processMessage(envelope: InboundMessageEnvelope): Promise<ProcessResult> {
  const update_id = envelope.update_id ?? Date.now();
  const corrId    = String(update_id);
  const text = envelope.messageText ?? '';
  const canonNormalization = normalizeGuestMessageForCanon(text);
  const latencyLoggingEnabled = envelope.channel === 'telegram';
  const ruDebug = process.env.RU_TELEGRAM_DEBUG === '1' && envelope.channel === 'telegram';
  const pipeDebug = pipelineDebugEnabled(envelope);

  const cpEnabled = pipeDebug || envelope.channel === 'telegram';
  const cp = (checkpoint: string, extra?: Record<string, unknown>) => {
    if (!cpEnabled) return;
    try {
      console.log('[comm:checkpoint]', {
        corr_id: corrId,
        update_id,
        channel: envelope.channel,
        ...extra,
        checkpoint,
        ts: new Date().toISOString(),
      });
    } catch {
      // Never let debug logging break processing
    }
  };

  const withAwaitCheckpoint = async <T>(
    name: string,
    fn: () => Promise<T>,
    extra?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> => {
    const startedAt = Date.now();
    cp(`${name}.start`, extra);
    try {
      let p = fn();
      if (timeoutMs && timeoutMs > 0) {
        p = Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
      }
      const result = await p;
      cp(`${name}.done`, { ...(extra ?? {}), ms: Date.now() - startedAt });
      return result;
    } catch (err) {
      const detail = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { message: String(err) };
      cp(`${name}.error`, { ...(extra ?? {}), ms: Date.now() - startedAt, error: detail });
      throw err;
    }
  };

  // Idempotency (inbound): drop duplicates using stable key (provider ids if possible)
  cp('entered.processMessage', {
    has_message_text: Boolean(envelope.messageText && envelope.messageText.length > 0),
    text_len: text.length,
    has_metadata: Boolean(envelope.metadata),
    env_comm_pipeline_debug: process.env.COMM_PIPELINE_DEBUG ?? null,
    env_ru_telegram_debug: process.env.RU_TELEGRAM_DEBUG ?? null,
    env_telegram_debug: process.env.TELEGRAM_DEBUG ?? null,
    env_node_env: process.env.NODE_ENV ?? null,
    env_vercel_env: process.env.VERCEL_ENV ?? null,
  });

  const providerMessageId = String((envelope.metadata as any)?.providerMessageId ?? '').trim();
  const externalMessageId = String((envelope.metadata as any)?.externalMessageId ?? '').trim();
  const explicitInboundKey = String((envelope.metadata as any)?.inboundIdempotencyKey ?? '').trim();
  const inboundAlreadyMarked = (envelope.metadata as any)?.inboundIdempotencyAlreadyMarked === true;
  const actorKey = String(envelope.externalUserId ?? envelope.chatId ?? envelope.email ?? envelope.phoneNumber ?? '').trim();
  const inboundFallback = sha256Base64Url(
    [
      envelope.channel,
      envelope.externalUserId ?? '',
      envelope.chatId ?? '',
      envelope.email ?? '',
      envelope.phoneNumber ?? '',
      envelope.subject ?? '',
      envelope.messageText ?? '',
      JSON.stringify(envelope.metadata ?? {}),
      String(update_id),
    ].join('|'),
  );
  // Prefer provider ids (stable across redelivery). Only fall back to update_id-based hash when unavailable.
  const inboundStableKey = explicitInboundKey ||
    (providerMessageId || externalMessageId
      ? `${envelope.channel}:${actorKey}:${providerMessageId || externalMessageId}`
      : `${envelope.channel}:${actorKey}:${String(update_id)}:${inboundFallback}`);

  cp('idempotency.inbound.check.start', { inbound_key: inboundStableKey });
  if (!inboundAlreadyMarked && checkAndMarkKey({ scope: 'inbound', key: inboundStableKey, meta: { update_id } })) {
    cp('idempotency.inbound.duplicate.returning', { inbound_key: inboundStableKey });
    auditDuplicate({ chat_id: 0, update_id });
    auditDecision({
      type: 'ignore',
      chat_id: 0,
      update_id,
      detail: `duplicate_inbound key=${inboundStableKey}`,
    });
    return { outcome: ProcessOutcome.Duplicate, update_id };
  }
  cp('idempotency.inbound.check.done', { inbound_key: inboundStableKey, already_marked: inboundAlreadyMarked });

  // Resolve identity + bind to business entities (reservation/property/lead/unknown)
  const identity = await withAwaitCheckpoint('identity.resolve', () => bindIdentity(envelope), {
    has_chat_id: Boolean(envelope.chatId),
    has_external_user_id: Boolean(envelope.externalUserId),
  });

  const chatId = stableNumericChatId(envelope, identity.guestId);
  cp('channel.resolved', { chat_id: chatId });
  cp('text.extracted', { chat_id: chatId, text_len: text.length });
  const rememberedIdentity = envelope.channel === 'telegram' ? rememberedTelegramIdentityForRoute(chatId) : null;
  const senderRoute = await withAwaitCheckpoint(
    'identity.route.resolve',
    () => resolveCommunicationIdentityRoute({ envelope, identity, rememberedIdentity }),
    { chat_id: chatId, identity_role: identity.role, remembered_identity: rememberedIdentity, identity_status: identity.status },
    15_000,
  );
  cp('identity.route.done', {
    chat_id: chatId,
    sender_identity: senderRoute.senderIdentity,
    route: senderRoute.route,
    guest_concierge: senderRoute.shouldRunGuestConcierge,
  });

  if (
    (senderRoute.route === 'unknown_clarify' || senderRoute.route === 'role_conflict_guest_question') &&
    envelope.channel === 'telegram' &&
    shouldSavePendingIdentityMessage(text) &&
    !(envelope.metadata as Record<string, unknown> | undefined)?.pending_identity_replay
  ) {
    savePendingIdentityMessage({
      chatId,
      channel: envelope.channel,
      messageText: text,
      metadata: envelope.metadata ?? null,
    });
    if (senderRoute.route === 'role_conflict_guest_question') {
      patchAutonomousSessionCollectedData({
        chatId,
        channel: envelope.channel,
        set: { pending_role_conflict_message: text },
      });
    }
  }

  auditDecision({
    type: senderRoute.shouldRunGuestConcierge ? 'reply' : 'ignore',
    chat_id: chatId,
    update_id,
    detail: `communication_identity_route sender=${senderRoute.senderIdentity} route=${senderRoute.route} reason=${senderRoute.reason}`,
  });

  const selectedIdentity = (
    senderRoute.selectedIdentity === 'guest' ||
    senderRoute.selectedIdentity === 'owner' ||
    senderRoute.selectedIdentity === 'manager' ||
    senderRoute.selectedIdentity === 'lead' ||
    senderRoute.selectedIdentity === 'support_problem'
  )
    ? ({
        ...identity,
        role: senderRoute.selectedIdentity === 'support_problem' ? 'operator' : senderRoute.selectedIdentity,
        entityType: senderRoute.selectedIdentity === 'lead' ? 'lead' : identity.entityType,
        confidence: Math.max(identity.confidence, 0.9),
        status: 'resolved',
        reason: 'telegram_button_selected_role',
        resolutionPath: [...(identity.resolutionPath ?? []), `role:${senderRoute.selectedIdentity}:button_selection`],
      } satisfies IdentityResolution)
    : null;

  if (selectedIdentity) {
    try {
      setAutonomousSessionIdentity({ chatId, channel: envelope.channel, identity: selectedIdentity });
      updateContext(chatId, {
        role: selectedIdentity.role,
        entityType: selectedIdentity.entityType,
        entityId: selectedIdentity.entityId,
        propertyId: selectedIdentity.propertyId,
        reservationId: selectedIdentity.reservationId,
        leadId: selectedIdentity.leadId,
        identityConfidence: selectedIdentity.confidence,
        identityResolutionStatus: selectedIdentity.status,
        identityReason: selectedIdentity.reason,
      });
    } catch {
      // best-effort: the current route still replies correctly even if role memory is unavailable.
    }
  }

  // Conversation session engine: resolve/create session by channel + actor identity.
  const { session: baseSession, key: sessionKey } = getOrCreateConversationSession({
    envelope,
    identity,
  });
  let convSession = baseSession;
  convSession = appendSessionMessage({
    key: sessionKey,
    session: convSession,
    direction: 'inbound',
    content: text,
    meta: envelope.metadata,
  });
  convSession = updateSessionFactsAndSummary({ key: sessionKey, session: convSession, text });

  const guestMemoryObservation = await observeResolvedGuestInbound({
    guestId: identity.guestId,
    senderIdentity: senderRoute.senderIdentity,
    messageText: text,
    language: detectOperationalLanguage(text),
    transport: String(
      (envelope.metadata as Record<string, unknown> | undefined)?.transport ??
      ((envelope.metadata as Record<string, unknown> | undefined)?.voice
        ? 'telegram_voice'
        : envelope.channel === 'telegram'
          ? 'telegram_text'
          : envelope.channel),
    ),
    sourceRef: convSession.sessionId,
  }).catch((error) => {
    console.warn('[orchestrator] guest memory observation skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      observed: false,
      preferenceOnly: Boolean(identity.guestId) &&
        (senderRoute.senderIdentity === 'guest' || senderRoute.senderIdentity === 'test_guest') &&
        isExplicitGuestPreferenceOnlyMessage(text),
      sensitiveRejected: false,
    };
  });

  if (guestMemoryObservation.preferenceOnly) {
    auditDecision({
      type: 'ignore',
      chat_id: chatId,
      update_id,
      detail: 'guest_preference_only_observed_no_handoff',
    });
    return {
      outcome: ProcessOutcome.Ignored,
      update_id,
      chat_id: chatId,
      category: MessageCategory.GuestMessage,
    };
  }

  const acceptanceEscalation = await handleTelegramOpsAcceptanceEscalation({
    envelope,
    identity,
    convSession,
    chatId,
    update_id,
  });
  if (acceptanceEscalation) {
    return acceptanceEscalation;
  }

  // Session safety: if already escalated, avoid "normal automation" by default.
  // We still allow limited deterministic-only tooling for acceptance testing.
  const allowEscalatedAutosend = process.env.COMM_ALLOW_AUTOSEND_WHEN_ESCALATED === '1';
  const hasActiveReviewItem = Boolean(getActiveEscalationReviewIdForSession(convSession.sessionId));
  // Handoff lock is authoritative: AI may reply only when ai_active or returned_to_ai.
  const aiReplyAllowed = canAiReply(convSession.sessionId);
  const blockNormalAutomationBecauseEscalated =
    (!aiReplyAllowed || convSession.state === 'escalated' || hasActiveReviewItem) && !allowEscalatedAutosend;
  if (!aiReplyAllowed) {
    recordHandoffAuditEvent({
      type: 'ai_reply_blocked',
      sessionId: convSession.sessionId,
      chat_id: chatId,
      update_id,
      detail: 'handoff_lock_active',
    });
  }

  // Acceptance/admin escape hatch: /reset_session (guarded by allowlist + non-prod by default).
  const cmdNorm = envelope.channel === 'telegram' ? normalizeTelegramSlashCommand(text) : null;
  const resetMatch = envelope.channel === 'telegram' ? matchTelegramCommand(text, 'reset_session') : { matched: false, raw: '' };
  if (envelope.channel === 'telegram') {
    const allowlist = parseAllowlistedChatIds(process.env.COMM_TELEGRAM_RESET_ALLOWLIST);
    const chatIdForAllow = stableNumericChatId(envelope, identity.guestId);
    const nonProd = (process.env.VERCEL_ENV ?? process.env.NODE_ENV) !== 'production';
    const allowlisted = allowlist.has(chatIdForAllow);
    const prod_reset_enabled = nonProd ? true : process.env.COMM_TELEGRAM_RESET_ALLOWLIST_PROD === '1';
    const allowed = resetMatch.matched && allowlisted && prod_reset_enabled;

    // Always log routing decision for reset command, including explicit denial reasons.
    if (resetMatch.matched) {
      const denialReason = !allowlisted
        ? 'deny:not_allowlisted'
        : !prod_reset_enabled
          ? 'deny:prod_reset_disabled'
          : 'allow';
      logSessionResetOrCaseReopen({
        previous_status: convSession.state,
        new_status: allowed ? 'active' : convSession.state,
        reason: denialReason,
        update_id,
        command_raw_text: cmdNorm?.raw_text ?? text,
        command_raw: cmdNorm?.raw_command ?? (resetMatch.raw || undefined),
        normalized_command: cmdNorm?.normalized_command ?? undefined,
        chat_id: chatIdForAllow,
        allowlisted,
        prod_reset_enabled,
        matched: true,
        intercepted_before_escalation: allowed ? true : false,
        final_reply: allowed ? 'Session reset for acceptance testing.' : null,
      });
      if (!allowed) {
        // Do not silently fall through in logs — this is a common production triage failure mode.
        console.warn('[comm:routing] telegram reset denied', {
          route: 'session_reset_or_case_reopen',
          command_raw_text: cmdNorm?.raw_text ?? text,
          normalized_command: cmdNorm?.normalized_command ?? null,
          update_id,
          chat_id: chatIdForAllow,
          allowlisted,
          prod_reset_enabled,
          matched: true,
          reason: denialReason,
          raw_command: resetMatch.raw || null,
        });
      }
    } else {
      // Only log non-match when message *looks like* a Telegram command, to avoid noise.
      const looksLikeCommand = String(text ?? '').trim().startsWith('/');
      if (looksLikeCommand) {
        logSessionResetOrCaseReopen({
          previous_status: convSession.state,
          new_status: convSession.state,
          reason: 'not_matched',
          update_id,
          command_raw_text: cmdNorm?.raw_text ?? text,
          command_raw: cmdNorm?.raw_command ?? undefined,
          normalized_command: cmdNorm?.normalized_command ?? undefined,
          chat_id: chatIdForAllow,
          allowlisted,
          prod_reset_enabled,
          matched: false,
          intercepted_before_escalation: false,
          final_reply: null,
        });
      }
    }

    if (allowed) {
      const previous = convSession.state;

      // Close operator review flag (if any) so escalation block is cleared.
      forceCloseActiveReviewForSession({
        sessionId: convSession.sessionId,
        operatorId: 'acceptance_reset',
        reason: 'telegram_reset_session',
      });

      // Reset the conversation-session engine memory/state.
      const actorId = resolveActorId(envelope, identity);
      resetConversationSessionForAcceptance({
        channel: envelope.channel,
        actorId,
        reason: `telegram:/reset_session update_id=${update_id}`,
      });

      // Reset file-backed autonomous snapshot (used by telegram operational intake memory).
      resetAutonomousSessionSnapshot({ chatId: chatIdForAllow, channel: envelope.channel, preserveIdentity: true });

      // Best-effort: move durable operational session status back to active.
      await transitionSessionStatus(chatIdForAllow, SessionStatus.Active);

      logSessionResetOrCaseReopen({
        previous_status: previous,
        new_status: 'active',
        reason: 'reset_command',
        update_id,
        command_raw_text: cmdNorm?.raw_text ?? text,
        command_raw: cmdNorm?.raw_command ?? (resetMatch.raw || undefined),
        normalized_command: cmdNorm?.normalized_command ?? 'reset_session',
        chat_id: chatIdForAllow,
        allowlisted: true,
        prod_reset_enabled: true,
        matched: true,
        intercepted_before_escalation: true,
        final_reply: 'Session reset for acceptance testing.',
      });

      const adapter = getChannelAdapter(envelope.channel);
      const sent = await adapter.sendMessage(String(chatIdForAllow), 'Session reset for acceptance testing.', {
        reply_handler: 'acceptance_reset',
        update_id,
      });
      if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatIdForAllow };
      return { outcome: ProcessOutcome.Replied, update_id, chat_id: chatIdForAllow, reply: 'Session reset for acceptance testing.' };
    }

    const RESET_IDENTITY_REPLY_RU = RESET_IDENTITY_CLARIFY_RU;
    const resetIdentityMatch = matchTelegramCommand(text, 'reset_identity');
    const resetIdentityAllowed = resetIdentityMatch.matched;

    if (resetIdentityMatch.matched) {
      logSessionResetOrCaseReopen({
        previous_status: convSession.state,
        new_status: resetIdentityAllowed ? 'inquiry' : convSession.state,
        reason: 'allow',
        update_id,
        command_raw_text: cmdNorm?.raw_text ?? text,
        command_raw: cmdNorm?.raw_command ?? (resetIdentityMatch.raw || undefined),
        normalized_command: cmdNorm?.normalized_command ?? 'reset_identity',
        chat_id: chatIdForAllow,
        allowlisted,
        prod_reset_enabled,
        matched: true,
        intercepted_before_escalation: resetIdentityAllowed ? true : false,
        final_reply: resetIdentityAllowed ? RESET_IDENTITY_REPLY_RU : null,
      });
    }

    if (resetIdentityAllowed) {
      const previous = convSession.state;

      forceCloseActiveReviewForSession({
        sessionId: convSession.sessionId,
        operatorId: 'acceptance_reset_identity',
        reason: 'telegram_reset_identity',
      });

      const actorId = resolveActorId(envelope, identity);
      resetConversationSessionForAcceptance({
        channel: envelope.channel,
        actorId,
        reason: `telegram:/reset_identity update_id=${update_id}`,
      });

      resetAutonomousSessionSnapshot({
        chatId: chatIdForAllow,
        channel: envelope.channel,
        preserveIdentity: false,
      });

      evictIdentityCacheForTelegramChatId(String(chatIdForAllow));
      clearTelegramPromptInjectionGuardForChat(chatIdForAllow);
      await clearDurableTelegramSessionForAcceptance(chatIdForAllow);
      forceResetSessionStatusForAcceptance(chatIdForAllow);

      logSessionResetOrCaseReopen({
        previous_status: previous,
        new_status: 'inquiry',
        reason: 'reset_identity_command',
        update_id,
        command_raw_text: cmdNorm?.raw_text ?? text,
        command_raw: cmdNorm?.raw_command ?? (resetIdentityMatch.raw || undefined),
        normalized_command: cmdNorm?.normalized_command ?? 'reset_identity',
        chat_id: chatIdForAllow,
        allowlisted: true,
        prod_reset_enabled: true,
        matched: true,
        intercepted_before_escalation: true,
        final_reply: RESET_IDENTITY_REPLY_RU,
      });

      const adapter = getChannelAdapter(envelope.channel);
      const sent = await adapter.sendMessage(String(chatIdForAllow), RESET_IDENTITY_REPLY_RU, {
        reply_handler: 'acceptance_reset_identity',
        update_id,
        reply_markup: UNKNOWN_IDENTITY_INLINE_KEYBOARD,
      });
      if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatIdForAllow };
      return { outcome: ProcessOutcome.Replied, update_id, chat_id: chatIdForAllow, reply: RESET_IDENTITY_REPLY_RU };
    }

    const voiceOnMatch = matchTelegramCommand(text, 'voice_on');
    const voiceOffMatch = matchTelegramCommand(text, 'voice_off');
    const voiceStatusMatch = matchTelegramCommand(text, 'voice_status');
    if (voiceOnMatch.matched || voiceOffMatch.matched || voiceStatusMatch.matched) {
      const chatIdForVoice = chatIdForAllow;
      let voiceCommandReply = '';
      if (voiceOnMatch.matched) {
        patchAutonomousSessionCollectedData({
          chatId: chatIdForVoice,
          channel: envelope.channel,
          set: { voice_replies_enabled: 'true' },
        });
        voiceCommandReply = 'Голосовые ответы включены для этого чата.';
      } else if (voiceOffMatch.matched) {
        patchAutonomousSessionCollectedData({
          chatId: chatIdForVoice,
          channel: envelope.channel,
          set: { voice_replies_enabled: 'false' },
        });
        voiceCommandReply = 'Голосовые ответы отключены. Чтобы включить снова — /voice_on.';
      } else {
        const voiceSettings = loadChatVoiceUserSettings(loadAutonomousSession(chatIdForVoice)?.collected_data);
        voiceCommandReply = voiceSettings.voiceRepliesEnabled
          ? 'Голосовые ответы: включены.'
          : 'Голосовые ответы: выключены.';
      }
      const adapter = getChannelAdapter(envelope.channel);
      const sent = await adapter.sendMessage(String(chatIdForVoice), voiceCommandReply, {
        reply_handler: `telegram_voice_command:${voiceOnMatch.matched ? 'on' : voiceOffMatch.matched ? 'off' : 'status'}`,
        update_id,
      });
      if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatIdForVoice };
      return { outcome: ProcessOutcome.Replied, update_id, chat_id: chatIdForVoice, reply: voiceCommandReply };
    }
  }

  if (!senderRoute.shouldRunGuestConcierge && senderRoute.replyText) {
    if (
      selectedIdentity &&
      senderRoute.route !== 'unknown_clarify' &&
      senderRoute.route !== 'object_problem_clarify'
    ) {
      const pending = takePendingIdentityMessage(chatId);
      if (pending?.text) {
        const replayEnvelope: InboundMessageEnvelope = {
          ...envelope,
          messageText: pending.text,
          receivedAt: new Date(),
          metadata: {
            ...(pending.metadata ?? {}),
            ...(envelope.metadata ?? {}),
            pending_identity_replay: true,
            providerMessageId: `pending_identity_replay:${chatId}:${String(update_id)}`,
            externalMessageId: `pending_identity_replay:${chatId}:${String(update_id)}`,
          },
        };
        return processMessage(replayEnvelope);
      }
    }

    const adapter = getChannelAdapter(envelope.channel);
    const targetId = resolveOutboundTargetId(envelope, identity.guestId);
    if (!targetId) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
    const ownerOnboarding =
      senderRoute.route === 'owner_manager' || senderRoute.route === 'lead'
        ? await processTelegramOwnerOnboarding({
            envelope,
            chatId,
            senderIdentity: senderRoute.senderIdentity,
          })
        : null;
    const routeReplyText = ownerOnboarding?.replyText || senderRoute.replyText;
    const routeReplyMarkup = ownerOnboarding?.replyMarkup ?? senderRoute.replyMarkup;
    const routeCrmContactId = ownerOnboarding?.crmContactId ?? senderRoute.crmContactId;
    const needsOperatorHandoff =
      ownerOnboarding?.status === 'needs_operator' || senderRoute.route === 'support_problem';
    if (
      (senderRoute.route === 'owner_manager' || senderRoute.route === 'lead' || senderRoute.route === 'support_problem') &&
      needsOperatorHandoff
    ) {
      const reviewReason =
        ownerOnboarding?.status === 'needs_operator'
          ? 'owner_onboarding_needs_operator'
          : senderRoute.route === 'lead'
          ? 'lead_connection_request'
          : senderRoute.route === 'support_problem'
            ? 'support_problem_message'
            : 'owner_manager_message';
      const reviewTopic =
        senderRoute.route === 'lead'
          ? 'Заявка на подключение ASI'
          : senderRoute.route === 'support_problem'
            ? 'Обращение в поддержку'
            : 'Внутреннее обращение по объекту';
      const reviewReasonText = ownerOnboarding?.status === 'needs_operator'
        ? 'Пользователь застрял в онбординге объекта или написал вне сценария.'
        : ownerOnboarding?.status === 'ready_for_channel_manager'
          ? 'Минимальные данные объекта собраны, можно переходить к Менеджеру каналов.'
          : ownerOnboarding?.status === 'missing_required_data' || ownerOnboarding?.status === 'onboarding_started'
            ? `Онбординг объекта идет. Не хватает: ${ownerOnboarding.missing.join(', ') || 'ничего'}.`
            : senderRoute.route === 'lead'
              ? 'Пользователь хочет подключить ASI.'
              : senderRoute.route === 'support_problem'
                ? 'Пользователь выбрал поддержку.'
                : 'Пользователь пишет как владелец или управляющий, это не гостевой автопилот.';
      createOrUpdateEscalationReview({
        sessionId: convSession.sessionId,
        channel: envelope.channel,
        targetId: String(targetId),
        actorId: convSession.actorId,
        role: senderRoute.senderIdentity === 'lead' ? 'lead' : senderRoute.senderIdentity === 'manager' ? 'manager' : senderRoute.senderIdentity === 'owner' ? 'owner' : identity.role,
        reservationId: identity.reservationId,
        propertyId: identity.propertyId,
        leadId: identity.leadId,
        escalationReason: reviewReason,
        confidence: identity.confidence,
        source: {
          route: 'communication_identity_route',
          sender_identity: senderRoute.senderIdentity,
          reason: senderRoute.reason,
          onboarding_status: ownerOnboarding?.status,
          onboarding_missing: ownerOnboarding?.missing,
        },
        latestMessages: convSession.memory.lastMessages,
        suggestedReply: routeReplyText,
        detail: buildOperatorNotificationText({
          role: senderRoute.senderIdentity,
          intent: ownerOnboarding?.status
            ? `onboarding:${ownerOnboarding.status}`
            : String(senderRoute.audit?.detectedIntent ?? senderRoute.route),
          topic: reviewTopic,
          message: text,
          reason: reviewReasonText,
          recommendedReply: routeReplyText,
        }),
      });
    }
    const sent = await deliverOwnerOnboardingTelegramReply({
      adapter,
      targetId: String(targetId),
      replyText: routeReplyText,
      replyMarkup: routeReplyMarkup as Record<string, unknown> | undefined,
      editInPlace: ownerOnboarding?.editInPlace,
      editInPlaceMode: ownerOnboarding?.editInPlaceMode,
      callbackMessageId: readTelegramCallbackMessageId(envelope.metadata),
      handler: `orchestrator:communication_identity_route:${senderRoute.route}`,
      update_id,
      metadata: {
        sender_identity: senderRoute.senderIdentity,
        crm_contact_id: routeCrmContactId,
        onboarding_status: ownerOnboarding?.status,
        onboarding_missing: ownerOnboarding?.missing,
      },
    });
    if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
    return { outcome: ProcessOutcome.Replied, update_id, chat_id: chatId, reply: routeReplyText };
  }

  // Harden session memory with identity binding (safe defaults when unknown).
  updateContext(chatId, {
    role: identity.role,
    entityType: identity.entityType,
    entityId: identity.entityId,
    propertyId: identity.propertyId,
    reservationId: identity.reservationId,
    leadId: identity.leadId,
    identityConfidence: identity.confidence,
    identityResolutionStatus: identity.status,
    identityReason: identity.reason,
  });

  // Store identity in the file-backed autonomous session snapshot too.
  try {
    setAutonomousSessionIdentity({ chatId, channel: envelope.channel, identity });
  } catch {
    // best-effort
  }

  if (pipeDebug) {
    console.log('[comm:pipeline] message.received', {
      corr_id: corrId,
      update_id,
      channel: envelope.channel,
      chat_id: chatId,
      text_len: text.length,
      has_metadata: Boolean(envelope.metadata),
    });
  }
  
  await withAwaitCheckpoint(
    'timeline.inbound.append',
    () =>
      appendTimelineEvent(identity.guestId ?? String(chatId), {
        type: 'message_inbound',
        channel: envelope.channel,
        content: text,
        ts: envelope.receivedAt,
      }),
    { chat_id: chatId },
    15_000,
  );

  // Mark session active on first processed message (fire-and-forget — never blocks reply).
  cp('session.active.mark.fire_and_forget.start', { chat_id: chatId });
  runInBackground(
    { correlationId: corrId, module: 'orchestrator', taskName: 'transitionSessionStatus', triggerId: String(chatId) },
    () => transitionSessionStatus(chatId, SessionStatus.Active),
  );
  cp('session.active.mark.fire_and_forget.queued', { chat_id: chatId });

  try {
    let telegramMetaStoredReply: string | null = null;
    let telegramMetaRouteKind: TelegramTextMetaKind | null = null;

    // RU Telegram: log runtime-critical env state (never print secrets).
    if (ruDebug) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      console.log('[ru:tg] runtime.env', {
        chat_id: chatId,
        update_id,
        has_bot_token: Boolean(token && token.trim().length > 0),
        dry_run: isTelegramOutboundDryRun(),
        outbound_debug: process.env.TELEGRAM_OUTBOUND_DEBUG === '1',
        comm_pipeline_debug: process.env.COMM_PIPELINE_DEBUG ?? null,
        ru_telegram_debug: process.env.RU_TELEGRAM_DEBUG ?? null,
        telegram_debug: process.env.TELEGRAM_DEBUG ?? null,
        node_env: process.env.NODE_ENV ?? null,
        vercel_env: process.env.VERCEL_ENV ?? null,
      });
    }
    // Keyword-based incident detection — runs before LLM
    cp('envelope.validated', { chat_id: chatId }); // basic shape is already assumed by caller; this marks post-identity sanity point
    cp('classifier.precheck.keywords.start', { chat_id: chatId });
    const INCIDENT_KEYWORDS = ['trash', 'dirty', 'party', 'damage'];
    if (INCIDENT_KEYWORDS.some(kw => text.toLowerCase().includes(kw))) {
      updateContext(chatId, { incident: true, incident_type: 'property_issue', severity: 'high' });
    }
    cp('classifier.precheck.keywords.done', { chat_id: chatId });

    const telegramLangForMeta =
      envelope.channel === 'telegram'
        ? String((envelope.metadata as Record<string, unknown> | undefined)?.telegram_user_language_code ?? '')
            .trim() || undefined
        : undefined;

    cp('classifier.start', { chat_id: chatId });
    const classification = await withAwaitCheckpoint('classifier.await', () => classifyMessage(text), { chat_id: chatId }, 30_000);
    cp('classifier.done', { chat_id: chatId, category: classification.category, lang: classification.lang });
    if (process.env.RU_TELEGRAM_FORCE_RU === '1' && envelope.channel === 'telegram') {
      classification.lang = 'ru';
    }
    if (envelope.channel === 'telegram') {
      const tm = resolveTelegramTextMeta({ baseText: text, telegramLangCode: telegramLangForMeta });
      if (tm) {
        telegramMetaStoredReply = tm.reply;
        telegramMetaRouteKind = tm.kind;
        classification.category = tm.category;
        classification.slots = tm.classification.slots;
        if (process.env.RU_TELEGRAM_FORCE_RU !== '1') {
          classification.lang = tm.classification.lang;
        }
      }
    }
    if (pipeDebug) {
      console.log('[comm:pipeline] classification.done', {
        corr_id: corrId,
        update_id,
        chat_id: chatId,
        category: classification.category,
        lang: classification.lang,
        slots: classification.slots,
      });
    }
    auditInbound({
      chat_id: chatId,
      update_id,
      text,
      category: classification.category,
      lang: classification.lang,
    });

    cp('intent.start', { chat_id: chatId });
    const intentStartedAt = Date.now();
    const intentResult = await withAwaitCheckpoint('intent.await', () => detectIntent(text), { chat_id: chatId }, 30_000);
    cp('intent.done', { chat_id: chatId, intent: intentResult.intent, confidence: intentResult.confidence });
    if (latencyLoggingEnabled) {
      console.info('[tg:latency] intent.detection', {
        update_id,
        chat_id: chatId,
        stage_ms: Date.now() - intentStartedAt,
      });
    }
    if (pipeDebug) {
      console.log('[comm:pipeline] intent.done', {
        corr_id: corrId,
        update_id,
        chat_id: chatId,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
      });
    }
    cp('memory/context.load.start', { chat_id: chatId });
    const memoryLoadStartedAt = Date.now();
    const ctx = getContext(chatId);
    const resolvedCommunicationLang = resolveCanonicalCommunicationLang({
      normalization: canonNormalization,
      previousLang: (ctx as any).communicationSemanticMemory?.preferredLang ?? null,
      classifiedLang: classification.lang,
    });
    classification.lang = resolvedCommunicationLang;
    updateContext(chatId, {
      communicationSemanticMemory: {
        ...((ctx as any).communicationSemanticMemory ?? {}),
        preferredLang: resolvedCommunicationLang,
        lastLanguageHint: canonNormalization.language,
        lastToneHint: canonNormalization.tone,
        lastSemanticReferences: canonNormalization.semanticReferences,
        lastNormalizationConfidence: canonNormalization.confidence,
      },
    } as any);
    cp('memory/context.load.done', { chat_id: chatId });
    if (latencyLoggingEnabled) {
      console.info('[tg:latency] memory.load', {
        update_id,
        chat_id: chatId,
        stage_ms: Date.now() - memoryLoadStartedAt,
      });
    }
    if (pipeDebug) {
      console.log('[comm:pipeline] memory.loaded', {
        corr_id: corrId,
        update_id,
        chat_id: chatId,
        has_last_intent: Boolean(ctx.lastIntent),
        incident: Boolean(ctx.incident),
      });
    }

    // ── Staff-group clue accumulation ──────────────────────────────────────────
    // Extract operator-provided booking/property clues from the current message
    // and merge with anything already stored in the conversation context.
    const currentClues = extractStaffClues(text);
    const mergedClues = {
      bookingReference: ctx.bookingReference ?? currentClues.bookingReference,
      propertyLocation: ctx.propertyLocation ?? currentClues.propertyLocation,
      guestName:        ctx.guestName        ?? currentClues.guestName,
      checkInDate:      ctx.checkInDate      ?? currentClues.checkInDate,
    };
    // Persist any newly extracted clues so second-turn replies can use them.
    if (currentClues.bookingReference || currentClues.propertyLocation || currentClues.guestName || currentClues.checkInDate) {
      updateContext(chatId, {
        ...(currentClues.bookingReference ? { bookingReference: currentClues.bookingReference } : {}),
        ...(currentClues.propertyLocation ? { propertyLocation: currentClues.propertyLocation } : {}),
        ...(currentClues.guestName        ? { guestName:        currentClues.guestName        } : {}),
        ...(currentClues.checkInDate      ? { checkInDate:      currentClues.checkInDate      } : {}),
      });
    }

    // Assembly
    cp('memory/context.build.start', { chat_id: chatId });
    const commContext = await withAwaitCheckpoint(
      'memory/context.build.await',
      () => buildCommunicationContext(chatId, text, intentResult, []),
      { chat_id: chatId },
      45_000,
    );
    cp('memory/context.build.done', { chat_id: chatId });

    // Harden session state snapshot for routing/escalation across turns.
    // This persists both collected clues and identity binding into the session store.
    try {
      mergeAutonomousSessionFromInbound({
        chatId,
        channel: envelope.channel,
        identity,
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
        lang: classification.lang,
        mergedClues,
      });
    } catch {
      // best-effort
    }

    // Fetch per-property templates (null when none set or on any error)
    const propertyId = commContext.reservation.propertyId;
    const templates = propertyId
      ? await withAwaitCheckpoint('templates.load.await', () => getPropertyTemplates(propertyId), { chat_id: chatId, property_id: propertyId }, 15_000)
      : null;
    cp('templates.loaded', { chat_id: chatId, property_id: propertyId ?? null, templates_loaded: Boolean(templates) });
    if (ruDebug) {
      console.log('[ru:tg] context.assembled', {
        chat_id: chatId,
        update_id,
        category: classification.category,
        lang: classification.lang,
        intent: intentResult.intent,
        intent_confidence: intentResult.confidence,
        reservation_status: commContext.reservation.status,
        reservation_confidence: commContext.reservation.confidence,
        reservation_id: commContext.reservation.reservationId ?? null,
        property_id: commContext.reservation.propertyId ?? null,
        templates_loaded: Boolean(templates),
        staff_clues: mergedClues,
      });
    }

    let replyText: string = '';
    let llmSucceeded: boolean = false;
    const replyComposeStartedAt = Date.now();
    let usedPath:
      | 'deterministic'
      | 'llm'
      | 'communication_autopilot'
      | 'telegram_meta_deterministic'
      | 'telegram_operational_intake'
      | 'reply_composer' = 'deterministic';
    let escalation: ReturnType<typeof createEscalationEvent> | undefined = undefined;
    let telegramOperationalIntakeConsumed: boolean = false;
    let telegramGuestAgentLlmUsed = false;
    let currentAutopilotIntent: string | null = null;
    let antiLoopEligible = false;
    let telegramGuestAgentShadowAudit: CommunicationAutopilotDecision['metadata']['guestAgentShadow'] | null = null;
    let voiceOutboundHint: {
      detectedIntent?: string;
      domainZone?: 'core' | 'adjacent' | 'out_of_domain';
      responseMode?: string;
    } = {};
    const adapter = getChannelAdapter(envelope.channel);
    cp('channel.adapter.resolved', { chat_id: chatId });

    const escalationSafetyGate = blockNormalAutomationBecauseEscalated;
    /** When set, pre-rule low confidence / identity escalation must not clobber this turn. */
    const persistEscalationReview = (params: {
      reason: string;
      escalationSummary: string;
      confidence?: number;
      suggestedReply?: string;
      detail?: string;
      source?: Record<string, unknown>;
    }) => {
      const targetIdRaw = resolveOutboundTargetId(envelope, identity.guestId);
      if (!targetIdRaw) return;
      void recordCommunicationEscalation({
        sessionId: convSession.sessionId,
        channel: envelope.channel,
        targetId: String(targetIdRaw),
        actorId: convSession.actorId,
        role: identity.role,
        reservationId: commContext?.reservation?.reservationId ?? identity.reservationId,
        objectId: commContext?.reservation?.propertyId ?? identity.propertyId,
        contactId: identity.leadId,
        guestId: identity.guestId,
        messageText: params.escalationSummary,
        summary: params.escalationSummary,
        reason: params.reason,
        source: 'telegram',
        confidence: params.confidence,
        suggestedReply: params.suggestedReply,
        detail: params.detail ?? params.escalationSummary,
        sourceMeta: params.source,
        latestMessages: convSession.memory.lastMessages,
      }).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn('[orchestrator] recordCommunicationEscalation failed', detail);
      });
    };

    if (commContext.knowledge.loadStatus === 'lookup_failed') {
      escalation = createEscalationEvent({
        reason: EscalationReason.ProcessingError,
        chat_id: chatId,
        update_id,
        classification,
        summary: 'property_knowledge_lookup_failed',
      });
      persistEscalationReview({
        reason: 'property_knowledge_lookup_failed',
        escalationSummary: 'property_knowledge_lookup_failed',
        confidence: 1,
        detail: 'Property knowledge could not be loaded; operator review required.',
        source: {
          route: 'property_knowledge_safe_fallback',
          property_id: commContext.reservation.propertyId ?? null,
          needs_operator: true,
        },
      });
      auditEscalation({
        chat_id: chatId,
        update_id,
        detail: 'property_knowledge_lookup_failed',
      });
      await withAwaitCheckpoint(
        'session.transition.operator_review_required_property_knowledge',
        () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
        { chat_id: chatId },
        15_000,
      );
      const safeFallback = classification.lang === 'ru'
        ? 'Передал запрос оператору — вернёмся с ответом.'
        : 'I’ve forwarded this to our team to review and will get back to you shortly.';
      replyText = adapter.formatResponse(safeFallback, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(
        convSession,
        'escalated',
        'property_knowledge_lookup_failed',
      );
    }

    const voiceMeta = (envelope.metadata as any)?.voice as Record<string, unknown> | undefined;
    const voiceSourceBase = voiceMeta
      ? {
          source: 'voice',
          voiceChannel: (voiceMeta as any).voiceChannel ?? envelope.channel,
          voiceSessionId: String((voiceMeta as any).voiceSessionId ?? ''),
          voiceTurnId: String((voiceMeta as any).voiceTurnId ?? ''),
          transcript: String(envelope.messageText ?? ''),
          transcriptConfidence: (voiceMeta as any).transcriptConfidence ?? undefined,
          audioRef: (voiceMeta as any).audioRef ?? undefined,
          providerMessageId: (voiceMeta as any).providerMessageId ?? (envelope.metadata as any)?.providerMessageId ?? undefined,
          providerMediaId: (voiceMeta as any).providerMediaId ?? undefined,
          originalMessageType: (voiceMeta as any).originalMessageType ?? undefined,
          sttStatus: (voiceMeta as any).sttStatus ?? undefined,
          telegramChatId: (voiceMeta as any).telegramChatId ?? undefined,
          telegramUserId: (voiceMeta as any).telegramUserId ?? undefined,
          language: (voiceMeta as any).language ?? undefined,
        }
      : null;
    const transportEventMeta = {
      transport: String((envelope.metadata as any)?.transport ?? (voiceMeta ? 'telegram_voice' : envelope.channel === 'telegram' ? 'telegram_text' : envelope.channel)),
      original_message_type: String(
        (envelope.metadata as any)?.original_message_type ??
          (envelope.metadata as any)?.originalMessageType ??
          (voiceMeta as any)?.original_message_type ??
          (voiceMeta as any)?.originalMessageType ??
          'text',
      ),
      transcription: voiceMeta
        ? String(
            (envelope.metadata as any)?.transcription ??
              (envelope.metadata as any)?.transcriptText ??
              (voiceMeta as any).transcription ??
              (voiceMeta as any).transcriptText ??
              envelope.messageText ??
              '',
          )
        : null,
      duration:
        typeof (envelope.metadata as any)?.duration === 'number'
          ? (envelope.metadata as any).duration
          : typeof (voiceMeta as any)?.duration === 'number'
            ? (voiceMeta as any).duration
            : null,
      telegram_user_id:
        (envelope.metadata as any)?.telegram_user_id ??
        (envelope.metadata as any)?.telegramUserId ??
        (voiceMeta as any)?.telegramUserId ??
        null,
    };

    if (envelope.channel === 'telegram' && telegramMetaStoredReply) {
      cp('branch.telegram_text_meta_deterministic.pre_operational', { chat_id: chatId, kind: telegramMetaRouteKind });
      replyText = adapter.formatResponse(telegramMetaStoredReply, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'telegram_meta_deterministic';
    }

    if (
      !replyText &&
      senderRoute.shouldRunGuestConcierge &&
      isLiveAutopilotInboundChannel(envelope.channel) &&
      classification.lang === 'ru' &&
      text.trim()
    ) {
      let bookingMemoryFields: ReturnType<typeof bookingObjectContextToAutopilotFields> | undefined;
      let telegramBookingObjectCtx: Awaited<ReturnType<typeof resolveTelegramGuestBookingObjectContext>> | null = null;
      if (envelope.channel === 'telegram') {
        const bookingObjectCtx = await withAwaitCheckpoint(
          'memory/booking_object.resolve.await',
          () =>
            resolveTelegramGuestBookingObjectContext({
              telegram_chat_id: chatId,
              text,
            }),
          { chat_id: chatId },
          15_000,
        );
        telegramBookingObjectCtx = bookingObjectCtx;
        bookingMemoryFields = bookingObjectContextToAutopilotFields(bookingObjectCtx);
        if (ruDebug) {
          console.log('[ru:tg] booking_object_memory', {
            chat_id: chatId,
            lookup_reason: bookingObjectCtx.lookup_reason,
            booking_resolved: bookingObjectCtx.booking_resolved,
            property_resolved: bookingObjectCtx.property_resolved,
            access_verified: bookingObjectCtx.access_verified,
            wifi_verified: bookingObjectCtx.wifi_verified,
            booking_id: bookingObjectCtx.booking?.booking_id ?? null,
            object_id: bookingObjectCtx.property?.object_id ?? null,
          });
        }
      } else if (envelope.channel === 'email') {
        const guestEmail = String(envelope.email ?? envelope.externalUserId ?? '').trim();
        const bookingObjectCtx = await withAwaitCheckpoint(
          'memory/email_booking_object.resolve.await',
          () =>
            resolveEmailGuestBookingObjectContext({
              guest_email: guestEmail,
              text,
            }),
          { chat_id: chatId, guest_email: guestEmail },
          15_000,
        );
        bookingMemoryFields = bookingObjectContextToAutopilotFields(bookingObjectCtx);
        if (pipeDebug) {
          console.log('[comm:email] booking_object_memory', {
            chat_id: chatId,
            guest_email: guestEmail,
            lookup_reason: bookingObjectCtx.lookup_reason,
            booking_resolved: bookingObjectCtx.booking_resolved,
            property_resolved: bookingObjectCtx.property_resolved,
            access_verified: bookingObjectCtx.access_verified,
            wifi_verified: bookingObjectCtx.wifi_verified,
          });
        }
      }

      if (envelope.channel === 'telegram' && telegramBookingObjectCtx) {
        const propertyId =
          telegramBookingObjectCtx.property?.object_id ??
          commContext.reservation.propertyId ??
          identity.propertyId ??
          null;
        const sessionCollectedData = loadAutonomousSession(chatId)?.collected_data ?? {};
        const guestLookupState = sessionCollectedData.guest_missing_reservation_followup_state;
        const isGuestMissingBookingFollowup =
          sessionCollectedData.guest_missing_reservation_followup === GUEST_MISSING_BOOKING_CONTEXT &&
          senderRoute.senderIdentity === 'guest';

        if (
          isGuestMissingBookingFollowup &&
          guestLookupState === GUEST_BOOKING_IDENTIFIER_STATE &&
          isGuestBookingLookupByNameQuestion(text)
        ) {
          patchAutonomousSessionCollectedData({
            chatId,
            channel: envelope.channel,
            set: {
              guest_missing_reservation_followup_state: GUEST_BOOKING_LOOKUP_DATA_STATE,
              guest_missing_reservation_lookup_offer: text,
            },
          });
          const targetId = resolveOutboundTargetId(envelope, identity.guestId);
          if (!targetId) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          const sent = await adapter.sendMessage(String(targetId), GUEST_BOOKING_LOOKUP_BY_NAME_REPLY, {
            reply_handler: 'orchestrator:guest_booking_lookup_followup:ask_lookup_data',
            update_id,
            sender_identity: senderRoute.senderIdentity,
          });
          if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          return {
            outcome: ProcessOutcome.Replied,
            update_id,
            chat_id: chatId,
            category: MessageCategory.GuestMessage,
            reply: GUEST_BOOKING_LOOKUP_BY_NAME_REPLY,
          };
        }

        if (
          isGuestMissingBookingFollowup &&
          guestLookupState === GUEST_BOOKING_LOOKUP_DATA_STATE &&
          hasGuestBookingLookupData(text)
        ) {
          const telegramUserId = String(
            envelope.metadata?.telegram_user_id ??
              envelope.metadata?.telegramUserId ??
              envelope.externalUserId ??
              chatId,
          );
          const lookupData = extractGuestBookingLookupData(text);
          const created = await createOperatorFollowupRequired({
            telegramUserId,
            telegramChatId: chatId,
            propertyId,
            guestQuestion: text,
            updateId: update_id,
            intent: 'booking_lookup_missing_details',
            internalDetail:
              'Гость прислал минимальные данные для поиска бронирования: имя/фамилия, дата заезда и последние 4 цифры телефона при наличии.',
            lookupData,
            ...transportEventMeta,
          });
          const deterministicReplyText = created.ok
            ? GUEST_BOOKING_LOOKUP_RECEIVED_REPLY
            : OPERATOR_HANDOFF_FAILED_REPLY;
          if (created.ok) {
            patchAutonomousSessionCollectedData({
              chatId,
              channel: envelope.channel,
              clear: [
                'guest_missing_reservation_followup',
                'guest_missing_reservation_followup_state',
                'guest_missing_reservation_lookup_offer',
                'guest_missing_reservation_intent',
              ],
              set: {
                guest_booking_lookup_data_raw: lookupData.raw_text,
              },
            });
          }
          const targetId = resolveOutboundTargetId(envelope, identity.guestId);
          if (!targetId) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          const sent = await adapter.sendMessage(String(targetId), deterministicReplyText, {
            reply_handler: 'orchestrator:guest_booking_lookup_followup:operator_required',
            update_id,
            sender_identity: senderRoute.senderIdentity,
          });
          if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          return {
            outcome: ProcessOutcome.Replied,
            update_id,
            chat_id: chatId,
            category: MessageCategory.GuestMessage,
            reply: deterministicReplyText,
          };
        }

        const autopilotProperty = telegramBookingObjectCtx.property;
        const sessionMemory = autopilotSessionFromCollectedData(sessionCollectedData);
        const useDeterministicAutopilotV1 =
          !canSendAutonomousGuestReply(autopilotProperty) ||
          shouldPreferCommunicationAutopilotV1(text, sessionMemory);
        if (canClassifyInboundCommunication(autopilotProperty) && useDeterministicAutopilotV1) {
          const telegramUserId = String(
            envelope.metadata?.telegram_user_id ??
              envelope.metadata?.telegramUserId ??
              envelope.externalUserId ??
              chatId,
          );
          const passport = propertyId ? await getGroundedKnowledge(propertyId) : null;
          const guestMemory = await loadRelevantGuestMemory({
            guestId: identity.guestId,
            requestText: text,
          });
          const autopilotResult = runCommunicationAutopilotV1({
            messageText: text,
            property: autopilotProperty,
            propertyId,
            bookingVerified: telegramBookingObjectCtx.access_verified,
            passport,
            session: sessionMemory,
            guestMemory,
            language: detectOperationalLanguage(text, sessionMemory),
          });
          const sessionPatch = buildAutopilotSessionPatch({
            result: autopilotResult,
            messageText: text,
            propertyId,
            propertyName: autopilotProperty?.object_name ?? null,
            previous: sessionMemory,
            transport: String(transportEventMeta.transport ?? envelope.channel),
            bookingReference: telegramBookingObjectCtx.booking?.booking_id ?? null,
          });
          patchAutonomousSessionCollectedData({
            chatId,
            channel: envelope.channel,
            set: patchAutopilotSessionCollectedData({
              memory: sessionPatch,
            }),
          });
          await recordCommunicationAutopilotTurn({
            telegramUserId,
            telegramChatId: chatId,
            propertyId,
            guestQuestion: text,
            result: autopilotResult,
            role: senderRoute.senderIdentity,
            ...transportEventMeta,
          });
          if (autopilotResult.needsOperator) {
            persistEscalationReview({
              reason: autopilotResult.escalationReason ?? 'operator_required',
              escalationSummary: `communication_autopilot_v1:${autopilotResult.intent}`,
              confidence: 0.9,
              suggestedReply: autopilotResult.replyText,
              source: {
                route: 'communication_autopilot_v1',
                intent: autopilotResult.intent,
                needs_operator: true,
              },
              detail: buildOperatorEscalationDetail({
                role: senderRoute.senderIdentity,
                intent: autopilotResult.intent,
                message: text,
                reason: autopilotResult.escalationReason ?? 'Нужна проверка оператора.',
                recommendedStep: autopilotResult.replyText,
              }),
            });
            await withAwaitCheckpoint(
              'session.transition.operator_review_required_autopilot_v1',
              () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
              { chat_id: chatId },
              15_000,
            );
          }
          const allowAutonomousReply =
            canSendAutonomousGuestReply(autopilotProperty) &&
            autopilotResult.action === 'auto_reply' &&
            !autopilotResult.needsOperator;
          const outboundReplyText = allowAutonomousReply || autopilotResult.action !== 'auto_reply'
            ? autopilotResult.replyText
            : autopilotResult.language === 'en'
              ? 'I have passed the question to an operator for review.'
              : 'Передала вопрос оператору на проверку.';
          if (!allowAutonomousReply && autopilotResult.action === 'auto_reply' && !autopilotResult.needsOperator) {
            persistEscalationReview({
              reason: 'manual_control_mode',
              escalationSummary: `communication_manual_mode:${autopilotResult.intent}`,
              confidence: 0.85,
              suggestedReply: autopilotResult.replyText,
              source: {
                route: 'communication_manual_mode',
                intent: autopilotResult.intent,
              },
              detail: buildOperatorEscalationDetail({
                role: senderRoute.senderIdentity,
                intent: autopilotResult.intent,
                message: text,
                reason: 'Ручной контроль: автоответ заблокирован.',
                recommendedStep: autopilotResult.replyText,
              }),
            });
          }
          const targetId = resolveOutboundTargetId(envelope, identity.guestId);
          if (!targetId) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          const voiceExtras = await buildTelegramVoiceExtras({
            envelope,
            replyText: outboundReplyText,
            chatId,
            detectedIntent: autopilotResult.intent,
            responseMode: allowAutonomousReply ? 'answer_from_property' : 'operator_escalation',
            role: senderRoute.senderIdentity,
            propertyId,
            isUrgent: false,
            isEscalation: autopilotResult.needsOperator || !allowAutonomousReply,
          });
          const sent = await adapter.sendMessage(String(targetId), outboundReplyText, {
            reply_handler: `orchestrator:communication_autopilot_v1:${autopilotResult.action}`,
            update_id,
            sender_identity: senderRoute.senderIdentity,
            communication_autopilot_v1: true,
            autopilot_action: autopilotResult.action,
            autopilot_intent: autopilotResult.intent,
            needs_operator: autopilotResult.needsOperator,
            conversation_resolved: autopilotResult.resolved,
            ...voiceExtras,
          });
          if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          return {
            outcome: ProcessOutcome.Replied,
            update_id,
            chat_id: chatId,
            category: MessageCategory.GuestMessage,
            reply: outboundReplyText,
          };
        }

        const commMemory = loadCommunicationMemoryFromSession(loadAutonomousSession(chatId));
        const commDecision = await decideGuestCommunicationWithLlmSafeDomainLayer({
          messageText: text,
          currentIdentity: senderRoute.senderIdentity,
          property: telegramBookingObjectCtx.property,
          propertyId,
          conversationMemory: commMemory,
          conversationContext: convSession.memory.lastMessages
            .slice(0, -1)
            .slice(-6)
            .map((message) => `${message.direction === 'inbound' ? 'guest' : 'assistant'}: ${String(message.content ?? '').slice(0, 240)}`)
            .join('\n'),
          telegramChatId: chatId,
        });
        const answer = commDecision.guestTestResult;
        const brainIntent = commDecision.detectedIntent;
        const brainOutcome = commDecision.outcome ?? answer?.outcome;
        if ((answer && answer.intent !== 'unknown') || commDecision.llmSafeDomain || commDecision.shouldEscalate) {
          const telegramUserId = String(
            envelope.metadata?.telegram_user_id ??
              envelope.metadata?.telegramUserId ??
              envelope.externalUserId ??
              chatId,
          );
          const internalMissingDataDetail = brainOutcome === 'missing_data' ? answer?.reply ?? null : null;
          const guestReplyText =
            commDecision.safeGuestReply ??
            (brainOutcome === 'missing_data' ? GUEST_MISSING_DATA_OPERATOR_REPLY : answer?.reply ?? '');
          const recorded = await recordGuestTestQuestionOutcome({
            telegramUserId,
            telegramChatId: chatId,
            propertyId,
            questionText: text,
            replyText: guestReplyText,
            outcome: brainOutcome ?? 'operator_followup_required',
            intent: answer?.intent ?? brainIntent,
            missingFields: commDecision.missingFields ?? answer?.missingFields ?? [],
            role: senderRoute.senderIdentity,
            detectedIntent: brainIntent,
            responseMode: commDecision.responseMode,
            confidence: commDecision.confidence,
            reason: commDecision.reason,
            decisionSource: commDecision.decisionSource,
            ...transportEventMeta,
          });

          let deterministicReplyText = guestReplyText;
          if (brainOutcome === 'answered_by_concierge_autopilot') {
            await createGuestConciergeAnsweredEvent({
              telegramUserId,
              telegramChatId: chatId,
              propertyId,
              guestQuestion: text,
              replyText: guestReplyText,
              contactId: recorded.contactId,
              intent: answer?.intent ?? commDecision.llmSafeDomain?.detectedIntent ?? brainIntent,
              role: senderRoute.senderIdentity,
              detectedIntent: brainIntent,
              responseMode: commDecision.responseMode,
              confidence: commDecision.confidence,
              reason: commDecision.reason,
              source: commDecision.llmSafeDomain?.source,
              domainZone: commDecision.llmSafeDomain?.domainZone,
              llmDetectedIntent: commDecision.llmSafeDomain?.detectedIntent,
              llmProvider: commDecision.llmSafeDomain?.provider,
              llmModelName: commDecision.llmSafeDomain?.modelName,
              suggestedReply: commDecision.llmSafeDomain?.suggestedReply,
              ...transportEventMeta,
            });
          } else if (brainOutcome === 'missing_data' && answer) {
            await createGuestTestMissingDataEvent({
              telegramUserId,
              telegramChatId: chatId,
              propertyId,
              guestQuestion: text,
              missingFields: answer.missingFields,
              contactId: recorded.contactId,
              intent: answer.intent,
              internalDetail: internalMissingDataDetail,
              role: senderRoute.senderIdentity,
              detectedIntent: brainIntent,
              responseMode: commDecision.responseMode,
              confidence: commDecision.confidence,
              reason: commDecision.reason,
              ...transportEventMeta,
            });
            await createOperatorFollowupRequired({
              telegramUserId,
              telegramChatId: chatId,
              propertyId,
              guestQuestion: text,
              contactId: recorded.contactId,
              updateId: update_id,
              intent: answer.intent,
              internalDetail: internalMissingDataDetail,
              role: senderRoute.senderIdentity,
              detectedIntent: brainIntent,
              responseMode: commDecision.responseMode,
              confidence: commDecision.confidence,
              reason: commDecision.reason,
              ...transportEventMeta,
            });
            patchAutonomousSessionCollectedData({
              chatId,
              channel: envelope.channel,
              set: {
                ...patchCommunicationMemoryFromDecision({
                  collectedData: {},
                  decision: commDecision,
                  messageText: text,
                  activeRole: senderRoute.senderIdentity,
                }),
                guest_missing_reservation_followup: GUEST_MISSING_BOOKING_CONTEXT,
                guest_missing_reservation_followup_state: GUEST_BOOKING_IDENTIFIER_STATE,
                guest_missing_reservation_intent: answer.intent,
              },
            });
          } else if (brainOutcome === 'operator_followup_required' || commDecision.shouldEscalate) {
            const escalationDetail = buildOperatorEscalationDetail({
              role: senderRoute.senderIdentity,
              intent: brainIntent,
              message: text,
              reason: commDecision.operatorReason ?? commDecision.reason,
              recommendedStep: deterministicReplyText,
            });
            const created = await createOperatorFollowupRequired({
              telegramUserId,
              telegramChatId: chatId,
              propertyId,
              guestQuestion: text,
              contactId: recorded.contactId,
              updateId: update_id,
              intent: answer?.intent ?? brainIntent,
              internalDetail: escalationDetail,
              role: senderRoute.senderIdentity,
              detectedIntent: brainIntent,
              responseMode: commDecision.responseMode,
              confidence: commDecision.confidence,
              reason: commDecision.reason,
              ...transportEventMeta,
            });
            if (!created.ok) deterministicReplyText = OPERATOR_HANDOFF_FAILED_REPLY;
            persistEscalationReview({
              reason: 'operator_followup_required',
              escalationSummary: `minigpt:${brainIntent}`,
              confidence: commDecision.confidence,
              suggestedReply: deterministicReplyText,
              source: {
                route: 'minigpt_guest_communication_brain_v1',
                intent: brainIntent,
                outcome: brainOutcome ?? 'operator_followup_required',
                responseMode: commDecision.responseMode,
              },
              detail: escalationDetail,
            });
            await withAwaitCheckpoint(
              'session.transition.operator_review_required_guest_test',
              () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
              { chat_id: chatId },
              15_000,
            );
            patchAutonomousSessionCollectedData({
              chatId,
              channel: envelope.channel,
              set: patchCommunicationMemoryFromDecision({
                collectedData: {},
                decision: commDecision,
                messageText: text,
                activeRole: senderRoute.senderIdentity,
              }),
            });
          }

          if (
            brainOutcome !== 'missing_data' &&
            brainOutcome !== 'operator_followup_required' &&
            !commDecision.shouldEscalate
          ) {
            patchAutonomousSessionCollectedData({
              chatId,
              channel: envelope.channel,
              set: patchCommunicationMemoryFromDecision({
                collectedData: {},
                decision: commDecision,
                messageText: text,
                activeRole: senderRoute.senderIdentity,
              }),
            });
          }

          const targetId = resolveOutboundTargetId(envelope, identity.guestId);
          if (!targetId) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          voiceOutboundHint = {
            detectedIntent: brainIntent,
            domainZone: commDecision.llmSafeDomain?.domainZone,
            responseMode: commDecision.responseMode,
          };
          const voiceExtras = await buildTelegramVoiceExtras({
            envelope,
            replyText: deterministicReplyText,
            chatId,
            detectedIntent: brainIntent,
            domainZone: commDecision.llmSafeDomain?.domainZone,
            responseMode: commDecision.responseMode,
            role: senderRoute.senderIdentity,
            propertyId,
            isUrgent: classification.slots.isUrgent || classification.slots.isAccessRelated,
            isEscalation: Boolean(commDecision.shouldEscalate),
          });
          const sent = await adapter.sendMessage(String(targetId), deterministicReplyText, {
            reply_handler: `orchestrator:minigpt_brain_v1:${brainOutcome ?? 'escalation'}`,
            update_id,
            sender_identity: senderRoute.senderIdentity,
            guest_test_outcome: brainOutcome,
            guest_test_intent: answer?.intent ?? brainIntent,
            minigpt_intent: brainIntent,
            minigpt_response_mode: commDecision.responseMode,
            ...voiceExtras,
          });
          if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
          return {
            outcome: ProcessOutcome.Replied,
            update_id,
            chat_id: chatId,
            category: MessageCategory.GuestMessage,
            reply: deterministicReplyText,
          };
        }
      }

      const autopilotContext = buildAutopilotContext({
        chatId,
        envelope,
        identity,
        commContext,
        templates,
        lang: classification.lang,
        bookingMemoryFields,
      });
      const commSessionId = String(
        envelope.channel === 'email' ? stableEmailChatId(envelope) : chatId,
      );
      const commSessionMemory = getCommAgentSessionMemory(envelope.channel, commSessionId);
      const operationalLanguage = detectOperationalLanguage(
        text,
        commSessionMemory
          ? {
              language: commSessionMemory.language,
              requested_missing_field: commSessionMemory.last_requested_identifier,
            }
          : null,
      );
      const sessionContinuation = applyCommAgentSessionContinuation({
        channel: envelope.channel,
        sessionId: commSessionId,
        messageText: text,
        memory: commSessionMemory,
      });
      const autopilotMessageText = sessionContinuation.enriched_message_text;
      const autopilotDecision = await decideCommunicationAutopilotResponseWithLlmRouter({
        channel: envelope.channel,
        messageText: autopilotMessageText,
        context: autopilotContext,
        wifiSession: {
          previousReply: commSessionMemory?.last_safe_reply,
          continuationUsed:
            sessionContinuation.memory_used ||
            commSessionMemory?.last_intent === 'wifi_problem' ||
            sessionContinuation.continued_intent === 'wifi_problem',
          previousIntent: sessionContinuation.continued_intent ?? commSessionMemory?.last_intent ?? null,
        },
      });
      const bookingResolved = Boolean(
        autopilotContext.booking?.id || bookingMemoryFields?.booking?.id,
      );
      const operatorNeeded =
        autopilotDecision.action === 'escalate' || Boolean(autopilotDecision.metadata.urgent);
      logCommAgentMetrics({
        channel: envelope.channel,
        session_key: commSessionId,
        intent: autopilotDecision.metadata.intent,
        confidence: autopilotDecision.confidence,
        action: autopilotDecision.action,
        source: sessionContinuation.memory_used
          ? 'session_continuation'
          : autopilotDecision.metadata.llmRouter?.used
            ? 'llm_router'
            : autopilotDecision.metadata.policy.includes('llm_router')
              ? 'llm_router'
              : 'deterministic_mvp',
        memory_used: sessionContinuation.memory_used,
        booking_resolved: bookingResolved,
        operator_needed: operatorNeeded,
        auto_reply_allowed: autopilotDecision.action === 'auto_reply' && Boolean(autopilotDecision.replyText),
        operational_outcome: operatorNeeded
          ? 'safety_blocked'
          : autopilotDecision.action === 'auto_reply'
            ? 'auto_resolved'
            : 'clarification',
        language: operationalLanguage,
        transport: String(transportEventMeta.transport ?? envelope.channel),
        handoff_reason: operatorNeeded ? (autopilotDecision.escalationReason ?? autopilotDecision.metadata.intent) : undefined,
        safety_blocked_action: operatorNeeded,
        ...(autopilotDecision.metadata.wifiEscalation
          ? {
              object_resolved: autopilotDecision.metadata.wifiEscalation.object_resolved,
              escalation_needed: autopilotDecision.metadata.wifiEscalation.escalation_needed,
              booking_request_reason: autopilotDecision.metadata.wifiEscalation.booking_request_reason,
            }
          : {}),
        chat_id: chatId,
        update_id,
        ...(autopilotDecision.metadata.semanticRouter?.used
          ? {
              semantic_router_used: true,
              semantic_source: autopilotDecision.metadata.semanticRouter.source,
              semantic_model: autopilotDecision.metadata.semanticRouter.modelName,
              mvp_intent: autopilotDecision.metadata.semanticRouter.mvpIntent,
              semantic_intent: autopilotDecision.metadata.semanticRouter.semanticIntent,
              semantic_confidence: autopilotDecision.metadata.semanticRouter.semanticConfidence,
              final_intent: autopilotDecision.metadata.semanticRouter.finalIntent ?? autopilotDecision.metadata.intent,
              semantic_override_applied: autopilotDecision.metadata.semanticRouter.semanticOverrideApplied,
              override_reason: autopilotDecision.metadata.semanticRouter.overrideReason,
            }
          : {}),
      });
      updateCommAgentSessionMemory(envelope.channel, commSessionId, {
        ...deriveSessionMemoryPatchFromDecision({
          intent: autopilotDecision.metadata.intent,
          action: autopilotDecision.action,
          replyText: autopilotDecision.replyText,
          needsBookingLookup: autopilotDecision.metadata.missingContext.length > 0,
          needsOperator: operatorNeeded,
          bookingId: autopilotContext.booking?.id ?? null,
          propertyId: autopilotContext.object?.id ?? null,
          escalationReason: autopilotDecision.escalationReason ?? null,
          language: operationalLanguage,
          unresolvedAction: autopilotDecision.metadata.intent,
          recentSummary: `${autopilotDecision.metadata.intent}:${autopilotDecision.action}`,
        }),
      });
      const handoffDecision = buildOperatorHandoffDecision({
        channel: envelope.channel,
        transport: String(transportEventMeta.transport ?? envelope.channel),
        guestMessage: text,
        autopilot: autopilotDecision,
        bookingId: autopilotContext.booking?.id ?? null,
        propertyId: autopilotContext.object?.id ?? null,
        sessionId: convSession.sessionId,
        guestIdentity: convSession.actorId,
        conversationSummary: convSession.memory.summary ?? text ?? null,
      });
      if (handoffDecision) {
        logCommAgentHandoffPreview({
          channel: envelope.channel,
          session_key: commSessionId,
          reason: handoffDecision.reason,
          urgency: handoffDecision.urgency,
        });
        if (envelope.channel === 'email' || !handoffDecision.safe_to_auto_send) {
          persistEscalationReview({
            reason: handoffDecision.reason,
            escalationSummary: `comm_agent_handoff:${handoffDecision.urgency}`,
            confidence: autopilotDecision.confidence,
            source: {
              route: 'comm_agent_handoff_v1',
              channel: envelope.channel,
              transport: handoffDecision.guest_transport,
              urgency: handoffDecision.urgency,
              booking_id: handoffDecision.resolved_booking_id,
              property_id: handoffDecision.resolved_property_id,
              session_id: handoffDecision.session_id,
              guest_identity: handoffDecision.guest_identity,
              detected_intent: handoffDecision.detected_intent,
              conversation_summary: handoffDecision.conversation_summary,
              guest_acknowledgement: handoffDecision.guest_acknowledgement,
              next_action: handoffDecision.next_action,
            },
            suggestedReply: handoffDecision.suggested_reply ?? undefined,
            detail: JSON.stringify({
              safe_to_auto_send: handoffDecision.safe_to_auto_send,
              operator_needed: operatorNeeded,
            }),
          });
        }
      }
      currentAutopilotIntent = autopilotDecision.metadata.intent;
      telegramGuestAgentShadowAudit = autopilotDecision.metadata.guestAgentShadow ?? null;
      telegramGuestAgentLlmUsed =
        envelope.channel === 'telegram' &&
        Boolean(autopilotDecision.metadata.llmRouter?.used || autopilotDecision.metadata.policy.includes('llm_router'));

      auditAutonomousDecision({
        chat_id: chatId,
        update_id,
        detail: JSON.stringify({
          route: 'communication_autopilot',
          stage: 'pre_scenario',
          action: autopilotDecision.action,
          intent: autopilotDecision.metadata.intent,
          confidence: autopilotDecision.confidence,
          missingContext: autopilotDecision.metadata.missingContext,
          channelMode: autopilotDecision.metadata.channelMode,
          urgent: autopilotDecision.metadata.urgent,
          llmRouter: autopilotDecision.metadata.llmRouter
            ? {
                used: true,
                provider: autopilotDecision.metadata.llmRouter.provider,
                intent: autopilotDecision.metadata.llmRouter.intent,
                validation: autopilotDecision.metadata.llmRouter.validation,
                reason: autopilotDecision.metadata.llmRouter.reason,
              }
            : undefined,
        }),
      });

      const objectKnowledgeKey = objectKnowledgeKeyForAutopilotIntent(autopilotDecision.metadata.intent);
      if (objectKnowledgeKey) {
        const knowledgeStatus = resolveObjectKnowledgeStatusForAudit({
          key: objectKnowledgeKey,
          context: autopilotContext,
          missingContext: autopilotDecision.metadata.missingContext,
        });
        audit_object_knowledge_reply({
          message_id: firstUsefulText(
            envelope.metadata?.providerMessageId,
            envelope.metadata?.externalMessageId,
            update_id,
          ) ?? String(update_id),
          object_id: autopilotContext.object?.id ?? null,
          intent: autopilotDecision.metadata.intent,
          knowledge_key: objectKnowledgeKey,
          knowledge_found: knowledgeStatus === 'found' || knowledgeStatus === 'stale' || knowledgeStatus === 'low_confidence',
          knowledge_status: knowledgeStatus,
          source_type: null,
          confidence: null,
          last_verified_at: null,
          reply_source:
            autopilotDecision.action === 'auto_reply'
              ? 'object_knowledge'
              : autopilotDecision.action === 'escalate'
                ? 'operator_review'
                : 'fallback',
          guest_reply_redacted: autopilotDecision.replyText ?? null,
        });
      }

      if (autopilotDecision.metadata.llmRouter?.used) {
        auditLLM({ chat_id: chatId, update_id, used_fallback: true });
        for (const attempt of autopilotDecision.metadata.llmRouter.attempts ?? []) {
          auditLlmRouter({
            chat_id: chatId,
            update_id,
            marker: attempt.marker,
            detail: JSON.stringify({
              provider: attempt.provider,
              modelName: attempt.modelName,
              latencyMs: attempt.latencyMs,
              failureReason: attempt.failureReason,
              normalizedIntent: attempt.normalizedIntent,
              confidence: attempt.confidence,
              validation: attempt.validation,
              fallbackPath: attempt.fallbackPath,
              finalActionType: attempt.finalActionType,
              finalShouldEscalate: attempt.finalShouldEscalate,
            }),
          });
        }
        auditDecision({
          type: 'reply',
          chat_id: chatId,
          update_id,
          detail: `communication_autopilot:llm_router provider=${autopilotDecision.metadata.llmRouter.provider} intent=${autopilotDecision.metadata.llmRouter.intent} validation=${autopilotDecision.metadata.llmRouter.validation}`,
        });
      } else if (autopilotDecision.confidence >= 0.7 && autopilotDecision.metadata.intent !== 'unknown') {
        auditLlmRouter({
          chat_id: chatId,
          update_id,
          marker: 'LLM_ROUTER_CANON_HIGH_CONFIDENCE',
          detail: JSON.stringify({
            normalizedIntent: autopilotDecision.metadata.intent,
            confidence: autopilotDecision.confidence,
            finalActionType: autopilotDecision.metadata.operationsAction?.category ?? 'guest_reply_only',
            finalShouldEscalate: autopilotDecision.action === 'escalate',
          }),
        });
      }

      const autopilotOperation = autopilotDecision.metadata.operationsAction
        ? upsertCommunicationOperationsAction({
            sourceChannel: toAutopilotOperationsSourceChannel(envelope.channel),
            category: autopilotDecision.metadata.operationsAction.category,
            priority: autopilotDecision.metadata.operationsAction.priority,
            reason: autopilotDecision.metadata.operationsAction.shortReason,
            reference: {
              guestId: firstUsefulText(autopilotContext.session?.guestName, envelope.externalUserId),
              sessionId: firstUsefulText(autopilotContext.session?.id),
              bookingId: firstUsefulText(autopilotContext.booking?.id, commContext.reservation.reservationId),
              objectId: firstUsefulText(autopilotContext.object?.id, commContext.reservation.propertyId),
              chatId,
              updateId: update_id,
              providerMessageId: firstUsefulText(
                envelope.metadata?.providerMessageId,
                envelope.metadata?.externalMessageId,
              ),
            },
          })
        : null;

      const allowSafeAutopilotReplyDuringHandoff =
        escalationSafetyGate &&
        isSafeAutopilotSelfServiceIntent(autopilotDecision.metadata.intent) &&
        !autopilotDecision.metadata.urgent;
      const autopilotPropertyForMode = telegramBookingObjectCtx?.property ?? null;
      const canUseAutopilotReply =
        (!escalationSafetyGate || allowSafeAutopilotReplyDuringHandoff) &&
        canSendAutonomousGuestReply(autopilotPropertyForMode);

      if (canUseAutopilotReply && autopilotDecision.action === 'auto_reply' && autopilotDecision.replyText) {
        const operationsReply = composeAutopilotOperationsRegisteredReply({
          decision: autopilotDecision,
          lang: classification.lang,
        });
        replyText = adapter.formatResponse(operationsReply ?? autopilotDecision.replyText, commContext as unknown as Record<string, unknown>);
        llmSucceeded = true;
        usedPath = 'communication_autopilot';
        convSession = transitionConversationSessionState(
          convSession,
          'resolved',
          `communication_autopilot:${autopilotDecision.metadata.intent}`,
        );
        auditDecision({
          type: 'reply',
          chat_id: chatId,
          update_id,
          detail: `communication_autopilot:auto_reply intent=${autopilotDecision.metadata.intent}`,
        });
      } else if (canUseAutopilotReply && autopilotDecision.action === 'needs_context') {
        const recommendedReply = composeCommunicationAutopilotContextReply({ decision: autopilotDecision, lang: classification.lang });
        replyText = adapter.formatResponse(
          classification.lang === 'ru'
            ? 'Сейчас не вижу точных данных по этому вопросу. Уточню у оператора и вернусь с ответом.'
            : recommendedReply,
          commContext as unknown as Record<string, unknown>,
        );
        llmSucceeded = true;
        usedPath = 'communication_autopilot';
        convSession = transitionConversationSessionState(
          convSession,
          'escalated',
          `communication_autopilot:needs_context:${autopilotDecision.metadata.intent}`,
        );
        persistEscalationReview({
          reason: 'missing_verified_data',
          escalationSummary: `communication_autopilot:needs_context:${autopilotDecision.metadata.intent}`,
          confidence: autopilotDecision.confidence,
          source: {
            route: 'communication_autopilot',
            channel: envelope.channel,
            intent: autopilotDecision.metadata.intent,
            missing_context: autopilotDecision.metadata.missingContext,
            ...(voiceSourceBase ?? {}),
          },
          suggestedReply: recommendedReply,
          detail: buildOperatorNotificationText({
            role: senderRoute.senderIdentity,
            intent: String(autopilotDecision.metadata.intent),
            topic: String(autopilotDecision.metadata.intent),
            message: text,
            reason: `Нет проверенных данных: ${autopilotDecision.metadata.missingContext.join(', ') || 'контекст не найден'}.`,
            recommendedReply,
          }),
        });
        await withAwaitCheckpoint(
          'session.transition.operator_review_required_missing_context',
          () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
          { chat_id: chatId },
          15_000,
        );
        auditEscalation({
          chat_id: chatId,
          update_id,
          detail: `communication_autopilot:missing_verified_data intent=${autopilotDecision.metadata.intent}`,
        });
        auditDecision({
          type: 'reply',
          chat_id: chatId,
          update_id,
          detail: `communication_autopilot:needs_context_escalated intent=${autopilotDecision.metadata.intent} missing=${autopilotDecision.metadata.missingContext.join(',')}`,
        });
        antiLoopEligible = autopilotDecision.metadata.intent === 'unknown';
      } else if (
        autopilotDecision.action === 'escalate' &&
        (!escalationSafetyGate || autopilotDecision.metadata.operationsAction)
      ) {
        const urgent = autopilotDecision.metadata.urgent;
        escalation = createEscalationEvent({
          reason: urgent ? EscalationReason.UrgentIssue : EscalationReason.RequiresOperator,
          chat_id: chatId,
          update_id,
          classification,
          summary: `communication_autopilot:${autopilotDecision.escalationReason ?? autopilotDecision.metadata.intent}`,
        });
        replyText = adapter.formatResponse(
          composeAutopilotHandoffReply({
            decision: autopilotDecision,
            channel: envelope.channel,
            lang: classification.lang,
          }),
          commContext as unknown as Record<string, unknown>,
        );
        llmSucceeded = true;
        usedPath = 'communication_autopilot';
        persistEscalationReview({
          reason: String(escalation.reason),
          escalationSummary: escalation.summary,
          confidence: autopilotDecision.confidence,
          source: {
            route: 'communication_autopilot',
            channel: envelope.channel,
            intent: autopilotDecision.metadata.intent,
            missing_context: autopilotDecision.metadata.missingContext,
            urgent,
            ...(voiceSourceBase ?? {}),
          },
          suggestedReply: replyText,
          detail: buildOperatorNotificationText({
            role: senderRoute.senderIdentity,
            intent: String(autopilotDecision.metadata.intent),
            topic: String(autopilotDecision.metadata.intent),
            message: text,
            reason: autopilotDecision.escalationReason ?? (urgent ? 'Срочная ситуация.' : 'Нужна проверка оператора.'),
            recommendedReply: replyText,
          }),
        });
        auditEscalation({
          chat_id: chatId,
          update_id,
          detail: `communication_autopilot:${autopilotDecision.escalationReason ?? autopilotDecision.metadata.intent}`,
        });
        auditDecision({
          type: 'escalate',
          chat_id: chatId,
          update_id,
          detail: `communication_autopilot:escalate intent=${autopilotDecision.metadata.intent} urgent=${urgent}`,
        });
        await withAwaitCheckpoint(
          'session.transition.operator_review_required_autopilot',
          () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
          { chat_id: chatId },
          15_000,
        );
        const autopilotOpsTask = resolveAutopilotOpsTask({
          decision: autopilotDecision,
          context: autopilotContext,
          envelope,
          fallbackPropertyId: commContext.reservation.propertyId,
          fallbackReservationId: commContext.reservation.reservationId,
          chatId,
          updateId: update_id,
          operationsLifecycle: autopilotOperation,
        });
        if (autopilotOpsTask) {
          if (autopilotOpsTask.lifecycle === 'created') {
            runInBackground(
              {
                correlationId: corrId,
                module: 'orchestrator',
                taskName: 'createOpsTask_CommunicationAutopilot',
                triggerId: String(chatId),
              },
              async () => {
                const { task_id } = await createTelegramOpsTask(autopilotOpsTask.task);
                if (task_id) {
                  await appendTimelineEvent(identity.guestId ?? String(chatId), {
                    type: 'ops_task_created',
                    task_type: autopilotOpsTask.task.task_type,
                    task_id,
                    ts: new Date(),
                  });
                }
              },
            );
          } else {
            auditDecision({
              type: 'escalate',
              chat_id: chatId,
              update_id,
              detail: `communication_autopilot:ops_action_reused action_id=${autopilotOpsTask.action.id} intent=${autopilotDecision.metadata.intent}`,
            });
          }
        } else {
          auditDecision({
            type: 'escalate',
            chat_id: chatId,
            update_id,
            detail: `communication_autopilot:ops_task_skipped intent=${autopilotDecision.metadata.intent} reason=missing_operations_context`,
          });
        }
        convSession = transitionConversationSessionState(
          convSession,
          'escalated',
          `communication_autopilot:${autopilotDecision.metadata.intent}`,
        );
      }
    }

    // Action Policy Guard
    cp('action_selection.start', { chat_id: chatId });
    const safety = evaluateActionSafety(commContext, text);
    cp('action_selection.done', { chat_id: chatId, safe: safety.safe, action: safety.action });
    if (pipeDebug) {
      console.log('[comm:pipeline] action.selected', {
        corr_id: corrId,
        update_id,
        chat_id: chatId,
        safe: safety.safe,
        action: safety.action,
        reason: safety.reason ?? null,
        escalation_reason: safety.escalationReason ?? null,
      });
    }

    // ── Scenario engine + reservation-aware decision layer ────────────────────
    // Deterministic-first: decide next action BEFORE generating any freeform LLM reply.
    cp('scenario_engine.start', { chat_id: chatId });
    const entityResolution = resolveEntities({ text, identity, context: commContext });
    const { decision, plan } = buildDecisionAndPlan({
      text,
      classification,
      intent: intentResult,
      identity,
      context: commContext,
      entityResolution,
    });
    const cq = decision.nextAction === 'ask_clarifying_question'
      ? pickSingleBestClarifyingQuestion({ decision, lang: classification.lang })
      : null;
    if (cq) plan.clarifyingQuestion = cq;
    cp('scenario_engine.done', { chat_id: chatId, scenario: decision.scenario, next_action: decision.nextAction, entity_status: decision.entityResolution.status });
    auditAutonomousDecision({
      chat_id: chatId,
      update_id,
      detail: JSON.stringify({
        scenario: decision.scenario,
        confidence: decision.confidence,
        nextAction: decision.nextAction,
        missingFacts: decision.missingFacts,
        entityStatus: decision.entityResolution.status,
        evidence: decision.entityResolution.evidence?.slice(0, 8),
        candidates: decision.entityResolution.candidates?.slice(0, 5),
      }),
    });


    // Deterministic canonical operational intake (guest relay) — before scenario / pre-rule escalation / LLM.
    if (
      !replyText &&
      senderRoute.shouldRunGuestConcierge &&
      !telegramGuestAgentLlmUsed &&
      envelope.channel === 'telegram' &&
      text.trim()
    ) {
      const autopilotV1Result = await tryCommunicationAutopilotV1OrchestratorTurn({
        text,
        chatId,
        update_id,
        envelope,
        identity,
        senderRoute,
        adapter,
        commContext,
        transportEventMeta,
        sessionId: convSession.sessionId,
        guestIdentity: convSession.actorId ?? null,
        conversationSummary: convSession.memory.summary ?? text ?? null,
        persistEscalationReview,
        resolveOutboundTargetId: (envelope, guestId) =>
          resolveOutboundTargetId(envelope, guestId ?? undefined) ?? null,
        withAwaitCheckpoint,
      });
      if (autopilotV1Result) return autopilotV1Result;
    }

    if (
      !replyText &&
      senderRoute.shouldRunGuestConcierge &&
      !telegramGuestAgentLlmUsed &&
      isCanonicalGuestCommunicationChannel(envelope.channel) &&
      text.trim()
    ) {
      const opIntakeResult = await processTelegramOperationalIntakeWithSessionMemory({
        chatId,
        channel: envelope.channel,
        text,
        surfaceLang: classification.lang === 'ru' ? 'ru' : 'en',
        update_id,
        normalization: canonNormalization,
      });
      if (opIntakeResult.handled) {
        const opIntake = opIntakeResult.hit;
        telegramOperationalIntakeConsumed = true;
        const tgPriority = envelope.channel === 'telegram' && isTgLivePriorityScenario(opIntake.category);
        if (tgPriority) {
          const ef = (opIntake.extractedFacts ?? {}) as any;
          const knStatus = ef?.property_knowledge_status ? String(ef.property_knowledge_status) : null;
          const knFields = Array.isArray(ef?.property_knowledge_fields) ? ef.property_knowledge_fields.map(String) : [];
          const explicitProp = Boolean(ef?.explicit_property_detected);
          const propHint =
            typeof ef?.property_hint === 'string'
              ? String(ef.property_hint)
              : typeof ef?.property === 'string'
                ? String(ef.property)
                : null;
          const knSkip = typeof ef?.knowledge_skip_reason === 'string' ? String(ef.knowledge_skip_reason) : null;
          logTelegramLivePath({
            stage: 'intake',
            update_id,
            raw_text: text,
            scenario: opIntake.category,
            extracted_facts: ef,
            explicit_property_detected: explicitProp,
            property_hint: propHint,
            matched_property_id: ef?.matched_property_id ? String(ef.matched_property_id) : null,
            property_match_confidence: ef?.match_confidence ? String(ef.match_confidence) : null,
            matched_reservation_id: ef?.matched_reservation_id ? String(ef.matched_reservation_id) : null,
            knowledge_lookup_attempted: Boolean(knStatus && knStatus !== 'skipped'),
            knowledge_lookup_result: knStatus ?? 'skipped',
            knowledge_skip_reason: knStatus ? null : knSkip,
            knowledge_fields_available: knFields,
            reply_mode:
              opIntake.finalAction === 'clarify'
                ? 'clarification'
                : opIntake.finalAction === 'escalate_operator' || opIntake.finalAction === 'escalate_urgent'
                  ? 'escalation'
                  : 'grounded_reply',
            clarification_question_used: opIntake.finalAction === 'clarify',
            clarification_question_used_text: opIntake.finalAction === 'clarify' ? String(opIntake.reply ?? '') : null,
            escalation_reason:
              opIntake.finalAction === 'escalate_operator' || opIntake.finalAction === 'escalate_urgent'
                ? String(opIntake.actionReason ?? 'n/a')
                : null,
            final_reply_text: null,
          });
        }
        if (escalationSafetyGate) {
          logSessionResetOrCaseReopen({
            previous_status: 'escalated',
            new_status: 'escalated',
            reason: `operational_intake:${opIntakeResult.mode}`,
            update_id,
          });
        }
        cp('branch.telegram_operational_intake', {
          chat_id: chatId,
          category: opIntake.category,
          final_action: opIntake.finalAction,
          missing_facts: opIntake.missingFacts,
        });

        // Deterministic reservation/property linking v1 (after intake + session memory).
        // Never invent matches; store unresolved state for future turns.
        try {
          const mem = getContext(chatId);
          const link = await linkReservationOrPropertyDeterministicV1({
            text,
            surfaceLang: classification.lang === 'ru' ? 'ru' : 'en',
            update_id,
            propertyLocation: mem.propertyLocation ?? (opIntakeResult.case.property ?? null),
            guestName: mem.guestName ?? (opIntakeResult.case.guest_name ?? null),
            checkInDate: mem.checkInDate ?? null,
            bookingReference: mem.bookingReference ?? null,
          });

          updateContext(chatId, { reservationPropertyLinkingV1: link.state });
          if (link.outcome === 'linked_to_property') {
            updateContext(chatId, {
              propertyId: mem.propertyId ?? link.propertyId,
              entityType: mem.entityType ?? 'property',
              entityId: mem.entityId ?? link.propertyId,
              identityResolutionStatus: mem.identityResolutionStatus ?? 'resolved',
              identityReason: mem.identityReason ?? 'deterministic_linking_v1:property',
            });
          } else if (link.outcome === 'linked_to_reservation') {
            updateContext(chatId, {
              reservationId: mem.reservationId ?? link.reservationId,
              propertyId: mem.propertyId ?? link.propertyId ?? mem.propertyId,
              entityType: mem.entityType ?? 'reservation',
              entityId: mem.entityId ?? link.reservationId,
              identityResolutionStatus: mem.identityResolutionStatus ?? 'resolved',
              identityReason: mem.identityReason ?? 'deterministic_linking_v1:reservation',
            });
          }

          // If intake would "reply" but linking is missing exactly one key fact, ask ONE short question.
          if (
            opIntake.finalAction !== 'escalate_operator' &&
            opIntake.finalAction !== 'escalate_urgent' &&
            opIntake.finalAction === 'reply' &&
            link.outcome === 'unresolved_needs_one_fact'
          ) {
            replyText = adapter.formatResponse(link.question, commContext as unknown as Record<string, unknown>);
            llmSucceeded = true;
            usedPath = 'telegram_operational_intake';
            convSession = transitionConversationSessionState(convSession, 'awaiting_input', `reservation_property_linking:${link.state.missing_fact_for_linking ?? 'unknown'}`);
          }
        } catch {
          // best-effort
        }

        if (!replyText) {
          const memNow = getContext(chatId);
          const policyMemory = ((memNow as any).telegramOperationalPolicyMemory ?? null) as
            | {
                lastSlowAckUpdateId?: number | null;
                unknownOperationalAttemptCount?: number;
              }
            | null;
          const policyInput = {
            messageText: text,
            update_id,
            sessionMemory: {
              knownContext: {
                objectLabel:
                  (opIntakeResult.case?.property ?? null) ||
                  ((opIntake.extractedFacts as any)?.matched_property_label ?? null) ||
                  memNow.propertyLocation ||
                  memNow.propertyId ||
                  null,
                bookingReference:
                  ((opIntake.extractedFacts as any)?.booking_reference ?? null) ||
                  ((opIntake.extractedFacts as any)?.matched_reservation_id ?? null) ||
                  memNow.bookingReference ||
                  memNow.reservationId ||
                  null,
                cleaningStatusKnown: Boolean((opIntake.extractedFacts as any)?.cleaning_status),
              },
              lastSlowAckUpdateId: policyMemory?.lastSlowAckUpdateId ?? null,
              unknownOperationalAttemptCount: policyMemory?.unknownOperationalAttemptCount ?? 0,
            },
            knownContext: {
              objectLabel:
                (opIntakeResult.case?.property ?? null) ||
                ((opIntake.extractedFacts as any)?.matched_property_label ?? null) ||
                memNow.propertyLocation ||
                memNow.propertyId ||
                null,
              bookingReference:
                ((opIntake.extractedFacts as any)?.booking_reference ?? null) ||
                ((opIntake.extractedFacts as any)?.matched_reservation_id ?? null) ||
                memNow.bookingReference ||
                memNow.reservationId ||
                null,
              cleaningStatusKnown: Boolean((opIntake.extractedFacts as any)?.cleaning_status),
            },
            normalization: canonNormalization,
          };
          const policyResult = executeTelegramOperationalPolicy(policyInput);
          const multiPolicy = classification.lang === 'ru'
            ? executeTelegramOperationalPolicyMultiIntent(policyInput)
            : null;
          const composed =
            multiPolicy && multiPolicy.intents.length > 1
              ? composeTelegramOperationalMultiIntentReply({
                  intents: multiPolicy.intents,
                  lang: classification.lang,
                })
              : composeTelegramOperationalReply({
                  update_id,
                  category: opIntake.category,
                  action: opIntake.finalAction,
                  lang: classification.lang,
                  text,
                  extractedFacts: opIntake.extractedFacts ?? {},
                  missingFacts: opIntake.missingFacts ?? [],
                  urgency: opIntake.finalAction === 'escalate_urgent' ? 'urgent' : 'normal',
                  linkingState: memNow.reservationPropertyLinkingV1 ?? null,
                  sessionCase: opIntakeResult.case ?? null,
                  sessionMemory: memNow ?? null,
                  shouldGreet: shouldGreetTelegramOperationalReply(convSession),
                  policyResult: classification.lang === 'ru' ? policyResult : null,
                  normalization: canonNormalization,
                });
          const channelText =
            canonicalUrgentAccessEscalationText({
              channel: envelope.channel,
              lang: classification.lang,
              category: opIntake.category,
              action: opIntake.finalAction,
            }) ?? composed.text;
          replyText = adapter.formatResponse(channelText, commContext as unknown as Record<string, unknown>);
          llmSucceeded = true;
          usedPath = 'reply_composer';
          const wasFinalOperationalReply =
            opIntake.finalAction === 'reply' &&
            multiPolicy !== null &&
            multiPolicy.intents.length > 1;
          if (wasFinalOperationalReply) {
            // Finalized multi-intent reply: mark this update as replied to block any extra slow_ack fallback.
            updateContext(chatId, {
              telegramOperationalPolicyMemory: {
                lastSlowAckUpdateId: update_id,
                unknownOperationalAttemptCount: multiPolicy.nextSessionMemory?.unknownOperationalAttemptCount ?? 0,
              },
              telegramFinalOperationalReplyUpdateId: update_id,
            });
          } else if (multiPolicy) {
            updateContext(chatId, {
              telegramOperationalPolicyMemory: {
                lastSlowAckUpdateId: multiPolicy.nextSessionMemory?.lastSlowAckUpdateId ?? null,
                unknownOperationalAttemptCount: multiPolicy.nextSessionMemory?.unknownOperationalAttemptCount ?? 0,
              },
            });
          }
          if (tgPriority) {
            const ef = (opIntake.extractedFacts ?? {}) as any;
            const knStatus = ef?.property_knowledge_status ? String(ef.property_knowledge_status) : null;
            const knFields = Array.isArray(ef?.property_knowledge_fields) ? ef.property_knowledge_fields.map(String) : [];
          const explicitProp = Boolean(ef?.explicit_property_detected);
          const propHint =
            typeof ef?.property_hint === 'string'
              ? String(ef.property_hint)
              : typeof ef?.property === 'string'
                ? String(ef.property)
                : null;
          const knSkip = typeof ef?.knowledge_skip_reason === 'string' ? String(ef.knowledge_skip_reason) : null;
            logTelegramLivePath({
              stage: 'reply_composed',
              update_id,
              raw_text: text,
              scenario: opIntake.category,
              extracted_facts: ef,
            explicit_property_detected: explicitProp,
            property_hint: propHint,
              matched_property_id: ef?.matched_property_id ? String(ef.matched_property_id) : null,
              property_match_confidence: ef?.match_confidence ? String(ef.match_confidence) : null,
              matched_reservation_id: ef?.matched_reservation_id ? String(ef.matched_reservation_id) : null,
              knowledge_lookup_attempted: Boolean(knStatus && knStatus !== 'skipped'),
              knowledge_lookup_result: knStatus ?? 'skipped',
            knowledge_skip_reason: knStatus ? null : knSkip,
              knowledge_fields_available: knFields,
              reply_mode:
                opIntake.finalAction === 'clarify'
                  ? 'clarification'
                  : opIntake.finalAction === 'escalate_operator' || opIntake.finalAction === 'escalate_urgent'
                    ? 'escalation'
                    : 'grounded_reply',
              clarification_question_used: opIntake.finalAction === 'clarify',
              clarification_question_used_text: opIntake.finalAction === 'clarify' ? String(composed.text ?? '') : null,
              escalation_reason:
                opIntake.finalAction === 'escalate_operator' || opIntake.finalAction === 'escalate_urgent'
                  ? String(opIntake.actionReason ?? 'n/a')
                  : null,
              final_reply_text: replyText,
            });
          }
        }
        if (opIntake.finalAction === 'escalate_operator' || opIntake.finalAction === 'escalate_urgent') {
          const urgent = opIntake.finalAction === 'escalate_urgent';
          escalation = createEscalationEvent({
            reason: urgent ? EscalationReason.UrgentIssue : EscalationReason.RequiresOperator,
            chat_id: chatId,
            update_id,
            classification,
            summary: `telegram_operational_intake:${opIntake.category}; action=${opIntake.finalAction}; signals=${(opIntake.urgencySignals ?? []).slice(0, 6).join(',')}`,
          });
          persistEscalationReview({
            reason: String(escalation.reason),
            escalationSummary: `telegram_operational_intake:${opIntake.category}; action=${opIntake.finalAction}`,
            confidence: 1,
            source: {
              route: 'telegram_operational_intake',
              session_memory_mode: opIntakeResult.mode,
              category: opIntake.category,
              extracted_facts: opIntake.extractedFacts,
              missing_facts: opIntake.missingFacts,
              final_action: opIntake.finalAction,
              urgency_signals: opIntake.urgencySignals,
              action_reason: opIntake.actionReason,
              ...(voiceSourceBase ?? {}),
            },
            detail: JSON.stringify({
              category: opIntake.category,
              extractedFacts: opIntake.extractedFacts,
              missingFacts: opIntake.missingFacts,
              urgencySignals: opIntake.urgencySignals,
              action: opIntake.finalAction,
            }),
            suggestedReply: opIntake.reply,
          });
          if (tgPriority) {
            const ef = (opIntake.extractedFacts ?? {}) as any;
            const knStatus = ef?.property_knowledge_status ? String(ef.property_knowledge_status) : null;
            const knFields = Array.isArray(ef?.property_knowledge_fields) ? ef.property_knowledge_fields.map(String) : [];
            const explicitProp = Boolean(ef?.explicit_property_detected);
            const propHint =
              typeof ef?.property_hint === 'string'
                ? String(ef.property_hint)
                : typeof ef?.property === 'string'
                  ? String(ef.property)
                  : null;
            const knSkip = typeof ef?.knowledge_skip_reason === 'string' ? String(ef.knowledge_skip_reason) : null;
            logTelegramLivePath({
              stage: 'escalation_payload',
              update_id,
              raw_text: text,
              scenario: opIntake.category,
              extracted_facts: ef,
              explicit_property_detected: explicitProp,
              property_hint: propHint,
              matched_property_id: ef?.matched_property_id ? String(ef.matched_property_id) : null,
              property_match_confidence: ef?.match_confidence ? String(ef.match_confidence) : null,
              matched_reservation_id: ef?.matched_reservation_id ? String(ef.matched_reservation_id) : null,
              knowledge_lookup_attempted: Boolean(knStatus && knStatus !== 'skipped'),
              knowledge_lookup_result: knStatus ?? 'skipped',
              knowledge_skip_reason: knStatus ? null : knSkip,
              knowledge_fields_available: knFields,
              reply_mode: 'escalation',
              clarification_question_used: false,
              clarification_question_used_text: null,
              escalation_reason: String(opIntake.actionReason ?? 'n/a'),
              final_reply_text: replyText || null,
            });
          }
          auditEscalation({ chat_id: chatId, update_id, detail: `telegram_operational_intake:${opIntake.category}` });
          auditDecision({
            type: 'escalate',
            chat_id: chatId,
            update_id,
            detail: `telegram_operational_intake:${opIntake.category}`,
          });
          await withAwaitCheckpoint(
            'session.transition.operator_review_required_telegram_op_intake',
            () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
            { chat_id: chatId },
            15_000,
          );
          runInBackground(
            {
              correlationId: corrId,
              module: 'orchestrator',
              taskName: 'createOpsTask_TelegramOperationalIntake',
              triggerId: String(chatId),
            },
            async () => {
              const { task_id } = await createTelegramOpsTask({
                property_id: commContext.reservation.propertyId ?? 'unknown',
                reservation_id: commContext.reservation.reservationId ?? null,
                chat_id: chatId,
                task_type: OpsTaskType.GuestIssue,
                title: `Telegram operational intake: ${opIntake.category}`,
                description: `Automated intake.\nFacts: ${JSON.stringify(opIntake.extractedFacts)}`,
                priority: urgent ? OpsTaskPriority.Urgent : OpsTaskPriority.Normal,
                source_event: 'telegram_operational_intake',
                trigger_reason: opIntake.category,
              });
              if (task_id) {
                await appendTimelineEvent(identity.guestId ?? String(chatId), {
                  type: 'ops_task_created',
                  task_type: OpsTaskType.GuestIssue,
                  task_id,
                  ts: new Date(),
                });
              }
            },
          );
          convSession = transitionConversationSessionState(
            convSession,
            'escalated',
            `telegram_operational:${opIntake.category}`,
          );
        } else if (opIntake.finalAction === 'clarify') {
          convSession = transitionConversationSessionState(
            convSession,
            'awaiting_input',
            `telegram_operational:${opIntake.category}`,
          );
        } else {
          convSession = transitionConversationSessionState(
            convSession,
            'awaiting_input',
            `telegram_operational:${opIntake.category}_reply`,
          );
        }
      }
    }

    // Canonical policy fallback for operational intents that do not have a narrow intake category
    // (for example cancellation/refund, pets, or explicit operator handoff).
    if (!replyText && !escalationSafetyGate && isCanonicalGuestCommunicationChannel(envelope.channel) && text.trim()) {
      const memNow = getContext(chatId);
      const knownContext = {
        objectLabel:
          memNow.propertyLocation ??
          memNow.propertyId ??
          commContext?.reservation?.propertyId ??
          identity.propertyId ??
          null,
        bookingReference:
          memNow.bookingReference ??
          memNow.reservationId ??
          commContext?.reservation?.reservationId ??
          identity.reservationId ??
          null,
        cleaningStatusKnown: Boolean((memNow as any)?.cleaningStatusKnown),
      };
      const policyMemory = ((memNow as any).telegramOperationalPolicyMemory ?? null) as
        | {
            lastSlowAckUpdateId?: number | null;
            unknownOperationalAttemptCount?: number;
          }
        | null;
      const policyInput = {
        messageText: text,
        update_id,
        sessionMemory: {
          knownContext,
          lastSlowAckUpdateId: policyMemory?.lastSlowAckUpdateId ?? null,
          unknownOperationalAttemptCount: policyMemory?.unknownOperationalAttemptCount ?? 0,
        },
        knownContext,
        normalization: canonNormalization,
      };
      const multiPolicy = executeTelegramOperationalPolicyMultiIntent(policyInput);
      const actionableIntents = actionableCanonicalOperationalIntents(multiPolicy.intents);
      const shouldUseCanonicalFallback =
        actionableIntents.length > 0 &&
        actionableIntents.some((intent) => intent.scenarioFamily !== 'UNKNOWN_OPERATIONAL_REQUEST');

      if (shouldUseCanonicalFallback) {
        replyText = adapter.formatResponse(
          composeCanonicalOperationalPolicyFallback({
            intents: actionableIntents,
            lang: classification.lang,
            channel: envelope.channel,
          }),
          commContext as unknown as Record<string, unknown>,
        );
        llmSucceeded = true;
        usedPath = 'reply_composer';
        telegramOperationalIntakeConsumed = true;
        updateContext(chatId, {
          telegramOperationalPolicyMemory: {
            lastSlowAckUpdateId: multiPolicy.nextSessionMemory?.lastSlowAckUpdateId ?? null,
            unknownOperationalAttemptCount: multiPolicy.nextSessionMemory?.unknownOperationalAttemptCount ?? 0,
          },
          telegramFinalOperationalReplyUpdateId: update_id,
        });

        const escalationIntents = actionableIntents.filter((intent) => intent.action === 'escalate');
        if (escalationIntents.length > 0) {
          const families = Array.from(new Set(escalationIntents.map((intent) => intent.scenarioFamily)));
          const urgent = families.some((family) => family === 'ACCESS_KEY_ISSUE' || family === 'EMERGENCY_URGENT_ISSUE');
          const paymentRelated = families.some((family) => family === 'CANCELLATION_REFUND');
          escalation = createEscalationEvent({
            reason: urgent
              ? EscalationReason.UrgentIssue
              : paymentRelated
                ? EscalationReason.PaymentComplaint
                : EscalationReason.RequiresOperator,
            chat_id: chatId,
            update_id,
            classification,
            summary: `canonical_operational_policy:${families.join(',')}`,
          });
          persistEscalationReview({
            reason: String(escalation.reason),
            escalationSummary: `canonical_operational_policy:${families.join(',')}`,
            confidence: Math.max(...escalationIntents.map((intent) => intent.confidence)),
            source: {
              route: 'canonical_operational_policy',
              channel: envelope.channel,
              scenario_families: families,
              intents: escalationIntents.map((intent) => ({
                scenarioFamily: intent.scenarioFamily,
                action: intent.action,
                confidence: intent.confidence,
                requiredContext: intent.requiredContext,
              })),
              ...(voiceSourceBase ?? {}),
            },
            detail: JSON.stringify({
              scenarioFamilies: families,
              actions: escalationIntents.map((intent) => intent.action),
            }),
            suggestedReply: replyText,
          });
          auditEscalation({ chat_id: chatId, update_id, detail: `canonical_operational_policy:${families.join(',')}` });
          auditDecision({
            type: 'escalate',
            chat_id: chatId,
            update_id,
            detail: `canonical_operational_policy:${families.join(',')}`,
          });
          await withAwaitCheckpoint(
            'session.transition.operator_review_required_canonical_policy',
            () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
            { chat_id: chatId },
            15_000,
          );
          runInBackground(
            {
              correlationId: corrId,
              module: 'orchestrator',
              taskName: 'createOpsTask_CanonicalOperationalPolicy',
              triggerId: String(chatId),
            },
            async () => {
              const { task_id } = await createTelegramOpsTask({
                property_id: commContext.reservation.propertyId ?? 'unknown',
                reservation_id: commContext.reservation.reservationId ?? null,
                chat_id: chatId,
                task_type: OpsTaskType.GuestIssue,
                title: `Canonical operational policy: ${families.join(', ')}`,
                description: `Automated canonical policy handoff.\nFamilies: ${families.join(', ')}`,
                priority: urgent ? OpsTaskPriority.Urgent : OpsTaskPriority.Normal,
                source_event: 'canonical_operational_policy',
                trigger_reason: families.join(','),
              });
              if (task_id) {
                await appendTimelineEvent(identity.guestId ?? String(chatId), {
                  type: 'ops_task_created',
                  task_type: OpsTaskType.GuestIssue,
                  task_id,
                  ts: new Date(),
                });
              }
            },
          );
          convSession = transitionConversationSessionState(convSession, 'escalated', 'canonical_operational_policy');
        } else if (actionableIntents.some((intent) => intent.action === 'clarify')) {
          convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'canonical_operational_policy:clarify');
        } else {
          convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'canonical_operational_policy:reply');
        }
      }
    }

    // Scenario-engine clarifying question (single best question).
    if (!replyText && !escalationSafetyGate && decision.nextAction === 'ask_clarifying_question' && plan.clarifyingQuestion) {
      cp('branch.scenario_engine.ask_clarify', { chat_id: chatId, scenario: decision.scenario });
      const qText = classification.lang === 'ru'
        ? (plan.clarifyingQuestion.ru ?? plan.clarifyingQuestion.en)
        : plan.clarifyingQuestion.en;
      replyText = adapter.formatResponse(qText, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'awaiting_input', `scenario_clarify:${decision.scenario}`);
    }

    // Scenario-engine escalation (evidence-based payload).
    if (!replyText && !escalationSafetyGate && decision.nextAction === 'escalate') {
      cp('branch.scenario_engine.escalate.start', { chat_id: chatId, scenario: decision.scenario });
      const scenarioReason =
        decision.scenario === 'payment_issue'
          ? EscalationReason.PaymentComplaint
          : EscalationReason.RequiresOperator;
      escalation = createEscalationEvent({
        reason: scenarioReason,
        chat_id: chatId,
        update_id,
        classification,
        summary: `scenario=${decision.scenario}; reason=${decision.reason}`,
      });
      persistEscalationReview({
        reason: String(escalation.reason),
        escalationSummary: `scenario=${decision.scenario}; reason=${decision.reason}`,
        confidence: decision.confidence,
        source: voiceSourceBase
          ? {
              ...voiceSourceBase,
              lastDecisionScenario: decision.scenario,
              missingFacts: decision.missingFacts,
            }
          : undefined,
        detail: JSON.stringify({
          scenario: decision.scenario,
          decisionReason: decision.reason,
          missingFacts: decision.missingFacts,
          entityResolution: decision.entityResolution,
          latestMessages: convSession.memory.lastMessages?.slice(-6)?.map(m => ({ dir: m.direction, text: String(m.content ?? '').slice(0, 500) })),
        }),
      });
      auditEscalation({ chat_id: chatId, update_id, detail: `scenario_engine_escalation scenario=${decision.scenario}` });
      auditDecision({ type: 'escalate', chat_id: chatId, update_id, detail: `scenario_engine_escalation scenario=${decision.scenario}` });
      await withAwaitCheckpoint(
        'session.transition.operator_review_required_scenario',
        () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
        { chat_id: chatId },
        15_000,
      );
      const escalationBase =
        classification.lang === 'ru'
          ? 'Передал запрос оператору — вернёмся с ответом.'
          : 'I’ve forwarded this to our team to review and will get back to you shortly.';
      const escalationMsg = templates?.escalation_contact_text
        ? `${escalationBase} ${templates.escalation_contact_text}`
        : escalationBase;
      replyText = adapter.formatResponse(escalationMsg, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'escalated', `scenario_escalation:${decision.scenario}`);
      cp('branch.scenario_engine.escalate.done', { chat_id: chatId });
    }

    // Scenario-engine deterministic-first replies (safe wording, no guessing).
    if (!replyText && !escalationSafetyGate && decision.nextAction === 'reply' && plan.deterministicFirst) {
      cp('branch.scenario_engine.deterministic_reply', { chat_id: chatId, scenario: decision.scenario });
      const lang = classification.lang;
      if (decision.scenario === 'late_arrival') {
        const msg = lang === 'ru'
          ? 'Спасибо за предупреждение о позднем приезде. Подтвердите, пожалуйста, ориентировочное время прибытия — мы отметим это.'
          : 'Thanks for letting us know about a late arrival. Please confirm your approximate arrival time so we can note it.';
        replyText = adapter.formatResponse(msg, commContext as unknown as Record<string, unknown>);
        llmSucceeded = true;
        usedPath = 'deterministic';
      } else if (decision.scenario === 'invoice_receipt_request') {
        const msg = lang === 'ru'
          ? 'Поняла запрос на чек/квитанцию. Если хотите получить документ на email — пришлите email, и укажите дату заезда/имя гостя (если ещё не указано).'
          : 'Got it — you’re requesting an invoice/receipt. If you want it by email, please share the email and confirm the guest name / check-in date (if not already provided).';
        replyText = adapter.formatResponse(msg, commContext as unknown as Record<string, unknown>);
        llmSucceeded = true;
        usedPath = 'deterministic';
      } else if (decision.scenario === 'payment_issue' || decision.scenario === 'complaint_conflict') {
        // These are handled above as escalation; keep guard for safety.
      }
    }

    // Escalation rules (pre-reply). Conservative: prefer human handoff over unsafe automation.
    if (
      !telegramOperationalIntakeConsumed &&
      !escalationSafetyGate &&
      !replyText &&
      classification.category !== 'start' &&
      classification.category !== 'greeting'
    ) {
      const preEsc = shouldEscalateByRules({
        text,
        classification,
        confidence: intentResult?.confidence,
        identity,
        reservationResolutionStatus: commContext?.reservation?.status,
        intent: currentAutopilotIntent,
      });
      if (preEsc.escalate) {
        escalation = createEscalationEvent({
          reason: preEsc.reason,
          chat_id: chatId,
          update_id,
          classification,
          summary: preEsc.detail,
        });
        persistEscalationReview({
          reason: String(preEsc.reason),
          escalationSummary: preEsc.detail,
          confidence: intentResult?.confidence,
        source: voiceSourceBase ? { ...voiceSourceBase } : undefined,
          detail: `pre_rule_escalation detail=${preEsc.detail}`,
        });
        auditEscalation({ chat_id: chatId, update_id, detail: `pre_rule:${preEsc.detail}` });
        auditDecision({
          type: 'escalate',
          chat_id: chatId,
          update_id,
          detail: `pre_rule_escalation reason=${preEsc.reason} detail=${preEsc.detail}`,
        });
        // Mark conversation-session engine state escalated so future turns are blocked by safety gate.
        convSession = transitionConversationSessionState(convSession, 'escalated', 'pre_rule_escalation');
      }
    }

    // If already escalated by rules, avoid normal auto reply flow when configured.
    const stopAutoReplyOnEscalation = process.env.COMM_STOP_AUTO_REPLY_ON_ESCALATION !== '0';
    if (escalation && stopAutoReplyOnEscalation && !replyText) {
      const escalationBase =
        classification.lang === 'ru'
          ? 'Поняла. Передала запрос команде — вернёмся с ответом.'
          : 'Understood. I’m passing this to the team now.';
      const escalationMsg = templates?.escalation_contact_text
        ? `${escalationBase} ${templates.escalation_contact_text}`
        : escalationBase;
      replyText = adapter.formatResponse(escalationMsg, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
    }

    // Staff-group operational bridge: group chat (chatId < 0) without a matched
    // reservation. Only ask a clarifying question when we STILL don't have
    // enough booking/property clues — once clues arrive, fall through to the
    // normal LLM/deterministic path so the reply is actually contextual.
    const staffNeedsContext =
      envelope.channel === 'telegram' &&
      chatId < 0 &&
      commContext.reservation.status !== 'matched' &&
      classification.category !== 'start' &&
      !hasMinimalStaffClues(mergedClues);

    if (!replyText && !escalationSafetyGate && classification.category === 'start') {
      cp('branch.start_message', { chat_id: chatId });
      replyText = adapter.formatResponse(deterministicReply(classification), commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
    } else if (!replyText && !escalationSafetyGate && staffNeedsContext) {
      cp('branch.staff_needs_context', { chat_id: chatId });
      const scenario = detectStaffScenario(intentResult.intent);
      replyText = buildStaffClarifyQuestion(scenario);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'staff_clarify_question');
    } else if (!replyText && !escalationSafetyGate && ctx.incident) {
      cp('branch.incident', { chat_id: chatId });
      const incidentMsg =
        'Thank you for letting us know.\n\n' +
        'We are reviewing the situation.\n' +
        'Our team will assess the apartment condition.\n\n' +
        'Additional cleaning or damage charges may apply if necessary.\n\n' +
        'We will get back to you shortly.';
      replyText = adapter.formatResponse(incidentMsg, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      updateContext(chatId, { escalation_candidate: true });
    } else if (!replyText && !escalationSafetyGate && !safety.safe && safety.action === 'escalate_to_operator') {
      cp('branch.policy_escalation.start', { chat_id: chatId });
      const handoff = buildOperatorHandoff(commContext, text, safety.action, safety.reason || 'Escalated by policy');
      escalation = createEscalationEvent({
        reason: safety.escalationReason || EscalationReason.RequiresOperator,
        chat_id: chatId,
        update_id,
        classification,
        summary: handoff.reasonForEscalation,
      });
      persistEscalationReview({
        reason: String(escalation.reason),
        escalationSummary: handoff.reasonForEscalation,
        confidence: convSession.confidence,
        source: voiceSourceBase ? { ...voiceSourceBase } : undefined,
        // We intentionally do not auto-send any suggested reply while escalated.
        suggestedReply: undefined,
        detail: `policy_escalation:${safety.reason ?? 'n/a'}`,
      });
      auditEscalation({ chat_id: chatId, update_id, detail: escalation.summary });
      auditDecision({ type: 'escalate', chat_id: chatId, update_id, detail: `policy_escalation:${escalation.reason}` });
      await withAwaitCheckpoint(
        'timeline.escalation.append',
        () => appendTimelineEvent(identity.guestId ?? String(chatId), { type: 'escalation', reason: escalation!.summary, ts: new Date() }),
        { chat_id: chatId },
        15_000,
      );
      await withAwaitCheckpoint(
        'session.transition.operator_review_required',
        () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
        { chat_id: chatId },
        15_000,
      );
      // Ops task: policy escalation → guest_issue (fire-and-forget)
      runInBackground(
        { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_EscalatePolicy', triggerId: String(chatId) },
        async () => {
          const { task_id } = await createTelegramOpsTask({
            property_id: commContext.reservation.propertyId ?? 'unknown',
            reservation_id: commContext.reservation.reservationId ?? null,
            chat_id: chatId,
            task_type: OpsTaskType.GuestIssue,
            title: `Guest issue escalated: ${escalation!.reason}`,
            description: escalation!.summary,
            priority: OpsTaskPriority.Urgent,
            source_event: 'escalation_policy',
            trigger_reason: escalation!.reason,
          });
          if (task_id) {
            await appendTimelineEvent(identity.guestId ?? String(chatId), { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
          }
        },
      );
      const escalationBase =
        classification.lang === 'ru'
          ? 'Поняла. Передала запрос команде — вернёмся с ответом.'
          : 'Understood. I’m passing this to the team now.';
      const escalationMsg = templates?.escalation_contact_text
        ? `${escalationBase} ${templates.escalation_contact_text}`
        : escalationBase;
      replyText = adapter.formatResponse(escalationMsg, commContext as unknown as Record<string, unknown>);
      usedPath = 'deterministic';
      cp('branch.policy_escalation.done', { chat_id: chatId });
      convSession = transitionConversationSessionState(convSession, 'escalated', 'policy_escalation');
    } else if (!replyText && !escalationSafetyGate && safety.action === 'ask_clarifying_question') {
      cp('branch.ask_clarifying_question', { chat_id: chatId });
      const askRu =
        'Уточните, пожалуйста: объект/адрес, имя гостя и дата/время заезда. ' +
        'Если проблема с доступом — что именно на замке/двери и есть ли код?';
      const askEn =
        'Quick уточнение: property/address, guest name, and check-in date/time. ' +
        'If it’s an access issue: what exactly fails (lock/door) and do you have a code?';
      replyText = adapter.formatResponse(classification.lang === 'ru' ? askRu : askEn, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'clarifying_question');
    } else if (!replyText && !escalationSafetyGate && intentResult.intent === IntentCategory.CheckInInfo && !templates?.pre_checkin_template) {
      cp('branch.checkininfo.no_template', { chat_id: chatId });
      const ru =
        'Чтобы помочь с заселением/кодом доступа, пришлите: объект/адрес, имя гостя и дату/время заезда. ' +
        'Если есть — номер брони/код бронирования.';
      const en =
        'To help with check-in/access code, send: property/address, guest name, and check-in date/time (plus booking reference if you have it).';
      replyText = adapter.formatResponse(classification.lang === 'ru' ? ru : en, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'missing_checkin_template_needs_details');
    } else if (!replyText && !escalationSafetyGate && safety.action === 'provide_check_in_instructions' && templates?.pre_checkin_template) {
      cp('branch.provide_check_in_instructions.start', { chat_id: chatId });
      // ── Check-in readiness gate ──────────────────────────────────────
      const gateResult = propertyId
        ? await withAwaitCheckpoint(
            'checkin_gate.await',
            () => evaluateCheckinReadiness(propertyId),
            { chat_id: chatId, property_id: propertyId },
            15_000,
          )
        : { allowed: false, unit_state: null, blocked_reason: 'no_property_id', checked_at: new Date().toISOString() };

      if (gateResult.allowed) {
        // Unit is ready — deliver check-in instructions normally
        replyText = adapter.formatResponse(templates.pre_checkin_template, commContext as unknown as Record<string, unknown>);
        llmSucceeded = true;
        usedPath = 'deterministic';
        // Timeline: gate passed
        runInBackground(
          { correlationId: corrId, module: 'orchestrator', taskName: 'appendTimelineEvent_CheckinPassed', triggerId: identity.guestId ?? String(chatId) },
          () => appendTimelineEvent(identity.guestId ?? String(chatId), {
            type: 'checkin_gate_passed',
            property_id: propertyId!,
            reservation_id: commContext.reservation.reservationId ?? null,
            ts: new Date(),
          }),
        );
        // Seal pre_checkin_sent_at so the stay-flow runner never double-sends (best-effort)
        if (commContext.reservation.reservationId) {
          const resId = commContext.reservation.reservationId;
          runInBackground(
            { correlationId: corrId, module: 'orchestrator', taskName: 'update_pre_checkin_sent_at', triggerId: resId },
            async () => {
              const { error } = await supabase
                .from('tg_guest_reservations')
                .update({ pre_checkin_sent_at: new Date().toISOString() })
                .eq('id', resId);
              if (error) throw new Error(error.message);
            },
          );
        }
      } else {
        // Unit NOT ready — send safe holding message, never check-in instructions
        const holdingEn = "We're preparing your accommodation — we'll share check-in details once everything is ready!";
        const holdingRu = 'Мы готовим ваше жильё — мы отправим детали заселения, как только всё будет готово!';
        const holdingMsg = classification.lang === 'ru' ? holdingRu : holdingEn;
        replyText = adapter.formatResponse(holdingMsg, commContext as unknown as Record<string, unknown>);
        llmSucceeded = true; // no LLM fallback needed — we have a deterministic safe reply
        usedPath = 'deterministic';

        // Timeline: gate blocked
        runInBackground(
          { correlationId: corrId, module: 'orchestrator', taskName: 'appendTimelineEvent_ReadinessBlocked', triggerId: identity.guestId ?? String(chatId) },
          () => appendTimelineEvent(identity.guestId ?? String(chatId), {
            type: 'stay_flow_readiness_blocked',
            property_id: propertyId!,
            blocked_reason: gateResult.blocked_reason ?? 'unit_not_ready',
            reservation_id: commContext.reservation.reservationId ?? null,
            ts: new Date(),
          }),
        );

        // Persist blocked state on reservation (best-effort)
        if (commContext.reservation.reservationId) {
          runInBackground(
            {
              correlationId: corrId,
              module:        'orchestrator',
              taskName:      'update_readiness_blocked',
              triggerId:     commContext.reservation.reservationId ?? undefined,
            },
            async () => {
              const { error } = await supabase
                .from('tg_guest_reservations')
                .update({
                  readiness_blocked:       true,
                  readiness_block_reason:  gateResult.blocked_reason,
                  readiness_checked_at:    gateResult.checked_at,
                })
                .eq('id', commContext.reservation.reservationId);
              if (error) throw new Error(error.message);
            },
          );
        }

        // Ops task: check-in blocked (idempotent via dedup_key)
        runInBackground(
          { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_CheckinBlocked', triggerId: String(chatId) },
          async () => {
            const { error } = await createTelegramOpsTask({
              property_id: propertyId ?? 'unknown',
              reservation_id: commContext.reservation.reservationId ?? null,
              chat_id: chatId,
              task_type: OpsTaskType.CheckinReady,
              title: `Check-in blocked: ${gateResult.blocked_reason}`,
              description: `Guest asked for check-in info but unit is not ready. Reason: ${gateResult.blocked_reason}. Unit state: ${gateResult.unit_state ?? 'unknown'}.`,
              priority: OpsTaskPriority.Urgent,
              source_event: 'checkin_gate_blocked',
              trigger_reason: gateResult.blocked_reason ?? 'unit_not_ready',
              dedup_key: `checkin_gate_blocked:${commContext.reservation.reservationId ?? propertyId ?? 'unknown'}`,
            });
            if (error) throw new Error(error);
          },
        );
      }
      cp('branch.provide_check_in_instructions.done', { chat_id: chatId, allowed: gateResult.allowed });
      if (gateResult.allowed) {
        convSession = transitionConversationSessionState(convSession, 'resolved', 'checkin_instructions_provided');
      } else {
        convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'checkin_blocked_holding_message');
      }
    } else if (!replyText && !escalationSafetyGate && safety.action === 'provide_checkout_instructions' && templates?.checkout_template) {
      cp('branch.provide_checkout_instructions', { chat_id: chatId });
      replyText = adapter.formatResponse(templates.checkout_template, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'resolved', 'checkout_instructions_provided');
    } else if (!replyText && !escalationSafetyGate && safety.action === 'trigger_payment_request') {
      cp('branch.trigger_payment_request.start', { chat_id: chatId });
      const payment = await createPaymentRequest({
        amount: 100,
        currency: classification.lang === 'ru' ? 'RUB' : 'USD',
        chatId: String(chatId),
        serviceType: 'Chat Assistant Payment',
        reservationId: commContext.reservation.reservationId,
        propertyId: commContext.reservation.propertyId,
      });
      const paymentExpiresAt = payment.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000);
      await withAwaitCheckpoint(
        'session.transition.payment_pending',
        () => transitionSessionStatus(chatId, SessionStatus.PaymentPending, { paymentExpiresAt }),
        { chat_id: chatId },
        15_000,
      );
      setPaymentExpiry(chatId, paymentExpiresAt);
      const paymentUrl = payment.paymentUrl;
      const linkStr = classification.lang === 'ru'
        ? `Пожалуйста, завершите оплату по этой ссылке: ${paymentUrl}`
        : `Please complete your payment using this link: ${paymentUrl}`;
      replyText = adapter.formatResponse(linkStr, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      cp('branch.trigger_payment_request.done', { chat_id: chatId });
      convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'payment_link_sent');
    } else if (!replyText && !escalationSafetyGate && envelope.channel === 'telegram' && telegramMetaStoredReply) {
      cp('branch.telegram_text_meta_deterministic', { chat_id: chatId, kind: telegramMetaRouteKind });
      replyText = adapter.formatResponse(telegramMetaStoredReply, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'telegram_meta_deterministic';
    } else if (
      !replyText &&
      !escalationSafetyGate &&
      !(envelope.channel === 'telegram' && classification.lang === 'ru')
    ) {
      cp('branch.llm.start', { chat_id: chatId });
      const followupHint = templates?.followup_template
        ? `Follow-up template (use when context is post-stay or follow-up): ${templates.followup_template}`
        : null;
      let llmReply: string | null = null;
      const sessionContextBlock = buildSessionContextForLLM(convSession);
      const prompt = buildIntelligentPrompt(
        commContext as unknown as Parameters<typeof buildIntelligentPrompt>[0],
        text,
        classification,
        followupHint,
        sessionContextBlock,
      );
      llmReply = await withAwaitCheckpoint(
        'llm.call.await',
        () => callLLM({ systemPrompt: SYSTEM_PROMPT, userMessage: prompt }),
        { chat_id: chatId },
        Number(process.env.LLM_TIMEOUT_MS ?? 20000) + 10_000,
      );
      usedPath = 'llm';
      llmSucceeded = llmReply !== null;

      const rawFallback = llmReply ?? deterministicReply(classification);
      replyText = adapter.formatResponse(rawFallback, commContext as unknown as Record<string, unknown>);
      auditLLM({ chat_id: chatId, update_id, used_fallback: !llmSucceeded });
      cp('branch.llm.done', { chat_id: chatId, llm_succeeded: llmSucceeded });
    } else if (
      !replyText &&
      !escalationSafetyGate &&
      envelope.channel === 'telegram' &&
      classification.lang === 'ru' &&
      text.trim()
    ) {
      cp('branch.telegram_guest_agent.safe_fallback', { chat_id: chatId });
      replyText = adapter.formatResponse(
        'Поняла. Подскажите, вы про заселение, оплату, доступ к квартире или уже текущее проживание? Я помогу с нужным шагом.',
        commContext as unknown as Record<string, unknown>,
      );
      llmSucceeded = true;
      usedPath = 'communication_autopilot';
    }

    // Final safety ack: if session is escalated, do not run normal automation.
    if (!replyText && escalationSafetyGate) {
      auditDecision({
        type: 'ignore',
        chat_id: chatId,
        update_id,
        detail: 'session_escalated_block_normal_automation',
      });
      const base =
        classification.lang === 'ru'
          ? 'Поняла, оператор уже подключён. Спасибо, мы проверяем детали и вернёмся с ответом.'
          : 'This conversation is already escalated to a human operator. We will follow up shortly.';
      replyText = adapter.formatResponse(base, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
    }

    // If this was a /reset_session attempt that was NOT allowed, emit a final trace line
    // that captures the actual reply that was sent (to prove overwrite/fallthrough in prod).
    if (envelope.channel === 'telegram' && cmdNorm?.normalized_command === 'reset_session' && !resetMatch.matched) {
      // This case should be rare (normalized says reset_session but match failed), but log anyway.
      logSessionResetOrCaseReopen({
        previous_status: convSession.state,
        new_status: convSession.state,
        reason: 'reset_normalized_but_not_matched',
        update_id,
        command_raw_text: cmdNorm.raw_text,
        command_raw: cmdNorm.raw_command ?? undefined,
        normalized_command: cmdNorm.normalized_command ?? undefined,
        chat_id: chatId,
        matched: false,
        intercepted_before_escalation: false,
        final_reply: replyText ?? null,
      });
    } else if (envelope.channel === 'telegram' && resetMatch.matched) {
      // This line is the "must appear in prod" end-of-path trace, even when denied.
      const allowlist = parseAllowlistedChatIds(process.env.COMM_TELEGRAM_RESET_ALLOWLIST);
      const nonProd = (process.env.VERCEL_ENV ?? process.env.NODE_ENV) !== 'production';
      const prod_reset_enabled = nonProd ? true : process.env.COMM_TELEGRAM_RESET_ALLOWLIST_PROD === '1';
      const allowlisted = allowlist.has(chatId);
      logSessionResetOrCaseReopen({
        previous_status: convSession.state,
        new_status: convSession.state,
        reason: allowlisted && prod_reset_enabled ? 'fallthrough_unexpected' : 'deny_fallthrough_final_reply',
        update_id,
        command_raw_text: cmdNorm?.raw_text ?? text,
        command_raw: cmdNorm?.raw_command ?? (resetMatch.raw || undefined),
        normalized_command: cmdNorm?.normalized_command ?? 'reset_session',
        chat_id: chatId,
        allowlisted,
        prod_reset_enabled,
        matched: true,
        intercepted_before_escalation: false,
        final_reply: replyText ?? null,
      });
    }

    if (latencyLoggingEnabled) {
      console.info('[tg:latency] reply.compose', {
        update_id,
        chat_id: chatId,
        stage_ms: Date.now() - replyComposeStartedAt,
        used_path: usedPath,
        reply_len: replyText.length,
      });
    }

    if (telegramGuestAgentShadowAudit) {
      auditTelegramGuestAgentShadow({
        chat_id: chatId,
        update_id,
        mvp_intent: telegramGuestAgentShadowAudit.mvp_intent,
        semantic_intent: telegramGuestAgentShadowAudit.semantic_intent,
        agent_intent: telegramGuestAgentShadowAudit.agent.intent,
        agent_confidence: telegramGuestAgentShadowAudit.agent.confidence,
        agent_safe_reply_draft: telegramGuestAgentShadowAudit.agent.safe_reply_draft,
        final_sent_reply: replyText,
        mismatch_reason: telegramGuestAgentShadowAudit.mismatch_reason,
        would_agent_have_helped: telegramGuestAgentShadowAudit.would_agent_have_helped,
        requested_action: telegramGuestAgentShadowAudit.agent.requested_action,
        required_data: telegramGuestAgentShadowAudit.agent.required_data,
        escalation_needed: telegramGuestAgentShadowAudit.agent.escalation_needed,
      });
    }

    updateContext(chatId, { lastIntent: intentResult.intent });
    cp('memory/context.update.last_intent.done', { chat_id: chatId });

    cp('persistence.user_turn.start', { chat_id: chatId });
    await withAwaitCheckpoint(
      'persistence.user_turn.await',
      () =>
        Promise.allSettled([
          upsertSession(chatId),
          saveUserTurn({
            chat_id: chatId,
            update_id,
            text,
            category: classification.category,
            lang: classification.lang,
          }),
        ]),
      { chat_id: chatId },
      20_000,
    );
    cp('persistence.user_turn.done', { chat_id: chatId });

    // Persist the assistant turn BEFORE attempting outbound delivery.
    // This fixes the observed gap where user turns exist but assistant turns
    // are missing because delivery threw/failed before saveAssistantTurn.
    //
    // If delivery later fails, the turn is still recorded for ops debugging.
    cp('persistence.assistant_turn.start', { chat_id: chatId });
    await withAwaitCheckpoint(
      'persistence.assistant_turn.await',
      () =>
        saveAssistantTurn({
          chat_id: chatId,
          update_id,
          reply: replyText,
          category: classification.category,
          lang: classification.lang,
        }),
      { chat_id: chatId },
      20_000,
    );
    cp('persistence.assistant_turn.done', { chat_id: chatId });

    // Session memory: persist assistant outbound in the session engine.
    try {
      convSession = appendSessionMessage({
        key: sessionKey,
        session: convSession,
        direction: 'outbound',
        content: replyText,
      });
    } catch {
      // best-effort
    }

    if (!escalation && shouldEscalate(classification, llmSucceeded)) {
      cp('escalation.post_reply.start', { chat_id: chatId });
      const reason = deriveEscalationReason(classification, llmSucceeded);
      const handoff = buildOperatorHandoff(commContext, text, 'escalate_to_operator', 'LLM fallback triggered');
      escalation = createEscalationEvent({
        reason,
        chat_id: chatId,
        update_id,
        classification,
        summary: `category=${classification.category} llm=${llmSucceeded} urgent=${classification.slots.isUrgent}`,
      });
      persistEscalationReview({
        reason: String(reason),
        escalationSummary: `post_reply_escalation ${handoff.reasonForEscalation}`,
        confidence: intentResult?.confidence,
        source: voiceSourceBase ? { ...voiceSourceBase } : undefined,
        detail: `post_reply_escalation reason=${reason}`,
      });
      const esc = escalation;
      auditEscalation({
        chat_id: chatId,
        update_id,
        detail: `reason=${reason} category=${classification.category}`,
      });
      await withAwaitCheckpoint(
        'timeline.escalation_post_reply.append',
        () => appendTimelineEvent(identity.guestId ?? String(chatId), { type: 'escalation', reason: esc.summary, ts: new Date() }),
        { chat_id: chatId },
        15_000,
      );
      await withAwaitCheckpoint(
        'session.transition.operator_review_required_post_reply',
        () => transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired),
        { chat_id: chatId },
        15_000,
      );
      // Ops task: LLM-fallback escalation → guest_issue (fire-and-forget)
      runInBackground(
        { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_LLMFallback', triggerId: String(chatId) },
        async () => {
          const { task_id, error } = await createTelegramOpsTask({
            property_id: commContext.reservation.propertyId ?? 'unknown',
            reservation_id: commContext.reservation.reservationId ?? null,
            chat_id: chatId,
            task_type: OpsTaskType.GuestIssue,
            title: `Guest issue escalated: ${reason}`,
            description: escalation!.summary,
            priority: classification.slots.isUrgent ? OpsTaskPriority.Urgent : OpsTaskPriority.Normal,
            source_event: 'escalation_llm_fallback',
            trigger_reason: reason,
          });
          if (error) throw new Error(error);
          if (task_id) {
            await appendTimelineEvent(identity.guestId ?? String(chatId), { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
          }
        },
      );
      cp('escalation.post_reply.done', { chat_id: chatId, reason });
      convSession = transitionConversationSessionState(convSession, 'escalated', 'post_reply_escalation');
    }

    // Ops task: checkout intent → checkout task (fire-and-forget)
    if (intentResult.intent === IntentCategory.CheckOut && commContext.reservation.propertyId) {
      cp('ops.checkout_task.fire_and_forget.queued', { chat_id: chatId, property_id: commContext.reservation.propertyId });
      runInBackground(
        { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_Checkout', triggerId: String(chatId) },
        async () => {
          const { task_id, error } = await createTelegramOpsTask({
            property_id: commContext.reservation.propertyId!,
            reservation_id: commContext.reservation.reservationId ?? null,
            chat_id: chatId,
            task_type: OpsTaskType.Checkout,
            title: 'Guest checkout',
            priority: OpsTaskPriority.Normal,
            source_event: 'checkout_intent',
            trigger_reason: 'checkout_message_sent',
          });
          if (error) throw new Error(error);
          if (task_id) {
            await appendTimelineEvent(identity.guestId ?? String(chatId), { type: 'ops_task_created', task_type: OpsTaskType.Checkout, task_id, ts: new Date() });
          }
        },
      );
    }

    const antiLoopMemory = getContext(chatId);
    const antiLoop = preventRepeatedCommunicationReply({
      replyText,
      lang: classification.lang,
      memory: antiLoopMemory,
      eligible: antiLoopEligible,
    });
    if (antiLoop.prevented) {
      const rawAntiLoopReply = antiLoop.replyText;
      replyText = adapter.formatResponse(rawAntiLoopReply, commContext as unknown as Record<string, unknown>);
      auditDecision({
        type: antiLoop.escalated ? 'escalate' : 'reply',
        chat_id: chatId,
        update_id,
        detail: `anti_loop_repeated_response_prevented strategy=${antiLoop.escalated ? 'operator_escalation' : 'clearer_clarification'} repeat_count=${antiLoop.repeatedCount}`,
      });
      if (antiLoop.escalated) {
        escalation = createEscalationEvent({
          reason: EscalationReason.RequiresOperator,
          chat_id: chatId,
          update_id,
          classification,
          summary: 'anti_loop_repeated_response_prevented',
        });
        auditEscalation({ chat_id: chatId, update_id, detail: 'anti_loop_repeated_response_prevented' });
        convSession = transitionConversationSessionState(convSession, 'escalated', 'anti_loop_repeated_response_prevented');
      }
    }
    updateContext(chatId, {
      communicationSemanticMemory: {
        ...((getContext(chatId) as any).communicationSemanticMemory ?? {}),
        preferredLang: classification.lang,
        lastReplySignature: replySignature(replyText),
        lastReplyPreview: replyText.slice(0, 160),
        repeatedReplyCount: antiLoop.repeatedCount,
        lastAntiLoopMarker: antiLoop.prevented ? 'anti_loop_repeated_response_prevented' : undefined,
      },
    } as any);

    // Send the response abstractly
    const targetIdRaw = resolveOutboundTargetId(envelope, identity.guestId);
    if (!targetIdRaw) throw new Error('No outbound target id');
    const targetId = String(targetIdRaw);

    // Idempotency (outbound): protect against duplicate sends across retries/replays.
    const outboundKey = sha256Base64Url(
      [
        envelope.channel,
        String(chatId),
        String(targetId),
        inboundStableKey,
        replyText,
      ].join('|'),
    );
    if (checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { update_id, chatId } })) {
      auditDuplicateOutboundPrevented({
        chat_id: chatId,
        update_id,
        detail: `outbound_duplicate_prevented key=${outboundKey}`,
      });
      auditDecision({
        type: 'ignore',
        chat_id: chatId,
        update_id,
        detail: `outbound_duplicate_prevented key=${outboundKey}`,
      });
      return { outcome: ProcessOutcome.Ignored, update_id, chat_id: chatId, category: classification.category, escalation, reply: replyText };
    }

    cp('outbound.dispatch.start', { chat_id: chatId, target_id: targetId, used_path: usedPath, llm_succeeded: llmSucceeded, reply_len: replyText.length });
    if (ruDebug) {
      console.log('[ru:tg] reply.computed', {
        chat_id: chatId,
        update_id,
        used_path: usedPath,
        llm_succeeded: llmSucceeded,
        reply_len: replyText.length,
      });
    }

    const isDryRun =
      (isTelegramOutboundDryRun() && envelope.channel === 'telegram') ||
      (shouldSuppressEmailOutbound() && envelope.channel === 'email');
    if (pipeDebug) {
      console.log('[comm:pipeline] outbound.dispatch', {
        corr_id: corrId,
        update_id,
        chat_id: chatId,
        channel: envelope.channel,
        target_id: String(targetId),
        dry_run: isDryRun,
        email_draft_only: envelope.channel === 'email' && shouldSuppressEmailOutbound(),
        reply_len: replyText.length,
      });
    }
    const attempts = Number(process.env.COMM_OUTBOUND_RETRY_ATTEMPTS ?? 3);
    const baseDelayMs = Number(process.env.COMM_OUTBOUND_RETRY_BASE_DELAY_MS ?? 400);
    const sent = isDryRun
      ? true
      : (
          await withAwaitCheckpoint(
            'outbound.dispatch.retry.await',
            async () => {
              const res = await retry<boolean>({
                attempts,
                baseDelayMs,
                isSuccess: v => v === true,
                onAttempt: (info) => {
                  if (info.attempt === 1) return;
                  auditRetryAttempt({
                    chat_id: chatId,
                    update_id,
                    detail: `outbound_retry attempt=${info.attempt} decision=${info.decision?.reason ?? 'n/a'}`,
                  });
                },
                fn: async () => {
                  const voiceExtras =
                    envelope.channel === 'telegram'
                      ? await buildTelegramVoiceExtras({
                          envelope,
                          replyText,
                          chatId,
                          detectedIntent: voiceOutboundHint.detectedIntent ?? String(intentResult.intent),
                          domainZone: inferDomainZoneForVoice({
                            detectedIntent: voiceOutboundHint.detectedIntent ?? String(intentResult.intent),
                            domainZone: voiceOutboundHint.domainZone,
                          }),
                          responseMode: voiceOutboundHint.responseMode,
                          role: identity.role,
                          propertyId,
                          isUrgent: classification.slots.isUrgent || classification.slots.isAccessRelated,
                          isEscalation: Boolean(escalation),
                        })
                      : {};
                  return adapter.sendMessage(
                    targetId,
                    replyText,
                    buildOutboundTransportMetadata({
                      envelope,
                      usedPath,
                      update_id,
                      category: classification.category,
                      telegramMetaRouteKind,
                      isEscalation: Boolean(escalation),
                      voiceExtras,
                    }),
                  );
                },
              });
              if (!res.ok) {
                const reason = res.lastDecision?.reason ?? 'unknown';
                auditFailureEnqueued({
                  chat_id: chatId,
                  update_id,
                  detail: `outbound_failed attempts=${res.attempts} reason=${reason}`,
                });
                writeFailure({
                  type: 'outbound_delivery_failed',
                  ts: new Date().toISOString(),
                  sessionId: convSession.sessionId,
                  chat_id: chatId,
                  update_id,
                  channel: envelope.channel,
                  idempotencyKey: outboundKey,
                  payload: {
                    targetId,
                    replyTextPreview: replyText.slice(0, 400),
                    usedPath,
                    llmSucceeded,
                  },
                  reason: reason,
                  attempts: res.attempts,
                });
              }
              return Boolean(res.ok && res.value === true);
            },
            { chat_id: chatId, target_id: targetId, channel: envelope.channel },
            Number(process.env.TELEGRAM_HTTP_TIMEOUT_MS ?? 10000) + 5_000,
          )
        );
    if (pipeDebug) {
      console.log('[comm:pipeline] outbound.result', {
        corr_id: corrId,
        update_id,
        chat_id: chatId,
        channel: envelope.channel,
        sent,
      });
    }
    cp('outbound.dispatch.result', { chat_id: chatId, sent });
    if (!sent) throw new Error('Adapter failed to send message');
    await withAwaitCheckpoint(
      'timeline.outbound.append',
      () => appendTimelineEvent(identity.guestId ?? String(chatId), { type: 'message_outbound', channel: envelope.channel, content: replyText, ts: new Date() }),
      { chat_id: chatId },
      15_000,
    );

    auditOutbound({
      chat_id: chatId,
      update_id,
      category: classification.category,
      lang: classification.lang,
      detail: escalation ? `escalated:${escalation.reason}` : undefined,
    });

    auditDecision({
      type: 'reply',
      chat_id: chatId,
      update_id,
      detail: `reply_sent used_path=${usedPath} llm=${llmSucceeded} outbound_key=${outboundKey}`,
    });

    cp('processMessage.return.success', { chat_id: chatId, outcome: ProcessOutcome.Replied });
    return {
      outcome: ProcessOutcome.Replied,
      update_id,
      chat_id: chatId,
      category: classification.category,
      escalation,
      reply: replyText,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    cp('processMessage.catch', { chat_id: chatId, error_detail: detail });
    auditError({ chat_id: chatId, update_id, detail });
    return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
  }
}

// Keep backward compatibility for Telegram Webhook
import { TelegramUpdate, TelegramAttachmentRef } from './types';

/**
 * Build a human-readable text summary of any attachments in the message,
 * and collect attachment refs for the operator leads page.
 *
 * Telegram sends photo arrays (smallest→largest). We use the largest size.
 * The file_id lets operators retrieve the actual file via:
 *   GET https://api.telegram.org/bot<TOKEN>/getFile?file_id=...
 */
function extractAttachments(message: NonNullable<TelegramUpdate['message']>): {
  textHint: string;
  refs: TelegramAttachmentRef[];
} {
  const refs: TelegramAttachmentRef[] = [];

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    refs.push({
      type:      'photo',
      label:     `Photo ${largest.width}×${largest.height}px`,
      file_id:   largest.file_id,
      caption:   message.caption ?? undefined,
      file_size: largest.file_size,
    });
  }

  if (message.document) {
    const doc = message.document;
    refs.push({
      type:      'document',
      label:     doc.file_name ?? 'Document',
      file_id:   doc.file_id,
      caption:   message.caption ?? undefined,
      file_size: doc.file_size,
    });
  }

  if (message.caption && refs.length === 0) {
    refs.push({ type: 'note', label: 'Caption', caption: message.caption });
  }

  const parts: string[] = [];
  if (message.photo)    parts.push('[photo]');
  if (message.document) parts.push(`[file: ${message.document.file_name ?? 'document'}]`);
  if (message.caption)  parts.push(`Caption: ${message.caption}`);

  return { textHint: parts.join(' '), refs };
}

function getTelegramUpdateEvent(update: TelegramUpdate): {
  type: 'message' | 'edited_message';
  message?: TelegramUpdate['message'];
} {
  if (update.edited_message) return { type: 'edited_message', message: update.edited_message };
  if (update.message) return { type: 'message', message: update.message };
  return { type: 'message' };
}

function telegramEventOccurrenceId(update: TelegramUpdate, message: NonNullable<TelegramUpdate['message']>, eventType: 'message' | 'edited_message'): string {
  if (eventType === 'edited_message') {
    return String(message.edit_date ?? update.update_id);
  }
  return 'original';
}

function telegramInboundIdempotencyKey(update: TelegramUpdate, message: NonNullable<TelegramUpdate['message']>, eventType: 'message' | 'edited_message'): string {
  return [
    'telegram',
    eventType,
    String(message.chat.id),
    String(message.message_id),
    telegramEventOccurrenceId(update, message, eventType),
  ].join(':');
}

async function handleTelegramPromptInjectionGuard(params: {
  update: TelegramUpdate;
  message: NonNullable<TelegramUpdate['message']>;
  eventType: 'message' | 'edited_message';
  eventOccurrenceId: string;
  baseText: string;
}): Promise<ProcessResult | null> {
  if (!params.baseText.trim()) return null;

  const guard = evaluateTelegramPromptInjectionGuard({
    chatId: params.message.chat.id,
    text: params.baseText,
  });

  if (guard.action === 'allow') return null;

  const replyText =
    guard.action === 'block_first'
      ? TELEGRAM_PROMPT_INJECTION_FIRST_REPLY
      : TELEGRAM_PROMPT_INJECTION_BLOCKED_REPLY;
  const outboundKey = sha256Base64Url(
    [
      'tg_prompt_injection_guard',
      params.eventType,
      String(params.message.chat.id),
      String(params.message.message_id),
      params.eventOccurrenceId,
      replyText,
    ].join('|'),
  );

  if (guard.action === 'block_repeat') {
    auditPromptInjectionRepeat({
      chat_id: params.message.chat.id,
      update_id: params.update.update_id,
      detail: `reason=${guard.reason} violation_count=${guard.violationCount} blocked_until=${guard.blockedUntil}`,
    });
    auditDecision({
      type: 'escalate',
      chat_id: params.message.chat.id,
      update_id: params.update.update_id,
      detail: `PROMPT_INJECTION_REPEAT reason=${guard.reason}`,
    });
    createOrUpdateEscalationReview({
      sessionId: `telegram:${params.message.chat.id}:prompt_injection`,
      channel: 'telegram',
      targetId: String(params.message.chat.id),
      actorId: String(params.message.chat.id),
      role: 'guest',
      escalationReason: 'PROMPT_INJECTION_REPEAT',
      confidence: 1,
      source: {
        event: 'PROMPT_INJECTION_REPEAT',
        update_id: params.update.update_id,
      },
      suggestedReply: replyText,
      detail: 'PROMPT_INJECTION_REPEAT',
    });
  } else {
    auditPromptInjectionBlocked({
      chat_id: params.message.chat.id,
      update_id: params.update.update_id,
      detail:
        guard.action === 'block_first'
          ? `reason=${guard.reason} blocked_until=${guard.blockedUntil}`
          : `active_block blocked_until=${guard.blockedUntil}`,
    });
    auditDecision({
      type: 'reply',
      chat_id: params.message.chat.id,
      update_id: params.update.update_id,
      detail: guard.action === 'block_first' ? `PROMPT_INJECTION_BLOCKED reason=${guard.reason}` : 'PROMPT_INJECTION_ACTIVE_BLOCK',
    });
  }

  if (!checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { update_id: params.update.update_id, chatId: params.message.chat.id } })) {
    await replyToTelegram(params.message.chat.id, replyText, {
      handler: `telegram_prompt_injection_guard/${guard.action}`,
      update_id: params.update.update_id,
    });
  }

  return {
    outcome: ProcessOutcome.Replied,
    update_id: params.update.update_id,
    chat_id: params.message.chat.id,
    category: MessageCategory.Fallback,
    reply: replyText,
  };
}

function telegramIdentityCallbackToRoute(data: unknown): {
  messageText: string;
  senderIdentity: 'guest' | 'owner_manager' | 'lead' | 'support_problem';
} | null {
  switch (String(data ?? '').trim()) {
    case TELEGRAM_IDENTITY_CALLBACKS.guest:
      return { messageText: 'Я гость', senderIdentity: 'guest' };
    case TELEGRAM_IDENTITY_CALLBACKS.ownerManager:
      return { messageText: 'Я владелец / управляющий объекта', senderIdentity: 'owner_manager' };
    case TELEGRAM_IDENTITY_CALLBACKS.lead:
      return { messageText: 'Хочу подключить ASI', senderIdentity: 'lead' };
    case TELEGRAM_IDENTITY_CALLBACKS.supportProblem:
      return { messageText: 'Нужна поддержка', senderIdentity: 'support_problem' };
    default:
      return null;
  }
}

async function processTelegramCallbackQuery(
  update: TelegramUpdate,
  options?: { durableReceiptOwned?: boolean },
): Promise<ProcessResult | null> {
  const callback = update.callback_query;
  if (!callback) return null;

  // Always ack the spinner — including ignore/duplicate/missing-chat paths.
  if (callback.id) {
    void answerTelegramCallbackQuery(callback.id).catch(() => undefined);
  }

  const message = callback.message;
  const chatId = message?.chat?.id;
  if (typeof chatId !== 'number') {
    return { outcome: ProcessOutcome.Ignored, update_id: update.update_id, chat_id: undefined };
  }

  const callbackData = String(callback.data ?? '').trim();
  const isOnboardingWizardCallback = callbackData.startsWith('obv2:');
  const isMkOnboardingCallback = callbackData.startsWith('obmk:');
  const isOwnerSessionRouterCallback = callbackData.startsWith('obsr:');

  const selected = isOnboardingWizardCallback || isMkOnboardingCallback || isOwnerSessionRouterCallback
    ? { messageText: '', senderIdentity: 'lead' as const }
    : telegramIdentityCallbackToRoute(callback.data);

  if (!selected) {
    return { outcome: ProcessOutcome.Ignored, update_id: update.update_id, chat_id: chatId };
  }

  const inboundKey = ['telegram', 'callback_query', callback.id].join(':');
  if (!options?.durableReceiptOwned && checkAndMarkKey({
    scope: 'inbound',
    key: inboundKey,
    meta: {
      update_id: update.update_id,
      chat_id: chatId,
      telegram_callback_query_id: callback.id,
      telegram_callback_data: callback.data,
    },
  })) {
    auditDuplicate({ chat_id: chatId, update_id: update.update_id });
    auditDecision({
      type: 'ignore',
      chat_id: chatId,
      update_id: update.update_id,
      detail: `duplicate_inbound key=${inboundKey}`,
    });
    return { outcome: ProcessOutcome.Duplicate, update_id: update.update_id, chat_id: chatId };
  }

  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: (callback.from?.id ?? chatId).toString(),
    chatId: chatId.toString(),
    messageText: selected.messageText,
    receivedAt: new Date(),
    update_id: update.update_id,
    metadata: {
      telegram_chat_id: chatId.toString(),
      providerMessageId: `callback_query:${callback.id}`,
      externalMessageId: `callback_query:${callback.id}`,
      inboundIdempotencyKey: inboundKey,
      inboundIdempotencyAlreadyMarked: true,
      telegram_event_type: 'callback_query',
      telegram_callback_query_id: callback.id,
      telegram_callback_data: callback.data,
      telegram_callback_message_id: message?.message_id,
      telegram_onboarding_wizard_callback: isOnboardingWizardCallback ? callbackData : undefined,
      telegram_mk_onboarding_callback: isMkOnboardingCallback ? callbackData : undefined,
      telegram_session_router_callback: isOwnerSessionRouterCallback ? callbackData : undefined,
      senderIdentity: selected.senderIdentity,
      telegram_user_language_code: callback.from?.language_code,
      telegram_user_id: callback.from?.id,
      telegram_username: callback.from?.username,
      telegram_first_name: callback.from?.first_name,
    },
  };

  return processMessage(envelope);
}

async function shouldRouteTelegramIdentityBeforePromptGuard(params: {
  envelope: InboundMessageEnvelope;
  chatId: number;
}): Promise<boolean> {
  const identity = await bindIdentity(params.envelope);
  const rememberedIdentity = rememberedTelegramIdentityForRoute(params.chatId);
  const route = await resolveCommunicationIdentityRoute({
    envelope: params.envelope,
    identity,
    rememberedIdentity,
  });

  return (
    !route.shouldRunGuestConcierge &&
    Boolean(route.replyText) &&
    (
      route.route === 'unknown_clarify' ||
      route.route === 'role_conflict_guest_question' ||
      route.route === 'object_problem_clarify'
    )
  );
}

export async function processUpdate(
  update: TelegramUpdate,
  options?: { durableReceiptOwned?: boolean },
): Promise<ProcessResult> {
  const callbackResult = await processTelegramCallbackQuery(update, options);
  if (callbackResult) return callbackResult;

  const event = getTelegramUpdateEvent(update);
  const message = event.message;
  if (!message) return { outcome: ProcessOutcome.Ignored, update_id: update.update_id };
  const eventOccurrenceId = telegramEventOccurrenceId(update, message, event.type);
  const inboundKey = telegramInboundIdempotencyKey(update, message, event.type);

  if (!options?.durableReceiptOwned && checkAndMarkKey({
    scope: 'inbound',
    key: inboundKey,
    meta: {
      update_id: update.update_id,
      chat_id: message.chat.id,
      message_id: message.message_id,
      telegram_event_type: event.type,
      telegram_event_occurrence_id: eventOccurrenceId,
    },
  })) {
    console.info('[comm:routing]', {
      path: 'telegram_text',
      outcome: 'duplicate',
      update_id: update.update_id,
      chat_id: message.chat.id,
      message_id: message.message_id,
      telegram_event_type: event.type,
      telegram_event_occurrence_id: eventOccurrenceId,
    });
    auditDuplicate({ chat_id: message.chat.id, update_id: update.update_id });
    auditDecision({
      type: 'ignore',
      chat_id: message.chat.id,
      update_id: update.update_id,
      detail: `duplicate_inbound key=${inboundKey}`,
    });
    return { outcome: ProcessOutcome.Duplicate, update_id: update.update_id, chat_id: message.chat.id };
  }

  console.info('[comm:routing]', {
    path: 'telegram_text',
    update_id: update.update_id,
    chat_id: message.chat.id,
    telegram_event_type: event.type,
    telegram_event_occurrence_id: eventOccurrenceId,
    has_text: Boolean(message.text ?? message.caption),
    has_photo: Boolean(message.photo && message.photo.length > 0),
    has_document: Boolean(message.document),
  });

  const { textHint, refs } = extractAttachments(message);
  const baseText = message.text ?? message.caption ?? '';
  // If message has attachments but no text, synthesise a description so the
  // orchestrator can still classify and create an ops task.
  const messageText = baseText || textHint || '';
  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: (message.from?.id ?? message.chat.id).toString(),
    chatId: message.chat.id.toString(),
    messageText,
    receivedAt: new Date(),
    update_id: update.update_id,
    metadata: {
      ...(refs.length > 0 ? { attachments: refs } : {}),
      telegram_chat_id: message.chat.id.toString(),
      providerMessageId: `${event.type}:${message.message_id}:${eventOccurrenceId}`,
      externalMessageId: `${event.type}:${message.message_id}:${eventOccurrenceId}`,
      inboundIdempotencyKey: inboundKey,
      inboundIdempotencyAlreadyMarked: true,
      telegram_event_type: event.type,
      telegram_event_occurrence_id: eventOccurrenceId,
      telegram_user_language_code: message.from?.language_code,
      telegram_user_id: message.from?.id,
      telegram_username: message.from?.username,
      telegram_first_name: message.from?.first_name,
    },
  };

  const resetIdentityMatch = matchTelegramCommand(messageText, 'reset_identity');
  if (resetIdentityMatch.matched) {
    const result = await processMessage(envelope);
    console.info('[comm:routing]', {
      path: 'telegram_text',
      route: 'telegram_identity_reset_before_prompt_guard',
      outcome: result.outcome,
      update_id: update.update_id,
      chat_id: message.chat.id,
      telegram_event_type: event.type,
      telegram_event_occurrence_id: eventOccurrenceId,
    });
    return result;
  }

  if (
    messageText.trim() &&
    !detectTelegramPromptInjection(messageText).detected &&
    await shouldRouteTelegramIdentityBeforePromptGuard({ envelope, chatId: message.chat.id })
  ) {
    const result = await processMessage(envelope);
    console.info('[comm:routing]', {
      path: 'telegram_text',
      route: 'telegram_identity_clarification_before_prompt_guard',
      outcome: result.outcome,
      update_id: update.update_id,
      chat_id: message.chat.id,
      telegram_event_type: event.type,
      telegram_event_occurrence_id: eventOccurrenceId,
    });
    return result;
  }

  const promptInjectionGuardResult = await handleTelegramPromptInjectionGuard({
    update,
    message,
    eventType: event.type,
    eventOccurrenceId,
    baseText,
  });
  if (promptInjectionGuardResult) {
    console.info('[comm:routing]', {
      path: 'telegram_text',
      route: 'telegram_prompt_injection_guard',
      outcome: promptInjectionGuardResult.outcome,
      update_id: update.update_id,
      chat_id: message.chat.id,
      telegram_event_type: event.type,
      telegram_event_occurrence_id: eventOccurrenceId,
    });
    return promptInjectionGuardResult;
  }

  const guestCanon =
    message.chat?.id && baseText
      ? resolveTelegramGuestIntentCanon(baseText)
      : null;

  if (guestCanon && isNoActionTelegramGuestCanonIntent(guestCanon.intent)) {
    const preEnvelope: InboundMessageEnvelope = {
      channel: 'telegram',
      externalUserId: (message.from?.id ?? message.chat.id).toString(),
      chatId: message.chat.id.toString(),
      messageText: baseText,
      receivedAt: new Date(),
      update_id: update.update_id,
      metadata: {
        telegram_chat_id: message.chat.id.toString(),
        telegram_user_language_code: message.from?.language_code,
        telegram_user_id: message.from?.id,
        telegram_username: message.from?.username,
        telegram_first_name: message.from?.first_name,
      },
    };
    const preIdentity = await bindIdentity(preEnvelope);
    const preRoute = await resolveCommunicationIdentityRoute({ envelope: preEnvelope, identity: preIdentity });
    if (preRoute.shouldRunGuestConcierge) {
    const outboundKey = sha256Base64Url(
      [
        'tg_guest_intent_canon_v1',
        event.type,
        String(message.chat.id),
        String(message.message_id),
        eventOccurrenceId,
        guestCanon.reply,
      ].join('|'),
    );
    if (!checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { update_id: update.update_id, chatId: message.chat.id } })) {
      await replyToTelegram(message.chat.id, guestCanon.reply, {
        handler: `telegram_guest_intent_canon_v1/${guestCanon.intent}`,
        update_id: update.update_id,
      });
    }
    const result = {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: message.chat.id,
      category: MessageCategory.LanguageCheck,
      reply: guestCanon.reply,
    };
    console.info('[comm:routing]', {
      path: 'telegram_text',
      outcome: event.type === 'edited_message' ? 'edited_message_processed' : 'replied',
      update_id: update.update_id,
      chat_id: message.chat.id,
      telegram_event_type: event.type,
      telegram_event_occurrence_id: eventOccurrenceId,
    });
    return result;
    }
  }

  const result = await processMessage(envelope);
  console.info('[comm:routing]', {
    path: 'telegram_text',
    outcome: event.type === 'edited_message' && result.outcome === ProcessOutcome.Replied ? 'edited_message_processed' : result.outcome,
    update_id: update.update_id,
    chat_id: message.chat.id,
    telegram_event_type: event.type,
    telegram_event_occurrence_id: eventOccurrenceId,
  });

  // If there were attachments, append them to the most recently created ops task
  // for this chat so the operator can see what was sent on the leads page.
  if (refs.length > 0) {
    runInBackground(
      { correlationId: String(update.update_id), module: 'orchestrator', taskName: 'appendAttachmentsToLatestTask', triggerId: String(message.chat.id) },
      () => appendAttachmentsToLatestTask(message.chat.id, refs),
    );
  }

  return result;
}

/**
 * Best-effort: find the most recent open ops_task for this chat_id and
 * append attachment_refs so the operator sees them on the leads page.
 */
async function appendAttachmentsToLatestTask(
  chatId: number,
  refs: TelegramAttachmentRef[],
): Promise<void> {
  const { data } = await supabase
    .from('ops_tasks')
    .select('id, attachment_refs')
    .eq('chat_id', chatId)
    .in('task_status', ['open', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return;

  const existing: TelegramAttachmentRef[] = Array.isArray(data.attachment_refs)
    ? (data.attachment_refs as TelegramAttachmentRef[])
    : [];

  await supabase
    .from('ops_tasks')
    .update({
      attachment_refs: [...existing, ...refs],
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.id);
}
