/**
 * Communication Handoff Lock — session ownership state machine.
 *
 * When the AI decides a conversation needs a human operator, the session
 * transitions through the following ownership states:
 *
 *   ai_active ──► operator_requested ──► operator_active ──► resolved ──► returned_to_ai
 *                                                                ▲
 *                                                                │
 *                                                       (operator closes)
 *
 * Rules enforced:
 *   - AI may reply only when state is `ai_active` or `returned_to_ai`.
 *   - `operator_requested` and `operator_active` are LOCKED for AI replies.
 *   - `requestOperatorHandoff` is idempotent — repeated calls for the same
 *     session reuse the existing active review (no duplicate locks).
 *   - Inbound message duplicates are deduplicated upstream by `idempotency`,
 *     so they cannot create a duplicate handoff lock.
 *   - Operator can `releaseSessionToAi` to unlock; subsequent reads return
 *     `returned_to_ai` (AI may resume on the next inbound turn).
 *
 * Storage strategy — derivative, not new persistence:
 *   - Active lock state derives from `operator-review` (active review +
 *     review.status).
 *   - "Has been escalated before" derives from `operator-review`'s full
 *     review list.
 *   - "Just resolved" is reported transiently via the `releaseSessionToAi`
 *     return value; subsequent reads collapse it to `returned_to_ai`.
 *
 * No new state file is introduced. The existing operator-review JSON file
 * and session-status table remain authoritative.
 */

import {
  createOrUpdateEscalationReview,
  forceCloseActiveReviewForSession,
  getActiveEscalationReviewIdForSession,
  getEscalationReview,
  getReviewsBySessionId,
  acknowledgeEscalationReview,
  sendOperatorReply,
  type EscalationReview,
  type EscalationReviewStatus,
} from './operator-review';
import { transitionSessionStatus, SessionStatus } from './session-status';
import { auditLog } from './audit';
import { AuditEventType } from './types';
import type { CommunicationChannel, Message, Role } from './types';
import { updateCommAgentSessionMemory } from './comm-agent-session-memory';
import { logCommAgentHandoffLifecycleMetric } from './comm-agent-metrics';
import {
  autopilotSessionFromCollectedData,
  patchAutopilotSessionCollectedData,
} from './communication-autopilot-session';
import {
  loadAutonomousSession,
  patchAutonomousSessionCollectedData,
} from './conversation-session-store';

// ─── State ───────────────────────────────────────────────────────────────────

export const HandoffLockState = {
  /** AI is in control. No active operator review, no prior escalation. */
  AiActive:          'ai_active',
  /** Operator handoff requested, but no operator has acknowledged yet. */
  OperatorRequested: 'operator_requested',
  /** Operator has acknowledged / approved / replied — actively handling. */
  OperatorActive:    'operator_active',
  /** Operator just closed the review (transient — only returned by releaseSessionToAi). */
  Resolved:          'resolved',
  /** Previously had an operator review; no active review. AI may reply. */
  ReturnedToAi:      'returned_to_ai',
} as const;

export type HandoffLockState = (typeof HandoffLockState)[keyof typeof HandoffLockState];

const OPERATOR_ACTIVE_STATUSES: ReadonlySet<EscalationReviewStatus> = new Set([
  'acknowledged',
  'approved',
  'replied',
]);

// ─── Read API ────────────────────────────────────────────────────────────────

export function getHandoffLockState(sessionId: string): HandoffLockState {
  const activeReviewId = getActiveEscalationReviewIdForSession(sessionId);
  if (activeReviewId) {
    const review = getEscalationReview(activeReviewId);
    if (review && OPERATOR_ACTIVE_STATUSES.has(review.status)) {
      return HandoffLockState.OperatorActive;
    }
    return HandoffLockState.OperatorRequested;
  }
  // No active review. If we ever had one, this session has returned to AI.
  const history = getReviewsBySessionId(sessionId);
  if (history.length > 0) return HandoffLockState.ReturnedToAi;
  return HandoffLockState.AiActive;
}

/**
 * AI may reply when state is `ai_active` or `returned_to_ai`.
 * Returns false while operator handoff is requested or active.
 */
export function canAiReply(sessionId: string): boolean {
  const state = getHandoffLockState(sessionId);
  return state === HandoffLockState.AiActive || state === HandoffLockState.ReturnedToAi;
}

// ─── Write API ───────────────────────────────────────────────────────────────

