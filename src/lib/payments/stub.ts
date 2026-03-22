import { PaymentRequest } from '../communication/types';

// In-memory mock database
const paymentStore = new Map<string, PaymentRequest>();

export function createPaymentRequest(chatId: number, amount: number, description?: string): string {
  const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  paymentStore.set(id, {
    id,
    chatId,
    amount,
    currency: 'USD',
    status: 'pending',
    description,
  });
  return id;
}

export function getPaymentRequest(id: string): PaymentRequest | undefined {
  return paymentStore.get(id);
}

export function confirmPayment(id: string): boolean {
  const req = paymentStore.get(id);
  if (!req) return false;
  req.status = 'paid';
  return true;
}
