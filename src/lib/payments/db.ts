import { PaymentRequest, PaymentStatus } from './types';

// Mock DB for the sake of decoupling the orchestrator from raw SQL.
// In a real app, this wraps Supabase calls.
const _db = new Map<string, PaymentRequest>();

export async function createPaymentRecord(payment: PaymentRequest): Promise<void> {
  _db.set(payment.id, payment);
  _db.set(payment.providerTransactionId!, payment); // index by provider ID too
}

export async function getPaymentByTransactionId(transactionId: string): Promise<PaymentRequest | null> {
  return _db.get(transactionId) || null;
}

export async function updatePaymentStatus(transactionId: string, status: PaymentStatus): Promise<boolean> {
  const payment = _db.get(transactionId);
  if (!payment) return false;
  if (payment.status === status) return false; // Indempotency safeguard

  payment.status = status;
  payment.updatedAt = new Date();
  _db.set(transactionId, payment);
  return true;
}
