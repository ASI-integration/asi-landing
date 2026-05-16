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
    keyFactorsRu: [
      'Станция метро Площадь Мужества · Метро · 830 м — Станция метро Площадь Мужества — около 830 м',
      'Станция метро Лесная · Метро · 940 м — Станция метро Лесная — около 940 м',
      'Клиника рядом · Медицинские учреждения · 430 м',
    ],
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

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('GET /api/location-report/[reportId]/pdf', () => {
  it('returns a real PDF attachment for an existing saved report', async () => {
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
    const body = Buffer.from(await res.arrayBuffer());
    const bodyAsUtf8 = body.toString('utf8');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('filename="asi-location-report-report-1.pdf"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(bodyAsUtf8).not.toContain('<html');
    expect(bodyAsUtf8).not.toContain('<!DOCTYPE');
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
  });
});
