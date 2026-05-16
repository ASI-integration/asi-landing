import { describe, expect, it } from 'vitest';
import {
  buildGeneratedLocationReportDocument,
  buildLocationReportPrintHtml,
} from '../location-report-engine';
import type { PersistedStandaloneReportEntity } from '../standalone-report-store';
import type { LocationStandaloneReport } from '../standalone-report';

function entity(report: LocationStandaloneReport): PersistedStandaloneReportEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    locale: 'ru',
    address: report.address,
    report_version: report.version,
    report,
    created_at: '2026-05-16T10:00:00.000Z',
  };
}

const freeReport: LocationStandaloneReport = {
  version: 'v1',
  reportId: '11111111-1111-4111-8111-111111111111',
  reportMode: 'free',
  inputAddress: 'Невский проспект, 88',
  normalizedAddress: 'санкт-петербург, невский проспект, 88',
  calculatedAt: '2026-05-16T10:00:00.000Z',
  status: 'ready',
  pdfStatus: 'ready',
  dataFreshness: {
    currentLocationAsOfIso: '2026-05-16T10:00:00.000Z',
    summaryRu: 'Данные сохранены на момент расчёта.',
  },
  address: 'Санкт-Петербург, Невский проспект, 88',
  generated_at_iso: '2026-05-16T10:00:00.000Z',
  freeSummary: {
    conclusionRu: 'Локация подходит как первый фильтр.',
    publicScore: 72,
    keyFactorsRu: ['Метро рядом', 'Смешанный спрос', 'Сервисы в пешей доступности'],
    risksAndLimitsRu: ['Проверить конкурентов вручную'],
    recommendationRu: 'Запросите подробный отчёт перед решением.',
  },
  sections: [
    {
      id: 'summary',
      verdict: 'Локация подходит как первый фильтр.',
      drivers: ['Метро рядом', 'Смешанный спрос'],
      income_rub_month: null,
      recommended_strategy: null,
    },
    { id: 'next_step', cta: 'get_full_breakdown' },
  ],
};

describe('location report generation engine', () => {
  it('builds the unified saved free report document without paid-only sections', () => {
    const doc = buildGeneratedLocationReportDocument(entity(freeReport));

    expect(doc).toMatchObject({
      reportId: '11111111-1111-4111-8111-111111111111',
      reportMode: 'free',
      inputAddress: 'Невский проспект, 88',
      normalizedAddress: 'санкт-петербург, невский проспект, 88',
      status: 'ready',
      pdfStatus: 'ready',
    });
    expect(doc.freeSummary.keyFactorsRu).toHaveLength(3);
    expect(doc.paidSections).toBeUndefined();
    expect(JSON.stringify(doc.freeSummary)).not.toContain('unifiedReport');
    expect(JSON.stringify(doc.freeSummary)).not.toContain('income_rub_month');
  });

  it('returns print/PDF-friendly content from saved report data', () => {
    const doc = buildGeneratedLocationReportDocument(entity(freeReport));
    const html = buildLocationReportPrintHtml(doc);

    expect(html).toContain('Бесплатный общий отчёт');
    expect(html).toContain('Невский проспект, 88');
    expect(html).toContain('Метро рядом');
    expect(html).toContain('Проверить конкурентов вручную');
    expect(html).not.toContain('unifiedReport');
  });

  it('exposes paid structure for paid reports', () => {
    const paid: LocationStandaloneReport = {
      ...freeReport,
      reportMode: 'paid',
      paidSections: [{ id: 'competition', titleRu: 'Конкуренция', summaryRu: 'Платный раздел.' }],
      sections: [
        {
          id: 'summary',
          verdict: 'Полный отчёт готов.',
          drivers: ['Спрос подтверждён'],
          income_rub_month: 150000,
          recommended_strategy: 'short_term',
        },
        { id: 'next_step', cta: 'get_full_breakdown' },
      ],
    };

    const doc = buildGeneratedLocationReportDocument(entity(paid));

    expect(doc.reportMode).toBe('paid');
    expect(doc.paidSections).toEqual([{ id: 'competition', titleRu: 'Конкуренция', summaryRu: 'Платный раздел.' }]);
  });
});
