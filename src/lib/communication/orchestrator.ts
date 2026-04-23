import { getChannelAdapter } from './channels';
import { bindIdentity } from './identity-binding';
import { appendTimelineEvent } from './timeline';
import {
  auditDuplicate,
  auditDecision,
  auditDuplicateOutboundPrevented,
  auditEscalation,
  auditError,
  auditInbound,
  auditLLM,
  auditOutbound,
  auditRetryAttempt,
  auditFailureEnqueued,
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
  InboundMessageEnvelope,
  IntentCategory,
  MessageCategory,
} from './types';

import { getContext, updateContext } from './memory';
import {
  mergeAutonomousSessionFromInbound,
  resetAutonomousSessionSnapshot,
  setAutonomousSessionIdentity,
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
import {
  SessionStatus,
  setPaymentExpiry,
  transitionSessionStatus,
} from './session-status';
import { getPropertyTemplates } from './templates';
import { createOpsTask, OpsTaskType, OpsTaskPriority } from '@/lib/ops/tasks';
import { evaluateCheckinReadiness } from '@/lib/ops/checkin-gate';
import { supabase } from '@/lib/supabase';
import { runInBackground } from './background';
import { retry, sha256Base64Url } from './reliability';
import { writeFailure } from './failure-store';
import { shouldEscalateByRules } from './escalation-policy';
import { replyToTelegram } from '@/lib/telegram';
import { resolveTelegramTextMeta, type TelegramTextMetaKind } from './telegram-text-meta-handler';
import { processTelegramOperationalIntakeWithSessionMemory } from './telegram-session-memory';
import { linkReservationOrPropertyDeterministicV1 } from './reservation-property-linking';
import { composeTelegramOperationalReply } from './telegram-reply-composer';

function pipelineDebugEnabled(envelope?: InboundMessageEnvelope): boolean {
  if (process.env.COMM_PIPELINE_DEBUG === '1') return true;
  if (process.env.RU_TELEGRAM_DEBUG === '1' && envelope?.channel === 'telegram') return true;
  if (process.env.TELEGRAM_DEBUG === '1' && envelope?.channel === 'telegram') return true;
  return false;
}

function stableNumericChatId(envelope: InboundMessageEnvelope, guestId?: string): number {
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

function logSessionResetOrCaseReopen(params: {
  previous_status: string;
  new_status: string;
  reason: string;
  update_id: number;
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'session_reset_or_case_reopen',
        previous_status: params.previous_status,
        new_status: params.new_status,
        reason: params.reason,
        update_id: params.update_id,
      }),
    );
  } catch {
    // never throw from logging
  }
}

