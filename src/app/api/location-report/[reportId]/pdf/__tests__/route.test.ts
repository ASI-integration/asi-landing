import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationStandaloneReport } from '@/lib/location/standalone-report';

const mockGetStandaloneReportById = vi.fn();
const mockRenderLocationReportPdfFromPrintRoute = vi.fn();

vi.mock('@/lib/location/standalone-report-store', () => ({
  getStandaloneReportById: (...args: unknown[]) => mockGetStandaloneReportById(...args),
}));

vi.mock('@/lib/location/location-report-print-pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/location/location-report-print-pdf')>();
  return {
    ...actual,
    locationReportPdfFilename: (reportId: string) => `location-report-${reportId}.pdf`,
    renderLocationReportPdfFromPrintRoute: (...args: unknown[]) =>
      mockRenderLocationReportPdfFromPrintRoute(...args),
    logLocationReportPdfFailure: vi.fn(),
  };
});

const report: LocationStandaloneReport = {
  version: 'v1',
  reportMode: 'paid',
  accessStatus: 'paid_unlocked',
  address: 'Санкт-Петербург, Невский проспект, 88',
  generated_at_iso: '2026-05-16T10:00:00.000Z',
  freeSummary: {
    conclusionRu: 'Краткий вывод готов.',
    publicScore: 70,
    keyFactorsRu: ['Метро рядом'],
    risksAndLimitsRu: ['Проверить ограничения вручную'],
    recommendationRu: 'Держите чистоту и тишину в часы пик у клиник — это напрямую влияет на отзывы гостей.',
  },
  sections: [
    {
      id: 'summary',
      verdict: 'Краткий вывод готов.',
      drivers: ['Метро рядом'],
      income_rub_month: null,
      recommended_strategy: null,
    },
    { id: 'next_step', cta: 'get_full_breakdown' },
  ],
};

const mockPdfBody = Buffer.from('%PDF-1.4\n%mock-location-report\n');

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('GET /api/location-report/[reportId]/pdf', () => {
  it('returns PDF without requiring Yandex map env keys', { timeout: 15_000 }, async () => {
    delete process.env.YANDEX_MAPS_API_KEY;
    delete process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY;

    mockGetStandaloneReportById.mockResolvedValue({
      id: 'report-yandex-free',
      locale: 'ru',
      address: report.address,
      report_version: report.version,
      report,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    mockRenderLocationReportPdfFromPrintRoute.mockResolvedValue(mockPdfBody);
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost/api/location-report/report-yandex-free/pdf') as any, {
      params: Promise.resolve({ reportId: 'report-yandex-free' }),
    });

    expect(res.status).toBe(200);
    expect(mockRenderLocationReportPdfFromPrintRoute).toHaveBeenCalledWith('report-yandex-free');
  });

  it('returns a real PDF attachment rendered from the print route', { timeout: 15_000 }, async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'report-1',
      locale: 'ru',
      address: report.address,
      report_version: report.version,
      report,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    mockRenderLocationReportPdfFromPrintRoute.mockResolvedValue(mockPdfBody);
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost/api/location-report/report-1/pdf') as any, {
      params: Promise.resolve({ reportId: 'report-1' }),
    });
    const body = Buffer.from(await res.arrayBuffer());

    expect(mockRenderLocationReportPdfFromPrintRoute).toHaveBeenCalledWith('report-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('filename="location-report-report-1.pdf"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.length).toBeGreaterThan(0);
    expect(body.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('returns forbidden for a public preview report', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'preview-1',
      locale: 'ru',
      address: report.address,
      report_version: report.version,
      report: { ...report, reportMode: 'free' },
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost/api/location-report/preview-1/pdf') as any, {
      params: Promise.resolve({ reportId: 'preview-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'preview_only' });
    expect(mockRenderLocationReportPdfFromPrintRoute).not.toHaveBeenCalled();
  });

  it('returns forbidden for a paid report that is not unlocked', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'locked-1',
      locale: 'ru',
      address: report.address,
      report_version: report.version,
      report: { ...report, accessStatus: 'pending_payment' },
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost/api/location-report/locked-1/pdf') as any, {
      params: Promise.resolve({ reportId: 'locked-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'locked' });
    expect(mockRenderLocationReportPdfFromPrintRoute).not.toHaveBeenCalled();
  });

  it('returns a safe not-found response for a missing saved report', async () => {
    mockGetStandaloneReportById.mockResolvedValue(null);
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost/api/location-report/missing/pdf') as any, {
      params: Promise.resolve({ reportId: 'missing' }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'not_found' });
    expect(mockRenderLocationReportPdfFromPrintRoute).not.toHaveBeenCalled();
  });

  it('returns a simple Russian error without internal details when PDF render fails', async () => {
    const { LocationReportPdfError } =
      await vi.importActual<typeof import('@/lib/location/location-report-print-pdf')>(
        '@/lib/location/location-report-print-pdf',
      );
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'report-1',
      locale: 'ru',
      address: report.address,
      report_version: report.version,
      report,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    mockRenderLocationReportPdfFromPrintRoute.mockRejectedValue(
      new LocationReportPdfError('chromium_missing', 'Chromium executable not found on server'),
    );
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost/api/location-report/report-1/pdf') as any, {
      params: Promise.resolve({ reportId: 'report-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('pdf_failed');
    expect(body.message).toMatch(/PDF/);
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('Chromium');
  });
});
