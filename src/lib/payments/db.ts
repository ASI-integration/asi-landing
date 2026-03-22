import { PaymentRequest, PaymentStatus } from './types';

/**
 * In-memory payment store with two indices:
 *   - byId              keyed on internal payment ID
 *   - byProviderTxId    keyed on provider transaction ID → internal ID
 *
 * Swap both Maps for Supabase client calls in production.
 */

const byId = new Map<string, PaymentRequest>();
const byProviderTxId = new Map<string, string>(); // providerTxId → internal id

export async function createPaymentRecord(payment: PaymentRequest): Promise<void> {
  byId.set(payment.id, { ...payment });
  if (payment.providerTransactionId) {
    byProviderTxId.set(payment.providerTransactionId, payment.id);
  }
}

export async function getPaymentById(id: string): Promise<PaymentRequest | null> {
  return byId.get(id) ?? null;
}

export async function getPaymentByTransactionId(transactionId: string): Promise<PaymentRequest | null> {
  const id = byProviderTxId.get(transactionId);
  if (!id) return null;
  return byId.get(id) ?? null;
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
  return true;
}

/** Reset store — for testing only. */
export function _resetPaymentDb(): void {
  byId.clear();
  byProviderTxId.clear();
}