export async function processMessage(envelope: InboundMessageEnvelope): Promise<ProcessResult> {
  const update_id = envelope.update_id ?? Date.now();
  const corrId    = String(update_id);
  const text = envelope.messageText ?? '';
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
  const inboundStableKey =
    providerMessageId || externalMessageId
      ? `${envelope.channel}:${actorKey}:${providerMessageId || externalMessageId}`
      : `${envelope.channel}:${actorKey}:${String(update_id)}:${inboundFallback}`;

  cp('idempotency.inbound.check.start', { inbound_key: inboundStableKey });
  if (checkAndMarkKey({ scope: 'inbound', key: inboundStableKey, meta: { update_id } })) {
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
  cp('idempotency.inbound.check.done', { inbound_key: inboundStableKey });

  // Resolve identity + bind to business entities (reservation/property/lead/unknown)
  const identity = await withAwaitCheckpoint('identity.resolve', () => bindIdentity(envelope), {
    has_chat_id: Boolean(envelope.chatId),
    has_external_user_id: Boolean(envelope.externalUserId),
  });

  const chatId = stableNumericChatId(envelope, identity.guestId);
  cp('channel.resolved', { chat_id: chatId });
  cp('text.extracted', { chat_id: chatId, text_len: text.length });

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

  // Session safety: if already escalated, avoid "normal automation" by default.
  // We still allow limited deterministic-only tooling for acceptance testing.
  const allowEscalatedAutosend = process.env.COMM_ALLOW_AUTOSEND_WHEN_ESCALATED === '1';
  const hasActiveReviewItem = Boolean(getActiveEscalationReviewIdForSession(convSession.sessionId));
  const blockNormalAutomationBecauseEscalated =
    (convSession.state === 'escalated' || hasActiveReviewItem) && !allowEscalatedAutosend;

  // Acceptance/admin escape hatch: /reset_session (guarded by allowlist + non-prod by default).
  const resetCmd = text.trim().toLowerCase() === '/reset_session';
  if (resetCmd && envelope.channel === 'telegram') {
    const allowlist = parseAllowlistedChatIds(process.env.COMM_TELEGRAM_RESET_ALLOWLIST);
    const chatIdForAllow = stableNumericChatId(envelope, identity.guestId);
    const nonProd = (process.env.VERCEL_ENV ?? process.env.NODE_ENV) !== 'production';
    const allowed = allowlist.has(chatIdForAllow) && (nonProd || process.env.COMM_TELEGRAM_RESET_ALLOWLIST_PROD === '1');

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
      });

      const adapter = getChannelAdapter(envelope.channel);
      const sent = await adapter.sendMessage(String(chatIdForAllow), 'Session reset for acceptance testing.', {
        reply_handler: 'acceptance_reset',
        update_id,
      });
      if (!sent) return { outcome: ProcessOutcome.Error, update_id, chat_id: chatIdForAllow };
      return { outcome: ProcessOutcome.Replied, update_id, chat_id: chatIdForAllow, reply: 'Session reset for acceptance testing.' };
    }
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
        dry_run: process.env.TELEGRAM_DRY_RUN === '1',
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
    const intentResult = await withAwaitCheckpoint('intent.await', () => detectIntent(text), { chat_id: chatId }, 30_000);
    cp('intent.done', { chat_id: chatId, intent: intentResult.intent, confidence: intentResult.confidence });
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
    const ctx = getContext(chatId);
    cp('memory/context.load.done', { chat_id: chatId });
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

    let replyText = '';
    let llmSucceeded = false;
    let usedPath:
      | 'deterministic'
      | 'llm'
      | 'telegram_meta_deterministic'
      | 'telegram_operational_intake'
      | 'reply_composer' = 'deterministic';
    let escalation: ReturnType<typeof createEscalationEvent> | undefined = undefined;
    /** When set, pre-rule “low confidence / identity” escalation must not clobber this turn. */
    let telegramOperationalIntakeConsumed = false;
    const adapter = getChannelAdapter(envelope.channel);
    cp('channel.adapter.resolved', { chat_id: chatId });

    const escalationSafetyGate = blockNormalAutomationBecauseEscalated;

    const persistEscalationReview = (params: {
      reason: string;
      escalationSummary: string;
      confidence?: number;
      suggestedReply?: string;
      detail?: string;
    source?: Record<string, unknown>;
    }) => {
      const targetIdRaw = envelope.chatId || envelope.email || envelope.phoneNumber || identity.guestId;
      if (!targetIdRaw) return;
      createOrUpdateEscalationReview({
        sessionId: convSession.sessionId,
        channel: envelope.channel,
        targetId: String(targetIdRaw),
        actorId: convSession.actorId,
        role: identity.role,
        reservationId: commContext?.reservation?.reservationId ?? identity.reservationId,
        propertyId: commContext?.reservation?.propertyId ?? identity.propertyId,
        leadId: identity.leadId,
        escalationReason: params.reason,
        confidence: params.confidence,
      source: params.source,
        latestMessages: convSession.memory.lastMessages,
        suggestedReply: params.suggestedReply,
        detail: params.detail ?? params.escalationSummary,
      });
    };

    const voiceMeta = (envelope.metadata as any)?.voice as Record<string, unknown> | undefined;
    const voiceSourceBase = voiceMeta
      ? {
          source: 'voice',
          voiceChannel: envelope.channel,
          voiceSessionId: String((voiceMeta as any).voiceSessionId ?? ''),
          voiceTurnId: String((voiceMeta as any).voiceTurnId ?? ''),
          transcript: String(envelope.messageText ?? ''),
          transcriptConfidence: (voiceMeta as any).transcriptConfidence ?? undefined,
          audioRef: (voiceMeta as any).audioRef ?? undefined,
          providerMessageId: (voiceMeta as any).providerMessageId ?? (envelope.metadata as any)?.providerMessageId ?? undefined,
          providerMediaId: (voiceMeta as any).providerMediaId ?? undefined,
          language: (voiceMeta as any).language ?? undefined,
        }
      : null;

    // Deterministic Telegram operational intake (guest relay) — before scenario / pre-rule escalation / LLM.
    if (!replyText && envelope.channel === 'telegram' && text.trim()) {
      const opIntakeResult = processTelegramOperationalIntakeWithSessionMemory({
        chatId,
        channel: envelope.channel,
        text,
        surfaceLang: classification.lang === 'ru' ? 'ru' : 'en',
        update_id,
      });
      if (opIntakeResult.handled) {
        const opIntake = opIntakeResult.hit;
        telegramOperationalIntakeConsumed = true;
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
          const composed = composeTelegramOperationalReply({
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
          });
          replyText = adapter.formatResponse(composed.text, commContext as unknown as Record<string, unknown>);
          llmSucceeded = true;
          usedPath = 'reply_composer';
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
              const { task_id } = await createOpsTask({
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
          ? 'Передал(а) запрос оператору — вернёмся с ответом.'
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
          ? 'Понял(а) запрос на чек/квитанцию. Если хотите получить документ на email — пришлите email, и укажите дату заезда/имя гостя (если ещё не указано).'
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
      classification.category !== 'start' &&
      classification.category !== 'greeting'
    ) {
      const preEsc = shouldEscalateByRules({
        text,
        classification,
        confidence: intentResult?.confidence,
        identity,
        reservationResolutionStatus: commContext?.reservation?.status,
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
          ? 'Понял(а). Передал(а) запрос команде — вернёмся с ответом.'
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
          const { task_id } = await createOpsTask({
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
          ? 'Понял(а). Передал(а) запрос команде — вернёмся с ответом.'
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
            const { error } = await createOpsTask({
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
    } else if (!replyText && !escalationSafetyGate) {
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
          ? 'Запрос уже передан оператору. Мы вернёмся с ответом.'
          : 'This conversation is already escalated to a human operator. We will follow up shortly.';
      replyText = adapter.formatResponse(base, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
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
          const { task_id, error } = await createOpsTask({
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
          const { task_id, error } = await createOpsTask({
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

    // Send the response abstractly
    const targetIdRaw = envelope.chatId || envelope.email || envelope.phoneNumber || identity.guestId;
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

    const isDryRun = process.env.TELEGRAM_DRY_RUN === '1' && envelope.channel === 'telegram';
    if (pipeDebug) {
      console.log('[comm:pipeline] outbound.dispatch', {
        corr_id: corrId,
        update_id,
        chat_id: chatId,
        channel: envelope.channel,
        target_id: String(targetId),
        dry_run: isDryRun,
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
                fn: () =>
                  adapter.sendMessage(
                    targetId,
                    replyText,
                    envelope.channel === 'telegram'
                      ? {
                          reply_handler: `orchestrator:${usedPath}${
                            telegramMetaRouteKind ? `:telegram_meta=${telegramMetaRouteKind}` : ''
                          }:category=${classification.category}`,
                          update_id,
                        }
                      : undefined,
                  ),
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

export async function processUpdate(update: TelegramUpdate): Promise<ProcessResult> {
  const message = update.message ?? update.edited_message;
  if (!message) return { outcome: ProcessOutcome.Ignored, update_id: update.update_id };

  console.info('[comm:routing]', {
    path: 'telegram_text',
    update_id: update.update_id,
    chat_id: message.chat.id,
    has_text: Boolean(message.text ?? message.caption),
    has_photo: Boolean(message.photo && message.photo.length > 0),
    has_document: Boolean(message.document),
  });

  const { textHint, refs } = extractAttachments(message);
  const baseText = message.text ?? message.caption ?? '';
  // If message has attachments but no text, synthesise a description so the
  // orchestrator can still classify and create an ops task.
  const messageText = baseText || textHint || '';

  // Deterministic Telegram-only social/meta lines (must not touch LLM / scenario engine).
  const meta =
    message.chat?.id && baseText
      ? resolveTelegramTextMeta({
          baseText,
          telegramLangCode: message.from?.language_code,
        })
      : null;
  if (meta) {
    const preview = baseText.length > 120 ? `${baseText.slice(0, 120)}…` : baseText;
    console.info('[comm:routing]', {
      path: 'telegram_text',
      route: 'telegram_text_meta_short',
      handler: `${meta.handler}/${meta.kind}`,
      update_id: update.update_id,
      chat_id: message.chat.id,
      text_preview: preview,
    });
    const outboundKey = sha256Base64Url(
      [
        'tg_text_meta',
        String(message.chat.id),
        String(message.message_id),
        meta.reply,
      ].join('|'),
    );
    if (!checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { update_id: update.update_id, chatId: message.chat.id } })) {
      await replyToTelegram(message.chat.id, meta.reply, {
        handler: `${meta.handler}/${meta.kind}`,
        update_id: update.update_id,
      });
    }
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: message.chat.id,
      category: meta.category,
      reply: meta.reply,
    };
  }

  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: message.chat.id.toString(),
    chatId: message.chat.id.toString(),
    messageText,
    receivedAt: new Date(),
    update_id: update.update_id,
    metadata: {
      ...(refs.length > 0 ? { attachments: refs } : {}),
      providerMessageId: String(message.message_id),
      externalMessageId: String(message.message_id),
      telegram_user_language_code: message.from?.language_code,
    },
  };

  const result = await processMessage(envelope);

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
