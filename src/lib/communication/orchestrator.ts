import { getChannelAdapter } from './channels';
import { bindIdentity } from './identity-binding';
import { appendTimelineEvent } from './timeline';
import {
  auditDuplicate,
  auditEscalation,
  auditError,
  auditInbound,
  auditLLM,
  auditOutbound,
} from './audit';
import {
  buildIntelligentPrompt,
  classifyMessage,
  deterministicReply,
  SYSTEM_PROMPT,
} from './classifier';
import { checkAndMark } from './idempotency';
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
} from './types';

import { getContext, updateContext } from './memory';
import { mergeAutonomousSessionFromInbound, setAutonomousSessionIdentity } from './conversation-session-store';
import {
  appendSessionMessage,
  buildSessionContextForLLM,
  getOrCreateConversationSession,
  transitionConversationSessionState,
  updateSessionFactsAndSummary,
} from './conversation-session-engine';
import {
  extractStaffClues,
  hasMinimalStaffClues,
  buildStaffClarifyQuestion,
  detectStaffScenario,
} from './staff-bridge';
import { detectIntent } from './intent';
import { createPaymentRequest } from '@/lib/payments/factory';
import { callLLM } from '@/lib/openai';
import { buildCommunicationContext } from './context';
import { evaluateActionSafety } from './action';
import { buildOperatorHandoff } from './handoff';
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

  // Idempotency: drop duplicate update_ids
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

  cp('idempotency.check.start');
  if (checkAndMark(update_id)) {
    cp('idempotency.duplicate.returning');
    auditDuplicate({ chat_id: 0, update_id });
    return { outcome: ProcessOutcome.Duplicate, update_id };
  }
  cp('idempotency.check.done');

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

    cp('classifier.start', { chat_id: chatId });
    const classification = await withAwaitCheckpoint('classifier.await', () => classifyMessage(text), { chat_id: chatId }, 30_000);
    cp('classifier.done', { chat_id: chatId, category: classification.category, lang: classification.lang });
    if (process.env.RU_TELEGRAM_FORCE_RU === '1' && envelope.channel === 'telegram') {
      classification.lang = 'ru';
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

    let replyText: string;
    let llmSucceeded = false;
    let usedPath: 'deterministic' | 'llm' = 'deterministic';
    let escalation: ReturnType<typeof createEscalationEvent> | undefined = undefined;
    const adapter = getChannelAdapter(envelope.channel);
    cp('channel.adapter.resolved', { chat_id: chatId });

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

    if (classification.category === 'start') {
      cp('branch.start_message', { chat_id: chatId });
      replyText = adapter.formatResponse(deterministicReply(classification), commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
    } else if (staffNeedsContext) {
      cp('branch.staff_needs_context', { chat_id: chatId });
      const scenario = detectStaffScenario(intentResult.intent);
      replyText = buildStaffClarifyQuestion(scenario);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'awaiting_input', 'staff_clarify_question');
    } else if (ctx.incident) {
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
    } else if (!safety.safe && safety.action === 'escalate_to_operator') {
      cp('branch.policy_escalation.start', { chat_id: chatId });
      const handoff = buildOperatorHandoff(commContext, text, safety.action, safety.reason || 'Escalated by policy');
      escalation = createEscalationEvent({
        reason: safety.escalationReason || EscalationReason.RequiresOperator,
        chat_id: chatId,
        update_id,
        classification,
        summary: handoff.reasonForEscalation,
      });
      auditEscalation({ chat_id: chatId, update_id, detail: escalation.summary });
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
          ? 'Не могу безопасно ответить автоматически. Передал(а) запрос в операционный поток — вернёмся с ответом.'
          : "I'm not entirely sure how to answer that. I have flagged this for our team to review!";
      const escalationMsg = templates?.escalation_contact_text
        ? `${escalationBase} ${templates.escalation_contact_text}`
        : escalationBase;
      replyText = adapter.formatResponse(escalationMsg, commContext as unknown as Record<string, unknown>);
      usedPath = 'deterministic';
      cp('branch.policy_escalation.done', { chat_id: chatId });
      convSession = transitionConversationSessionState(convSession, 'escalated', 'policy_escalation');
    } else if (safety.action === 'ask_clarifying_question') {
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
    } else if (intentResult.intent === IntentCategory.CheckInInfo && !templates?.pre_checkin_template) {
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
    } else if (safety.action === 'provide_check_in_instructions' && templates?.pre_checkin_template) {
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
    } else if (safety.action === 'provide_checkout_instructions' && templates?.checkout_template) {
      cp('branch.provide_checkout_instructions', { chat_id: chatId });
      replyText = adapter.formatResponse(templates.checkout_template, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      usedPath = 'deterministic';
      convSession = transitionConversationSessionState(convSession, 'resolved', 'checkout_instructions_provided');
    } else if (safety.action === 'trigger_payment_request') {
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
    } else {
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
    const sent = isDryRun
      ? true
      : await withAwaitCheckpoint(
          'outbound.dispatch.await',
          () => adapter.sendMessage(targetId, replyText),
          { chat_id: chatId, target_id: targetId, channel: envelope.channel },
          Number(process.env.TELEGRAM_HTTP_TIMEOUT_MS ?? 10000) + 5_000,
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

  const { textHint, refs } = extractAttachments(message);
  const baseText = message.text ?? message.caption ?? '';
  // If message has attachments but no text, synthesise a description so the
  // orchestrator can still classify and create an ops task.
  const messageText = baseText || textHint || '';

  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: message.chat.id.toString(),
    chatId: message.chat.id.toString(),
    messageText,
    receivedAt: new Date(),
    update_id: update.update_id,
    metadata: refs.length > 0 ? { attachments: refs } : undefined,
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
