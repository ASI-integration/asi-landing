/**
 * Operational Session Status — canonical state machine for guest conversations.
 *
 * Status lifecycle:
 *   inquiry → active → payment_pending → paid → booking_confirmed
 *                 ↓              ↓         ↓
 *           operator_review_required (any point, escalation triggered)
 *                 ↓
 *           cancelled | expired
 *
 * Architecture:
 *   - In-memory Map is the fast primary store (synchronous reads/writes).
 *   - Supabase tg_conversation_sessions.status is the durable secondary store
 *     (best-effort, fire-and-forget — does NOT throw on failure).
 *   - The column `status` and `status_updated_at` must be present in
 *     tg_conversation_sessions; if missing, Supabase writes silently fail
 *     and the in-memory store remains authoritative.
 *
 * Migration (run once in Supabase SQL editor):
 *   ALTER TABLE tg_conversation_sessions
 *     ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'inquiry',
 *     ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
 */

import { supabase } from '@/lib/supabase';

// ─── Status Values ───────────────────────────────────────────────────────────

export const SessionStatus = {
  /** First contact, no message processed yet. */
  Inquiry:                'inquiry',
  /** At least one message has been processed by the orchestrator. */
  Active:                 'active',
  /** Payment URL sent to guest, awaiting payment. */
  PaymentPending:         'payment_pending',
  /** Payment webhook confirmed as succeeded. */
  Paid:                   'paid',
  /** Reservation confirmed downstream (post-paid; future hook point). */
  BookingConfirmed:       'booking_confirmed',
  /** Payment cancelled by provider or guest. */
  Cancelled:              'cancelled',
  /** Payment window elapsed without a succeeded event. */
  Expired:                'expired',
  /** Escalation triggered; waiting for human operator. */
  OperatorReviewRequired: 'operator_review_required',
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

// ─── Transition Table ────────────────────────────────────────────────────────

const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  inquiry:                  ['active', 'operator_review_required'],
  active:                   ['payment_pending', 'operator_review_required'],
  payment_pending:          ['paid', 'cancelled', 'expired', 'operator_review_required'],
  paid:                     ['booking_confirmed', 'operator_review_required'],
  booking_confirmed:        ['cancelled'],
  cancelled:                [],
  expired:                  ['active'],
  operator_review_required: ['active'],
};

// ─── In-Memory Store ─────────────────────────────────────────────────────────

interface SessionEntry {
  status: SessionStatus;
  updatedAt: Date;
  /** Set when entering payment_pending so sweepExpiredPaymentSessions can act. */
  paymentExpiresAt?: Date;
}

const sessionStore = new Map<number, SessionEntry>();

// ─── Read API ────────────────────────────────────────────────────────────────

/** Synchronous read from in-memory store. Returns 'inquiry' if unknown. */
export function getSessionStatusSync(chatId: number): SessionStatus {
  return sessionStore.get(chatId)?.status ?? SessionStatus.Inquiry;
}

/**
 * Read from in-memory store, then fall back to Supabase for cold starts.
 * Never throws.
 */
export async function getSessionStatus(chatId: number): Promise<SessionStatus> {
  const cached = sessionStore.get(chatId);
  if (cached) return cached.status;

  try {
    const { data } = await supabase
      .from('tg_conversation_sessions')
      .select('status')
      .eq('chat_id', chatId)
      .single();

    if (data?.status) {
      const status = data.status as SessionStatus;
      sessionStore.set(chatId, { status, updatedAt: new Date() });
      return status;
    }
  } catch {
    // Supabase unavailable or column not yet migrated — default to inquiry.
  }

  return SessionStatus.Inquiry;
}

// ─── Transition API ──────────────────────────────────────────────────────────

/**
 * Transition a session to a new status.
 *
 * - Same-state no-ops are silently dropped.
 * - Invalid transitions log a warning and return without changing state.
 * - In-memory write is synchronous.
 * - Supabase write is best-effort (never throws).
 */
export async function transitionSessionStatus(
  chatId: number,
  newStatus: SessionStatus,
  opts?: { paymentExpiresAt?: Date },
): Promise<void> {
  const current = sessionStore.get(chatId)?.status ?? SessionStatus.Inquiry;

  if (current === newStatus) return;

  const allowed = ALLOWED[current];
  if (!allowed.includes(newStatus)) {
    console.warn(
      `[SessionStatus] Invalid transition chatId=${chatId} ` +
      `${current} → ${newStatus} — skipped`,
    );
    return;
  }

  const now = new Date();
  const existing = sessionStore.get(chatId);
  sessionStore.set(chatId, {
    status: newStatus,
    updatedAt: now,
    paymentExpiresAt: opts?.paymentExpiresAt ?? existing?.paymentExpiresAt,
  });

  console.log(`[SessionStatus] chatId=${chatId} ${current} → ${newStatus}`);

  // Best-effort Supabase write — gracefully ignores missing column.
  supabase
    .from('tg_conversation_sessions')
    .upsert(
      {
        chat_id: chatId,
        status: newStatus,
        status_updated_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'chat_id', ignoreDuplicates: false },
    )
    .then(({ error }) => {
      if (error) {
        console.warn(`[SessionStatus] Supabase write failed chatId=${chatId}: ${error.message}`);
      }
    });
}

// ─── Payment Expiry Helpers ──────────────────────────────────────────────────

/**
 * Store payment expiry time on an existing session entry.
 * Called by the orchestrator after createPaymentRequest returns.
 */
export function setPaymentExpiry(chatId: number, expiresAt: Date): void {
  const entry = sessionStore.get(chatId);
  if (entry) {
    sessionStore.set(chatId, { ...entry, paymentExpiresAt: expiresAt });
  }
}

/**
 * Scan all in-memory sessions with status=payment_pending whose payment
 * window has elapsed. Transitions them to 'expired'.
 *
 * Called from the cron job. Returns count of sessions swept.
 */
export async function sweepExpiredPaymentSessions(): Promise<number> {
  const now = new Date();
  let swept = 0;

  for (const [chatId, entry] of Array.from(sessionStore.entries())) {
    if (
      entry.status === SessionStatus.PaymentPending &&
      entry.paymentExpiresAt &&
      entry.paymentExpiresAt < now
    ) {
      await transitionSessionStatus(chatId, SessionStatus.Expired);
      swept++;
    }
  }

  return swept;
}
