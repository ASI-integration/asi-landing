import { describe, expect, it } from 'vitest';
import { buildLocationDisplayModel } from '../location-display-model';
import { buildLocationStandaloneReport } from '../standalone-report';
import type { LocationReportIntake } from '../report-intake';
import type {
  LocationAnalysis,
  MagnetItem,
  NeighborhoodEnvironmentLayer,
  ScoreBand,
  TargetAudience,
} from '../types';

function magnet(p: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId' | 'name' | 'distance'>): MagnetItem {
  return {
    categoryLabel: p.categoryId,
    icon: '•',
    lat: 0,
    lon: 0,
    weight: p.weight ?? 4,
    permanenceType: p.permanenceType ?? 'permanent',
    scopeLevel: p.scopeLevel ?? 'local',
    strengthClass: p.strengthClass ?? 'medium',
    attractionScore: p.attractionScore ?? 3,
    ...p,
  };
}

const baseEnv: NeighborhoodEnvironmentLayer = {
  environmentalFrictionScore: 26,
  concernLevel: 'moderate',
  concernLabelEn: 'Moderate concern',
  concernLabelRu: 'Окружение: умеренная нагрузка',
  reasonsEn: [],
  reasonsRu: [],
  environmentNarrativeEn: '',
  environmentNarrativeRu: 'Жилая среда требует проверки окружения и фактического спроса.',
  confidence: 'medium',
  breakdown: {
    majorRoads01: 0.24,
    industrial01: 0.46,
    aviation01: 0.04,
    nightlife01: 0.08,
    transitCorridor01: 0.12,
    harshUrbanStack01: 0.32,
  },
};

function fixture(p: {
  evergreenIndex: number;
  magnets: MagnetItem[];
  primaryAudience: TargetAudience;
  audienceFitScore: number;
  audienceSharePct?: number;
  businessClusterDetected?: boolean;
}): LocationAnalysis {
  return {
    evergreenIndex: p.evergreenIndex,
    scoreBand: (p.evergreenIndex >= 70 ? 'strong' : p.evergreenIndex >= 45 ? 'medium' : 'weak') as ScoreBand,
    locationScore: {
      location_score: p.evergreenIndex,
      rating: 'viable',
      breakdown: {
        demand_score: p.evergreenIndex,
        supply_score: 64,
        magnet_score: 66,
        seasonality_score: 58,
        audience_fit_score: p.audienceFitScore,
        accessibility_score: 42,
      },
      estimated_monthly_income: { short_term: 120000, mid_term: 90000, hybrid: 105000 },
      income_model: { base_adr_rub: 3000, base_occupancy_pct: 55 },
      top_positive_factors: [
        'Стабильный поток командированных: производственная зона рядом',
        'Сильные сигналы спроса в зоне',
      ],
      top_negative_factors: [],
      recommended_strategy: 'hybrid',
    },
    magnets: p.magnets,
    magnetCountByCategory: {},
    accessibilityStops: [],
    competitors: [],
    gravityExplanation: {
      dominantMagnets: [],
      strongestZoneLabel: '',
      competitorPressureLevel: 'low',
      demandDistribution: 'split',
      demandType: 'mixed',
      clusterDetected: false,
      clusterSize: 0,
      scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0, trafficBoost: 0 },
    },
    demandType: 'mixed',
    strongestMagnets: [],
    clusterZones: [],
    splitDemand: false,
    competitorPressure: 0,
    footTraffic: {
      modifierTier: 'moderate',
      boostPoints: 0,
      movementDensity: '',
      zoneActivity: '',
      flowStability: '',
      flowCharacter: '',
      transitVsTarget: { transitShare: 0.33, localActiveShare: 0.34, destinationShare: 0.33 },
      stability01: 0.5,
      concentration01: 0.5,
    },
    audienceAnalysis: {
      primaryAudience: p.primaryAudience,
      locationType: 'MIXED',
      audienceFitScore: p.audienceFitScore,
      primaryMagnets: [
        {
          type: 'business',
          name: 'Производственная зона',
          categoryId: 'business',
          subType: 'industrial',
          weight: 4,
          distance: 620,
          relevanceScore: 6,
        },
      ],
      fallbackMode: false,
      audienceSharePct: p.audienceSharePct ?? 75,
      businessClusterDetected: p.businessClusterDetected ?? true,
      primaryDriverLabel: 'Основной поток: BUSINESS — производственная зона',
      lockedMode: true,
      demandFlowLabel: 'устойчивый поток',
    },
    neighborhoodEnvironment: baseEnv,
    heatmapPoints: [],
    conclusion: '',
  };
}

function murinoIndustrialEdge(): LocationAnalysis {
  return fixture({
    evergreenIndex: 71,
    primaryAudience: 'BUSINESS',
    audienceFitScore: 72,
    magnets: [
      magnet({
        categoryId: 'business',
        name: 'Производственная зона Мурино',
        distance: 620,
        subType: 'industrial',
        weight: 4,
      }),
      magnet({
        categoryId: 'business',
        name: 'Складской комплекс',
        distance: 980,
        subType: 'factory',
        weight: 4,
      }),
      magnet({ categoryId: 'shopping_local', name: 'Магазин у дома', distance: 240 }),
    ],
  });
}

