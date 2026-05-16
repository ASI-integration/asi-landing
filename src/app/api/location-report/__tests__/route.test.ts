import { afterEach, describe, expect, it, vi } from 'vitest';

const mockGenerateFreeLocationReport = vi.fn();

vi.mock('@/lib/location/location-report-engine', () => ({
  generateFreeLocationReport: (...args: unknown[]) => mockGenerateFreeLocationReport(...args),
}));

describe('POST /api/location-report', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('generates and returns a saved free location report', async () => {
    mockGenerateFreeLocationReport.mockResolvedValue({
      reportId: '55555555-5555-4555-8555-555555555555',
      permalink: '/ru/location-report/55555555-5555-4555-8555-555555555555',
      lat: 59.93,
      lon: 30.36,
      report: {
        reportId: '55555555-5555-4555-8555-555555555555',
        reportMode: 'free',
        inputAddress: 'Санкт-Петербург, Невский проспект, 88',
        normalizedAddress: 'санкт-петербург, невский проспект, 88',
        calculatedAt: '2026-05-16T10:00:00.000Z',
        status: 'ready',
        score: 72,
        publicScore: 72,
        shortConclusion: 'Краткий вывод готов.',
        verdictSummary: 'Краткий вывод готов.',
        keyDemandDrivers: ['Метро рядом'],
        evidenceBullets: ['Метро рядом'],
        mainRisks: ['Проверить конкурентов вручную'],
        risksAndLimitsRu: ['Проверить конкурентов вручную'],
        nearbyStrongObjects: [{ summaryRu: 'Метро рядом' }],
        recommendationRu: 'Используйте краткий вывод как первый фильтр.',
        pdfStatus: 'ready',
      },
    });
    const { POST } = await import('../route');

    const res = await POST(new Request('http://localhost/api/location-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address: 'Санкт-Петербург, Невский проспект, 88',
        is_paid: false,
        locale: 'ru',
      }),
    }) as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGenerateFreeLocationReport).toHaveBeenCalledWith(
      'Санкт-Петербург, Невский проспект, 88',
      { locale: 'ru', market: 'ru' },
    );
    expect(body).toMatchObject({
      reportId: '55555555-5555-4555-8555-555555555555',
      reportMode: 'free',
      permalink: '/ru/location-report/55555555-5555-4555-8555-555555555555',
      report: {
        reportMode: 'free',
        publicScore: 72,
        keyDemandDrivers: ['Метро рядом'],
        mainRisks: ['Проверить конкурентов вручную'],
      },
    });
    expect(body.report).not.toHaveProperty('paidSections');
    expect(body.report).not.toHaveProperty('unifiedReport');
    expect(body.report).not.toHaveProperty('strReport');
  });
});
