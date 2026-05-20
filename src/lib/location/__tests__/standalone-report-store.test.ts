import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationStandaloneReport } from '../standalone-report';
import { createStandaloneReport } from '../standalone-report-store';

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { from, insert, select, single };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
  },
}));

const contaminatedFreeReport = {
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
  paidSections: [{ id: 'competition', titleRu: 'Конкуренция', summaryRu: 'Платный раздел.' }],
  unifiedReport: { version: 'paid-only' },
  strReport: { product: 'str-location-report' },
  sections: [
    {
      id: 'summary',
      verdict: 'Краткий вывод готов.',
      drivers: ['Метро рядом'],
      income_rub_month: 150000,
      recommended_strategy: 'short_term',
    },
    {
      id: 'competition',
      competitor_count: 20,
      pressure_level: 'high',
    },
    { id: 'next_step', cta: 'get_full_breakdown' },
  ],
} as unknown as LocationStandaloneReport;

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('createStandaloneReport free report persistence contract', () => {
  it('saves a free report with reportId and strips paid-only sections', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('33333333-3333-4333-8333-333333333333' as any);
    mocks.single.mockResolvedValue({ data: { id: '33333333-3333-4333-8333-333333333333' }, error: null });

    const result = await createStandaloneReport({ locale: 'ru', report: contaminatedFreeReport });

    expect(result.reportId).toBe('33333333-3333-4333-8333-333333333333');
    const inserted = (mocks.insert.mock.calls[0] as any[])[0];
    const saved = inserted.report as LocationStandaloneReport;
    expect(saved.reportId).toBe('33333333-3333-4333-8333-333333333333');
    expect(saved.reportMode).toBe('free');
    expect(saved.accessStatus).toBe('created');
    expect(saved.pdfStatus).toBe('ready');
    expect(saved.pdfUrl).toBe('/api/location-report/33333333-3333-4333-8333-333333333333/pdf');
    expect(saved).not.toHaveProperty('paidSections');
    expect(saved).not.toHaveProperty('unifiedReport');
    expect(saved).not.toHaveProperty('strReport');
    expect(saved.sections.map(section => section.id)).toEqual(['summary', 'next_step']);
    const summary = saved.sections.find(section => section.id === 'summary');
    expect(summary?.id).toBe('summary');
    if (summary?.id !== 'summary') throw new Error('summary section missing');
    expect(summary.income_rub_month).toBeNull();
    expect(summary.recommended_strategy).toBeNull();
  });
});
