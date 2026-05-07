import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGeocode = vi.fn();
const mockCacheGetByAddress = vi.fn();
const mockCacheSet = vi.fn();
const mockFetchOsmData = vi.fn();
const mockBuildAnalysis = vi.fn();
const mockGetRequest = vi.fn();

vi.mock('@/lib/location/address-providers/geocode-pipeline', () => ({
  geocodePlainAddressForMarket: (...args: unknown[]) => mockGeocode(...args),
}));

vi.mock('@/lib/location/cache', () => ({
  normalizeAddress: (value: string) => value,
  cacheGetByAddress: (...args: unknown[]) => mockCacheGetByAddress(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
}));

vi.mock('@/lib/location/report-request-store', () => ({
  getLocationReportRequestById: (...args: unknown[]) => mockGetRequest(...args),
  hasPaidLocationReportAccess: (entity: { access_status?: string }) =>
    entity?.access_status === 'paid' || entity?.access_status === 'granted',
}));

vi.mock('@/lib/location', async () => {
  const actual = await vi.importActual<typeof import('@/lib/location')>('@/lib/location');
  return {
    ...actual,
    fetchOsmData: (...args: unknown[]) => mockFetchOsmData(...args),
    buildAnalysis: (...args: unknown[]) => mockBuildAnalysis(...args),
  };
});

import { POST } from '../route';
import { buildLocationDisplayModel } from '@/lib/location/location-display-model';
import type { LocationAnalysis, MagnetItem, NeighborhoodEnvironmentLayer, ScoreBand, TargetAudience } from '@/lib/location/types';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/location-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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
  concernLabelEn: '',
  concernLabelRu: '',
  reasonsEn: [],
  reasonsRu: [],
  environmentNarrativeEn: '',
  environmentNarrativeRu: '',
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

/** Murino-style industrial-edge fixture: raw evergreenIndex 92 must be capped to ≤ 55 publicly. */
function murinoIndustrialEdgeAnalysis(): LocationAnalysis {
  const evergreenIndex = 92;
  const magnets: MagnetItem[] = [
    magnet({ categoryId: 'business', name: 'Производство Мурино', distance: 600, subType: 'factory', weight: 6, strengthClass: 'strong' }),
    magnet({ categoryId: 'business', name: 'Складской комплекс', distance: 980, subType: 'industrial', weight: 6, strengthClass: 'strong' }),
    magnet({ categoryId: 'metro', name: 'Девяткино', distance: 1400, strengthClass: 'strong', weight: 9 }),
    magnet({ categoryId: 'shopping_local', name: 'Магазин у дома', distance: 250, weight: 2 }),
  ];
  const primaryAudience: TargetAudience = 'BUSINESS';
  return {
    evergreenIndex,
    scoreBand: 'strong' as ScoreBand,
    locationScore: {
      location_score: evergreenIndex,
      rating: 'exceptional',
      breakdown: {
        demand_score: evergreenIndex,
        supply_score: 64,
        magnet_score: 66,
        seasonality_score: 58,
        audience_fit_score: 78,
        accessibility_score: 42,
      },
      estimated_monthly_income: { short_term: 180000, mid_term: 120000, hybrid: 150000 },
      income_model: { base_adr_rub: 3000, base_occupancy_pct: 60 },
      top_positive_factors: ['Стабильный поток командированных: производственная зона рядом'],
      top_negative_factors: [],
      recommended_strategy: 'hybrid',
    },
    magnets,
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
      primaryAudience,
      locationType: 'MIXED',
      audienceFitScore: 78,
      primaryMagnets: [],
      fallbackMode: false,
      audienceSharePct: 75,
      businessClusterDetected: true,
      primaryDriverLabel: '',
      lockedMode: true,
      demandFlowLabel: '',
    },
    neighborhoodEnvironment: baseEnv,
    heatmapPoints: [],
    conclusion: '',
  };
}