const intakeWithoutObjectParams: LocationReportIntake = {
  object_type: 'apartment',
  object_status: 'checking_address',
  intended_strategy: 'short_term',
  object_params: { parking: 'unknown' },
  requested_modules: ['income_range', 'strategy_comparison', 'district_risks', 'decision'],
  income_accuracy_acknowledged: true,
};

describe('LocationDisplayModel canonical residential interpretation', () => {
  it('caps Murino-style industrial edge and does not expose BUSINESS as public audience', () => {
    const model = buildLocationDisplayModel(murinoIndustrialEdge(), {
      locale: 'ru',
      mode: 'residential',
    });

    expect(model.rawScore).toBe(71);
    expect(model.displayScore).toBeLessThanOrEqual(55);
    expect(model.displayAudience).toBe('RESIDENTIAL');
    expect(model.verdictLabelRu).not.toBe('Сильная локация для командированных');
    expect(model.residentialSanityApplied).toBe(true);
    expect(model.capReasons.join(' ')).toContain('промышленные объекты');
  });

  it('uses the same canonical score, audience, verdict and drivers in paid report', () => {
    const analysis = murinoIndustrialEdge();
    const model = buildLocationDisplayModel(analysis, {
      locale: 'ru',
      mode: 'residential',
    });
    const report = buildLocationStandaloneReport({
      address: 'Мурино, Оборонная улица, 37',
      analysis,
      displayModel: model,
      market: 'RU',
    });
    const summary = report.sections.find(s => s.id === 'summary');
    expect(summary && summary.id === 'summary').toBe(true);
    if (!summary || summary.id !== 'summary') return;

    expect(report.location_score).toBe(model.displayScore);
    expect(report.display_model?.displayScore).toBe(model.displayScore);
    expect(summary.location_score).toBe(model.displayScore);
    expect(summary.display_audience).toBe(model.displayAudience);
    expect(summary.verdict_label_ru).toBe(model.verdictLabelRu);
    expect(summary.short_reason).toBe(model.reportNarrative);
    expect(summary.drivers).toEqual(model.safeDrivers.map(d => d.labelRu).slice(0, 3));
  });

  it('does not let factory/industrial positives become public business drivers', () => {
    const model = buildLocationDisplayModel(murinoIndustrialEdge(), {
      locale: 'ru',
      mode: 'residential',
    });

    expect(model.displayAudience).not.toBe('BUSINESS');
    expect(model.safeDrivers.map(d => d.labelRu).join(' ')).not.toMatch(/Стабильный поток командированных: производственная зона рядом/i);
  });

  it('shows cautious income as a range for medium/weak display scores', () => {
    const analysis = murinoIndustrialEdge();
    const model = buildLocationDisplayModel(analysis, {
      locale: 'ru',
      mode: 'residential',
    });
    const report = buildLocationStandaloneReport({
      address: 'Мурино, Оборонная улица, 37',
      analysis,
      displayModel: model,
      reportIntake: intakeWithoutObjectParams,
      market: 'RU',
    });
    const summary = report.sections.find(s => s.id === 'summary');
    expect(summary && summary.id === 'summary').toBe(true);
    if (!summary || summary.id !== 'summary') return;

    expect(model.displayScore).toBeLessThanOrEqual(55);
    expect(report.report_intake).toEqual(intakeWithoutObjectParams);
    expect(summary.income_rub_month).toBeNull();
    expect(summary.income_range_rub).toEqual({ low: 60000, high: 95000 });
    expect(summary.income_confidence).toBe('low');
    expect(summary.income_note).toMatch(/Осторожная доходная вилка/);
    expect(summary.income_note).not.toMatch(/гарантирован/i);
  });

  it('hides per-strategy point income in paid income_strategy section when confidence is low', () => {
    const analysis = murinoIndustrialEdge();
    const model = buildLocationDisplayModel(analysis, {
      locale: 'ru',
      mode: 'residential',
    });
    const report = buildLocationStandaloneReport({
      address: 'Мурино, Оборонная улица, 37',
      analysis,
      displayModel: model,
      reportIntake: intakeWithoutObjectParams,
      market: 'RU',
    });
    const income = report.sections.find(s => s.id === 'income_strategy');
    expect(income && income.id === 'income_strategy').toBe(true);
    if (!income || income.id !== 'income_strategy') return;

    expect(income.income_confidence).toBe('low');
    expect(income.monthly_income_rub.short_term).toBeNull();
    expect(income.monthly_income_rub.hybrid).toBeNull();
    expect(income.monthly_income_rub.mid_term).toBeNull();
    expect(income.income_range_rub).not.toBeNull();
    expect(income.assumptions.length).toBeGreaterThan(0);
    expect(income.positioning_hint ?? '').not.toMatch(/гарантирован/i);
  });
});
