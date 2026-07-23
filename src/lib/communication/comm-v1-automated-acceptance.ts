import type { TelegramUpdate } from './types';
import {
  TELEGRAM_IDENTITY_CALLBACKS,
  UNKNOWN_IDENTITY_CLARIFY_RU,
  UNKNOWN_IDENTITY_INLINE_KEYBOARD,
} from './communication-identity-routing';

export const COMM_V1_ACCEPTANCE_CYCLE = 'comm-v1-automated-acceptance-v1';

export const COMM_V1_ACCEPTANCE_CHAT_PRIMARY = 9_770_001;
export const COMM_V1_ACCEPTANCE_CHAT_CB_LEAD = 9_770_002;
export const COMM_V1_ACCEPTANCE_CHAT_CB_GUEST = 9_770_003;
export const COMM_V1_ACCEPTANCE_CHAT_CB_SUPPORT_A = 9_770_004;
export const COMM_V1_ACCEPTANCE_CHAT_CB_SUPPORT_B = 9_770_005;
export const COMM_V1_ACCEPTANCE_CHAT_VOICE = 9_770_006;

export const COMM_V1_FIRST_MESSAGE_RU = 'Привет, во сколько заезд?';
export const COMM_V1_OPERATOR_REQUEST_RU = 'Мне срочно нужен оператор';
export const COMM_V1_OPERATOR_REPLY_RU = 'Оператор на связи, минуту.';

export type CommV1CheckStatus = 'PASS' | 'FAIL';

export type CommV1AcceptanceResult = {
  ok: boolean;
  cycle: string;
  checks: Record<string, CommV1CheckStatus>;
  failures: string[];
  evidence: Record<string, unknown>;
};

export type CommV1SendMessageCall = {
  chatId: string | number;
  text: string;
  metadata?: Record<string, unknown>;
};

export type CommV1AnswerCallbackCall = {
  callbackQueryId: string;
  text?: string;
};

export type CommV1AcceptanceDeps = {
  processUpdate: (update: TelegramUpdate) => Promise<{ outcome: string; reply?: string; chat_id?: number }>;
  processTelegramVoiceUpdate: (
    update: TelegramUpdate,
  ) => Promise<{ outcome: string; reason?: string; chat_id?: number }>;
  loadAutonomousSession: (chatId: number) => {
    pending_identity_message?: string | null;
    identity_role?: string | null;
  } | null;
  listEscalationReviews: (filter?: { status?: string }) => Array<{ reviewId: string; sessionId: string; targetId?: string }>;
  getActiveEscalationReviewIdForSession: (sessionId: string) => string | null;
  canAiReply: (sessionId: string) => boolean;
  lockSessionForOperator: (input: { reviewId: string; operatorId: string }) => unknown;
  releaseSessionToAi: (input: { sessionId: string; operatorId: string; reason: string }) => unknown;
  sendOperatorReply: (input: {
    reviewId: string;
    operatorId: string;
    replyText: string;
  }) => Promise<{ ok: boolean }>;
  getSendMessageCalls: () => CommV1SendMessageCall[];
  getAnswerCallbackQueryCalls: () => CommV1AnswerCallbackCall[];
  resetEphemeralMocks: () => void;
};

const MOJIBAKE_PATTERN = /(?:Рџ|РЎ|Р Р|СЂ|Р°|РІ)/;
const INVENTED_STREET_PATTERN =
  /\b(?:ул\.?|улиц[аеу]|просп\.?|проспект|пер\.?|переулок|наб\.?|набережн)\s+[А-ЯA-ZЁ][а-яa-zё]+(?:\s+\d{1,4})?/i;
