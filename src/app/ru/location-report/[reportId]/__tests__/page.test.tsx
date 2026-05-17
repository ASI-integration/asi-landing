import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationStandaloneReport } from '@/lib/location/standalone-report';

const mockGetStandaloneReportById = vi.fn();

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('@/lib/location/standalone-report-store', () => ({
  getStandaloneReportById: (...args: unknown[]) => mockGetStandaloneReportById(...args),
}));

vi.mock('@/components/location/LocationReportPublicPreview', () => ({
  LocationReportPublicPreview: ({ reportId }: { reportId?: string }) => (
    <div>Предпросмотр отчёта {reportId}</div>
  ),
}));

vi.mock('@/components/location/LocationStandaloneFullReport', () => ({
  LocationStandaloneFullReport: ({ reportId }: { reportId?: string }) => <div>Подробный отчёт {reportId}</div>,
}));

vi.mock('@/components/location/CommercialReportView', () => ({
  CommercialReportView: () => <div>Коммерческий отчёт</div>,
}));

const freeReport: LocationStandaloneReport = {
  version: 'v1',
  reportMode: 'free',
  inputAddress: 'Невский проспект, 88',
  normalizedAddress: 'санкт-петербург, невский проспект, 88',
  calculatedAt: '2026-05-16T10:00:00.000Z',
  status: 'ready',
  pdfStatus: 'ready',
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

describe('/ru/location-report/[reportId]', () => {
  it('renders a saved public preview report by reportId', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'report-1',
      locale: 'ru',
      address: freeReport.address,
      report_version: freeReport.version,
      report: freeReport,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { default: Page } = await import('../page');

    const element = await Page({ params: Promise.resolve({ reportId: 'report-1' }) });
    const html = renderToStaticMarkup(element);

    expect(mockGetStandaloneReportById).toHaveBeenCalledWith('report-1');
    expect(html).toContain('Предпросмотр отчёта report-1');
    expect(html).not.toContain('Бесплатный');
    expect(html).not.toContain('ожидает оплаты');
    expect(html).not.toContain('Ожидает оплаты');
  });

  it('renders print page content from the same saved free report data', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'report-1',
      locale: 'ru',
      address: freeReport.address,
      report_version: freeReport.version,
      report: freeReport,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { default: PrintPage } = await import('../print/page');

    const element = await PrintPage({ params: Promise.resolve({ reportId: 'report-1' }) });
    const html = renderToStaticMarkup(element);

    expect(mockGetStandaloneReportById).toHaveBeenCalledWith('report-1');
    expect(html).toContain('Предпросмотр отчёта');
    expect(html).toContain('Невский проспект, 88');
    expect(html).toContain('Краткий вывод готов.');
    expect(html).toContain('Метро в пешей доступности');
    expect(html).toContain('Предпросмотр отчёта');
    expect(html).not.toContain('Скачать PDF');
    expect(html).not.toContain('will appear after payment');
    expect(html).not.toContain('появится после оплаты');
  });

  it('shows a clean fallback when the saved report is missing', async () => {
    mockGetStandaloneReportById.mockResolvedValue(null);
    const { default: Page } = await import('../page');

    const element = await Page({ params: Promise.resolve({ reportId: 'missing' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Отчёт не найден');
    expect(html).toContain('Ссылка устарела или отчёт был удалён');
    expect(html).not.toContain('NEXT_NOT_FOUND');
  });
});
