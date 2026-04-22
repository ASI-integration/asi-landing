import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { sha256Base64Url } from './reliability';
import { checkAndMarkKey } from './idempotency';
import { getChannelAdapter } from './channels';
import { auditDuplicateOutboundPrevented, auditError } from './audit';
import { recoverConversationSessionToActive } from './conversation-session-engine';
import { SessionStatus, transitionSessionStatus } from './session-status';
import type { CommunicationChannel, Message, Role } from './types';

export type EscalationReviewStatus =
  | 'pending'
  | 'acknowledged'
  | 'approved'
  | 'replied'
  | 'closed';

export type EscalationReview = {
  reviewId: string;
  sessionId: string;
  channel: CommunicationChannel;
  /**
   * Outbound routing target for the channel adapter (e.g. Telegram chat id as string).
   * This is intentionally stored because operator replies must not depend on the
   * original inbound event being available.
   */
  targetId: string;
  actorId?: string;
  role?: Role;
  reservationId?: string;
  propertyId?: string;
  leadId?: string;
  escalationReason: string;
  confidence?: number;
  latestMessages: Array<{
    direction: 'inbound' | 'outbound';
    content: string;
    createdAt: string;
  }>;
  suggestedReply?: string;
  status: EscalationReviewStatus;
  createdAt: string;
  updatedAt: string;
};

export type OperatorAuditEvent =
  | { type: 'review_created'; reviewId: string; sessionId: string; detail?: string; ts: string }
  | { type: 'review_acknowledged'; reviewId: string; operatorId: string; ts: string }
  | { type: 'review_approved'; reviewId: string; operatorId: string; ts: string }
  | { type: 'review_closed'; reviewId: string; operatorId: string; ts: string }
  | { type: 'operator_reply_sent'; reviewId: string; operatorId: string; outboundKey: string; ts: string }
  | { type: 'operator_reply_duplicate_prevented'; reviewId: string; operatorId: string; outboundKey: string; ts: string }
  | { type: 'operator_reply_send_failed'; reviewId: string; operatorId: string; error: string; ts: string };

const isTest = process.env.NODE_ENV === 'test';
function defaultStateDir(): string {
  // Never default to /tmp in production-like environments — it is not reliably persistent.
  // Prefer a project-local directory (works with PM2 + artifact deployments).
  const env =
    process.env.COMM_STATE_DIR ??
    process.env.CONVERSATION_SESSION_DIR ??
    process.env.SESSION_STORE_DIR ??
    process.env.STATE_DIR;
  if (env && String(env).trim()) return String(env);
  return path.join(process.cwd(), '.asi-comm-state');
}

const BASE_DIR = defaultStateDir();
const REVIEWS_PATH = path.join(BASE_DIR, 'asi-comm-escalation-reviews.json');
const AUDIT_PATH = path.join(BASE_DIR, 'asi-comm-escalation-reviews-audit.jsonl');

type StoreShape = {
  reviewsById: Record<string, EscalationReview>;
  activeReviewIdBySessionId: Record<string, string>;
};

let loaded = false;
let cache: StoreShape = { reviewsById: {}, activeReviewIdBySessionId: {} };

function nowIso(): string {
  return new Date().toISOString();
}

function safeMkdirp(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }
}