const INVENTED_DOOR_CODE_PATTERN = /\b(?:код\s*(?:двер|домофон|подъезд)|домофон\s*[:#]?\s*\d{3,8}|код\s*[:#]?\s*\d{3,8})/i;
const INVENTED_EXACT_CHECKIN_TIME_PATTERN =
  /\b(?:заезд\s*(?:в|с)\s*)?\d{1,2}[:.]\d{2}\b|\b(?:check-?in\s*(?:at|from)\s*)\d{1,2}[:.]\d{2}\b/i;

export function collectInlineCallbackData(markup: unknown): string[] {
  if (!markup || typeof markup !== 'object') return [];
  const keyboard = (markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> }).inline_keyboard;
  if (!Array.isArray(keyboard)) return [];
  return keyboard.flatMap((row) => row.map((btn) => String(btn.callback_data ?? ''))).filter(Boolean);
}

export function assertIdentityClarifyReply(reply: string | undefined): string | null {
  if (reply !== UNKNOWN_IDENTITY_CLARIFY_RU) {
    return `expected UNKNOWN_IDENTITY_CLARIFY_RU, got: ${String(reply ?? '').slice(0, 120)}`;
  }
  return null;
}

export function assertIdentityClarifyKeyboard(markup: unknown): string | null {
  const callbacks = collectInlineCallbackData(markup);
  const expected = [
    TELEGRAM_IDENTITY_CALLBACKS.lead,
    TELEGRAM_IDENTITY_CALLBACKS.guest,
    TELEGRAM_IDENTITY_CALLBACKS.supportProblem,
    TELEGRAM_IDENTITY_CALLBACKS.supportProblem,
  ];
  if (callbacks.length !== 4) {
    return `expected 4 inline callbacks, got ${callbacks.length}: ${callbacks.join(', ')}`;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (callbacks[i] !== expected[i]) {
      return `callback[${i}] expected ${expected[i]}, got ${callbacks[i]}`;
    }
  }
  const keyboardJson = JSON.stringify(UNKNOWN_IDENTITY_INLINE_KEYBOARD);
  const actualJson = JSON.stringify({ inline_keyboard: (markup as { inline_keyboard?: unknown }).inline_keyboard });
  if (keyboardJson !== actualJson) {
    return 'reply_markup does not match UNKNOWN_IDENTITY_INLINE_KEYBOARD export';
  }
  return null;
}

export function assertNoInventedGuestFacts(reply: string | undefined): string | null {
  const text = String(reply ?? '');
  if (!text) return 'empty guest reply';
  if (INVENTED_STREET_PATTERN.test(text)) return `reply invents street address: ${text.slice(0, 160)}`;
  if (INVENTED_DOOR_CODE_PATTERN.test(text)) return `reply invents door code: ${text.slice(0, 160)}`;
  if (INVENTED_EXACT_CHECKIN_TIME_PATTERN.test(text)) {
    return `reply invents exact check-in time: ${text.slice(0, 160)}`;
  }
  return null;
}

export function assertUtf8RuPreserved(text: string | undefined): string | null {
  const value = String(text ?? '');
  if (!/[а-яА-ЯЁё]/.test(value)) return `expected Cyrillic in reply, got: ${value.slice(0, 120)}`;
  if (MOJIBAKE_PATTERN.test(value)) return `mojibake detected in reply: ${value.slice(0, 120)}`;
  return null;
}

export function buildCommV1TextUpdate(params: {
  chatId: number;
  text: string;
  updateId: number;
  messageId?: number;
  userId?: number;
}): TelegramUpdate {
  return {
    update_id: params.updateId,
    message: {
      message_id: params.messageId ?? params.updateId,
      chat: { id: params.chatId },
      from: {
        id: params.userId ?? params.chatId,
        language_code: 'ru',
        username: `comm_v1_${params.chatId}`,
      },
      text: params.text,
    },
  };
}

export function buildCommV1CallbackUpdate(params: {
  chatId: number;
  callbackData: string;
  updateId: number;
  callbackId: string;
  messageId?: number;
  userId?: number;
}): TelegramUpdate {
  return {
    update_id: params.updateId,
    callback_query: {
      id: params.callbackId,
      from: {
        id: params.userId ?? params.chatId,
        language_code: 'ru',
        username: `comm_v1_cb_${params.chatId}`,
      },
      message: {
        message_id: params.messageId ?? params.updateId,
        chat: { id: params.chatId },
        from: { id: 100, is_bot: true, first_name: 'ASI Support' },
        text: UNKNOWN_IDENTITY_CLARIFY_RU,
      },
      data: params.callbackData,
    },
  };
}

export function buildCommV1VoiceUpdate(params: {
  chatId: number;
  updateId: number;
  messageId?: number;
  userId?: number;
}): TelegramUpdate {
  return {
    update_id: params.updateId,
    message: {
      message_id: params.messageId ?? params.updateId,
      chat: { id: params.chatId },
      from: {
        id: params.userId ?? params.chatId,
        language_code: 'ru',
        username: `comm_v1_voice_${params.chatId}`,
      },
      voice: {
        file_id: `voice_${params.updateId}`,
        duration: 3,
        mime_type: 'audio/ogg',
      },
    } as TelegramUpdate['message'],
  };
}

function recordCheck(
  checks: Record<string, CommV1CheckStatus>,
  failures: string[],
  name: string,
  error: string | null,
): void {
  if (error) {
    checks[name] = 'FAIL';
    failures.push(`${name}: ${error}`);
  } else {
    checks[name] = 'PASS';
  }
}

function latestReplyMarkup(calls: CommV1SendMessageCall[]): unknown {
  return calls.at(-1)?.metadata?.reply_markup;
}

function allReplyTexts(calls: CommV1SendMessageCall[]): string[] {
  return calls.map((call) => call.text).filter(Boolean);
}

export async function runCommV1AutomatedAcceptance(
  deps: CommV1AcceptanceDeps,
): Promise<CommV1AcceptanceResult> {
  const checks: Record<string, CommV1CheckStatus> = {};
  const failures: string[] = [];
  const evidence: Record<string, unknown> = {};

  let updateSeq = 97_700_100;
  const nextUpdateId = () => {
    updateSeq += 1;
    return updateSeq;
  };

  deps.resetEphemeralMocks();

  // ── 1. First text → identity clarify ─────────────────────────────────────
  const firstUpdateId = nextUpdateId();
  const firstResult = await deps.processUpdate(
    buildCommV1TextUpdate({
      chatId: COMM_V1_ACCEPTANCE_CHAT_PRIMARY,
      text: COMM_V1_FIRST_MESSAGE_RU,
      updateId: firstUpdateId,
    }),
  );
  evidence.first_reply = firstResult.reply;
  recordCheck(checks, failures, 'identity_clarify_text', assertIdentityClarifyReply(firstResult.reply));
  recordCheck(
    checks,
    failures,
    'identity_clarify_keyboard',
    assertIdentityClarifyKeyboard(latestReplyMarkup(deps.getSendMessageCalls())),
  );

  const sessionAfterFirst = deps.loadAutonomousSession(COMM_V1_ACCEPTANCE_CHAT_PRIMARY);
  evidence.pending_identity_message = sessionAfterFirst?.pending_identity_message ?? null;
  recordCheck(
    checks,
    failures,
    'identity_context_saved',
    sessionAfterFirst?.pending_identity_message === COMM_V1_FIRST_MESSAGE_RU
      ? null
      : `expected pending_identity_message=${COMM_V1_FIRST_MESSAGE_RU}, got ${String(sessionAfterFirst?.pending_identity_message)}`,
  );

  // ── 2. Four inline callbacks → answerCallbackQuery each ──────────────────
  const callbackCases: Array<{ chatId: number; data: string; label: string; callbackId: string }> = [
    {
      chatId: COMM_V1_ACCEPTANCE_CHAT_CB_LEAD,
      data: TELEGRAM_IDENTITY_CALLBACKS.lead,
      label: 'identity_lead',
      callbackId: 'comm-v1-cb-lead',
    },
    {
      chatId: COMM_V1_ACCEPTANCE_CHAT_CB_GUEST,
      data: TELEGRAM_IDENTITY_CALLBACKS.guest,
      label: 'identity_guest',
      callbackId: 'comm-v1-cb-guest',
    },
    {
      chatId: COMM_V1_ACCEPTANCE_CHAT_CB_SUPPORT_A,
      data: TELEGRAM_IDENTITY_CALLBACKS.supportProblem,
      label: 'identity_support_a',
      callbackId: 'comm-v1-cb-support-a',
    },
    {
      chatId: COMM_V1_ACCEPTANCE_CHAT_CB_SUPPORT_B,
      data: TELEGRAM_IDENTITY_CALLBACKS.supportProblem,
      label: 'identity_support_b',
      callbackId: 'comm-v1-cb-support-b',
    },
  ];

  const answeredCallbackIds: string[] = [];
  for (const cb of callbackCases) {
    deps.resetEphemeralMocks();
    await deps.processUpdate(
      buildCommV1CallbackUpdate({
        chatId: cb.chatId,
        callbackData: cb.data,
        updateId: nextUpdateId(),
        callbackId: cb.callbackId,
      }),
    );
    const answered = deps.getAnswerCallbackQueryCalls().some((call) => call.callbackQueryId === cb.callbackId);
    if (answered) answeredCallbackIds.push(cb.callbackId);
    recordCheck(
      checks,
      failures,
      `callback_answered_${cb.label}`,
      answered ? null : `answerTelegramCallbackQuery not called for ${cb.callbackId}`,
    );
  }
  evidence.answered_callback_ids = answeredCallbackIds;

  recordCheck(
    checks,
    failures,
    'all_four_callbacks_answered',
    answeredCallbackIds.length === 4 ? null : `answered ${answeredCallbackIds.length}/4 callback queries`,
  );

  // ── 3. Guest path on primary chat (pending replay) ───────────────────────
  deps.resetEphemeralMocks();
  const guestSelectUpdateId = nextUpdateId();
  const guestResult = await deps.processUpdate(
    buildCommV1CallbackUpdate({
      chatId: COMM_V1_ACCEPTANCE_CHAT_PRIMARY,
      callbackData: TELEGRAM_IDENTITY_CALLBACKS.guest,
      updateId: guestSelectUpdateId,
      callbackId: 'comm-v1-primary-guest',
    }),
  );
  evidence.guest_reply = guestResult.reply;
  const guestSession = deps.loadAutonomousSession(COMM_V1_ACCEPTANCE_CHAT_PRIMARY);
  recordCheck(
    checks,
    failures,
    'identity_guest_selected',
    guestSession?.identity_role === 'guest' ? null : `identity_role=${String(guestSession?.identity_role)}`,
  );
  recordCheck(
    checks,
    failures,
    'identity_guest_stay_question_path',
    guestResult.reply && /гост|заезд|брон|объект/i.test(guestResult.reply)
      ? null
      : `unexpected guest path reply: ${String(guestResult.reply).slice(0, 160)}`,
  );
  recordCheck(checks, failures, 'identity_guest_no_invented_facts', assertNoInventedGuestFacts(guestResult.reply));
  recordCheck(
    checks,
    failures,
    'identity_guest_pending_cleared',
    guestSession?.pending_identity_message == null
      ? null
      : `pending_identity_message still set: ${String(guestSession?.pending_identity_message)}`,
  );

  // ── 4. Operator request → one escalation + AI lock ───────────────────────
  deps.resetEphemeralMocks();
  const operatorUpdateId = nextUpdateId();
  const escalationsBeforeOp = deps.listEscalationReviews().length;
  const operatorResult = await deps.processUpdate(
    buildCommV1TextUpdate({
      chatId: COMM_V1_ACCEPTANCE_CHAT_PRIMARY,
      text: COMM_V1_OPERATOR_REQUEST_RU,
      updateId: operatorUpdateId,
    }),
  );
  evidence.operator_reply = operatorResult.reply;
  const escalationsAfterOp = deps.listEscalationReviews();
  const newEscalations = escalationsAfterOp.length - escalationsBeforeOp;
  evidence.escalations_after_operator_request = escalationsAfterOp.length;
  evidence.operator_request_new_escalations = newEscalations;

  const primaryTargetId = String(COMM_V1_ACCEPTANCE_CHAT_PRIMARY);
  const reviewsForPrimaryChat = escalationsAfterOp.filter(
    (review) => review.targetId === primaryTargetId || review.sessionId.includes(primaryTargetId),
  );
  evidence.reviews_for_primary_chat = reviewsForPrimaryChat.length;

  const activeReview =
    reviewsForPrimaryChat.at(-1) ??
    escalationsAfterOp.find((review) => review.targetId === primaryTargetId) ??
    escalationsAfterOp.at(-1) ??
    null;
  evidence.active_review_id = activeReview?.reviewId ?? null;
  evidence.active_session_id = activeReview?.sessionId ?? null;
  const sessionId = activeReview?.sessionId ?? '';
  const activeReviewIdForSession = sessionId ? deps.getActiveEscalationReviewIdForSession(sessionId) : null;
  evidence.active_review_id_for_session = activeReviewIdForSession;
  recordCheck(
    checks,
    failures,
    'operator_request_single_escalation',
    activeReviewIdForSession
      ? newEscalations <= 1
        ? null
        : `expected at most one new escalation, got +${newEscalations}`
      : 'no active escalation review after operator request',
  );
  recordCheck(
    checks,
    failures,
    'operator_request_ai_lock',
    sessionId && !deps.canAiReply(sessionId)
      ? null
      : `expected canAiReply=false for session ${sessionId || '(missing)'}`,
  );

  // ── 5. Operator reply + release → AI unlock ─────────────────────────────
  if (activeReview?.reviewId && sessionId) {
    deps.lockSessionForOperator({ reviewId: activeReview.reviewId, operatorId: 'comm_v1_acceptance_op' });
    recordCheck(
      checks,
      failures,
      'operator_lock_ai_blocked',
      deps.canAiReply(sessionId) ? 'canAiReply still true after lockSessionForOperator' : null,
    );

    const operatorSend = await deps.sendOperatorReply({
      reviewId: activeReview.reviewId,
      operatorId: 'comm_v1_acceptance_op',
      replyText: COMM_V1_OPERATOR_REPLY_RU,
    });
    recordCheck(
      checks,
      failures,
      'operator_reply_sent',
      operatorSend.ok ? null : 'sendOperatorReply returned ok=false',
    );

    deps.releaseSessionToAi({
      sessionId,
      operatorId: 'comm_v1_acceptance_op',
      reason: 'comm_v1_acceptance_resolved',
    });
    recordCheck(
      checks,
      failures,
      'operator_release_ai_unlock',
      deps.canAiReply(sessionId) ? null : 'canAiReply still false after releaseSessionToAi',
    );
  } else {
    recordCheck(checks, failures, 'operator_lock_ai_blocked', 'missing active review for operator handoff');
    recordCheck(checks, failures, 'operator_reply_sent', 'missing active review for operator handoff');
    recordCheck(checks, failures, 'operator_release_ai_unlock', 'missing active review for operator handoff');
  }

  // ── 6. Duplicate text update → idempotent ────────────────────────────────
  deps.resetEphemeralMocks();
  const escalationsBeforeDupText = deps.listEscalationReviews().length;
  const dupTextResult = await deps.processUpdate(
    buildCommV1TextUpdate({
      chatId: COMM_V1_ACCEPTANCE_CHAT_PRIMARY,
      text: COMM_V1_OPERATOR_REQUEST_RU,
      updateId: operatorUpdateId,
    }),
  );
  evidence.duplicate_text_outcome = dupTextResult.outcome;
  recordCheck(
    checks,
    failures,
    'duplicate_text_idempotent',
    dupTextResult.outcome === 'duplicate' ? null : `expected outcome=duplicate, got ${dupTextResult.outcome}`,
  );
  recordCheck(
    checks,
    failures,
    'duplicate_text_no_extra_escalation',
    deps.listEscalationReviews().length === escalationsBeforeDupText
      ? null
      : `escalation count changed on duplicate text (${escalationsBeforeDupText} → ${deps.listEscalationReviews().length})`,
  );

  // ── 7. Duplicate callback → idempotent ───────────────────────────────────
  deps.resetEphemeralMocks();
  const dupCallbackResult = await deps.processUpdate(
    buildCommV1CallbackUpdate({
      chatId: COMM_V1_ACCEPTANCE_CHAT_PRIMARY,
      callbackData: TELEGRAM_IDENTITY_CALLBACKS.guest,
      updateId: guestSelectUpdateId,
      callbackId: 'comm-v1-primary-guest',
    }),
  );
  evidence.duplicate_callback_outcome = dupCallbackResult.outcome;
  recordCheck(
    checks,
    failures,
    'duplicate_callback_idempotent',
    dupCallbackResult.outcome === 'duplicate' ? null : `expected outcome=duplicate, got ${dupCallbackResult.outcome}`,
  );

  // ── 8. Recovery continuity (stores survive; ephemeral mocks cleared) ───
  const sessionBeforeRecovery = deps.loadAutonomousSession(COMM_V1_ACCEPTANCE_CHAT_PRIMARY);
  evidence.identity_before_recovery = sessionBeforeRecovery?.identity_role ?? null;
  deps.resetEphemeralMocks();
  const recoveryUpdateId = nextUpdateId();
  const recoveryResult = await deps.processUpdate(
    buildCommV1TextUpdate({
      chatId: COMM_V1_ACCEPTANCE_CHAT_PRIMARY,
      text: 'Спасибо, жду ответа',
      updateId: recoveryUpdateId,
    }),
  );
  evidence.recovery_reply = recoveryResult.reply;
  const sessionAfterRecovery = deps.loadAutonomousSession(COMM_V1_ACCEPTANCE_CHAT_PRIMARY);
  recordCheck(
    checks,
    failures,
    'recovery_session_continuity',
    sessionAfterRecovery?.identity_role === 'guest'
      ? null
      : `identity lost after recovery simulation (${String(sessionAfterRecovery?.identity_role)})`,
  );
  recordCheck(
    checks,
    failures,
    'recovery_idempotency_survives',
    recoveryResult.outcome !== 'duplicate' ? null : 'unexpected duplicate on fresh recovery update',
  );

  // ── 9. Stale callback after identity set ─────────────────────────────────
  deps.resetEphemeralMocks();
  let staleError: string | null = null;
  try {
    const staleResult = await deps.processUpdate(
      buildCommV1CallbackUpdate({
        chatId: COMM_V1_ACCEPTANCE_CHAT_PRIMARY,
        callbackData: TELEGRAM_IDENTITY_CALLBACKS.lead,
        updateId: nextUpdateId(),
        callbackId: 'comm-v1-stale-lead',
      }),
    );
    evidence.stale_callback_outcome = staleResult.outcome;
  } catch (error) {
    staleError = error instanceof Error ? error.message : String(error);
  }
  recordCheck(checks, failures, 'stale_callback_safe', staleError);

  // ── 10. Voice STT fail → text fallback, no voice reply ───────────────────
  delete process.env.VOICE_REPLY_ENABLED;
  deps.resetEphemeralMocks();
  const voiceUpdateId = nextUpdateId();
  const voiceResult = await deps.processTelegramVoiceUpdate(
    buildCommV1VoiceUpdate({
      chatId: COMM_V1_ACCEPTANCE_CHAT_VOICE,
      updateId: voiceUpdateId,
    }),
  );
  evidence.voice_outcome = voiceResult.outcome;
  evidence.voice_reason = voiceResult.reason ?? null;
  const voiceFallbackText = deps.getSendMessageCalls().at(-1)?.text ?? '';
  evidence.voice_fallback_text = voiceFallbackText;
  recordCheck(
    checks,
    failures,
    'voice_stt_safe_fallback',
    voiceResult.outcome === 'voice_fallback_sent' && voiceResult.reason === 'stt_failed'
      ? null
      : `expected voice_fallback_sent/stt_failed, got ${voiceResult.outcome}/${String(voiceResult.reason)}`,
  );
  recordCheck(
    checks,
    failures,
    'voice_no_voice_reply_when_disabled',
    voiceFallbackText && !/\.ogg|voice_note|sendVoice/i.test(JSON.stringify(deps.getSendMessageCalls()))
      ? null
      : 'expected text fallback without voice outbound',
  );

  // ── 11. UTF-8 + overall idempotency ──────────────────────────────────────
  const replyTexts = allReplyTexts(deps.getSendMessageCalls());
  evidence.reply_sample_count = replyTexts.length;
  const utf8Failure = replyTexts.map((text) => assertUtf8RuPreserved(text)).find(Boolean) ?? null;
  recordCheck(checks, failures, 'utf8_ru_preserved', utf8Failure);

  recordCheck(
    checks,
    failures,
    'idempotency_overall',
    checks.duplicate_text_idempotent === 'PASS' && checks.duplicate_callback_idempotent === 'PASS'
      ? null
      : 'duplicate text/callback idempotency checks did not both pass',
  );

  const ok = failures.length === 0;
  return { ok, cycle: COMM_V1_ACCEPTANCE_CYCLE, checks, failures, evidence };
}

export function formatCommV1AcceptanceResultLine(result: CommV1AcceptanceResult): string {
  return `COMM_V1_ACCEPTANCE_RESULT=${JSON.stringify(result)}`;
}
