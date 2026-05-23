import { afterEach, describe, expect, it, vi } from 'vitest';

const mockGetLocationReportRequestById = vi.fn();
const mockGetReportArtifactByRequestId = vi.fn();
const mockGetDeliveriesByRequestId = vi.fn();
const mockGetActiveEntitlements = vi.fn();
const mockListAuditEventsByRequestId = vi.fn();

vi.mock('@/lib/location/report-request-store', () => ({
  getLocationReportRequestById: (...args: unknown[]) => mockGetLocationReportRequestById(...args),
}));

vi.mock('@/lib/location/report-artifact-repository', () => ({
  reportArtifactRepository: {
    getByRequestId: (...args: unknown[]) => mockGetReportArtifactByRequestId(...args),
  },
}));

vi.mock('@/lib/location/report-delivery-repository', () => ({
  reportDeliveryRepository: {
    getDeliveriesByRequestId: (...args: unknown[]) => mockGetDeliveriesByRequestId(...args),
  },
}));

vi.mock('@/lib/location/report-access-entitlement-repository', () => ({
  reportAccessEntitlementRepository: {
    getActiveEntitlements: (...args: unknown[]) => mockGetActiveEntitlements(...args),
  },
}));

vi.mock('@/lib/location/report-audit-repository', () => ({
  reportAuditRepository: {
    listAuditEventsByRequestId: (...args: unknown[]) => mockListAuditEventsByRequestId(...args),
  },
}));

afterEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('GET /api/location-full-report/request/[requestId]/status', () => {
  it('returns the current stored report artifact payload', async () => {
    mockGetDeliveriesByRequestId.mockResolvedValue([]);
    mockGetActiveEntitlements.mockResolvedValue([]);
    mockListAuditEventsByRequestId.mockResolvedValue([]);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-1',
      payment_status: 'paid_unlocked',
      status: 'queued',
      report_id: null,
      created_at: '2026-05-20T09:00:00.000Z',
      updated_at: '2026-05-20T09:01:00.000Z',
    });
    mockGetReportArtifactByRequestId.mockResolvedValue({
      request_id: 'request-1',
      status: 'preliminary_ready',
      preliminary_report_url: '/ru/location-report/report-1?view=preliminary',
      final_report_url: null,
      pdf_url: null,
      generated_at: null,
      expires_at: null,
      cleanup_ready: false,
      created_at: '2026-05-20T09:02:00.000Z',
      updated_at: '2026-05-20T09:02:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetReportArtifactByRequestId).toHaveBeenCalledWith('request-1');
    expect(body).toMatchObject({
      access_status: 'paid_unlocked',
      request_status: 'queued',
      request_id: 'request-1',
      status: 'preliminary_ready',
      preliminary_report_url: '/ru/location-report/report-1?view=preliminary',
      final_report_url: null,
      pdf_url: null,
      generated_at: null,
      updated_at: '2026-05-20T09:02:00.000Z',
    });
    expect(body.metadata).toBeUndefined();
    expect(body.cleanup_ready).toBeUndefined();
  });

  it('does not expose artifact metadata or internal audit messages', async () => {
    mockGetDeliveriesByRequestId.mockResolvedValue([]);
    mockGetActiveEntitlements.mockResolvedValue([]);
    mockListAuditEventsByRequestId.mockResolvedValue([
      {
        event_id: 'event-debug',
        request_id: 'request-meta',
        report_id: 'report-meta',
        snapshot_id: null,
        event_type: 'orchestration.failed',
        layer: 'lifecycle',
        status: 'failed',
        message: 'supabase_secret_missing',
        created_at: '2026-05-20T09:00:00.000Z',
        metadata: { readiness_blockers: ['supabase_env_missing'], trace: 'internal' },
      },
    ]);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-meta',
      payment_status: 'paid_unlocked',
      status: 'processing',
      report_id: 'report-meta',
      created_at: '2026-05-20T09:00:00.000Z',
      updated_at: '2026-05-20T09:01:00.000Z',
    });
    mockGetReportArtifactByRequestId.mockResolvedValue({
      request_id: 'request-meta',
      status: 'report_forming',
      preliminary_report_url: null,
      final_report_url: null,
      pdf_url: null,
      generated_at: null,
      expires_at: null,
      cleanup_ready: true,
      metadata: {
        canonical_document: { sections: [] },
        adapter_summary: { source: 'debug' },
      },
      created_at: '2026-05-20T09:02:00.000Z',
      updated_at: '2026-05-20T09:02:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-meta' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.metadata).toBeUndefined();
    expect(body.cleanup_ready).toBeUndefined();
    expect(body.audit_summary?.latest_event?.message).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('readiness_blockers');
    expect(JSON.stringify(body)).not.toContain('canonical_document');
  });

  it('includes audit summary counts when audit events exist', async () => {
    mockGetDeliveriesByRequestId.mockResolvedValue([]);
    mockGetActiveEntitlements.mockResolvedValue([]);
    mockListAuditEventsByRequestId.mockResolvedValue([
      {
        event_id: 'event-1',
        request_id: 'request-audit',
        report_id: 'report-audit',
        snapshot_id: null,
        event_type: 'orchestration.started',
        layer: 'lifecycle',
        status: 'started',
        message: null,
        created_at: '2026-05-20T09:00:00.000Z',
        metadata: {},
      },
      {
        event_id: 'event-2',
        request_id: 'request-audit',
        report_id: 'report-audit',
        snapshot_id: null,
        event_type: 'materialization.stale_detected',
        layer: 'materialization',
        status: 'warning',
        message: 'stale',
        created_at: '2026-05-20T10:00:00.000Z',
        metadata: {},
      },
      {
        event_id: 'event-3',
        request_id: 'request-audit',
        report_id: 'report-audit',
        snapshot_id: null,
        event_type: 'orchestration.failed',
        layer: 'lifecycle',
        status: 'failed',
        message: 'boom',
        created_at: '2026-05-20T10:05:00.000Z',
        metadata: {},
      },
    ]);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-audit',
      payment_status: 'paid_unlocked',
      status: 'failed',
      report_id: 'report-audit',
      created_at: '2026-05-20T09:00:00.000Z',
      updated_at: '2026-05-20T10:05:00.000Z',
    });
    mockGetReportArtifactByRequestId.mockResolvedValue({
      request_id: 'request-audit',
      status: 'failed',
      preliminary_report_url: null,
      final_report_url: null,
      pdf_url: null,
      generated_at: null,
      expires_at: null,
      cleanup_ready: false,
      created_at: '2026-05-20T09:02:00.000Z',
      updated_at: '2026-05-20T10:05:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-audit' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.audit_summary).toEqual({
      latest_event: {
        event_type: 'orchestration.failed',
        layer: 'lifecycle',
        status: 'failed',
        created_at: '2026-05-20T10:05:00.000Z',
      },
      warning_count: 1,
      failure_count: 1,
    });
  });

  it('includes delivery summary when deliveries exist', async () => {
    mockGetActiveEntitlements.mockResolvedValue([]);
    mockListAuditEventsByRequestId.mockResolvedValue([]);
    mockGetDeliveriesByRequestId.mockResolvedValue([
      {
        delivery_id: 'delivery-1',
        request_id: 'request-3',
        snapshot_id: 'snapshot-1',
        channel: 'cabinet',
        status: 'ready',
        target: '/ru/location-report/status?requestId=request-3',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T10:00:00.000Z',
        delivered_at: null,
        metadata: {},
      },
      {
        delivery_id: 'delivery-2',
        request_id: 'request-3',
        snapshot_id: 'snapshot-1',
        channel: 'permalink',
        status: 'ready',
        target: '/ru/location-report/report-3',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T10:00:00.000Z',
        delivered_at: null,
        metadata: {},
      },
      {
        delivery_id: 'delivery-3',
        request_id: 'request-3',
        snapshot_id: 'snapshot-1',
        channel: 'pdf_download',
        status: 'ready',
        target: '/ru/report/report-3/pdf',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T10:00:00.000Z',
        delivered_at: null,
        metadata: {},
      },
      {
        delivery_id: 'delivery-4',
        request_id: 'request-3',
        snapshot_id: 'snapshot-1',
        channel: 'email',
        status: 'skipped',
        target: null,
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T10:00:00.000Z',
        delivered_at: null,
        metadata: { reason: 'missing_email_target' },
      },
    ]);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-3',
      payment_status: 'paid_unlocked',
      status: 'completed',
      report_id: 'report-3',
      created_at: '2026-05-20T09:00:00.000Z',
      updated_at: '2026-05-20T09:03:00.000Z',
    });
    mockGetReportArtifactByRequestId.mockResolvedValue({
      request_id: 'request-3',
      status: 'pdf_ready',
      preliminary_report_url: '/preliminary',
      final_report_url: '/final',
      pdf_url: '/pdf',
      generated_at: '2026-05-20T09:03:00.000Z',
      expires_at: null,
      cleanup_ready: false,
      created_at: '2026-05-20T09:02:00.000Z',
      updated_at: '2026-05-20T09:03:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-3' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.delivery_summary).toEqual({
      cabinet: 'ready',
      permalink: 'ready',
      pdf: 'ready',
      email: 'skipped',
    });
  });

  it('includes access summary when active entitlements exist', async () => {
    mockGetDeliveriesByRequestId.mockResolvedValue([]);
    mockListAuditEventsByRequestId.mockResolvedValue([]);
    mockGetActiveEntitlements.mockResolvedValue([
      {
        entitlement_id: 'entitlement-1',
        request_id: 'request-4',
        report_id: 'report-4',
        snapshot_id: 'snapshot-1',
        subject_type: 'guest',
        subject_id: 'request-4',
        access_level: 'admin',
        status: 'active',
        expires_at: null,
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T10:00:00.000Z',
        metadata: {},
      },
    ]);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-4',
      payment_status: 'paid_unlocked',
      status: 'completed',
      report_id: 'report-4',
      created_at: '2026-05-20T09:00:00.000Z',
      updated_at: '2026-05-20T09:03:00.000Z',
    });
    mockGetReportArtifactByRequestId.mockResolvedValue({
      request_id: 'request-4',
      status: 'pdf_ready',
      preliminary_report_url: '/preliminary',
      final_report_url: '/final',
      pdf_url: '/pdf',
      generated_at: '2026-05-20T09:03:00.000Z',
      expires_at: null,
      cleanup_ready: false,
      created_at: '2026-05-20T09:02:00.000Z',
      updated_at: '2026-05-20T09:03:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-4' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.access_summary).toEqual({
      preview: true,
      full_report: true,
      pdf: true,
    });
  });

  it('derives a ready artifact from the existing request state when memory is empty', async () => {
    mockGetDeliveriesByRequestId.mockResolvedValue([]);
    mockGetActiveEntitlements.mockResolvedValue([]);
    mockListAuditEventsByRequestId.mockResolvedValue([]);
    mockGetReportArtifactByRequestId.mockResolvedValue(null);
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-2',
      payment_status: 'paid_unlocked',
      status: 'completed',
      report_id: 'report-2',
      created_at: '2026-05-20T09:00:00.000Z',
      updated_at: '2026-05-20T09:03:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'request-2' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      request_id: 'request-2',
      status: 'pdf_ready',
      preliminary_report_url: '/ru/location-report/report-2?view=preliminary',
      final_report_url: '/ru/location-report/report-2',
      pdf_url: '/api/location-report/report-2/pdf',
      generated_at: '2026-05-20T09:03:00.000Z',
      updated_at: '2026-05-20T09:03:00.000Z',
    });
  });

  it('returns not_found for unknown requests', async () => {
    mockGetDeliveriesByRequestId.mockResolvedValue([]);
    mockGetActiveEntitlements.mockResolvedValue([]);
    mockListAuditEventsByRequestId.mockResolvedValue([]);
    mockGetLocationReportRequestById.mockResolvedValue(null);
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost') as any, {
      params: Promise.resolve({ requestId: 'missing' }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('not_found');
  });
});
