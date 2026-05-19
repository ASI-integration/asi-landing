/**
 * Unified report assembly reads scores from `LocationAnalysis` only (projection / copy).
 * Numeric headline must come from `gravity-scoring` → `locationScore`; never derive new composites here.
 */

import type {
  ConfidenceLevel,
  DataQualityLevel,
  ReportLocale,
  ReportMode,
  RiskSeverity,
} from './report-contract';
import type {
  HeatmapPoint,
  LocationAnalysis,
  LocationScoreBreakdown,
  RecommendedStrategy,
} from './types';
import { buildCommercialFormatFit } from './commercial-format-fit';
import { filterResidentialPrimeMagnets, type ResidentialMarketMode } from './residential-prime-magnets';
import { classifyMagnetSignal } from './signals/location-signal-taxonomy';
import type {
  UrbanDevelopmentSignal,
  UrbanDevelopmentSignalsSnapshot,
} from './data-sources/urban-development';
import {
  computeUrbanDevelopmentForecastScore,
  type UrbanDevelopmentForecastScore,
} from './data-sources/urban-development-forecast-score';
import { portDemandDetailLinesRu, strategicHubPaidDetailLinesRu } from './strategic-transport-hub';
import { specializedMedicalPaidDetailLinesRu } from './specialized-medical-anchor';

export type {
  UrbanDevelopmentForecastConfidence,
  UrbanDevelopmentForecastContributingSignalRef,
  UrbanDevelopmentForecastLevel,
  UrbanDevelopmentForecastScore,
} from './data-sources/urban-development-forecast-score';

export type ReportLevel = 'express' | 'full';
export type LocationReportGoal = 'buy' | 'rent' | 'launch' | 'evaluate';
export type LocationUseCase = 'guest_stay' | 'retail_or_service' | 'mixed_use' | 'unknown';
export type SignalStatus = 'available' | 'partial' | 'missing' | 'not_configured';
export type SourceStatus = SignalStatus | 'unavailable';
export type DecisionAction = 'buy' | 'rent' | 'launch' | 'avoid' | 'manually_verify';

export interface SourceAvailability {
  status: SignalStatus;
  sourceStatus: SourceStatus;
  sourceName: string;
  confidenceImpact: 'none' | 'minor' | 'moderate' | 'major';
  manualVerification: string[];
}

export interface DataQuality {
  level: DataQualityLevel;
  completeness: SignalStatus;
  freshness: 'current' | 'stale' | 'unknown';
  sourceStatus: SourceStatus;
  confidenceImpact: SourceAvailability['confidenceImpact'];
}

export interface EvidenceItem {
  id: string;
  sourceType:
    | 'engine'
    | 'osm'
    | 'derived'
    | 'user'
    | 'market_proxy'
    | 'public_urban_planning_data'
    | 'open_city_development_source'
    | 'not_connected';
  title: string;
  description: string;
  value?: string | number;
  url?: string;
  observedAtIso?: string;
  confidence: ConfidenceLevel;
}

interface SignalBlockBase {
  status: SignalStatus;
  sourceStatus: SourceStatus;
  confidence: ConfidenceLevel;
  dataQuality: DataQuality;
  evidence: EvidenceItem[];
  limitations: string[];
  manualVerificationNeeded: boolean;
  manualVerification: string[];
}

export interface LocationReportSection extends SignalBlockBase {
  id: string;
  title: string;
  summary: string;
  items: string[];
}

export interface DemandSignals extends SignalBlockBase {
  demandType: LocationAnalysis['demandType'] | 'unknown';
  demandScore: number | null;
  guestDemandDrivers: string[];
  shortTermRentalPotential: RecommendedStrategy | null;
  stayTypeStrategy: string | null;
}

export interface CompetitionSignals extends SignalBlockBase {
  competitorCount: number | null;
  pressureLevel: 'low' | 'medium' | 'high' | 'unknown';
  visibleDataOnly: boolean;
}

export interface PricingSignals extends SignalBlockBase {
  currency: 'RUB' | 'USD' | 'unknown';
  roughMonthlyCorridor: {
    low: number;
    high: number;
  } | null;
  strategyCorridors: Array<{
    strategy: RecommendedStrategy;
    amountMonthly: number;
  }>;
}

export interface SeasonalitySignals extends SignalBlockBase {
  seasonalityScore: number | null;
  notes: string[];
}

export interface MagnetSignalItem {
  categoryId: string;
  name: string;
  distanceM: number;
  tier: 'tier1' | 'tier2' | 'context';
  domain: string;
}

export interface MagnetSignals extends SignalBlockBase {
  tier1: MagnetSignalItem[];
  tier2: MagnetSignalItem[];
  residentialImpact: MagnetSignalItem[];
}