describe('POST /api/location-report — canonical parity with LocationDisplayModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGetByAddress.mockResolvedValue(null);
    mockGetRequest.mockResolvedValue(null);
    mockGeocode.mockResolvedValue({ result: { lat: 60.04, lon: 30.45 } });
    mockFetchOsmData.mockResolvedValue({ elements: [], hadProviderFailure: false, usedFallbackQuery: false });
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('does not return raw uncapped score for Murino-style industrial-edge case (preview)', async () => {
    const analysis = murinoIndustrialEdgeAnalysis();
    mockBuildAnalysis.mockReturnValue(analysis);

    const expected = buildLocationDisplayModel(analysis, { locale: 'ru', mode: 'residential' });
    expect(expected.rawScore).toBe(92);
    expect(expected.displayScore).toBeLessThanOrEqual(55);

    const res = await POST(makeReq({ address: 'Мурино, Оборонная 37', locale: 'ru' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.report.is_preview).toBe(true);

    // Public score is the canonical capped score, never the raw 92.
    expect(json.report.location_score).toBe(expected.displayScore);
    expect(json.report.location_score).toBeLessThanOrEqual(55);
    expect(json.report.location_score).not.toBe(92);

    // Display projection mirrors LocationDisplayModel.
    expect(json.report.display.display_score).toBe(expected.displayScore);
    expect(json.report.display.display_audience).toBe(expected.displayAudience);
    expect(json.report.display.display_audience).not.toBe('BUSINESS');
    expect(json.report.display.verdict_label_ru).toBe(expected.verdictLabelRu);
    expect(json.report.display.verdict_label_ru).not.toContain('Сильная локация для командированных');
    expect(json.report.display.cap_reasons.join(' ')).toContain('промышленные объекты');
    expect(json.report.display.residential_sanity_applied).toBe(true);

    // No raw industrial driver leaked into top_positive_factors.
    expect((json.report.top_positive_factors as string[]).join(' ')).not.toMatch(/производствен|завод|industrial|factory/i);

    // Public rating is no longer 'exceptional' / 'strong' for a capped score.
    expect(['risky', 'weak', 'viable']).toContain(json.report.rating);
  });

  it('paid full report low-confidence income does not expose exact point monthly numbers', async () => {
    const analysis = murinoIndustrialEdgeAnalysis();
    mockBuildAnalysis.mockReturnValue(analysis);
    mockGetRequest.mockResolvedValue({ access_status: 'paid' });

    const res = await POST(makeReq({ address: 'Мурино, Оборонная 37', locale: 'ru', request_id: 'req_paid' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.report.is_preview).toBe(false);

    const income = json.report.estimated_monthly_income;
    expect(income.confidence).toBe('low');
    expect(income.short_term).toBeNull();
    expect(income.hybrid).toBeNull();
    expect(income.mid_term).toBeNull();
    expect(income.range).not.toBeNull();
    expect(income.note).toMatch(/Осторожная|диапазон/i);
    expect(income.note).not.toMatch(/гарантирован/i);
  });

  it('demo display model and legacy /api/location-report agree on public score, audience, verdict', async () => {
    const analysis = murinoIndustrialEdgeAnalysis();
    mockBuildAnalysis.mockReturnValue(analysis);

    const demoModel = buildLocationDisplayModel(analysis, { locale: 'ru', mode: 'residential' });

    const res = await POST(makeReq({ address: 'Мурино, Оборонная 37', locale: 'ru' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.report.location_score).toBe(demoModel.displayScore);
    expect(json.report.display.display_score).toBe(demoModel.displayScore);
    expect(json.report.display.display_audience).toBe(demoModel.displayAudience);
    expect(json.report.display.verdict_label_ru).toBe(demoModel.verdictLabelRu);
    expect(json.report.display.verdict_tone).toBe(demoModel.verdictTone);
    expect(json.report.display.cap_reasons).toEqual(demoModel.capReasons);
    expect(json.report.display.safe_drivers).toEqual(demoModel.safeDrivers);
  });
});
