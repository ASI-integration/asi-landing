import { afterEach, describe, expect, it, vi } from 'vitest';

const mockGetLocationReportRequestById = vi.fn();
const mockMarkLocationReportRequestPaymentUnlocked = vi.fn();
const mockIsYooKassaEnabled = vi.fn();
const mockProcessPaidReportRequest = vi.fn();

vi.mock('@/lib/location/report-request-store', () => ({
  getLocationReportRequestById: (...args: unknown[]) => mockGetLocationReportRequestById(...args),
  markLocationReportRequestPaymentUnlocked: (...args: unknown[]) =>
    mockMarkLocationReportRequestPaymentUnlocked(...args),
}));

vi.mock('@/lib/payments/yookassa-env', () => ({
  isYooKassaEnabled: () => mockIsYooKassaEnabled(),
  YOOKASSA_PENDING_REVIEW_MESSAGE: 'Оплата будет подключена после финальной проверки отчёта.',
}));

vi.mock('@/lib/location/paid-report-orchestration', () => ({
  processPaidReportRequest: (...args: unknown[]) => mockProcessPaidReportRequest(...args),
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
    mockProcessPaidReportRequest.mockResolvedValue({
      request_id: 'request-1',
      status: 'pdf_ready',
      preliminary_report_url: '/ru/location-report/report-1?view=preliminary',
      final_report_url: '/ru/location-report/report-1',
      pdf_url: '/api/location-report/report-1/pdf',
      generated_at: '2026-05-20T10:00:00.000Z',
      updated_at: '2026-05-20T10:00:00.000Z',
    });
    const { POST } = await import('../route');

    const res = await POST(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockMarkLocationReportRequestPaymentUnlocked).toHaveBeenCalledWith('request-1');
    expect(mockProcessPaidReportRequest).toHaveBeenCalledWith('request-1');
    expect(body).toMatchObject({
      requestId: 'request-1',
      status: 'pdf_ready',
      paymentStatus: 'paid_unlocked',
      yookassa: 'disabled',
      next: '/ru/location-report/status?requestId=request-1',
      report_artifact: {
        request_id: 'request-1',
        status: 'pdf_ready',
        preliminary_report_url: '/ru/location-report/report-1?view=preliminary',
        final_report_url: '/ru/location-report/report-1',
        pdf_url: '/api/location-report/report-1/pdf',
      },
      process: { triggered: true },
    });
  });

  it('returns a user-safe 503 when the report pipeline is not ready', async () => {
    const { ReportPipelineNotReadyError } = await import('@/lib/location/report-pipeline-not-ready-error');
    mockIsYooKassaEnabled.mockReturnValue(false);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-not-ready',
      access_tier: 'paid_required',
      payment_status: 'pending_payment',
      status: 'queued',
      report_id: null,
    });
    mockProcessPaidReportRequest.mockRejectedValue(
      new ReportPipelineNotReadyError({
        ready: false,
        checked_at: '2026-05-20T10:00:00.000Z',
        blockers: ['supabase_env_missing'],
        warnings: [],
        checks: [],
        metadata: {
          env: {
            supabase_url: 'missing',
            supabase_service_role_key: 'missing',
            report_debug_token: 'present',
            location_report_manual_confirm_key: 'missing',
            node_env: 'test',
          },
        },
      }),
    );
    const { POST } = await import('../route');

    const res = await POST(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-not-ready' }),
    });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      requestId: 'request-not-ready',
      status: 'report_forming',
      paymentStatus: 'paid_unlocked',
      error: 'report_pipeline_not_ready',
      retryable: true,
      next: '/ru/location-report/status?requestId=request-not-ready',
      process: { triggered: false },
    });
    expect(body.message).toBe(
      'Оплата прошла, но отчёт временно не может быть сформирован. Мы сохранили заявку и вернёмся к формированию после восстановления сервиса.',
    );
    expect(body.metadata).toBeUndefined();
    expect(body.blockers).toBeUndefined();
    expect(body.checks).toBeUndefined();
    expect(mockMarkLocationReportRequestPaymentUnlocked).toHaveBeenCalledWith('request-not-ready');
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
    expect(mockProcessPaidReportRequest).not.toHaveBeenCalled();
  });
});
