import { afterEach, describe, expect, it, vi } from 'vitest';

const mockGetLocationReportRequestById = vi.fn();
const mockMarkLocationReportRequestPaymentUnlocked = vi.fn();
const mockIsYooKassaEnabled = vi.fn();

vi.mock('@/lib/location/report-request-store', () => ({
  getLocationReportRequestById: (...args: unknown[]) => mockGetLocationReportRequestById(...args),
  markLocationReportRequestPaymentUnlocked: (...args: unknown[]) =>
    mockMarkLocationReportRequestPaymentUnlocked(...args),
}));

vi.mock('@/lib/payments/yookassa-env', () => ({
  isYooKassaEnabled: () => mockIsYooKassaEnabled(),
  YOOKASSA_PENDING_REVIEW_MESSAGE: 'Оплата будет подключена после финальной проверки отчёта.',
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('POST /api/location-full-report/request/[requestId]/simulate-payment', () => {
  it('marks a paid-required report request as unlocked without creating a YooKassa payment', async () => {
    mockIsYooKassaEnabled.mockReturnValue(false);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-1',
      access_tier: 'paid_required',
      payment_status: 'pending_payment',
      status: 'queued',
      report_id: null,
    });
    const { POST } = await import('../route');

    const res = await POST(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockMarkLocationReportRequestPaymentUnlocked).toHaveBeenCalledWith('request-1');
    expect(body).toMatchObject({
      requestId: 'request-1',
      paymentStatus: 'paid_unlocked',
      yookassa: 'disabled',
      next: '/dashboard/reports/request-1',
      process: {
        method: 'POST',
        url: '/api/location-full-report/process',
        body: { requestId: 'request-1' },
      },
    });
  });

  it('does not expose the simulation path when YooKassa is enabled', async () => {
    mockIsYooKassaEnabled.mockReturnValue(true);
    const { POST } = await import('../route');

    const res = await POST(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('simulation_disabled');
    expect(mockGetLocationReportRequestById).not.toHaveBeenCalled();
    expect(mockMarkLocationReportRequestPaymentUnlocked).not.toHaveBeenCalled();
  });
});
