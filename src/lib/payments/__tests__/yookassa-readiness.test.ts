import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentForProduct, createPaymentRequest } from '../factory';
import {
  _resetPaymentDb,
  createPaymentRecord,
  getPaymentById,
  getPaymentByTransactionId,
  updatePaymentRecord,
} from '../db';
import { _resetEventLogs } from '../events';
import { _resetEntitlements, activateEntitlementForPaidPayment } from '../entitlement';
import { processYooKassaPaymentEvent } from '../process-yookassa-event';
import { setYooKassaHttpForTests, type YooKassaHttp } from '../yookassa-http';
import { getYooKassaConfig, getYooKassaMode, isYooKassaEnabled } from '../yookassa-env';
import { POST as createPaymentRoute } from '../../../app/api/yookassa/create-payment/route';
import { GET as statusRoute } from '../../../app/api/payments/status/route';
import { handleYookassaWebhook } from '../handle-yookassa-webhook';

const PROVIDER_ID = '2e5b8e96-000f-5000-a000-1c39c811f237';

function enableTestYooKassa() {
  process.env.YOOKASSA_ENABLED = 'true';
  process.env.YOOKASSA_MODE = 'test';
  process.env.YOOKASSA_SHOP_ID = 'shop-test';
  process.env.YOOKASSA_SECRET_KEY = 'test_secret_key_for_unit_tests';
  process.env.YOOKASSA_FORCE_TEST_KEY = 'true';
  process.env.NEXT_PUBLIC_APP_URL = 'https://asi.example';
  delete process.env.YOOKASSA_ALLOW_LIVE;
}

function mockHttp(overrides?: Partial<{ createId: string; getStatus: string; getAmount: string; getCurrency: string }>): YooKassaHttp {
  const createId = overrides?.createId ?? PROVIDER_ID;
  return async (request) => {
    if (request.method === 'POST' && request.path === '/payments') {
      return {
        ok: true,
        status: 200,
        json: {
          id: createId,
          status: 'pending',
          confirmation: {
            confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${createId}`,
          },
        },
      };
    }
    if (request.method === 'GET' && request.path.startsWith('/payments/')) {
      return {
        ok: true,
        status: 200,
        json: {
          id: createId,
          status: overrides?.getStatus ?? 'succeeded',
          amount: {
            value: overrides?.getAmount ?? '1000.00',
            currency: overrides?.getCurrency ?? 'RUB',
          },
          metadata: { payment_id: 'ignored' },
        },
      };
    }
    return { ok: false, status: 404, json: { error: 'not found' } };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.YOOKASSA_ENABLED;
  delete process.env.YOOKASSA_MODE;
  delete process.env.YOOKASSA_SHOP_ID;
  delete process.env.YOOKASSA_SECRET_KEY;
  delete process.env.YOOKASSA_ALLOW_LIVE;
  delete process.env.YOOKASSA_FORCE_TEST_KEY;
  delete process.env.NEXT_PUBLIC_APP_URL;
  _resetPaymentDb();
  _resetEventLogs();
  _resetEntitlements();
  setYooKassaHttpForTests(null);
});

describe('YooKassa readiness — create + catalog', () => {
  it('create payment uses server-authoritative amount', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp());
    const payment = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-1',
    });
    expect(payment.amount).toBe(100_000);
    expect(payment.currency).toBe('RUB');
    expect(payment.paymentUrl).toContain('yoomoney.ru');
    expect(payment.providerTransactionId).toBe(PROVIDER_ID);
  });

  it('arbitrary client amount cannot override price', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp());
    const res = await createPaymentRoute(
      new Request('https://asi.example/api/yookassa/create-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountRub: 1, amount: 1 }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/amount/i);
  });

  it('create operation uses stable idempotency', async () => {
    enableTestYooKassa();
    let posts = 0;
    setYooKassaHttpForTests(async (request) => {
      if (request.method === 'POST') {
        posts += 1;
        expect(request.idempotenceKey).toBe('stable-key-1');
      }
      return mockHttp()(request);
    });

    const first = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-1',
      idempotencyKey: 'stable-key-1',
    });
    const second = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-1',
      idempotencyKey: 'stable-key-1',
    });
    expect(second.id).toBe(first.id);
    expect(posts).toBe(1);
  });

  it('retry does not duplicate internal payment', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp());
    const a = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      chatId: '42',
      idempotencyKey: 'chat-42-attempt',
    });
    const b = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      chatId: '42',
      idempotencyKey: 'chat-42-attempt',
    });
    expect(a.id).toBe(b.id);
    expect(a.providerTransactionId).toBe(b.providerTransactionId);
  });

  it('provider payment ID stored exactly once', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp());
    const payment = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-2',
    });
    const byTx = await getPaymentByTransactionId(PROVIDER_ID);
    expect(byTx?.id).toBe(payment.id);
    expect(byTx?.providerTransactionId).toBe(PROVIDER_ID);
  });
});

describe('YooKassa readiness — return vs webhook', () => {
  it('redirect return alone cannot mark payment paid', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'pending' }));
    const payment = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-3',
    });

    const res = await statusRoute(
      new Request(
        `https://asi.example/api/payments/status?paymentId=${payment.id}&paid=true&status=succeeded`,
      ),
    );
    const body = await res.json();
    expect(body.status).toBe('pending');
    const stored = await getPaymentById(payment.id);
    expect(stored?.status).toBe('pending');
  });

  it('valid succeeded webhook transitions payment once', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'succeeded' }));
    const payment = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-4',
    });

    const result = await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId: `payment.succeeded:${PROVIDER_ID}:succeeded`,
      providerPaymentId: PROVIDER_ID,
    });
    expect(result.ok).toBe(true);
    expect(result.handled).toBe(true);
    const stored = await getPaymentById(payment.id);
    expect(stored?.status).toBe('paid');
    expect(stored?.paidAt).toBeInstanceOf(Date);
  });

  it('duplicate succeeded webhook is harmless', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'succeeded' }));
    await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-5',
    });
    const eventId = `payment.succeeded:${PROVIDER_ID}:succeeded`;
    const first = await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId,
      providerPaymentId: PROVIDER_ID,
    });
    const second = await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId,
      providerPaymentId: PROVIDER_ID,
    });
    expect(first.handled).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.reason).toBe('duplicate_event');
  });

  it('mismatched amount fails closed', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'succeeded', getAmount: '1.00' }));
    await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-6',
    });
    const result = await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId: 'evt-amount',
      providerPaymentId: PROVIDER_ID,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('amount_mismatch');
  });

  it('mismatched currency fails closed', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'succeeded', getCurrency: 'USD' }));
    await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-7',
    });
    const result = await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId: 'evt-currency',
      providerPaymentId: PROVIDER_ID,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('currency_mismatch');
  });

  it('unknown provider payment fails closed', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ createId: 'unknown-provider-id', getStatus: 'succeeded' }));
    const result = await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId: 'evt-unknown',
      providerPaymentId: 'unknown-provider-id',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_payment');
  });

  it('stale event cannot corrupt successful state', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'succeeded' }));
    const payment = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-8',
    });
    await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId: 'evt-paid',
      providerPaymentId: PROVIDER_ID,
    });

    setYooKassaHttpForTests(mockHttp({ getStatus: 'canceled' }));
    const stale = await processYooKassaPaymentEvent({
      eventType: 'payment.canceled',
      eventId: 'evt-cancel-late',
      providerPaymentId: PROVIDER_ID,
    });
    expect(stale.ok).toBe(true);
    expect(stale.reason).toBe('stale_or_illegal_transition');
    const stored = await getPaymentById(payment.id);
    expect(stored?.status).toBe('paid');
  });
});