function loadOnce(): void {
  if (loaded || isTest) {
    loaded = true;
    return;
  }
  loaded = true;
  safeMkdirp(BASE_DIR);
  try {
    if (!fs.existsSync(REVIEWS_PATH)) return;
    const raw = fs.readFileSync(REVIEWS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    cache = {
      reviewsById: parsed.reviewsById ?? {},
      activeReviewIdBySessionId: parsed.activeReviewIdBySessionId ?? {},
    };
  } catch {
    cache = { reviewsById: {}, activeReviewIdBySessionId: {} };
  }
}

function persist(): void {
  if (isTest) return;
  safeMkdirp(BASE_DIR);
  try {
    fs.writeFileSync(REVIEWS_PATH, JSON.stringify(cache), 'utf-8');
  } catch {
    // best-effort
  }
}

function appendAuditLine(e: OperatorAuditEvent): void {
  // Always emit a structured audit line to stdout (works with PM2 logs).
  // Keep payload intentionally small (no full raw message bodies).
  try {
    console.log(JSON.stringify({ operator_review_audit: e }));
  } catch {
    // ignore
  }
  if (isTest) return;
  safeMkdirp(BASE_DIR);
  try {
    fs.appendFileSync(AUDIT_PATH, JSON.stringify(e) + '\n', 'utf-8');
  } catch {
    // best-effort
  }
}

function summariseMessages(messages: Message[] | undefined): EscalationReview['latestMessages'] {
  const last = Array.isArray(messages) ? messages.slice(-8) : [];
  return last.map(m => ({
    direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
    content: String(m.content ?? '').slice(0, 800),
    createdAt: m.createdAt,
  }));
}

export function getActiveEscalationReviewIdForSession(sessionId: string): string | null {
  loadOnce();
  return cache.activeReviewIdBySessionId[sessionId] ?? null;
}

export function getEscalationReview(reviewId: string): EscalationReview | null {
  loadOnce();
  return cache.reviewsById[reviewId] ?? null;
}

export function listEscalationReviews(params?: {
  status?: EscalationReviewStatus;
  limit?: number;
}): EscalationReview[] {
  loadOnce();
  const all = Object.values(cache.reviewsById).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const filtered = params?.status ? all.filter(r => r.status === params.status) : all;
  const limit = params?.limit && params.limit > 0 ? params.limit : 200;
  return filtered.slice(0, limit);
}

export function createOrUpdateEscalationReview(input: {
  sessionId: string;
  channel: CommunicationChannel;
  targetId: string;
  actorId?: string;
  role?: Role;
  reservationId?: string;
  propertyId?: string;
  leadId?: string;
  escalationReason: string;
  confidence?: number;
  latestMessages?: Message[];
  suggestedReply?: string;
  detail?: string;
}): EscalationReview {
  loadOnce();
  const existingId = cache.activeReviewIdBySessionId[input.sessionId];
  const existing = existingId ? cache.reviewsById[existingId] : undefined;

  const ts = nowIso();
  const review: EscalationReview = existing
    ? {
        ...existing,
        // Keep earliest createdAt; update evidence and reason
        escalationReason: input.escalationReason || existing.escalationReason,
        confidence: input.confidence ?? existing.confidence,
        reservationId: input.reservationId ?? existing.reservationId,
        propertyId: input.propertyId ?? existing.propertyId,
        leadId: input.leadId ?? existing.leadId,
        latestMessages: input.latestMessages ? summariseMessages(input.latestMessages) : existing.latestMessages,
        suggestedReply: input.suggestedReply ?? existing.suggestedReply,
        updatedAt: ts,
      }
    : {
        reviewId: randomUUID(),
        sessionId: input.sessionId,
        channel: input.channel,
        targetId: input.targetId,
        actorId: input.actorId,
        role: input.role,
        reservationId: input.reservationId,
        propertyId: input.propertyId,
        leadId: input.leadId,
        escalationReason: input.escalationReason,
        confidence: input.confidence,
        latestMessages: summariseMessages(input.latestMessages),
        suggestedReply: input.suggestedReply,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      };

  cache.reviewsById[review.reviewId] = review;
  if (review.status !== 'closed') {
    cache.activeReviewIdBySessionId[input.sessionId] = review.reviewId;
  }
  persist();

  appendAuditLine({
    type: 'review_created',
    reviewId: review.reviewId,
    sessionId: review.sessionId,
    detail: input.detail,
    ts,
  });

  return review;
}

function updateStatus(reviewId: string, next: EscalationReviewStatus): EscalationReview {
  loadOnce();
  const cur = cache.reviewsById[reviewId];
  if (!cur) throw new Error('review_not_found');
  const updated: EscalationReview = { ...cur, status: next, updatedAt: nowIso() };
  cache.reviewsById[reviewId] = updated;
  if (next === 'closed') {
    if (cache.activeReviewIdBySessionId[updated.sessionId] === reviewId) {
      delete cache.activeReviewIdBySessionId[updated.sessionId];
    }
  } else {
    cache.activeReviewIdBySessionId[updated.sessionId] = reviewId;
  }
  persist();
  return updated;
}

export function acknowledgeEscalationReview(reviewId: string, operatorId: string): EscalationReview {
  const updated = updateStatus(reviewId, 'acknowledged');
  appendAuditLine({ type: 'review_acknowledged', reviewId, operatorId, ts: nowIso() });
  return updated;
}

export function approveEscalationReview(reviewId: string, operatorId: string): EscalationReview {
  const updated = updateStatus(reviewId, 'approved');
  appendAuditLine({ type: 'review_approved', reviewId, operatorId, ts: nowIso() });
  return updated;
}

export function closeEscalationReview(reviewId: string, operatorId: string): EscalationReview {
  const updated = updateStatus(reviewId, 'closed');
  appendAuditLine({ type: 'review_closed', reviewId, operatorId, ts: nowIso() });
  // Best-effort: let automation resume.
  if (updated.actorId) {
    recoverConversationSessionToActive({
      channel: updated.channel,
      actorId: updated.actorId,
      reason: `operator_closed_review reviewId=${updated.reviewId}`,
    });
  }
  const chatId = Number(updated.targetId);
  if (Number.isFinite(chatId)) {
    transitionSessionStatus(chatId, SessionStatus.Active).catch(() => {});
  }
  return updated;
}

export async function sendOperatorReply(input: {
  reviewId: string;
  operatorId: string;
  replyText: string;
}): Promise<{ ok: boolean; review: EscalationReview | null; duplicatePrevented?: boolean; error?: string }> {
  loadOnce();
  const review = cache.reviewsById[input.reviewId];
  if (!review) return { ok: false, review: null, error: 'review_not_found' };
  if (!input.replyText || !String(input.replyText).trim()) return { ok: false, review, error: 'reply_required' };

  const adapter = getChannelAdapter(review.channel);
  const outboundKey = sha256Base64Url(
    ['operator', review.reviewId, review.channel, review.targetId, String(input.replyText)].join('|'),
  );

  if (checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { reviewId: review.reviewId, operatorId: input.operatorId } })) {
    const chatId = Number(review.targetId);
    if (Number.isFinite(chatId)) {
      auditDuplicateOutboundPrevented({
        chat_id: chatId,
        detail: `operator_outbound_duplicate_prevented key=${outboundKey} reviewId=${review.reviewId}`,
      });
    }
    appendAuditLine({
      type: 'operator_reply_duplicate_prevented',
      reviewId: review.reviewId,
      operatorId: input.operatorId,
      outboundKey,
      ts: nowIso(),
    });
    return { ok: true, review, duplicatePrevented: true };
  }

  try {
    const sent = await adapter.sendMessage(review.targetId, input.replyText);
    if (!sent) {
      appendAuditLine({
        type: 'operator_reply_send_failed',
        reviewId: review.reviewId,
        operatorId: input.operatorId,
        error: 'adapter_failed_to_send',
        ts: nowIso(),
      });
      return { ok: false, review, error: 'send_failed' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    auditError({ detail: `operator_reply_send_failed reviewId=${review.reviewId} err=${msg}` });
    appendAuditLine({
      type: 'operator_reply_send_failed',
      reviewId: review.reviewId,
      operatorId: input.operatorId,
      error: msg,
      ts: nowIso(),
    });
    return { ok: false, review, error: msg };
  }

  // Update review status to replied and persist the reply draft as suggestedReply snapshot.
  const updated = {
    ...review,
    status: 'replied' as const,
    suggestedReply: input.replyText,
    updatedAt: nowIso(),
  };
  cache.reviewsById[review.reviewId] = updated;
  cache.activeReviewIdBySessionId[review.sessionId] = review.reviewId;
  persist();

  appendAuditLine({
    type: 'operator_reply_sent',
    reviewId: review.reviewId,
    operatorId: input.operatorId,
    outboundKey,
    ts: nowIso(),
  });

  // Best-effort: allow automation to resume after a human reply.
  if (updated.actorId) {
    recoverConversationSessionToActive({
      channel: updated.channel,
      actorId: updated.actorId,
      reason: `operator_replied reviewId=${updated.reviewId}`,
    });
  }
  const chatId = Number(updated.targetId);
  if (Number.isFinite(chatId)) {
    transitionSessionStatus(chatId, SessionStatus.Active).catch(() => {});
  }

  return { ok: true, review: updated };
}

/** @internal tests only */
export function __resetEscalationReviewStoreForTests(): void {
  loaded = true;
  cache = { reviewsById: {}, activeReviewIdBySessionId: {} };
}