export interface TransportInfrastructureSignals extends SignalBlockBase {
  transitShare: number | null;
  localActiveShare: number | null;
  destinationShare: number | null;
  accessibilityStopsCount: number | null;
  spatialNotes: string[];
}

export interface UrbanDevelopmentSignals extends SignalBlockBase {
  plannedConstructionProjects: UrbanDevelopmentSignalsSnapshot['plannedConstructionProjects'];
  infrastructurePlans: UrbanDevelopmentSignalsSnapshot['infrastructurePlans'];
  roadTransportChanges: UrbanDevelopmentSignalsSnapshot['roadTransportChanges'];
  zoningPublicPlanningNotes: UrbanDevelopmentSignalsSnapshot['zoningPublicPlanningNotes'];
}

export interface EnvironmentalTrafficRiskSignals extends SignalBlockBase {
  environmentalFrictionScore: number | null;
  concernLevel: LocationAnalysis['neighborhoodEnvironment']['concernLevel'] | 'unknown';
  trafficLoadSignals: string[];
}

export interface HeatMapSignals extends SignalBlockBase {
  points: HeatmapPoint[];
  summary: string;
}

export interface AudienceFitSignals extends SignalBlockBase {
  primaryAudience: 'business' | 'tourist' | 'family' | 'mixed' | 'unknown';
  score: number | null;
  formatFit?: ReturnType<typeof buildCommercialFormatFit>;
  residentialStrategy?: LocationAnalysis['residentialAnalysis'];
}

export interface RiskSignals extends SignalBlockBase {
  items: Array<{
    title: string;
    severity: RiskSeverity;
    description: string;
    evidenceIds: string[];
  }>;
}

export interface DecisionRecommendation extends SignalBlockBase {
  decision: DecisionAction;
  rationale: string;
  checklist: string[];
}

export interface LocationReportInput {
  address: string;
  locale: ReportLocale;
  level?: ReportLevel;
  goal?: LocationReportGoal;
  useCase?: LocationUseCase;
  objectType?: string;
  objectContext?: Record<string, unknown>;
  coordinates?: {
    lat: number;
    lon: number;
  };
  requestedAtIso: string;
}

export interface LocationReportContext {
  analysis?: LocationAnalysis;
  generatedAtIso?: string;
  market?: ResidentialMarketMode;
  urbanDevelopment?: UrbanDevelopmentSignalsSnapshot;
  /** Нормализованные сигналы для слоя `urbanDevelopmentForecastScore` (не влияет на основной score). */
  urbanDevelopmentSignals?: UrbanDevelopmentSignal[];
  sourceAvailability?: Partial<Record<keyof UnifiedLocationReport['signals'], SourceAvailability>>;
}

export interface UnifiedLocationReport {
  version: 'unified-location-potential-report-v1';
  level: ReportLevel;
  input: LocationReportInput;
  createdAtIso: string;
  overallScore: number | null;
  scoreBreakdown: Partial<LocationScoreBreakdown> | null;
  summary: string;
  /** Основной текущий показатель локации (магниты / gravity); без изменений при добавлении прогноза градоразвития. */
  currentLocationScore: number | null;
  /** Отдельный прогнозный слой по сигналам градоразвития; не смешивается с `currentLocationScore`. */
  urbanDevelopmentForecastScore: UrbanDevelopmentForecastScore;
  signals: {
    demand: DemandSignals;
    competition: CompetitionSignals;
    pricing: PricingSignals;
    seasonality: SeasonalitySignals;
    magnets: MagnetSignals;
    transportInfrastructure: TransportInfrastructureSignals;
    urbanDevelopment: UrbanDevelopmentSignals;
    environmentalTrafficRisk: EnvironmentalTrafficRiskSignals;
    heatMap: HeatMapSignals;
    audienceFit: AudienceFitSignals;
    risks: RiskSignals;
    recommendation: DecisionRecommendation;
  };
  sections: LocationReportSection[];
  manualVerificationChecklist: string[];
}

function quality(
  level: DataQualityLevel,
  completeness: SignalStatus,
  sourceStatus: SourceStatus,
  confidenceImpact: SourceAvailability['confidenceImpact'],
): DataQuality {
  return {
    level,
    completeness,
    freshness: sourceStatus === 'available' || sourceStatus === 'partial' ? 'current' : 'unknown',
    sourceStatus,
    confidenceImpact,
  };
}

