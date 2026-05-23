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
    <div>Отчёт по локации {reportId}</div>
  ),
}));

vi.mock('@/components/location/LocationStandaloneFullReport', () => ({
  LocationStandaloneFullReport: ({ reportId, report }: { reportId?: string; report?: { metadata?: { providerWarningsRu?: string[] } } }) => (
    <div>
      Подробный отчёт {reportId}
      {report?.metadata?.providerWarningsRu?.[0] ?? null}
    </div>
  ),
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

const paidReport: LocationStandaloneReport = {
  ...freeReport,
  reportMode: 'paid',
  accessStatus: 'paid_unlocked',
  paidSections: [{ id: 'income', titleRu: 'Доходность', summaryRu: 'Полный раздел.' }],
  sections: [
    {
      id: 'summary',
      verdict: 'Полный отчёт готов.',
      drivers: ['Метро рядом'],
      income_rub_month: 150000,
      recommended_strategy: 'short_term',
    },
    {
      id: 'income_strategy',
      recommended_strategy: 'short_term',
      monthly_income_rub: {
        short_term: 150000,
        hybrid: 130000,
        mid_term: 100000,
      },
      positioning_hint: 'Рекомендуемая стратегия: посуточная аренда.',
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
    expect(html).toContain('Отчёт по локации report-1');
    expect(html).not.toContain('Бесплатный');
    expect(html).not.toContain('ожидает оплаты');
    expect(html).not.toContain('Ожидает оплаты');
  });

  it('renders the full report only when the saved report is unlocked', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'paid-1',
      locale: 'ru',
      address: paidReport.address,
      report_version: paidReport.version,
      report: paidReport,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { default: Page } = await import('../page');

    const element = await Page({ params: Promise.resolve({ reportId: 'paid-1' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Подробный отчёт paid-1');
  });

  it('renders paid report page without Yandex env keys', async () => {
    delete process.env.YANDEX_MAPS_API_KEY;
    delete process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY;

    mockGetStandaloneReportById.mockResolvedValue({
      id: 'paid-map',
      locale: 'ru',
      address: paidReport.address,
      report_version: paidReport.version,
      report: {
        ...paidReport,
        metadata: {
          calculatedAt: '2026-05-16T10:00:00.000Z',
          inputAddress: paidReport.address,
          normalizedAddress: paidReport.address.toLowerCase(),
          reportMode: 'paid',
          dataFreshness: {
            currentLocationAsOfIso: '2026-05-16T10:00:00.000Z',
            summaryRu: 'Тест',
          },
          sourceStatus: {
            current_location: 'live',
            urban_development: 'cache_or_not_connected',
            procurement: 'official_api_disabled',
          },
          coordinates: { lat: 59.93, lon: 30.33 },
          mapDisplay: 'unavailable',
          providerWarningsRu: ['Карта временно недоступна, расчёт сохранён.'],
          clientFreshnessRu: { usedSources: [], preparingSources: [] },
        },
      },
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { default: Page } = await import('../page');

    const element = await Page({ params: Promise.resolve({ reportId: 'paid-map' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Подробный отчёт paid-map');
    expect(html).toContain('Карта временно недоступна, расчёт сохранён.');
  });

  it('does not unlock a paid report from the permalink unless access is persisted', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'paid-locked',
      locale: 'ru',
      address: paidReport.address,
      report_version: paidReport.version,
      report: { ...paidReport, accessStatus: 'pending_payment' },
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { default: Page } = await import('../page');

    const element = await Page({ params: Promise.resolve({ reportId: 'paid-locked' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Отчёт не найден');
    expect(html).not.toContain('Подробный отчёт paid-locked');
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
