import { describe, expect, it } from 'vitest';
import {
  FREE_TOP_EVIDENCE_BULLETS_LIMIT,
  commercialFootTrafficPlannedSection,
  forbiddenFreeReportFields,
  freeReportSections,
  isFreeReportFieldForbidden,
  isFreeReportSectionAllowed,
  locationReportScopeContract,
  paidReportSections,
  resolveCommercialFootTrafficSectionStatus,
} from '../report-scope-contract';

describe('location report scope contract', () => {
  it('free report cannot include forbidden sections', () => {
    const forbiddenSections = [
      'fullScoreExplanation',
      'magnetsByCategory',
      'competitors',
      'sourceEvidence',
      'urbanDevelopmentForecast',
      'commercialFootTraffic',
    ];

    for (const section of forbiddenSections) {
      expect(isFreeReportSectionAllowed(section)).toBe(false);
    }
  });

  it('paid report includes full analytical sections', () => {
    expect(paidReportSections).toEqual([
      'executiveSummary',
      'fullScoreExplanation',
      'magnetsByCategory',
      'transport',
      'medical',
      'business',
      'education',
      'retailAndEvents',
      'competitors',
      'risks',
      'targetAudiences',
      'strategy',
      'urbanDevelopmentForecast',
      'dataFreshness',
      'sourceEvidence',
      'finalRecommendation',
    ]);
  });

  it('free topEvidenceBullets are limited to 5', () => {
    expect(freeReportSections).toContain('topEvidenceBullets');
    expect(FREE_TOP_EVIDENCE_BULLETS_LIMIT.max).toBe(5);
  });

  it('internal weights, formulas, and debug fields are forbidden in free', () => {
    expect(forbiddenFreeReportFields).toEqual(
      expect.arrayContaining([
        'internalWeights',
        'formulas',
        'debugTrace',
        'scoringWeights',
        'scoringFormula',
        'scoreTrace',
        'kernelTrace',
      ]),
    );

    expect(isFreeReportFieldForbidden('internalWeights')).toBe(true);
    expect(isFreeReportFieldForbidden('formulas')).toBe(true);
    expect(isFreeReportFieldForbidden('debugTrace')).toBe(true);
  });

  it('paid can include sourceEvidence and urbanDevelopmentForecast', () => {
    expect(locationReportScopeContract.modes.paid.allowedSections).toContain('sourceEvidence');
    expect(locationReportScopeContract.modes.paid.allowedSections).toContain('urbanDevelopmentForecast');
  });

  it('commercial foot traffic section exists only as planned placeholder unless data source connected', () => {
    expect(locationReportScopeContract.modes.free.allowedSections).not.toContain('commercialFootTraffic');
    expect(locationReportScopeContract.modes.paid.allowedSections).not.toContain('commercialFootTraffic');
    expect(locationReportScopeContract.modes.paid.plannedSections).toContain(commercialFootTrafficPlannedSection);
    expect(resolveCommercialFootTrafficSectionStatus({ commercialFootTrafficSourceConnected: false })).toBe(
      'planned_placeholder',
    );
    expect(resolveCommercialFootTrafficSectionStatus({ commercialFootTrafficSourceConnected: true })).toBe(
      'allowed',
    );
  });
});
