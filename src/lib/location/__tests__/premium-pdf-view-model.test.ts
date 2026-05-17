import { describe, expect, it } from 'vitest';
import { buildGeneratedLocationReportDocument } from '../location-report-engine';
import { buildPremiumPdfViewModel } from '../premium-pdf-view-model';
import { sampleStrLocationStandaloneReportRu } from '../standalone-report';

describe('buildPremiumPdfViewModel', () => {
  it('maps paid STR sample into five-page premium deck fields', () => {
    const doc = buildGeneratedLocationReportDocument({
      id: 'sample-paid',
      locale: 'ru',
      address: sampleStrLocationStandaloneReportRu.address,
      report_version: 'v1',
      report: sampleStrLocationStandaloneReportRu,
      created_at: sampleStrLocationStandaloneReportRu.generated_at_iso,
    });

    const model = buildPremiumPdfViewModel(doc);

    expect(model.reportMode).toBe('paid');
    expect(model.verdict.headline.isPlaceholder).toBe(false);
    expect(model.verdict.headline.value).toContain('посуточной');
    expect(model.score.overall.value).toBe(78);
    expect(model.score.dimensions.some(d => d.id === 'demand_score' && !d.isPlaceholder)).toBe(false);
    expect(model.risks.items.length).toBeGreaterThan(0);
    expect(model.risks.launchSteps.length).toBeGreaterThan(0);
    expect(model.revenueScenarios).toHaveLength(3);
    expect(model.futureDevelopmentSlots).toHaveLength(6);
    expect(model.finalRecommendation.value.length).toBeGreaterThan(10);
  });
});
