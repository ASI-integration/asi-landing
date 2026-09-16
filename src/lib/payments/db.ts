import { PaymentRequest, PaymentStatus } from './types';
import { getPaymentsSupabase } from './supabase';
import { canTransitionPaymentStatus } from './status-machine';

/**
 * Payment store with two layers:
 *   1. In-memory Maps — fast path / tests
 *   2. Supabase `operational_payments` — durable when configured
 */

const byId = new Map<string, PaymentRequest>();
const byProviderTxId = new Map<string, string>();
const byIdempotencyKey = new Map<string, string>();

type OperationalPaymentRow = {
  id: string;
  provider: PaymentRequest['provider'];
  provider_transaction_id: string | null;
  chat_id: string | null;
  reservation_id: string | null;
  property_id: string | null;
  guest_id: string | null;
  owner_id: string | null;
  service_type: string | null;
  amount: number | string;
  currency: string;
  status: PaymentRequest['status'];
  payment_url: string | null;
  idempotency_key: string | null;
  metadata: Record<string, string> | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
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
    ownerId: data.owner_id ?? undefined,
    serviceType: data.service_type ?? undefined,
    amount: Number(data.amount),
    currency: data.currency,
    status: data.status,
    paymentUrl: data.payment_url ?? undefined,
    idempotencyKey: data.idempotency_key ?? undefined,
    metadata: data.metadata ?? undefined,
    expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
  };
}

function warmPayment(payment: PaymentRequest): PaymentRequest {
  byId.set(payment.id, payment);
  if (payment.providerTransactionId) {
    byProviderTxId.set(payment.providerTransactionId, payment.id);
  }
  if (payment.idempotencyKey) {
    byIdempotencyKey.set(payment.idempotencyKey, payment.id);
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
      owner_id: payment.ownerId ?? null,
      service_type: payment.serviceType ?? null,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      payment_url: payment.paymentUrl ?? null,
      idempotency_key: payment.idempotencyKey ?? null,
      metadata: payment.metadata ?? null,
      expires_at: payment.expiresAt?.toISOString() ?? null,
      created_at: payment.createdAt.toISOString(),
      updated_at: payment.updatedAt.toISOString(),
      paid_at: payment.paidAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.warn('[payments/db] Supabase persist failed (non-fatal):', err);
  }
}

async function persistPatch(id: string, payment: PaymentRequest): Promise<void> {
  const sb = getPaymentsSupabase();
  if (!sb) return;
  try {
    await sb
      .from('operational_payments')
      .update({
        status: payment.status,
        provider_transaction_id: payment.providerTransactionId ?? null,
        payment_url: payment.paymentUrl ?? null,
        updated_at: payment.updatedAt.toISOString(),
        paid_at: payment.paidAt?.toISOString() ?? null,
        metadata: payment.metadata ?? null,
      })
      .eq('id', id);
  } catch (err) {
    console.warn('[payments/db] Supabase patch failed (non-fatal):', err);
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
  const id = byProviderTxId.get(transactionId);
  if (id) return byId.get(id) ?? null;

  const sb = getPaymentsSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('operational_payments')
      .select('*')
      .eq('provider_transaction_id', transactionId)
      .maybeSingle();
    if (error) throw error;
    if (data) return warmPayment(paymentFromRow(data as OperationalPaymentRow));
  } catch (err) {
    console.warn('[payments/db] getPaymentByTransactionId Supabase fallback failed:', err);
  }
  return null;
}

export async function getPaymentByIdempotencyKey(key: string): Promise<PaymentRequest | null> {
  const id = byIdempotencyKey.get(key);
  if (id) return byId.get(id) ?? null;

  const sb = getPaymentsSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('operational_payments')
      .select('*')
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw error;
    if (data) return warmPayment(paymentFromRow(data as OperationalPaymentRow));
  } catch (err) {
    console.warn('[payments/db] getPaymentByIdempotencyKey Supabase fallback failed:', err);
  }
  return null;
}

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

export async function updatePaymentRecord(
  id: string,
  patch: Partial<PaymentRequest>,
): Promise<PaymentRequest> {
  const payment = await getPaymentById(id);
  if (!payment) throw new Error(`Payment not found: ${id}`);

  if (patch.status && !canTransitionPaymentStatus(payment.status, patch.status)) {
    return payment;
  }

  const next: PaymentRequest = {
    ...payment,
    ...patch,
    id: payment.id,
    updatedAt: patch.updatedAt ?? new Date(),
  };
  warmPayment(next);
  await persistPatch(id, next);
  return next;
}

export async function updatePaymentStatus(
  transactionId: string,
  status: PaymentStatus,
): Promise<boolean> {
  const payment = await getPaymentByTransactionId(transactionId);
  if (!payment) return false;
  if (payment.status === status) return false;
  if (!canTransitionPaymentStatus(payment.status, status)) return false;
  await updatePaymentRecord(payment.id, {
    status,
    paidAt: status === 'paid' ? payment.paidAt ?? new Date() : payment.paidAt,
  });
  return true;
}

export async function updatePaymentStatusById(
  id: string,
  status: PaymentStatus,
): Promise<boolean> {
  const payment = await getPaymentById(id);
  if (!payment) return false;
  if (payment.status === status) return false;
  if (!canTransitionPaymentStatus(payment.status, status)) return false;
  await updatePaymentRecord(id, {
    status,
    paidAt: status === 'paid' ? payment.paidAt ?? new Date() : payment.paidAt,
  });
  return true;
}

export function _resetPaymentDb(): void {
  byId.clear();
  byProviderTxId.clear();
  byIdempotencyKey.clear();
}
