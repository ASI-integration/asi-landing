import { describe, expect, it } from 'vitest';
import { buildGeneratedLocationReportDocument } from '../location-report-engine';
import { buildPremiumPdfViewModel } from '../premium-pdf-view-model';
import { sampleStrLocationStandaloneReportRu } from '../standalone-report';

describe('buildPremiumPdfViewModel', () => {
  it('maps paid STR sample into premium PDF section fields', () => {
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
    expect(model.cover.score.value).toBe(78);
    expect(model.cover.recommendationLabel.isPlaceholder).toBe(false);
    expect(model.summary.conclusion.isPlaceholder).toBe(false);
    expect(model.summary.conclusion.value).toContain('посуточной');
    expect(model.transport.lines.length).toBeGreaterThan(0);
    expect(model.magnets.primary.length).toBeGreaterThan(0);
    expect(model.demand.suitableFor.length).toBeGreaterThan(0);
    expect(model.recommendations.steps.length).toBeGreaterThan(0);
    expect(model.score.overall.value).toBe(78);
    expect(model.score.dimensions.some(d => d.id === 'demand_score' && !d.isPlaceholder)).toBe(false);
    expect(model.risks.items.length).toBeGreaterThan(0);
    expect(model.risks.launchSteps.length).toBeGreaterThan(0);
    expect(model.revenueScenarios).toHaveLength(3);
    expect(model.futureDevelopmentSlots).toHaveLength(6);
    expect(model.finalRecommendation.value.length).toBeGreaterThan(10);
  });
});
