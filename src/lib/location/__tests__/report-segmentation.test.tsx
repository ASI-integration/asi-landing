import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocationReportPublicPreview } from '@/components/location/LocationReportPublicPreview';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { buildAnalysis } from '../gravity-scoring';
import {
  buildLocationReportSegmentGroups,
  buildLocationReportStructureViewModel,
  COMMERCIAL_REPORT_SEGMENT_INTRO_RU,
  PUBLIC_PAID_REPORT_GALLERY_ITEMS,
  RESIDENTIAL_REPORT_SEGMENT_INTRO_RU,
} from '../location-report-structure';
import { RETAIL_TARGET_TRAFFIC_WARNING_RU } from '../street-retail-suitability';
import { buildCommercialFormatFit } from '../commercial-format-fit';
import { buildPremiumCommercialRetailContent } from '../premium-paid-report-content';
import { buildLocationStandaloneReport } from '../standalone-report';
import { evaluateStreetRetailSuitability } from '../street-retail-suitability';
import { strongFlowAnalysis } from './report-segmentation-fixtures';

describe('report segmentation: residential vs commercial retail', () => {
  it('defines separate segment groups in paid report structure', () => {
    const groups = buildLocationReportSegmentGroups();
    const paid = buildLocationReportStructureViewModel('paid');

    expect(groups).toHaveLength(2);
    expect(groups[0]?.id).toBe('residential_investment');
    expect(groups[1]?.id).toBe('commercial_retail');
    expect(groups[0]?.sectionIds).toContain('executiveSummary');
    expect(groups[0]?.sectionIds).toContain('finalRecommendation');
    expect(groups[0]?.sectionIds).not.toContain('targetTrafficHeatmap');
    expect(groups[1]?.sectionIds).toContain('commercialPotential');
    expect(groups[1]?.sectionIds).toContain('retailPremisesConstraints');
    expect(paid.segmentGroups?.[0]?.introRu).toBe(RESIDENTIAL_REPORT_SEGMENT_INTRO_RU);
    expect(paid.segmentGroups?.[1]?.introRu).toBe(COMMERCIAL_REPORT_SEGMENT_INTRO_RU);
  });

  it('public gallery explains commercial traffic separately from housing', () => {
    const free = buildLocationReportStructureViewModel('free');
    const commercialCard = PUBLIC_PAID_REPORT_GALLERY_ITEMS.find(
      item => item.id === 'commercialTargetTraffic',
    );

    expect(commercialCard?.segment).toBe('commercial_retail');
    expect(commercialCard?.summaryRu).toContain('целевой поток для бизнеса');
    expect(commercialCard?.summaryRu).toContain('первая линия');
    expect(free.paidPreviewSections?.some(s => s.segment === 'commercial_retail')).toBe(true);
    expect(free.paidPreviewSections?.filter(s => s.segment === 'residential_investment').length).toBe(
      7,
    );

    const html = renderToStaticMarkup(
      React.createElement(LocationReportPublicPreview, {
        report: buildLocationStandaloneReport({
          address: 'Москва, тест',
          analysis: buildAnalysis([], 55.75, 37.61),
          verdict: 'Краткий вывод.',
          reportMode: 'free',
        }),
      }),
    );

    expect(html).toContain('Подходит для коммерции и ритейла');
    expect(html).toContain('целевой поток для бизнеса');
    expect(html).toContain('Показывает, подходит ли адрес для аренды, проживания или покупки.');
  });

  it('paid full report renders residential and commercial groups separately', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const paid = buildLocationStandaloneReport({
      address: 'Москва, paid',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });

    expect(paid.premiumPaidReport?.commercialRetail).not.toBeNull();
    const html = renderToString(
      React.createElement(LocationStandaloneFullReport, { report: paid, reportId: 'seg-1' }),
    );

    expect(html).toContain(RESIDENTIAL_REPORT_SEGMENT_INTRO_RU);
    expect(html).toContain(COMMERCIAL_REPORT_SEGMENT_INTRO_RU);
    expect(html).toContain('Недвижимость и аренда');
    expect(html).toContain('Коммерция и ритейл');
    expect(html).toContain(RETAIL_TARGET_TRAFFIC_WARNING_RU);
    expect(html).toContain('Индекс целевого трафика');
    expect(html).not.toMatch(/точный пешеходный трафик/i);
    expect(html).not.toMatch(/подсчёт людей в час/i);
    expect(html).not.toMatch(/гарантированный поток/i);
  });

  it('commercial foot-traffic copy is not framed as universal real-estate advice', () => {
    const analysis = strongFlowAnalysis();
    const content = buildPremiumCommercialRetailContent({ analysis });
    const residentialIntro = RESIDENTIAL_REPORT_SEGMENT_INTRO_RU;

    expect(content?.ownerMeaningRu).toContain('только для коммерческих');
    expect(content?.targetTrafficSummaryRu).toContain('оценка');
    expect(residentialIntro).not.toContain('первая линия');
    expect(residentialIntro).not.toContain('H3');
  });

  it('does not give strong street-retail recommendation for basement premises', () => {
    const analysis = strongFlowAnalysis();
    const fit = buildCommercialFormatFit(analysis, {
      objectContext: { floorLevel: 'цоколь', firstLine: false },
    });
    const suitability = evaluateStreetRetailSuitability(analysis, {
      floorLevel: 'цоколь',
      firstLine: false,
    });

    expect(suitability.strongStreetRetailAllowed).toBe(false);
    expect(fit.entries.find(e => e.format === 'retail')?.fitLevel).not.toBe('high');
    expect(fit.entries.find(e => e.format === 'retail')?.explanationRu).toMatch(
      /не даёт сильную рекомендацию|не подходит|ограничен/i,
    );
  });
});
