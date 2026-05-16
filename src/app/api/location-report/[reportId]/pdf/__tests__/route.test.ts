import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationStandaloneReport } from '@/lib/location/standalone-report';

const mockGetStandaloneReportById = vi.fn();

vi.mock('@/lib/location/standalone-report-store', () => ({
  getStandaloneReportById: (...args: unknown[]) => mockGetStandaloneReportById(...args),
}));

const report: LocationStandaloneReport = {
  version: 'v1',
  reportMode: 'free',
  address: 'Санкт-Петербург, Невский проспект, 88',
  generated_at_iso: '2026-05-16T10:00:00.000Z',
  freeSummary: {
    conclusionRu: 'Краткий вывод готов.',
    publicScore: 70,
    keyFactorsRu: ['Метро рядом'],
    risksAndLimitsRu: ['Проверить ограничения вручную'],
    recommendationRu: 'Запросить подробный отчёт.',
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

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('GET /api/location-report/[reportId]/pdf', () => {
  it('returns print-friendly content for an existing saved report', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'report-1',
      locale: 'ru',
      address: report.address,
      report_version: report.version,
      report,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { GET } = await import('../route');

    const res = await GET(new Request('http://localhost/api/location-report/report-1/pdf') as any, {
      params: Promise.resolve({ reportId: 'report-1' }),
    });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(text).toContain('Краткий вывод готов.');
    expect(text).toContain('Метро рядом');
    expect(text).not.toContain('unifiedReport');
  });
});
