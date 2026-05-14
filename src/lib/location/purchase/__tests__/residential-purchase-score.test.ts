import { describe, expect, it } from 'vitest';
import { computeResidentialPurchaseScore } from '../residential-purchase-score';
import type { ResidentialPurchaseScoreInput } from '../types';

describe('computeResidentialPurchaseScore', () => {
  it('dense urban mixed area gives strong liquidity and infrastructure', () => {
    const input: ResidentialPurchaseScoreInput = {
      territory: {
        density: 'high',
        mixityScore: 78,
        housingQualityScore: 68,
        socialInfrastructureScore: 86,
        transportAccessScore: 82,
        safetyScore: 64,
        prestigeScore: 62,
        greenScore: 48,
        strBusinessMagnetScore: 76,
        h3: {
          countedMagnets: 14,
          categoryDiversityScore: 0.74,
          businessTravelerSuitability: {
            score: 0.78,
            level: 'strong',
            hasTransportAccess: true,
          },
        },
      },
      object: {
        resaleDepthScore: 82,
        buildingQualityScore: 70,
      },
    };

    const out = computeResidentialPurchaseScore(input);

    expect(out.territory.type).toBe('dense_urban_core');
    expect(out.dimensions.liquidityScore).toBeGreaterThanOrEqual(75);
    expect(out.dimensions.infrastructureScore).toBe(86);
    expect(out.dimensions.transportScore).toBeGreaterThanOrEqual(82);
    expect(out.finalScore).toBeGreaterThanOrEqual(60);
  });

  it('low-density premium residential area can be weak for STR but strong for purchase and lifestyle', () => {
    const input: ResidentialPurchaseScoreInput = {
      territory: {
        density: 'low',
        housingQualityScore: 88,
        greenScore: 90,
        safetyScore: 84,
        prestigeScore: 86,
        socialInfrastructureScore: 62,
        transportAccessScore: 54,
        strBusinessMagnetScore: 18,
      },
      object: {
        resaleDepthScore: 78,
        buildingQualityScore: 88,
        optionalRentalDemandScore: 22,
      },
    };

    const out = computeResidentialPurchaseScore(input);

    expect(out.territory.type).toBe('premium_low_density_residential');
    expect(out.dimensions.optionalRentalScore).toBeLessThan(35);
    expect(out.dimensions.livingQualityScore).toBeGreaterThanOrEqual(80);
    expect(out.dimensions.prestigeLifestyleScore).toBeGreaterThanOrEqual(85);
    expect(out.explanation.strengthsRu.join(' ')).toContain('слабее для посуточной аренды');
    expect(out.explanation.notesRu.join(' ')).toContain('Мало STR-магнитов не означает плохую покупку');
  });

  it('isolated peripheral housing produces weak purchase score with uncertainty and risk explanation', () => {
    const input: ResidentialPurchaseScoreInput = {
      territory: {
        density: 'low',
        housingQualityScore: 38,
        socialInfrastructureScore: 26,
        transportAccessScore: 28,
        peripheralIsolationScore: 78,
        greenScore: 52,
        strBusinessMagnetScore: 12,
      },
      object: {
        resaleDepthScore: 30,
        buildingQualityScore: 42,
      },
    };

    const out = computeResidentialPurchaseScore(input);

    expect(out.territory.type).toBe('weak_peripheral_residential');
    expect(out.finalScore).toBeLessThan(45);
    expect(out.dimensions.liquidityScore).toBeLessThan(45);
    expect(out.trajectory.direction).toBe('uncertain');
    expect(out.explanation.summaryRu).toContain('слабая периферийная жилая среда');
  });

  it('industrial or road-adjacent area receives risk penalty', () => {
    const input: ResidentialPurchaseScoreInput = {
      territory: {
        density: 'medium',
        housingQualityScore: 48,
        socialInfrastructureScore: 58,
        transportAccessScore: 70,
        industrialRiskScore: 74,
        roadNoiseRiskScore: 82,
        greenScore: 28,
      },
      object: {
        resaleDepthScore: 52,
        buildingQualityScore: 46,
      },
    };

    const out = computeResidentialPurchaseScore(input);

    expect(out.territory.type).toBe('industrial_or_road_risk_zone');
    expect(out.dimensions.riskPenalty).toBeGreaterThanOrEqual(80);
    expect(out.dimensions.ecologyScore).toBeLessThan(45);
    expect(out.finalScore).toBeLessThan(45);
    expect(out.explanation.risksRu.join(' ')).toContain('факторы риска');
  });

  it('future infrastructure signal increases futureUpsideScore but not current infrastructureScore', () => {
    const base: ResidentialPurchaseScoreInput = {
      horizon: 5,
      territory: {
        density: 'medium',
        housingQualityScore: 62,
        socialInfrastructureScore: 45,
        transportAccessScore: 50,
        greenScore: 58,
        safetyScore: 60,
      },
    };
    const withFutureSignal: ResidentialPurchaseScoreInput = {
      ...base,
      earlyWarningSignals: [
        {
          type: 'government_procurement_school_design',
          impact: 'positive',
          confidence: 'high',
          stage: 'procurement',
          geoPrecision: 'nearby',
          title: 'Закупка на проектирование школы',
        },
      ],
    };

    const withoutSignal = computeResidentialPurchaseScore(base);
    const withSignal = computeResidentialPurchaseScore(withFutureSignal);

    expect(withSignal.dimensions.infrastructureScore).toBe(withoutSignal.dimensions.infrastructureScore);
    expect(withSignal.dimensions.futureUpsideScore).toBeGreaterThan(withoutSignal.dimensions.futureUpsideScore);
    expect(withSignal.trajectory.futureUpsideScore).toBeGreaterThan(0);
    expect(withSignal.explanation.notesRu.join(' ')).toContain('не считаются гарантией роста цены');
  });

  it('overbuilding signal increases overbuildingRiskScore', () => {
    const input: ResidentialPurchaseScoreInput = {
      territory: {
        density: 'medium',
        housingQualityScore: 56,
        socialInfrastructureScore: 48,
        transportAccessScore: 52,
        overbuildingPressureScore: 22,
      },
      earlyWarningSignals: [
        {
          type: 'overbuilding_risk',
          impact: 'negative',
          confidence: 'high',
          stage: 'planning',
          geoPrecision: 'district',
          title: 'Много новых ЖК без подтвержденной социалки',
        },
      ],
    };

    const out = computeResidentialPurchaseScore(input);

    expect(out.dimensions.overbuildingRiskScore).toBe(100);
    expect(out.dimensions.declineRiskScore).toBeGreaterThanOrEqual(90);
    expect(out.explanation.risksRu.join(' ')).toContain('переуплотнения');
  });

  it('no evidence is neutral and uncertain, not a dead-zone penalty', () => {
    const out = computeResidentialPurchaseScore({});

    expect(out.territory.type).toBe('no_evidence_uncertain');
    expect(out.territory.confidence).toBe('low');
    expect(out.dimensions.riskPenalty).toBe(0);
    expect(out.dimensions.liquidityScore).toBeGreaterThanOrEqual(45);
    expect(out.currentScore).toBeGreaterThanOrEqual(45);
    expect(out.trajectory.direction).toBe('uncertain');
    expect(out.explanation.risksRu.join(' ')).toContain('Данных мало');
  });
});
