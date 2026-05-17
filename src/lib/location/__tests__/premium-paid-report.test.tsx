import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LocationReportPublicPreview } from '@/components/location/LocationReportPublicPreview';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { PremiumLocationReportPdf } from '@/components/location/premium-pdf/PremiumLocationReportPdf';
import { buildGeneratedLocationReportDocument } from '../location-report-engine';
import { buildPremiumPdfViewModel } from '../premium-pdf-view-model';
import {
  listPremiumPaidSectionAnchorIds,
  PREMIUM_PAID_SECTION_TITLES_RU,
} from '../premium-paid-report-content';
import { buildLocationStandaloneReport, sampleStrLocationStandaloneReportRu } from '../standalone-report';
import { buildAnalysis } from '../gravity-scoring';

describe('premium paid location report', () => {
  it('paid full report renders all premium commercial sections', () => {
    const html = renderToString(
      React.createElement(LocationStandaloneFullReport, {
        report: sampleStrLocationStandaloneReportRu,
        reportId: 'paid-premium-1',
      }),
    );

    for (const title of Object.values(PREMIUM_PAID_SECTION_TITLES_RU)) {
      expect(html).toContain(title);
    }
    expect(html).toContain('Осторожный');
    expect(html).toContain('Базовый');
    expect(html).toContain('Сильный');
    expect(html).toContain('Строящиеся ЖК');
    expect(html).toContain('Госзакупки и ранние признаки развития');
  });

  it('public preview does not render premium paid sections', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const freeReport = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Краткий вывод.',
      reportMode: 'free',
    });

    const html = renderToStaticMarkup(
      <LocationReportPublicPreview report={freeReport} reportId="free-1" />,
    );

    expect(html).not.toContain('premium-revenue-scenarios');
    expect(html).not.toContain('premium-future-development');
    expect(html).not.toContain('Осторожный');
    expect(html).not.toContain('Строящиеся ЖК');
    expect(html).not.toContain('Для владельца:');
    expect(html).not.toContain('Скачать PDF');
  });

  it('future development and revenue scenarios exist only on paid report payload', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const paid = buildLocationStandaloneReport({
      address: 'Москва, paid',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });
    const free = buildLocationStandaloneReport({
      address: 'Москва, free',
      analysis,
      verdict: 'Free.',
      reportMode: 'free',
    });

    expect(paid.premiumPaidReport?.futureAreaDevelopment.slots).toHaveLength(6);
    expect(paid.premiumPaidReport?.revenueScenarios).toHaveLength(3);
    expect(free.premiumPaidReport).toBeUndefined();
    expect(listPremiumPaidSectionAnchorIds()).toContain('premium-future-development');
    expect(listPremiumPaidSectionAnchorIds()).toContain('premium-revenue-scenarios');
  });

  it('print/PDF view model includes paid premium sections for paid report', () => {
    const doc = buildGeneratedLocationReportDocument({
      id: 'paid-premium-pdf',
      locale: 'ru',
      address: sampleStrLocationStandaloneReportRu.address,
      report_version: 'v1',
      report: sampleStrLocationStandaloneReportRu,
      created_at: sampleStrLocationStandaloneReportRu.generated_at_iso,
    });

    const model = buildPremiumPdfViewModel(doc);
    expect(model.revenueScenarios).toHaveLength(3);
    expect(model.futureDevelopmentSlots).toHaveLength(6);
    expect(model.finalRecommendation.isPlaceholder).toBe(false);

    const pdfHtml = renderToStaticMarkup(<PremiumLocationReportPdf model={model} />);
    expect(pdfHtml).toContain('Сценарии дохода');
    expect(pdfHtml).toContain('Строящиеся ЖК');
    expect(pdfHtml).toContain('Осторожный');
  });
});