export interface RequestOperatorHandoffInput {
  sessionId: string;
  channel: CommunicationChannel;
  /** Outbound routing target (e.g. Telegram chat id as string). */
  targetId: string;
  actorId?: string;
  role?: Role;
  reservationId?: string;
  propertyId?: string;
  leadId?: string;
  escalationReason: string;
  confidence?: number;
  source?: Record<string, unknown>;
  latestMessages?: Message[];
  suggestedReply?: string;
  /** Optional chat id to mirror the durable session-status transition. */
  chatId?: number;
  /** Audit context. */
  updateId?: number;
  detail?: string;
}

export interface RequestOperatorHandoffResult {
  reviewId: string;
  state: HandoffLockState;
  /** True when this call surfaced an existing active lock instead of creating one. */
  alreadyLocked: boolean;
  review: EscalationReview;
}

/**
 * Idempotent: if the session already has an active operator review, this
 * call updates evidence on it and returns `alreadyLocked: true`. Otherwise
 * it creates a new pending review and (best-effort) transitions the durable
 * session-status to `operator_review_required`.
 */
export function requestOperatorHandoff(
  input: RequestOperatorHandoffInput,
): RequestOperatorHandoffResult {
  const preExistingId = getActiveEscalationReviewIdForSession(input.sessionId);
  const alreadyLocked = Boolean(preExistingId);

  const review = createOrUpdateEscalationReview({
    sessionId:         input.sessionId,
    channel:           input.channel,
    targetId:          input.targetId,
    actorId:           input.actorId,
    role:              input.role,
    reservationId:     input.reservationId,
    propertyId:        input.propertyId,
    leadId:            input.leadId,
    escalationReason:  input.escalationReason,
    confidence:        input.confidence,
    source:            input.source,
    latestMessages:    input.latestMessages,
    suggestedReply:    input.suggestedReply,
    detail:            input.detail,
  });

  // Mirror to durable session-status (best-effort, never throws).
  if (typeof input.chatId === 'number' && Number.isFinite(input.chatId)) {
    transitionSessionStatus(input.chatId, SessionStatus.OperatorReviewRequired)
      .catch(() => { /* best-effort */ });
  }

  recordHandoffAuditEvent({
    type: alreadyLocked ? 'handoff_request_idempotent' : 'handoff_requested',
    sessionId: input.sessionId,
    reviewId: review.reviewId,
    chat_id: input.chatId,
    update_id: input.updateId,
    detail: input.detail ?? input.escalationReason,
  });
  logCommAgentHandoffLifecycleMetric({
    channel: input.channel,
    session_key: input.sessionId,
    event: alreadyLocked ? 'duplicate_suppressed' : 'created',
    reason: input.escalationReason,
  });

  return {
    reviewId: review.reviewId,
    state: alreadyLocked ? getHandoffLockState(input.sessionId) : HandoffLockState.OperatorRequested,
    alreadyLocked,
    review,
  };
}

export interface LockSessionForOperatorInput {
  reviewId: string;
  operatorId: string;
  chatId?: number;
  updateId?: number;
}

/**
 * Operator has picked up the handoff — transitions the review from
 * `pending` to `acknowledged` (operator_active state).
 */
export function lockSessionForOperator(
  input: LockSessionForOperatorInput,
): { state: HandoffLockState; review: EscalationReview } {
  const review = acknowledgeEscalationReview(input.reviewId, input.operatorId);
  recordHandoffAuditEvent({
    type: 'handoff_locked',
    sessionId: review.sessionId,
    reviewId: review.reviewId,
    chat_id: input.chatId,
    update_id: input.updateId,
    detail: `operator=${input.operatorId}`,
  });
  return { state: getHandoffLockState(review.sessionId), review };
}

export interface ReleaseSessionToAiInput {
  sessionId: string;
  operatorId: string;
  reason: string;
  chatId?: number;
  updateId?: number;
  approvedAnswer?: string;
}

/**
 * Operator releases the lock back to AI. Closes the active review (if any)
 * and ensures the durable session-status returns to `active`.
 *
 * Returns `state: 'resolved'` for the call itself; subsequent reads of
 * `getHandoffLockState` will return `returned_to_ai`.
 */