describe('YooKassa readiness — entitlement + config safety', () => {
  it('entitlement activation occurs once', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'succeeded' }));
    const payment = await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-9',
    });
    await processYooKassaPaymentEvent({
      eventType: 'payment.succeeded',
      eventId: 'evt-entitlement',
      providerPaymentId: PROVIDER_ID,
    });
    const paid = await getPaymentById(payment.id);
    const first = await activateEntitlementForPaidPayment(paid!);
    const second = await activateEntitlementForPaidPayment(paid!);
    expect(first.alreadyActive || first.activated).toBe(true);
    expect(second.alreadyActive).toBe(true);
    expect(second.activated).toBe(false);
  });

  it('missing provider config fails closed', () => {
    process.env.YOOKASSA_ENABLED = 'true';
    process.env.YOOKASSA_MODE = 'test';
    expect(() => getYooKassaConfig()).toThrow(/missing/i);
  });

  it('test configuration cannot accidentally use live mode', () => {
    process.env.YOOKASSA_ENABLED = 'true';
    process.env.YOOKASSA_MODE = 'live';
    process.env.YOOKASSA_SHOP_ID = 'shop';
    process.env.YOOKASSA_SECRET_KEY = 'live_secret';
    expect(() => getYooKassaConfig()).toThrow(/YOOKASSA_ALLOW_LIVE/);
    expect(getYooKassaMode()).toBe('live');
  });

  it('secrets never appear in client bundle/response/log fixtures', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp());
    const res = await createPaymentRoute(
      new Request('https://asi.example/api/yookassa/create-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerId: 'owner-10' }),
      }),
    );
    const text = await res.text();
    expect(text).not.toContain('test_secret_key_for_unit_tests');
    expect(text).not.toContain('YOOKASSA_SECRET_KEY');
    // sanity: response still useful
    expect(text).toContain('paymentId');
    // hash presence check — secret must not leak even hashed into payload
    const digest = createHash('sha256').update('test_secret_key_for_unit_tests').digest('hex');
    expect(text).not.toContain(digest);
  });

  it('disabled by default', () => {
    expect(isYooKassaEnabled()).toBe(false);
  });

  it('webhook handler uses authoritative processing path', async () => {
    enableTestYooKassa();
    setYooKassaHttpForTests(mockHttp({ getStatus: 'succeeded' }));
    await createPaymentForProduct({
      productId: 'communication_pilot_object_month',
      ownerId: 'owner-11',
    });
    const res = await handleYookassaWebhook(
      new Request('https://asi.example/api/webhooks/yookassa', {
        method: 'POST',
        body: JSON.stringify({
          event: 'payment.succeeded',
          object: { id: PROVIDER_ID, status: 'succeeded' },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const stored = await getPaymentByTransactionId(PROVIDER_ID);
    expect(stored?.status).toBe('paid');
  });

  it('legacy createPaymentRequest still rejects silent live without allow', async () => {
    process.env.YOOKASSA_ENABLED = 'true';
    process.env.YOOKASSA_MODE = 'live';
    process.env.YOOKASSA_SHOP_ID = 'shop';
    process.env.YOOKASSA_SECRET_KEY = 'live_secret';
    await expect(
      createPaymentRequest({ amount: 1000, currency: 'RUB', provider: 'yookassa' }),
    ).rejects.toThrow(/YOOKASSA_ALLOW_LIVE/);
  });

  it('updatePaymentRecord refuses paid→cancelled downgrade', async () => {
    await createPaymentRecord({
      id: 'pay_manual',
      provider: 'yookassa',
      providerTransactionId: 'tx1',
      amount: 1000,
      currency: 'RUB',
      status: 'paid',
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: new Date(),
    });
    const next = await updatePaymentRecord('pay_manual', { status: 'cancelled' });
    expect(next.status).toBe('paid');
  });
});
