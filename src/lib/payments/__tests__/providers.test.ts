import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPaymentRequest, getProvider } from '../factory';
import { getPaymentByTransactionId, updatePaymentStatus } from '../db';
import { StripeProvider } from '../stripe';
import { YookassaProvider } from '../yookassa';
import { sendPaymentConfirmation } from '../../communication/notifications';

// Mocks
vi.mock('../../communication/notifications', () => ({
  sendPaymentConfirmation: vi.fn(),
}));

vi.mock('stripe', () => {
  return {
    default: class StripeMock {
      checkout = {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test_kPqPq',
            url: 'https://checkout.stripe.test/c/pay/cs_test_kPqPq',
          }),
        },
      };
      webhooks = {
        constructEvent: vi.fn((payload) => {
          if (payload === 'bad_payload') throw new Error('Bad signature');
          return {
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_test_kPqPq', payment_status: 'paid' } }
          };
        }),
      };
    }
  };
});

// Mock fetch for Yookassa
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    id: '2e5b8e96-000f-5000-a000-1c39c811f237',
    status: 'pending',
    confirmation: {
      type: 'redirect',
      confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=2e5b8e96-000f-5000-a000-1c39c811f237',
    },
  }),
});

describe('Payment Factory & Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes USD to Stripe and tracks it in DB', async () => {
    const payment = await createPaymentRequest(100, 'USD', { chatId: 12345 });
    expect(payment.provider).toBe('stripe');
    expect(payment.checkoutUrl).toContain('stripe');
    expect(payment.providerTransactionId).toBe('cs_test_kPqPq');

    const saved = await getPaymentByTransactionId('cs_test_kPqPq');
    expect(saved).toBeDefined();
    expect(saved?.status).toBe('pending');
  });

  it('routes RUB to Yookassa and tracks it in DB', async () => {
    const payment = await createPaymentRequest(5000, 'RUB', { chatId: 67890 });
    expect(payment.provider).toBe('yookassa');
    expect(payment.checkoutUrl).toContain('yoomoney');
    expect(payment.providerTransactionId).toBe('2e5b8e96-000f-5000-a000-1c39c811f237');
  });

  it('processes Stripe webhook successfully and triggers idempotency', async () => {
    const provider = getProvider('stripe');
    
    // Create record first
    await createPaymentRequest(200, 'USD', { chatId: 111 });

    const payload = 'good_payload';
    const sig = 'sig';

    expect(provider.verifyWebhookSignature(payload, sig)).toBe(true);

    const { transactionId, status } = await provider.parseWebhookEvent(payload, sig);
    expect(transactionId).toBe('cs_test_kPqPq');
    expect(status).toBe('paid');

    // Idempotency check 1
    const updated1 = await updatePaymentStatus(transactionId, status);
    expect(updated1).toBe(true);
    
    // Idempotency check 2 (webhook retry)
    const updated2 = await updatePaymentStatus(transactionId, status);
    expect(updated2).toBe(false);
  });

  it('processes Yookassa webhook safely', async () => {
    const provider = getProvider('yookassa');
    const payload = JSON.stringify({
      event: 'payment.canceled',
      object: { id: '2e5b8e96-000f-5000-a000-1c39c811f237', status: 'canceled' }
    });

    const parsed = await provider.parseWebhookEvent(payload, '');
    expect(parsed.status).toBe('cancelled');
    expect(parsed.transactionId).toBe('2e5b8e96-000f-5000-a000-1c39c811f237');
  });
});
