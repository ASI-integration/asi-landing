import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyWebhookSignature = vi.fn();
const mockParseWebhookEvent = vi.fn();
const mockHasWebhookBeenProcessed = vi.fn();
const mockMarkWebhookProcessed = vi.fn();
const mockConfirmLocationReportPayment = vi.fn();
const mockGetLocationReportRequestById = vi.fn();
const mockGetLocationReportRequestByPaymentId = vi.fn();
const mockGetPaymentByTransactionId = vi.fn();
const mockUpdatePaymentStatus = vi.fn();

vi.mock('@/lib/payments/factory', () => ({
  getProvider: () => ({
    verifyWebhookSignature: (...args: unknown[]) => mockVerifyWebhookSignature(...args),
    parseWebhookEvent: (...args: unknown[]) => mockParseWebhookEvent(...args),
  }),
}));

vi.mock('@/lib/payments/events', () => ({
  hasWebhookBeenProcessed: (...args: unknown[]) => mockHasWebhookBeenProcessed(...args),
  markWebhookProcessed: (...args: unknown[]) => mockMarkWebhookProcessed(...args),
}));

vi.mock('@/lib/location/report-request-store', () => ({
  confirmLocationReportPayment: (...args: unknown[]) => mockConfirmLocationReportPayment(...args),
  getLocationReportRequestById: (...args: unknown[]) => mockGetLocationReportRequestById(...args),
  getLocationReportRequestByPaymentId: (...args: unknown[]) => mockGetLocationReportRequestByPaymentId(...args),
}));

vi.mock('@/lib/payments/db', () => ({
  getPaymentByTransactionId: (...args: unknown[]) => mockGetPaymentByTransactionId(...args),
  updatePaymentStatus: (...args: unknown[]) => mockUpdatePaymentStatus(...args),
}));

vi.mock('@/lib/communication/notifications', () => ({
  sendPaymentConfirmation: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: vi.fn(),
}));

vi.mock('@/lib/communication/session-status', () => ({
  SessionStatus: { Paid: 'paid', Cancelled: 'cancelled' },
  transitionSessionStatus: vi.fn(),
}));

import { handleYookassaWebhook } from '../handle-yookassa-webhook';

function makeWebhookRequest(): Request {
  return new Request('http://localhost/api/webhooks/yookassa', {
    method: 'POST',
    body: JSON.stringify({ event: 'payment.succeeded' }),
  });
}

function mockLocationReportWebhook(paymentId = 'yk_pay_123') {
  mockParseWebhookEvent.mockResolvedValue({
    transactionId: paymentId,
    status: 'paid',
    eventId: paymentId,
    rawEvent: {
      event: 'payment.succeeded',
      object: {
        id: paymentId,
        metadata: {
          location_report_request_id: 'req_123',
          product_type: 'location_report_detail',
        },
      },
    },
  });
}

describe('handleYookassaWebhook location report safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyWebhookSignature.mockReturnValue(true);
    mockHasWebhookBeenProcessed.mockReturnValue(false);
    mockLocationReportWebhook();
    mockGetPaymentByTransactionId.mockResolvedValue(null);
    mockUpdatePaymentStatus.mockResolvedValue(false);
  });

  it('skips an already processed YooKassa event without granting access again', async () => {
    mockHasWebhookBeenProcessed.mockReturnValue(true);

    const res = await handleYookassaWebhook(makeWebhookRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(mockConfirmLocationReportPayment).not.toHaveBeenCalled();
    expect(mockGetLocationReportRequestById).not.toHaveBeenCalled();
  });

  it('grants a location report only when the stored payment_id matches YooKassa object.id', async () => {
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'req_123',
      payment_provider: 'yookassa',
      payment_id: 'yk_pay_123',
      product_type: 'location_report_detail',
    });
    mockConfirmLocationReportPayment.mockResolvedValue({ id: 'req_123' });

    const res = await handleYookassaWebhook(makeWebhookRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(mockConfirmLocationReportPayment).toHaveBeenCalledWith('req_123', {
      paymentId: 'yk_pay_123',
      paymentProvider: 'yookassa',
    });
    expect(mockMarkWebhookProcessed).toHaveBeenCalledWith('yookassa', 'yk_pay_123');
  });

  it('does not grant access when webhook metadata points at a request with another payment_id', async () => {
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'req_123',
      payment_provider: 'yookassa',
      payment_id: 'yk_other',
      product_type: 'location_report_detail',
    });

    const res = await handleYookassaWebhook(makeWebhookRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(mockConfirmLocationReportPayment).not.toHaveBeenCalled();
    expect(mockMarkWebhookProcessed).toHaveBeenCalledWith('yookassa', 'yk_pay_123');
  });
});