export function releaseSessionToAi(
  input: ReleaseSessionToAiInput,
): { state: HandoffLockState; closedReviewId: string | null } {
  const { closedReviewId } = forceCloseActiveReviewForSession({
    sessionId: input.sessionId,
    operatorId: input.operatorId,
    reason: input.reason,
    approvedAnswer: input.approvedAnswer,
  });

  if (!closedReviewId && typeof input.chatId === 'number' && Number.isFinite(input.chatId)) {
    transitionSessionStatus(input.chatId, SessionStatus.Active)
      .catch(() => { /* best-effort */ });
  }

  recordHandoffAuditEvent({
    type: 'handoff_released',
    sessionId: input.sessionId,
    reviewId: closedReviewId,
    chat_id: input.chatId,
    update_id: input.updateId,
    detail: `operator=${input.operatorId} reason=${input.reason}`,
  });

  return { state: HandoffLockState.Resolved, closedReviewId };
}

export async function resolveOperatorHandoffWithReply(input: {
  reviewId: string;
  operatorId: string;
  replyText: string;
}): Promise<{
  ok: boolean;
  review: EscalationReview | null;
  duplicatePrevented: boolean;
  state?: HandoffLockState;
  error?: string;
}> {
  const sent = await sendOperatorReply({ ...input, resumeAutomation: false });
  if (!sent.ok || !sent.review) {
    return {
      ok: false,
      review: sent.review,
      duplicatePrevented: Boolean(sent.duplicatePrevented),
      error: sent.error ?? 'send_failed',
    };
  }

  const review = sent.review;
  if (sent.duplicatePrevented && review.status === 'closed') {
    logCommAgentHandoffLifecycleMetric({
      channel: review.channel,
      session_key: review.sessionId,
      event: 'reply_duplicate_suppressed',
      reason: review.escalationReason,
    });
    return {
      ok: true,
      review,
      duplicatePrevented: true,
      state: HandoffLockState.Resolved,
    };
  }
  updateCommAgentSessionMemory(review.channel, review.targetId, {
    last_safe_reply: input.replyText.slice(0, 500),
    pending_operator_reason: null,
    pending_operator_status: 'resolved',
    unresolved_action: null,
    recent_summary: `operator_resolved:${review.escalationReason}`,
  });
  const chatId = Number(review.targetId);
  if (Number.isSafeInteger(chatId)) {
    const collected = loadAutonomousSession(chatId)?.collected_data ?? {};
    const autopilotMemory = autopilotSessionFromCollectedData(collected);
    if (Object.keys(autopilotMemory).length > 0) {
      patchAutonomousSessionCollectedData({
        chatId,
        channel: review.channel,
        set: patchAutopilotSessionCollectedData({
          memory: {
            ...autopilotMemory,
            requested_missing_field: null,
            unresolved_action: null,
            pending_operator_reason: null,
            pending_operator_status: 'resolved',
            last_reply: input.replyText.slice(0, 240),
            recent_summary: `operator_resolved:${review.escalationReason}`,
          },
        }),
      });
    }
  }
  const released = releaseSessionToAi({
    sessionId: review.sessionId,
    operatorId: input.operatorId,
    reason: 'operator_reply_resolved',
    approvedAnswer: input.replyText,
    chatId: Number.isFinite(chatId) ? chatId : undefined,
  });
  const closed = getEscalationReview(review.reviewId) ?? review;
  logCommAgentHandoffLifecycleMetric({
    channel: review.channel,
    session_key: review.sessionId,
    event: sent.duplicatePrevented ? 'reply_duplicate_suppressed' : 'resolved',
    reason: review.escalationReason,
  });
  return {
    ok: true,
    review: closed,
    duplicatePrevented: Boolean(sent.duplicatePrevented),
    state: released.state,
  };
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export type HandoffAuditEventType =
  | 'handoff_requested'
  | 'handoff_request_idempotent'
  | 'handoff_locked'
  | 'handoff_released'
  | 'ai_reply_blocked';

export interface HandoffAuditEvent {
  type: HandoffAuditEventType;
  sessionId: string;
  reviewId?: string | null;
  chat_id?: number;
  update_id?: number;
  detail?: string;
}

/**
 * Single-line structured audit log for handoff lifecycle events. Re-uses
 * the existing `EscalationCreated` audit type so downstream pipelines
 * already routing escalation events pick these up automatically; the
 * `handoff_*` discriminator lives in the `detail` field.
 */
export function recordHandoffAuditEvent(event: HandoffAuditEvent): void {
  const detail =
    `handoff=${event.type} session=${event.sessionId}` +
    (event.reviewId ? ` review=${event.reviewId}` : '') +
    (event.detail ? ` ${event.detail}` : '');
  auditLog({
    type: AuditEventType.EscalationCreated,
    chat_id: event.chat_id,
    update_id: event.update_id,
    detail,
  });
}
