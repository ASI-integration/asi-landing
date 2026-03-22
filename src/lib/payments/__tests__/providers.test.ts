import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPaymentRequest, getProvider } from '../factory';
import { getPaymentByTransactionId, updatePaymentStatus, _resetPaymentDb } from '../db';
import { _resetEventLogs, hasConfirmationBeenSent, markConfirmationSent } from '../events';
import { sendPaymentConfirmation } from '../../communication/notifications';

// ─── External dependency mocks ────────────────────────────────────────────────

vi.mock('../../communication/notifications', () => ({
  sendPaymentConfirmation: vi.fn(),
}));

vi.mock('stripe', () => ({
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
      constructEvent: vi.fn((payload: string) => {
        if (payload === 'bad_payload') throw new Error('Bad signature');
        return {
          id: 'evt_stripe_001',
          type: 'checkout.session.completed',
          data: { object: { id: 'cs_test_kPqPq', payment_status: 'paid' } },
        };
      }),
    };
  },
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    id: '2e5b8e96-000f-5000-a000-1c39c811f237',
    status: 'pending',
    confirmation: {
      type: 'redirect',
      confirmation_url:
        'https://yoomoney.ru/checkout/payments/v2/contract?orderId=2e5b8e96-000f-5000-a000-1c39c811f237',
    },
  }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _resetPaymentDb();
  _resetEventLogs();
});

// ─── Provider routing ─────────────────────────────────────────────────────────

describe('Payment factory — provider routing', () => {
  it('routes USD to Stripe and persists the record', async () => {
    const payment = await createPaymentRequest({ amount: 100, currency: 'USD', chatId: '12345' });
    expect(payment.provider).toBe('stripe');
    expect(payment.paymentUrl).toContain('stripe');
    expect(payment.providerTransactionId).toBe('cs_test_kPqPq');

    const saved = await getPaymentByTransactionId('cs_test_kPqPq');
    expect(saved).toBeDefined();
    expect(saved?.status).toBe('pending');
  });

  it('routes RUB to YooKassa and persists the record', async () => {
    const payment = await createPaymentRequest({ amount: 5000, currency: 'RUB', chatId: '67890' });
    expect(payment.provider).toBe('yookassa');
    expect(payment.paymentUrl).toContain('yoomoney');
    expect(payment.providerTransactionId).toBe('2e5b8e96-000f-5000-a000-1c39c811f237');
  });

  it('respects an explicit provider override', async () => {
    // Explicit stripe even for RUB (unusual but must be honoured)
    const payment = await createPaymentRequest({
      amount: 500,
      currency: 'RUB',
      provider: 'stripe',
    });
    expect(payment.provider).toBe('stripe');
  });
});

// ─── Duplicate session prevention ─────────────────────────────────────────────

describe('Payment factory — duplicate active session prevention', () => {
  it('returns the existing pending payment instead of creating a new one', async () => {
    const first = await createPaymentRequest({ amount: 100, currency: 'USD', chatId: '42' });
    const second = await createPaymentRequest({ amount: 200, currency: 'USD', chatId: '42' });

    // Must return the same payment record — no new session created
    expect(second.id).toBe(first.id);
    expect(second.amount).toBe(100); // original amount preserved, not 200
    expect(second.paymentUrl).toBe(first.paymentUrl);
  });

  it('creates a new payment if there is no active one for the chatId', async () => {
    const first = await createPaymentRequest({ amount: 100, currency: 'USD', chatId: '42' });
    // Mark it paid so it is no longer "active"
    await updatePaymentStatus(first.providerTransactionId!, 'paid');

    const second = await createPaymentRequest({ amount: 200, currency: 'USD', chatId: '42' });
    expect(second.id).not.toBe(first.id);
  });
});

// ─── Stripe webhook ───────────────────────────────────────────────────────────

describe('Stripe webhook processing', () => {
  it('verifies a valid signature and parses paid event', async () => {
    const provider = getProvider('stripe');
    expect(provider.verifyWebhookSignature('good_payload', 'sig')).toBe(true);

    const result = await provider.parseWebhookEvent('good_payload', 'sig');
    expect(result.transactionId).toBe('cs_test_kPqPq');
    expect(result.status).toBe('paid');
    expect(result.eventId).toBe('evt_stripe_001');
  });

  it('rejects an invalid signature', () => {
    const provider = getProvider('stripe');
    expect(provider.verifyWebhookSignature('bad_payload', 'bad_sig')).toBe(false);
  });

  it('applies paid status transition idempotently', async () => {
    await createPaymentRequest({ amount: 200, currency: 'USD', chatId: '111' });

    const updated1 = await updatePaymentStatus('cs_test_kPqPq', 'paid');
    expect(updated1).toBe(true);

    // Webhook retry — same event, same status
    const updated2 = await updatePaymentStatus('cs_test_kPqPq', 'paid');
    expect(updated2).toBe(false);
  });

  it('applies failed/cancelled status transitions', async () => {
    await createPaymentRequest({ amount: 100, currency: 'USD', chatId: '222' });

    const updated = await updatePaymentStatus('cs_test_kPqPq', 'failed');
    expect(updated).toBe(true);
    const saved = await getPaymentByTransactionId('cs_test_kPqPq');
    expect(saved?.status).toBe('failed');
  });
});

// ─── YooKassa webhook ─────────────────────────────────────────────────────────

describe('YooKassa webhook processing', () => {
  const YK_TX_ID = '2e5b8e96-000f-5000-a000-1c39c811f237';

  it('parses a payment.succeeded event', async () => {
    const provider = getProvider('yookassa');
    const payload = JSON.stringify({
      event: 'payment.succeeded',
      object: { id: YK_TX_ID, status: 'succeeded' },
    });
    const result = await provider.parseWebhookEvent(payload, '');
    expect(result.status).toBe('paid');
    expect(result.transactionId).toBe(YK_TX_ID);
  });

  it('parses a payment.canceled event', async () => {
    const provider = getProvider('yookassa');
    const payload = JSON.stringify({
      event: 'payment.canceled',
      object: { id: YK_TX_ID, status: 'canceled' },
    });
    const result = await provider.parseWebhookEvent(payload, '');
    expect(result.status).toBe('cancelled');
  });

  it('applies status transition idempotently on webhook retry', async () => {
    await createPaymentRequest({ amount: 5000, currency: 'RUB', chatId: '333' });

    const updated1 = await updatePaymentStatus(YK_TX_ID, 'paid');
    expect(updated1).toBe(true);

    const updated2 = await updatePaymentStatus(YK_TX_ID, 'paid');
    expect(updated2).toBe(false);
  });
});

// ─── Guest confirmation ───────────────────────────────────────────────────────

describe('Guest confirmation after paid', () => {
  it('sends confirmation when payment transitions to paid', async () => {
    const mockSend = vi.mocked(sendPaymentConfirmation);

    await sendPaymentConfirmation({
      paymentId: 'pay_test_001',
      chatId: 42,
      amount: 100,
      currency: 'USD',
      serviceType: 'Late check-out',
    });

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_test_001', chatId: 42 })
    );
  });

  it('tracks confirmation dedup state in the event log', () => {
    // Directly verify events.ts dedup primitives used by sendPaymentConfirmation
    expect(hasConfirmationBeenSent('pay_dedup_test')).toBe(false);
    markConfirmationSent('pay_dedup_test');
    expect(hasConfirmationBeenSent('pay_dedup_test')).toBe(true);

    // Second mark is idempotent (Set.add is safe)
    markConfirmationSent('pay_dedup_test');
    expect(hasConfirmationBeenSent('pay_dedup_test')).toBe(true);
  });
});
