import { PaymentRequest, PaymentStatus } from './types';

/**
 * Payment store with two layers:
 *   1. In-memory Maps (byId, byProviderTxId) — fast path, always consistent within a process
 *   2. Supabase `operational_payments` table — persistent across restarts (best-effort)
 *
 * Supabase writes are fire-and-forget: failures are logged but never block the caller.
 * Reads fall back to in-memory so the system stays functional if Supabase is unavailable.
 *
 * Schema required (run once):
 *   create table operational_payments (
 *     id text primary key,
 *     provider text not null,
 *     provider_transaction_id text,
 *     chat_id text,
 *     reservation_id text,
 *     property_id text,
 *     guest_id text,
 *     service_type text,
 *     amount numeric not null,
 *     currency text not null,
 *     status text not null,
 *     payment_url text,
 *     expires_at timestamptz,
 *     created_at timestamptz not null,
 *     updated_at timestamptz not null
 *   );
 *   create index on operational_payments (provider_transaction_id);
 */

const byId = new Map<string, PaymentRequest>();
const byProviderTxId = new Map<string, string>(); // providerTxId → internal id

function getSupabase() {
  try {
    // Lazy import to avoid crashing if env vars are missing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/lib/supabase').supabase;
  } catch {
    return null;
  }
}

async function persistCreate(payment: PaymentRequest): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from('operational_payments').upsert({
      id: payment.id,
      provider: payment.provider,
      provider_transaction_id: payment.providerTransactionId ?? null,
      chat_id: payment.chatId ?? null,
      reservation_id: payment.reservationId ?? null,
      property_id: payment.propertyId ?? null,
      guest_id: payment.guestId ?? null,
      service_type: payment.serviceType ?? null,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      payment_url: payment.paymentUrl ?? null,
      expires_at: payment.expiresAt?.toISOString() ?? null,
      created_at: payment.createdAt.toISOString(),
      updated_at: payment.updatedAt.toISOString(),
    });
  } catch (err) {
    console.warn('[payments/db] Supabase persist failed (non-fatal):', err);
  }
}

async function persistStatusUpdate(id: string, status: PaymentStatus): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb
      .from('operational_payments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
  } catch (err) {
    console.warn('[payments/db] Supabase status update failed (non-fatal):', err);
  }
}

export async function createPaymentRecord(payment: PaymentRequest): Promise<void> {
  byId.set(payment.id, { ...payment });
  if (payment.providerTransactionId) {
    byProviderTxId.set(payment.providerTransactionId, payment.id);
  }
  void persistCreate(payment);
}

export async function getPaymentById(id: string): Promise<PaymentRequest | null> {
  return byId.get(id) ?? null;
}

export async function getPaymentByTransactionId(transactionId: string): Promise<PaymentRequest | null> {
  // Fast path — in-memory
  const id = byProviderTxId.get(transactionId);
  if (id) return byId.get(id) ?? null;

  // Cold-start fallback — Supabase
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb
      .from('operational_payments')
      .select('*')
      .eq('provider_transaction_id', transactionId)
      .single();
    if (data) {
      const payment: PaymentRequest = {
        id:                    data.id,
        provider:              data.provider,
        providerTransactionId: data.provider_transaction_id ?? null,
        chatId:                data.chat_id ?? undefined,
        reservationId:         data.reservation_id ?? undefined,
        propertyId:            data.property_id ?? undefined,
        guestId:               data.guest_id ?? undefined,
        serviceType:           data.service_type ?? undefined,
        amount:                Number(data.amount),
        currency:              data.currency,
        status:                data.status as PaymentRequest['status'],
        paymentUrl:            data.payment_url ?? undefined,
        expiresAt:             data.expires_at ? new Date(data.expires_at) : undefined,
        createdAt:             new Date(data.created_at),
        updatedAt:             new Date(data.updated_at),
      };
      // Warm the in-memory store to avoid redundant DB hits within the same process lifetime.
      byId.set(payment.id, payment);
      byProviderTxId.set(transactionId, payment.id);
      return payment;
    }
  } catch (err) {
    console.warn('[payments/db] getPaymentByTransactionId Supabase fallback failed:', err);
  }
  return null;
}

/**
 * Returns the first active (pending or requires_action) payment for a given chatId.
 * Used to prevent duplicate checkout sessions for the same guest/request.
 */
export async function getActivePaymentForContext(chatId: string): Promise<PaymentRequest | null> {
  for (const payment of Array.from(byId.values())) {
    if (
      payment.chatId === chatId &&
      (payment.status === 'pending' || payment.status === 'requires_action')
    ) {
      return payment;
    }
  }
  return null;
}

/**
 * Updates payment status by provider transaction ID.
 * Returns true if the status changed, false if it was already set (idempotency guard).
 */
export async function updatePaymentStatus(
  transactionId: string,
  status: PaymentStatus
): Promise<boolean> {
  const id = byProviderTxId.get(transactionId);
  if (!id) return false;
  const payment = byId.get(id);
  if (!payment) return false;
  if (payment.status === status) return false;
  payment.status = status;
  payment.updatedAt = new Date();
  void persistStatusUpdate(id, status);
  return true;
}

/**
 * Updates payment status by internal payment ID.
 * Returns true if the status changed, false if already set (idempotency guard).
 */
export async function updatePaymentStatusById(
  id: string,
  status: PaymentStatus
): Promise<boolean> {
  const payment = byId.get(id);
  if (!payment) return false;
  if (payment.status === status) return false;
  payment.status = status;
  payment.updatedAt = new Date();
  void persistStatusUpdate(id, status);
  return true;
}

/** Reset store — for testing only. */
export function _resetPaymentDb(): void {
  byId.clear();
  byProviderTxId.clear();
}
