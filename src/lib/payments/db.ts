import { PaymentRequest, PaymentStatus } from './types';
import { getPaymentsSupabase } from './supabase';

/**
 * Payment store with two layers:
 *   1. In-memory Maps (byId, byProviderTxId) — fast path, always consistent within a process
 *   2. Supabase `operational_payments` table — persistent across restarts (best-effort)
 *
 * Supabase writes are awaited but best-effort: failures are logged without losing the
 * process-local record. Reads warm the in-memory cache after a process restart.
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

type OperationalPaymentRow = {
  id: string;
  provider: PaymentRequest['provider'];
  provider_transaction_id: string | null;
  chat_id: string | null;
  reservation_id: string | null;
  property_id: string | null;
  guest_id: string | null;
  service_type: string | null;
  amount: number | string;
  currency: string;
  status: PaymentRequest['status'];
  payment_url: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function paymentFromRow(data: OperationalPaymentRow): PaymentRequest {
  return {
    id: data.id,
    provider: data.provider,
    providerTransactionId: data.provider_transaction_id ?? null,
    chatId: data.chat_id ?? undefined,
    reservationId: data.reservation_id ?? undefined,
    propertyId: data.property_id ?? undefined,
    guestId: data.guest_id ?? undefined,
    serviceType: data.service_type ?? undefined,
    amount: Number(data.amount),
    currency: data.currency,
    status: data.status,
    paymentUrl: data.payment_url ?? undefined,
    expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

function warmPayment(payment: PaymentRequest): PaymentRequest {
  byId.set(payment.id, payment);
  if (payment.providerTransactionId) {
    byProviderTxId.set(payment.providerTransactionId, payment.id);
  }
  return payment;
}

async function persistCreate(payment: PaymentRequest): Promise<void> {
  const sb = getPaymentsSupabase();
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
  const sb = getPaymentsSupabase();
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
  warmPayment({ ...payment });
  await persistCreate(payment);
}

export async function getPaymentById(id: string): Promise<PaymentRequest | null> {
  const cached = byId.get(id);
  if (cached) return cached;

  const sb = getPaymentsSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('operational_payments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? warmPayment(paymentFromRow(data as OperationalPaymentRow)) : null;
  } catch (err) {
    console.warn('[payments/db] getPaymentById Supabase fallback failed:', err);
    return null;
  }
}

export async function getPaymentByTransactionId(transactionId: string): Promise<PaymentRequest | null> {
  // Fast path — in-memory
  const id = byProviderTxId.get(transactionId);
  if (id) return byId.get(id) ?? null;

  // Cold-start fallback — Supabase
  const sb = getPaymentsSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('operational_payments')
      .select('*')
      .eq('provider_transaction_id', transactionId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return warmPayment(paymentFromRow(data as OperationalPaymentRow));
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

  const sb = getPaymentsSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('operational_payments')
      .select('*')
      .eq('chat_id', chatId)
      .in('status', ['pending', 'requires_action'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? warmPayment(paymentFromRow(data as OperationalPaymentRow)) : null;
  } catch (err) {
    console.warn('[payments/db] getActivePaymentForContext Supabase fallback failed:', err);
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
  const payment = await getPaymentByTransactionId(transactionId);
  if (!payment) return false;
  if (payment.status === status) return false;
  payment.status = status;
  payment.updatedAt = new Date();
  await persistStatusUpdate(payment.id, status);
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
  const payment = await getPaymentById(id);
  if (!payment) return false;
  if (payment.status === status) return false;
  payment.status = status;
  payment.updatedAt = new Date();
  await persistStatusUpdate(id, status);
  return true;
}

/** Reset store — for testing only. */
export function _resetPaymentDb(): void {
  byId.clear();
  byProviderTxId.clear();
}