function unavailableBlock<T extends SignalBlockBase>(
  sourceStatus: Exclude<SourceStatus, 'available' | 'partial'>,
  sourceName: string,
  manualVerification: string[],
  extra: Omit<T, keyof SignalBlockBase>,
): T {
  return {
    status: sourceStatus === 'not_configured' ? 'not_configured' : 'missing',
    sourceStatus,
    confidence: 'low',
    dataQuality: quality('low', sourceStatus === 'not_configured' ? 'not_configured' : 'missing', sourceStatus, 'major'),
    evidence: [],
    limitations: [`${sourceName} is not connected to this report yet.`],
    manualVerificationNeeded: true,
    manualVerification,
    ...extra,
  } as unknown as T;
}

function evidence(id: string, title: string, description: string, value?: string | number): EvidenceItem {
  return {
    id,
    sourceType: 'engine',
    title,
    description,
    value,
    confidence: 'medium',
  };
}

function confidenceFromCount(count: number): ConfidenceLevel {
  if (count >= 6) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

function goalFromLegacyMode(mode?: ReportMode): Pick<LocationReportInput, 'goal' | 'useCase'> {
  if (mode === 'commercial') return { goal: 'launch', useCase: 'retail_or_service' };
  if (mode === 'residential') return { goal: 'rent', useCase: 'guest_stay' };
  return { goal: 'evaluate', useCase: 'unknown' };
}

export function locationReportInputFromLegacy(input: {
  address: string;
  locale: ReportLocale;
  mode?: ReportMode;
  objectType?: string;
  objectContext?: Record<string, unknown>;
  coordinates?: { lat: number; lon: number };
  requestedAtIso?: string;
}): LocationReportInput {
  return {
    address: input.address,
    locale: input.locale,
    ...goalFromLegacyMode(input.mode),
    objectType: input.objectType,
    objectContext: input.objectContext,
    coordinates: input.coordinates,
    requestedAtIso: input.requestedAtIso ?? new Date().toISOString(),
  };
}

function buildDemand(input: LocationReportInput, analysis?: LocationAnalysis): DemandSignals {
  if (!analysis) {
    return unavailableBlock<DemandSignals>('missing', 'Demand signals', [
      'Verify demand drivers from open map data, listing platforms, and field context.',
    ], {
      demandType: 'unknown',
      demandScore: null,
      guestDemandDrivers: [],
      shortTermRentalPotential: null,
      stayTypeStrategy: null,
    });
  }

  const score = analysis.locationScore;
  const evidenceItems = [
    evidence('demand-type', 'Demand type', 'Demand character from the location engine.', analysis.demandType),
    evidence('demand-score', 'Demand score', 'Demand score from the explainable location score.', score?.breakdown.demand_score ?? analysis.evergreenIndex),
  ];
  const residential = analysis.residentialAnalysis;
  return {
    status: 'available',
    sourceStatus: 'available',
    confidence: confidenceFromCount(analysis.magnets.length),
    dataQuality: quality('medium', 'available', 'available', 'none'),
    evidence: evidenceItems,
    limitations: ['Demand is inferred from open spatial signals and does not replace live booking or sales data.'],
    manualVerificationNeeded: false,
    manualVerification: [],
    demandType: analysis.demandType,
    demandScore: score?.breakdown.demand_score ?? analysis.evergreenIndex,
    guestDemandDrivers: (() => {
      const hubLines = strategicHubPaidDetailLinesRu(analysis.strategicTransportHubMagnets ?? []);
      const portLines = portDemandDetailLinesRu(analysis.magnets ?? []);
      const medLines = specializedMedicalPaidDetailLinesRu(analysis.magnets ?? []);
      const factorLines = score?.top_positive_factors ?? [];
      const premiumLines = residential?.premiumComfortSignals ?? [];
      // Strategic / specialized anchors must not be displaced by score-factor filler or premium copy.
      return [...new Set([...portLines, ...hubLines, ...medLines, ...factorLines, ...premiumLines])].slice(0, 12);
    })(),
    shortTermRentalPotential: score?.recommended_strategy ?? null,
    stayTypeStrategy: residential?.strategyRationaleRu ?? null,
  };
}

function buildCompetition(analysis?: LocationAnalysis): CompetitionSignals {
  if (!analysis) {
    return unavailableBlock<CompetitionSignals>('missing', 'Competition signals', [
      'Check visible competitor density in map sources and active marketplaces.',
    ], {
      competitorCount: null,
      pressureLevel: 'unknown',
      visibleDataOnly: true,
    });
  }

  return {
    status: 'partial',
    sourceStatus: 'partial',
    confidence: analysis.competitors.length >= 3 ? 'medium' : 'low',
    dataQuality: quality('medium', 'partial', 'partial', 'moderate'),
    evidence: [
      evidence('competitor-count', 'Visible competitor count', 'Competitors detected in currently available open data.', analysis.competitors.length),
      evidence('competitor-pressure', 'Pressure level', 'Competition pressure from the gravity engine.', analysis.gravityExplanation.competitorPressureLevel),
    ],
    limitations: ['Competitor data is visible/open-data only and can miss active inventory on private marketplaces.'],
    manualVerificationNeeded: true,
    manualVerification: ['Validate active competitors, photos, calendars, reviews, and pricing on current marketplaces.'],
    competitorCount: analysis.competitors.length,
    pressureLevel: analysis.gravityExplanation.competitorPressureLevel,
    visibleDataOnly: true,
  };
}

function buildPricing(analysis?: LocationAnalysis): PricingSignals {
  const score = analysis?.locationScore;
  if (!score) {
    return unavailableBlock<PricingSignals>('missing', 'Pricing corridor', [
      'Collect current comparable listings or commercial rents before making a pricing decision.',
    ], {
      currency: 'unknown',
      roughMonthlyCorridor: null,
      strategyCorridors: [],
    });
  }

  const values = Object.values(score.estimated_monthly_income).filter(Number.isFinite);
  return {
    status: 'partial',
    sourceStatus: 'partial',
    confidence: 'low',
    dataQuality: quality('low', 'partial', 'partial', 'moderate'),
    evidence: [
      evidence('pricing-proxy', 'Engine pricing proxy', 'Approximate monthly corridor from the existing score model.', `${Math.min(...values)}-${Math.max(...values)} RUB`),
    ],
    limitations: [
      'Pricing is an approximate corridor from model proxies, not a guaranteed income or rent forecast.',
      'Actual economics depend on asset quality, fit-out, season, channel costs, legal limits, and operations.',
    ],
    manualVerificationNeeded: true,
    manualVerification: ['Verify current comparable prices and costs manually before buy/rent/launch decisions.'],
    currency: 'RUB',
    roughMonthlyCorridor: values.length ? { low: Math.min(...values), high: Math.max(...values) } : null,
    strategyCorridors: [
      { strategy: 'short_term', amountMonthly: score.estimated_monthly_income.short_term },
      { strategy: 'hybrid', amountMonthly: score.estimated_monthly_income.hybrid },
      { strategy: 'mid_term', amountMonthly: score.estimated_monthly_income.mid_term },
    ],
  };
}

function buildSeasonality(analysis?: LocationAnalysis): SeasonalitySignals {
  const seasonalityScore = analysis?.locationScore?.breakdown.seasonality_score;
  if (seasonalityScore == null) {
    return unavailableBlock<SeasonalitySignals>('missing', 'Seasonality signals', [
      'Verify booking/sales seasonality with current market data.',
    ], { seasonalityScore: null, notes: [] });
  }

  return {
    status: 'partial',
    sourceStatus: 'partial',
    confidence: 'low',
    dataQuality: quality('low', 'partial', 'partial', 'minor'),
    evidence: [evidence('seasonality-score', 'Seasonality score', 'Seasonality proxy from the location score.', seasonalityScore)],
    limitations: ['Seasonality is a proxy layer and must be checked against current market calendars.'],
    manualVerificationNeeded: true,
    manualVerification: ['Check monthly demand, holidays, event calendars, and low-season behavior.'],
    seasonalityScore,
    notes: seasonalityScore >= 70 ? ['Seasonality proxy is elevated.'] : ['Seasonality proxy is moderate or weak.'],
  };
}

function buildMagnets(analysis?: LocationAnalysis, market: ResidentialMarketMode = 'RU'): MagnetSignals {
  if (!analysis) {
    return unavailableBlock<MagnetSignals>('missing', 'Attraction magnets', [
      'Verify Tier-1 and Tier-2 magnets from open map data and local inspection.',
    ], { tier1: [], tier2: [], residentialImpact: [] });
  }

  const magnetItems = analysis.strongestMagnets.slice(0, 10).map(m => {
    const taxonomy = classifyMagnetSignal(m);
    const tier = taxonomy.level === 'tier1_anchor'
      ? 'tier1'
      : taxonomy.level === 'tier2_anchor'
        ? 'tier2'
        : 'context';
    return {
      categoryId: m.categoryId,
      name: m.name,
      distanceM: Math.round(m.distance),
      tier,
      domain: taxonomy.domain,
    } satisfies MagnetSignalItem;
  });
  const residentialImpact = filterResidentialPrimeMagnets(analysis.magnets, { market }).map(m => ({
    categoryId: m.categoryId,
    name: m.name,
    distanceM: Math.round(m.distance),
    tier: m.anchorType === 'POSITIVE_DEMAND_ANCHOR' ? 'tier1' : 'context',
    domain: 'residential_guest_demand',
  } satisfies MagnetSignalItem));

  return {
    status: magnetItems.length ? 'available' : 'partial',
    sourceStatus: magnetItems.length ? 'available' : 'partial',
    confidence: confidenceFromCount(magnetItems.length),
    dataQuality: quality('medium', magnetItems.length ? 'available' : 'partial', magnetItems.length ? 'available' : 'partial', 'none'),
    evidence: magnetItems.slice(0, 5).map((m, i) => evidence(`magnet-${i + 1}`, m.name, `${m.tier} ${m.domain} magnet at ${m.distanceM} m.`, m.categoryId)),
    limitations: ['Magnet strength is inferred from open spatial data; real draw depends on scale, access, and current operation.'],
    manualVerificationNeeded: false,
    manualVerification: [],
    tier1: magnetItems.filter(m => m.tier === 'tier1'),
    tier2: magnetItems.filter(m => m.tier === 'tier2'),
    residentialImpact,
  };
}

function buildTransportInfrastructure(analysis?: LocationAnalysis): TransportInfrastructureSignals {
  if (!analysis) {
    return unavailableBlock<TransportInfrastructureSignals>('missing', 'Transport and infrastructure', [
      'Verify transit access, pedestrian barriers, road load, and last-meter access manually.',
    ], {
      transitShare: null,
      localActiveShare: null,
      destinationShare: null,
      accessibilityStopsCount: null,
      spatialNotes: [],
    });
  }

  const ft = analysis.footTraffic.transitVsTarget;
  return {
    status: 'available',
    sourceStatus: 'available',
    confidence: analysis.spatialFoundation?.enabled ? 'medium' : 'low',
    dataQuality: quality('medium', 'available', 'available', 'minor'),
    evidence: [
      evidence('flow-character', 'Flow character', 'Foot-traffic character from open spatial signals.', analysis.footTraffic.flowCharacter),
      evidence('accessibility-stops', 'Accessibility stops', 'Nearby public-transport stop count.', analysis.accessibilityStops.length),
    ],
    limitations: ['Pedestrian access is not a full routing graph unless a graph/provider layer is connected.'],
    manualVerificationNeeded: true,
    manualVerification: ['Check physical approach, crossings, parking, signage, and barriers on site.'],
    transitShare: Math.round(ft.transitShare * 100) / 100,
    localActiveShare: Math.round(ft.localActiveShare * 100) / 100,
    destinationShare: Math.round(ft.destinationShare * 100) / 100,
    accessibilityStopsCount: analysis.accessibilityStops.length,
    spatialNotes: analysis.spatialFoundation ? [analysis.spatialFoundation.geometricConfidenceNoteRu] : [],
  };
}

function buildUrbanDevelopment(snapshot?: UrbanDevelopmentSignalsSnapshot): UrbanDevelopmentSignals {
  if (!snapshot) {
    return {
      ...unavailableBlock<UrbanDevelopmentSignals>('not_configured', 'Urban development sources', [
        'Данные о планируемом развитии района не подключены. Требуется ручная проверка открытых градостроительных источников.',
        'Check public urban planning data, open city development sources, construction/planning signals, and planned infrastructure where available.',
      ], {
        plannedConstructionProjects: [],
        infrastructurePlans: [],
        roadTransportChanges: [],
        zoningPublicPlanningNotes: [],
      }),
      limitations: [
        'Данные о планируемом развитии района не подключены. Требуется ручная проверка открытых градостроительных источников.',
      ],
    };
  }

  const total =
    snapshot.plannedConstructionProjects.length +
    snapshot.infrastructurePlans.length +
    snapshot.roadTransportChanges.length +
    snapshot.zoningPublicPlanningNotes.length;

  return {
    status: total ? 'available' : 'missing',
    sourceStatus: total ? 'available' : 'missing',
    confidence: total ? 'medium' : 'low',
    dataQuality: quality(total ? 'medium' : 'low', total ? 'available' : 'missing', total ? 'available' : 'missing', total ? 'minor' : 'major'),
    evidence: snapshot.sources.map((s, i) => ({
      id: `urban-source-${i + 1}`,
      sourceType: s.sourceType === 'public_urban_planning_data' ? 'public_urban_planning_data' : 'open_city_development_source',
      title: s.title,
      description: s.note ?? 'Open public planning source.',
      url: s.url,
      observedAtIso: s.retrievedAtIso,
      confidence: 'medium',
    })),
    limitations: total ? ['Planning data can be incomplete, delayed, or revised by public authorities.'] : [
      'No urban development records were provided by a connected source.',
    ],
    manualVerificationNeeded: true,
    manualVerification: ['Verify planning documents, permits, public hearings, and construction status manually.'],
    plannedConstructionProjects: snapshot.plannedConstructionProjects,
    infrastructurePlans: snapshot.infrastructurePlans,
    roadTransportChanges: snapshot.roadTransportChanges,
    zoningPublicPlanningNotes: snapshot.zoningPublicPlanningNotes,
  };
}

function buildEnvironmentalTrafficRisk(analysis?: LocationAnalysis): EnvironmentalTrafficRiskSignals {
  const env = analysis?.neighborhoodEnvironment;
  if (!env) {
    return unavailableBlock<EnvironmentalTrafficRiskSignals>('missing', 'Environmental and traffic-load risk', [
      'Verify road load, noise, industrial context, nightlife, and aviation exposure manually.',
    ], {
      environmentalFrictionScore: null,
      concernLevel: 'unknown',
      trafficLoadSignals: [],
    });
  }

  return {
    status: 'available',
    sourceStatus: 'available',
    confidence: env.confidence,
    dataQuality: quality(env.confidence === 'high' ? 'high' : 'medium', 'available', 'available', 'minor'),
    evidence: [
      evidence('environment-friction', 'Environmental friction score', env.environmentNarrativeRu, env.environmentalFrictionScore),
    ],
    limitations: ['Environmental risk is based on OSM-style proxies and should be checked on site.'],
    manualVerificationNeeded: env.concernLevel === 'elevated' || env.concernLevel === 'high',
    manualVerification: env.concernLevel === 'elevated' || env.concernLevel === 'high'
      ? ['Check noise, road crossings, air/traffic load, and nighttime activity in person.']
      : [],
    environmentalFrictionScore: env.environmentalFrictionScore,
    concernLevel: env.concernLevel,
    trafficLoadSignals: env.reasonsRu,
  };
}

function buildHeatMap(analysis?: LocationAnalysis): HeatMapSignals {
  if (!analysis) {
    return unavailableBlock<HeatMapSignals>('missing', 'Heat-map location signals', [
      'Generate heat-map from magnet and competitor data once spatial analysis is available.',
    ], { points: [], summary: 'Heat-map signals are unavailable.' });
  }

  return {
    status: analysis.heatmapPoints.length ? 'available' : 'partial',
    sourceStatus: analysis.heatmapPoints.length ? 'available' : 'partial',
    confidence: confidenceFromCount(analysis.heatmapPoints.length),
    dataQuality: quality('medium', analysis.heatmapPoints.length ? 'available' : 'partial', analysis.heatmapPoints.length ? 'available' : 'partial', 'minor'),
    evidence: [evidence('heatmap-points', 'Heat-map points', 'Normalized influence points from magnets and competitors.', analysis.heatmapPoints.length)],
    limitations: ['Heat-map points show model influence, not measured footfall.'],
    manualVerificationNeeded: false,
    manualVerification: [],
    points: analysis.heatmapPoints,
    summary: `${analysis.heatmapPoints.length} model influence points are available.`,
  };
}

function primaryAudience(analysis?: LocationAnalysis): AudienceFitSignals['primaryAudience'] {
  const audience = analysis?.audienceAnalysis?.primaryAudience;
  if (audience === 'BUSINESS') return 'business';
  if (audience === 'TOURIST') return 'tourist';
  if (audience === 'FAMILY') return 'family';
  if (analysis) return 'mixed';
  return 'unknown';
}

function buildAudienceFit(input: LocationReportInput, analysis?: LocationAnalysis): AudienceFitSignals {
  if (!analysis) {
    return unavailableBlock<AudienceFitSignals>('missing', 'Audience fit', [
      'Validate target audience and format fit manually.',
    ], { primaryAudience: 'unknown', score: null });
  }

  const formatFit = input.useCase === 'retail_or_service' || input.goal === 'launch'
    ? buildCommercialFormatFit(analysis)
    : undefined;
  return {
    status: 'available',
    sourceStatus: 'available',
    confidence: analysis.audienceAnalysis?.lockedMode ? 'medium' : 'low',
    dataQuality: quality('medium', 'available', 'available', 'none'),
    evidence: [
      evidence('audience-primary', 'Primary audience', 'Primary audience from the audience scoring layer.', primaryAudience(analysis)),
      evidence('audience-fit-score', 'Audience fit score', 'Audience fit score from the analysis layer.', analysis.audienceAnalysis?.audienceFitScore ?? 'unavailable'),
    ],
    limitations: ['Audience fit is inferred from spatial signals and should be compared with actual customer or guest behavior.'],
    manualVerificationNeeded: true,
    manualVerification: ['Validate actual audience by market listings, footfall observation, and local interviews.'],
    primaryAudience: primaryAudience(analysis),
    score: analysis.audienceAnalysis?.audienceFitScore ?? null,
    formatFit,
    residentialStrategy: analysis.residentialAnalysis,
  };
}

function buildRisks(analysis?: LocationAnalysis): RiskSignals {
  if (!analysis) {
    return unavailableBlock<RiskSignals>('missing', 'Risks and limitations', [
      'Verify location risks manually once demand, competition, and environment layers are available.',
    ], { items: [] });
  }

  const scoreRisks = (analysis.locationScore?.top_negative_factors ?? []).slice(0, 4).map((description, index) => ({
    title: `Model risk ${index + 1}`,
    severity: 'medium' as RiskSeverity,
    description,
    evidenceIds: ['risk-score'],
  }));
  const env = analysis.neighborhoodEnvironment;
  const envRisk = env.concernLevel === 'elevated' || env.concernLevel === 'high'
    ? [{
        title: 'Environmental or traffic-load burden',
        severity: env.concernLevel === 'high' ? 'high' as RiskSeverity : 'medium' as RiskSeverity,
        description: env.environmentNarrativeRu,
        evidenceIds: ['environment-friction'],
      }]
    : [];

  return {
    status: 'available',
    sourceStatus: 'available',
    confidence: scoreRisks.length || envRisk.length ? 'medium' : 'low',
    dataQuality: quality('medium', 'available', 'available', 'minor'),
    evidence: [evidence('risk-score', 'Negative score factors', 'Negative factors from the score and environment layers.', scoreRisks.length + envRisk.length)],
    limitations: ['Risks are model-visible only; legal, physical, financial, and operating constraints still require review.'],
    manualVerificationNeeded: true,
    manualVerification: ['Check legal constraints, asset condition, capex, access, noise, and live competition manually.'],
    items: [...envRisk, ...scoreRisks],
  };
}

function buildRecommendation(
  input: LocationReportInput,
  demand: DemandSignals,
  pricing: PricingSignals,
  risks: RiskSignals,
  urbanDevelopment: UrbanDevelopmentSignals,
  analysis?: LocationAnalysis,
): DecisionRecommendation {
  const score = analysis?.locationScore?.location_score ?? analysis?.evergreenIndex ?? null;
  const missingStrategicData = urbanDevelopment.status !== 'available';
  const hasHighRisk = risks.items.some(r => r.severity === 'high');
  const decision: DecisionAction =
    missingStrategicData || score == null || pricing.status !== 'partial'
      ? 'manually_verify'
      : hasHighRisk || score < 45
        ? 'avoid'
        : input.goal === 'launch'
          ? 'launch'
          : input.goal === 'buy'
            ? 'buy'
            : 'rent';

  const checklist = [
    ...demand.manualVerification,
    ...pricing.manualVerification,
    ...risks.manualVerification,
    ...urbanDevelopment.manualVerification,
  ];

  return {
    status: decision === 'manually_verify' ? 'partial' : 'available',
    sourceStatus: decision === 'manually_verify' ? 'partial' : 'available',
    confidence: decision === 'manually_verify' ? 'low' : 'medium',
    dataQuality: quality(decision === 'manually_verify' ? 'low' : 'medium', decision === 'manually_verify' ? 'partial' : 'available', decision === 'manually_verify' ? 'partial' : 'available', missingStrategicData ? 'major' : 'minor'),
    evidence: [
      evidence('decision-score', 'Decision score basis', 'Overall score used as one input to the decision.', score ?? 'unavailable'),
      ...risks.evidence,
    ],
    limitations: [
      'This is a decision-support recommendation, not a guarantee of income, footfall, approval, or future development.',
      ...(missingStrategicData ? ['Future development data is not connected, so the decision must be manually verified.'] : []),
    ],
    manualVerificationNeeded: decision === 'manually_verify' || checklist.length > 0,
    manualVerification: [...new Set(checklist)],
    decision,
    rationale: decision === 'manually_verify'
      ? 'Core spatial signals exist, but one or more strategic layers are missing or partial. Manual verification is required before acting.'
      : `The current signal mix supports a ${decision} decision with manual validation of risks and economics.`,
    checklist: [...new Set(checklist)],
  };
}

function sectionFromBlock(id: string, title: string, summary: string, block: SignalBlockBase, items: string[] = []): LocationReportSection {
  return {
    id,
    title,
    summary,
    items,
    status: block.status,
    sourceStatus: block.sourceStatus,
    confidence: block.confidence,
    dataQuality: block.dataQuality,
    evidence: block.evidence,
    limitations: block.limitations,
    manualVerificationNeeded: block.manualVerificationNeeded,
    manualVerification: block.manualVerification,
  };
}

function buildUnifiedReport(input: LocationReportInput, context: LocationReportContext, level: ReportLevel): UnifiedLocationReport {
  const analysis = context.analysis;
  const demand = buildDemand(input, analysis);
  const competition = buildCompetition(analysis);
  const pricing = buildPricing(analysis);
  const seasonality = buildSeasonality(analysis);
  const magnets = buildMagnets(analysis, context.market);
  const transportInfrastructure = buildTransportInfrastructure(analysis);
  const urbanDevelopment = buildUrbanDevelopment(context.urbanDevelopment);
  const urbanDevelopmentForecastScore = computeUrbanDevelopmentForecastScore(context.urbanDevelopmentSignals ?? []);
  const environmentalTrafficRisk = buildEnvironmentalTrafficRisk(analysis);
  const heatMap = buildHeatMap(analysis);
  const audienceFit = buildAudienceFit(input, analysis);
  const risks = buildRisks(analysis);
  const recommendation = buildRecommendation(input, demand, pricing, risks, urbanDevelopment, analysis);

  const expressSections = [
    sectionFromBlock('summary', 'Score and summary', analysis?.conclusion ?? 'Location summary is unavailable until analysis is connected.', demand, [
      `Overall score: ${analysis?.locationScore?.location_score ?? analysis?.evergreenIndex ?? 'unavailable'}`,
    ]),
    sectionFromBlock('demand', 'Demand signals', `${demand.demandType} demand profile.`, demand, demand.guestDemandDrivers),
    sectionFromBlock('competition', 'Competition', `${competition.pressureLevel} visible competitive pressure.`, competition),
    sectionFromBlock('pricing', 'Approximate pricing corridor', pricing.roughMonthlyCorridor ? 'A rough pricing corridor is available.' : 'Pricing corridor is unavailable.', pricing),
    sectionFromBlock('magnets', 'Attraction magnets', `${magnets.tier1.length} Tier-1 and ${magnets.tier2.length} Tier-2 magnets detected.`, magnets),
    sectionFromBlock('risks', 'Key risks', `${risks.items.length} model-visible risks detected.`, risks, risks.items.map(r => r.description)),
    sectionFromBlock('recommendation', 'Decision recommendation', recommendation.rationale, recommendation, [recommendation.decision]),
  ];

  const fullOnlySections = [
    sectionFromBlock('audience_fit', 'Audience fit', `Primary audience: ${audienceFit.primaryAudience}.`, audienceFit),
    sectionFromBlock('seasonality', 'Seasonality', seasonality.seasonalityScore == null ? 'Seasonality is unavailable.' : `Seasonality score: ${seasonality.seasonalityScore}.`, seasonality, seasonality.notes),
    sectionFromBlock('transport_infrastructure', 'Transport and infrastructure', transportInfrastructure.spatialNotes[0] ?? 'Transport signals are available.', transportInfrastructure),
    sectionFromBlock('heat_map', 'Heat-map signals', heatMap.summary, heatMap),
    sectionFromBlock('urban_development', 'Urban development and construction signals', urbanDevelopment.limitations[0] ?? 'Urban development signals are available.', urbanDevelopment),
    sectionFromBlock('environmental_traffic_risk', 'Environmental and traffic-load risks', environmentalTrafficRisk.trafficLoadSignals[0] ?? 'Environmental risk signals are available.', environmentalTrafficRisk, environmentalTrafficRisk.trafficLoadSignals),
  ];

  return {
    version: 'unified-location-potential-report-v1',
    level,
    input: { ...input, level },
    createdAtIso: context.generatedAtIso ?? new Date().toISOString(),
    overallScore: analysis?.locationScore?.location_score ?? analysis?.evergreenIndex ?? null,
    currentLocationScore: analysis?.locationScore?.location_score ?? analysis?.evergreenIndex ?? null,
    scoreBreakdown: analysis?.locationScore?.breakdown ?? null,
    summary: analysis?.conclusion ?? 'Location potential report requires connected analysis data.',
    urbanDevelopmentForecastScore,
    signals: {
      demand,
      competition,
      pricing,
      seasonality,
      magnets,
      transportInfrastructure,
      urbanDevelopment,
      environmentalTrafficRisk,
      heatMap,
      audienceFit,
      risks,
      recommendation,
    },
    sections: level === 'express' ? expressSections : [...expressSections, ...fullOnlySections],
    manualVerificationChecklist: [...new Set(recommendation.checklist)],
  };
}

export function buildExpressLocationReport(input: LocationReportInput, context: LocationReportContext = {}): UnifiedLocationReport {
  return buildUnifiedReport(input, context, 'express');
}

export function buildFullLocationReport(input: LocationReportInput, context: LocationReportContext = {}): UnifiedLocationReport {
  return buildUnifiedReport(input, context, 'full');
}
