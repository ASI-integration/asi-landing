/**
 * Residential validation runner — control set baseline
 *
 * Runs buildResidentialAnalysis against 30 synthetic fixtures covering
 * all defined residential archetypes. Pure-function runner — no I/O, no
 * live API calls. Fixtures encode the exact parameter space that determines
 * model output.
 *
 * Usage:  npx tsx scripts/residential-validation-runner.ts
 * Output: scripts/residential-control-set-results.json
 *
 * To compare two passes:
 *   node -e "
 *     const a = require('./residential-control-set-results.json');
 *     const b = require('./residential-control-set-results-pass2.json');
 *     b.results.forEach((r,i) => {
 *       const prev = a.results[i];
 *       if (r.output.residentialStrategy !== prev.output.residentialStrategy)
 *         console.log(r.id, prev.output.residentialStrategy, '->', r.output.residentialStrategy);
 *     });
 *   "
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

import { buildResidentialAnalysis } from '../src/lib/location/residential-analysis';
import type {
  LocationAnalysis,
  NeighborhoodEnvironmentLayer,
  MagnetItem,
  ScoreBand,
  ResidentialAudienceType,
  ResidentialStrategy,
  OperationalSuitability,
  ResidentialAnalysisConfidence,
} from '../src/lib/location/types';

// ── Fixture type ─────────────────────────────────────────────────────────────

interface CaseFixture {
  id: string;
  label: string;
  archetype: string;
  // Core scoring inputs
  locationScore: number;
  demandScore: number;
  seasonalityScore: number;
  audienceFitScore: number;
  evergreenIndex: number;
  stability01: number;
  magnetCount: number;
  isFallbackMode: boolean;
  competitorPressureLevel: 'low' | 'medium' | 'high';
  // Environment
  environmentalFrictionScore: number;
  concernLevel: 'low' | 'moderate' | 'elevated' | 'high';
  envConfidence: 'low' | 'medium' | 'high';
  breakdown: NeighborhoodEnvironmentLayer['breakdown'];
  // Expected ideal outputs (not necessarily what model currently produces)
  expected: {
    audienceTypeTendency: 'premium' | 'mixed' | 'standard';
    strategyTendency: 'short_term' | 'selective_premium' | 'hybrid' | 'mid_term' | 'cautious';
    operationalSuitability: OperationalSuitability;
    confidenceTendency: ResidentialAnalysisConfidence;
  };
  notes: string;
}

// ── Mock builder ─────────────────────────────────────────────────────────────

function buildMock(f: CaseFixture): LocationAnalysis {
  const env: NeighborhoodEnvironmentLayer = {
    environmentalFrictionScore: f.environmentalFrictionScore,
    concernLevel: f.concernLevel,
    concernLabelEn: f.concernLevel,
    concernLabelRu: f.concernLevel,
    reasonsEn: [],
    reasonsRu: [],
    environmentNarrativeEn: '',
    environmentNarrativeRu: '',
    confidence: f.envConfidence,
    breakdown: f.breakdown,
  };

  const mockMagnet: MagnetItem = {
    categoryId: 'mock',
    categoryLabel: 'mock',
    icon: '•',
    name: 'mock',
    lat: 0,
    lon: 0,
    distance: 300,
    weight: 5,
    permanenceType: 'permanent',
    scopeLevel: 'local',
    strengthClass: 'medium',
    attractionScore: 5,
  };

  return {
    evergreenIndex: f.evergreenIndex,
    scoreBand: 'medium' as ScoreBand,
    locationScore: {
      location_score: f.locationScore,
      rating: 'viable',
      breakdown: {
        demand_score: f.demandScore,
        supply_score: 50,
        magnet_score: 50,
        seasonality_score: f.seasonalityScore,
        audience_fit_score: f.audienceFitScore,
        accessibility_score: 50,
      },
      estimated_monthly_income: { short_term: 0, mid_term: 0, hybrid: 0 },
      income_model: { base_adr_rub: 0, base_occupancy_pct: 0 },
      top_positive_factors: [],
      top_negative_factors: [],
      recommended_strategy: 'hybrid',
    },
    magnets: Array.from({ length: f.magnetCount }, () => ({ ...mockMagnet })),
    magnetCountByCategory: {},
    accessibilityStops: [],
    competitors: [],
    gravityExplanation: {
      dominantMagnets: [],
      strongestZoneLabel: '',
      competitorPressureLevel: f.competitorPressureLevel,
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
      stability01: f.stability01,
      concentration01: 0.5,
    },
    audienceAnalysis: {
      primaryAudience: 'BUSINESS',
      locationType: 'MIXED',
      audienceFitScore: f.audienceFitScore,
      primaryMagnets: [],
      fallbackMode: f.isFallbackMode,
      audienceSharePct: 50,
      businessClusterDetected: false,
      primaryDriverLabel: '',
      lockedMode: false,
      demandFlowLabel: '',
    },
    neighborhoodEnvironment: env,
    heatmapPoints: [],
    conclusion: '',
  };
}

// ── Gate evaluation ───────────────────────────────────────────────────────────

function strategyKey(s: ResidentialStrategy): string {
  if (s === 'selective_premium_short_term') return 'selective_premium';
  if (s === 'cautious_manual_only') return 'cautious';
  return s;
}

function audienceKey(a: ResidentialAudienceType): string {
  if (a === 'premium_comfort') return 'premium';
  if (a === 'mixed_use_adjacent') return 'mixed';
  return 'standard';
}

function evaluateGates(f: CaseFixture, output: ReturnType<typeof buildResidentialAnalysis>) {
  const audienceMatch = audienceKey(output.residentialAudienceType) === f.expected.audienceTypeTendency;
  const strategyMatch = strategyKey(output.residentialStrategy) === f.expected.strategyTendency;
  const opSuitMatch = output.operationalSuitability === f.expected.operationalSuitability;
  const confidenceMatch = output.confidence === f.expected.confidenceTendency;
  const allPass = audienceMatch && strategyMatch && opSuitMatch && confidenceMatch;
  return { audienceMatch, strategyMatch, opSuitMatch, confidenceMatch, allPass };
}

// ── Control set fixtures ──────────────────────────────────────────────────────

const CASES: CaseFixture[] = [
  {
    id: 'R01',
    label: 'Москва-Сити (Пресненская наб.) — strong urban core, business-led',
    archetype: 'strong urban core — business',
    locationScore: 82, demandScore: 85, seasonalityScore: 68, audienceFitScore: 72,
    evergreenIndex: 78, stability01: 0.62, magnetCount: 12, isFallbackMode: false,
    competitorPressureLevel: 'high',
    environmentalFrictionScore: 42, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.65, industrial01: 0.12, aviation01: 0.08, nightlife01: 0.35, transitCorridor01: 0.50, harshUrbanStack01: 0.48 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'high' },
    notes: 'Деловой центр elevated; short_term только при «ядре» (сумма score+спрос и пороги) — здесь hybrid корректно',
  },
  {
    id: 'R02',
    label: 'Остоженка / Золотая миля — quiet premium',
    archetype: 'quiet premium',
    locationScore: 74, demandScore: 69, seasonalityScore: 62, audienceFitScore: 58,
    evergreenIndex: 70, stability01: 0.68, magnetCount: 8, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 14, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.20, industrial01: 0.08, aviation01: 0.05, nightlife01: 0.12, transitCorridor01: 0.15, harshUrbanStack01: 0.18 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'selective_premium', operationalSuitability: 'full_auto', confidenceTendency: 'high' },
    notes: 'Эталон quiet premium. Любое отклонение от expected — критическая ошибка',
  },
  {
    id: 'R03',
    label: 'Люблино, промышленная зона — industrial harsh + strong demand',
    archetype: 'high-demand but harsh environment',
    locationScore: 58, demandScore: 75, seasonalityScore: 55, audienceFitScore: 45,
    evergreenIndex: 61, stability01: 0.52, magnetCount: 6, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 68, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.72, industrial01: 0.62, aviation01: 0.10, nightlife01: 0.42, transitCorridor01: 0.45, harshUrbanStack01: 0.72 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'cautious', operationalSuitability: 'manual', confidenceTendency: 'low' },
    notes: 'Высокий спрос + тяжёлая среда; cautious единственно правильная стратегия; cautious cap → score=2 → low',
  },
  {
    id: 'R04',
    label: 'СПб, Невский пр-т — tourist historic, active STR',
    archetype: 'tourist-heavy — active STR market',
    locationScore: 72, demandScore: 78, seasonalityScore: 85, audienceFitScore: 62,
    evergreenIndex: 72, stability01: 0.44, magnetCount: 9, isFallbackMode: false,
    competitorPressureLevel: 'high',
    environmentalFrictionScore: 38, concernLevel: 'moderate', envConfidence: 'high',
    breakdown: { majorRoads01: 0.38, industrial01: 0.08, aviation01: 0.06, nightlife01: 0.55, transitCorridor01: 0.30, harshUrbanStack01: 0.40 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'short_term', operationalSuitability: 'semi_auto', confidenceTendency: 'high' },
    notes: 'Туристический центр; short_term правильно; friction=38 точно на пороге full_auto',
  },
  {
    id: 'R05',
    label: 'Митино, жилой массив — family-friendly district',
    archetype: 'family-friendly district',
    locationScore: 55, demandScore: 58, seasonalityScore: 48, audienceFitScore: 42,
    evergreenIndex: 58, stability01: 0.55, magnetCount: 5, isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 16, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.22, industrial01: 0.06, aviation01: 0.04, nightlife01: 0.08, transitCorridor01: 0.10, harshUrbanStack01: 0.12 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'premium_comfort + hybrid: design tension допустима при locationScore=55 (ниже порога selective=56)',
  },
  {
    id: 'R06',
    label: 'Шоссе Энтузиастов — transport-heavy, noisy',
    archetype: 'transport-heavy but noisy',
    locationScore: 64, demandScore: 68, seasonalityScore: 52, audienceFitScore: 40,
    evergreenIndex: 63, stability01: 0.60, magnetCount: 7, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 52, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.78, industrial01: 0.15, aviation01: 0.12, nightlife01: 0.18, transitCorridor01: 0.70, harshUrbanStack01: 0.55 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'cautious', operationalSuitability: 'manual', confidenceTendency: 'low' },
    notes: 'elevated + score=64 < 68 → cautious; cautious cap → score=2 → low confidence',
  },
  {
    id: 'R07',
    label: 'Щепкина ул., медицинская зона — hospital adjacent',
    archetype: 'medical-adjacent — moderate demand',
    locationScore: 60, demandScore: 62, seasonalityScore: 44, audienceFitScore: 38,
    evergreenIndex: 58, stability01: 0.50, magnetCount: 4, isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 22, concernLevel: 'low', envConfidence: 'medium',
    breakdown: { majorRoads01: 0.35, industrial01: 0.05, aviation01: 0.04, nightlife01: 0.10, transitCorridor01: 0.15, harshUrbanStack01: 0.20 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'selective_premium', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Граничные значения selective: magnetCount=4, audienceFit=38; medium confidence ожидается',
  },
  {
    id: 'R08',
    label: 'Люберцы, спальный район — weak distant suburb',
    archetype: 'weak suburb',
    locationScore: 28, demandScore: 32, seasonalityScore: 35, audienceFitScore: 22,
    evergreenIndex: 28, stability01: 0.32, magnetCount: 2, isFallbackMode: true,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 12, concernLevel: 'low', envConfidence: 'medium',
    breakdown: { majorRoads01: 0.15, industrial01: 0.03, aviation01: 0.02, nightlife01: 0.05, transitCorridor01: 0.08, harshUrbanStack01: 0.08 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'mid_term', operationalSuitability: 'manual', confidenceTendency: 'low' },
    notes: 'MUST-PASS: fallback + слабые магниты → low confidence → manual обязательно',
  },
  {
    id: 'R09',
    label: 'Коптево — medium residential urban',
    archetype: 'medium residential urban',
    locationScore: 52, demandScore: 54, seasonalityScore: 50, audienceFitScore: 35,
    evergreenIndex: 50, stability01: 0.45, magnetCount: 5, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 30, concernLevel: 'moderate', envConfidence: 'medium',
    breakdown: { majorRoads01: 0.42, industrial01: 0.18, aviation01: 0.08, nightlife01: 0.22, transitCorridor01: 0.25, harshUrbanStack01: 0.35 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Стандартный средний городской профиль — тест стабильности модели',
  },
  {
    id: 'R10',
    label: 'Китай-город / Маросейка — nightlife urban contested',
    archetype: 'mixed-use contested — nightlife heavy',
    locationScore: 70, demandScore: 74, seasonalityScore: 65, audienceFitScore: 55,
    evergreenIndex: 70, stability01: 0.56, magnetCount: 8, isFallbackMode: false,
    competitorPressureLevel: 'high',
    environmentalFrictionScore: 48, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.35, industrial01: 0.12, aviation01: 0.06, nightlife01: 0.68, transitCorridor01: 0.40, harshUrbanStack01: 0.45 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Pass-3: elevated+hybrid без «чистого» ядра → medium confidence; nightlife=0.68 не даёт cautious',
  },
  {
    id: 'R11',
    label: 'Раменки — premium low-demand',
    archetype: 'premium but low-demand',
    locationScore: 65, demandScore: 42, seasonalityScore: 38, audienceFitScore: 48,
    evergreenIndex: 60, stability01: 0.62, magnetCount: 4, isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 10, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.18, industrial01: 0.04, aviation01: 0.03, nightlife01: 0.06, transitCorridor01: 0.08, harshUrbanStack01: 0.10 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'selective_premium', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Тихий premium, слабый спрос → selective правильно; medium confidence из-за малых магнитов',
  },
  {
    id: 'R12',
    label: 'Внуково — airport zone, aviation-heavy',
    archetype: 'airport zone',
    locationScore: 48, demandScore: 50, seasonalityScore: 55, audienceFitScore: 35,
    evergreenIndex: 48, stability01: 0.42, magnetCount: 3, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 62, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.45, industrial01: 0.12, aviation01: 0.88, nightlife01: 0.08, transitCorridor01: 0.35, harshUrbanStack01: 0.55 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'cautious', operationalSuitability: 'manual', confidenceTendency: 'low' },
    notes: 'Авиационная нагрузка + elevated + score=48 → cautious; cautious cap → low confidence',
  },
  {
    id: 'R13',
    label: '2-й Боткинский пр. — medical cluster, quiet',
    archetype: 'medical-adjacent — strong cluster, quiet',
    locationScore: 68, demandScore: 65, seasonalityScore: 42, audienceFitScore: 52,
    evergreenIndex: 65, stability01: 0.58, magnetCount: 7, isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 18, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.28, industrial01: 0.06, aviation01: 0.03, nightlife01: 0.08, transitCorridor01: 0.12, harshUrbanStack01: 0.16 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'selective_premium', operationalSuitability: 'full_auto', confidenceTendency: 'high' },
    notes: 'MUST-PASS: сильный медицинский кластер + тихая среда = selective + full_auto + high',
  },
  {
    id: 'R14',
    label: 'Тушино / Сходненская — Soviet block, transit ok',
    archetype: 'Soviet-era block — transit ok',
    locationScore: 48, demandScore: 56, seasonalityScore: 48, audienceFitScore: 32,
    evergreenIndex: 48, stability01: 0.50, magnetCount: 4, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 36, concernLevel: 'moderate', envConfidence: 'high',
    breakdown: { majorRoads01: 0.52, industrial01: 0.25, aviation01: 0.05, nightlife01: 0.18, transitCorridor01: 0.40, harshUrbanStack01: 0.42 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Советский панельный + транзит: moderate env не должен давать cautious',
  },
  {
    id: 'R15',
    label: 'СПб, Думская — tourist harsh, nightlife-heavy',
    archetype: 'tourist-heavy but harsh for living',
    locationScore: 75, demandScore: 80, seasonalityScore: 88, audienceFitScore: 65,
    evergreenIndex: 75, stability01: 0.45, magnetCount: 10, isFallbackMode: false,
    competitorPressureLevel: 'high',
    environmentalFrictionScore: 45, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.38, industrial01: 0.10, aviation01: 0.05, nightlife01: 0.72, transitCorridor01: 0.35, harshUrbanStack01: 0.48 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Pass-3: elevated+hybrid, сильная ночная нагрузка → medium confidence; hybrid (не short_term)',
  },
  {
    id: 'R16',
    label: 'Арбат, коммерческая граница — mixed-use contested',
    archetype: 'mixed-use contested — commercial edge',
    locationScore: 62, demandScore: 65, seasonalityScore: 55, audienceFitScore: 48,
    evergreenIndex: 60, stability01: 0.52, magnetCount: 6, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 28, concernLevel: 'moderate', envConfidence: 'high',
    breakdown: { majorRoads01: 0.55, industrial01: 0.22, aviation01: 0.06, nightlife01: 0.30, transitCorridor01: 0.35, harshUrbanStack01: 0.38 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Граница жилого и коммерческого; mixed_use_adjacent (score=62, friction=28); hybrid',
  },
  {
    id: 'R17',
    label: 'Преображенская пл. — industrial conversion, high gravity',
    archetype: 'industrial conversion — conflicting signals',
    locationScore: 70, demandScore: 73, seasonalityScore: 62, audienceFitScore: 52,
    evergreenIndex: 70, stability01: 0.58, magnetCount: 9, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 58, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.62, industrial01: 0.72, aviation01: 0.08, nightlife01: 0.22, transitCorridor01: 0.42, harshUrbanStack01: 0.68 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Pass-3: промка + elevated + hybrid → medium confidence (потолок); industrial=0.72 не даёт cautious',
  },
  {
    id: 'R18',
    label: 'Хамовники / Зубовский бул. — quiet premium, strong demand',
    archetype: 'quiet premium — strong demand',
    locationScore: 78, demandScore: 80, seasonalityScore: 72, audienceFitScore: 68,
    evergreenIndex: 78, stability01: 0.72, magnetCount: 11, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 20, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.30, industrial01: 0.08, aviation01: 0.05, nightlife01: 0.18, transitCorridor01: 0.18, harshUrbanStack01: 0.22 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'selective_premium', operationalSuitability: 'full_auto', confidenceTendency: 'high' },
    notes: 'MUST-PASS: strongest quiet premium. full_auto + high. selective берёт приоритет над short_term',
  },
  {
    id: 'R19',
    label: 'Краснодар, удалённый район — distant suburb, fallback',
    archetype: 'distant suburb — fallback mode',
    locationScore: 35, demandScore: 38, seasonalityScore: 60, audienceFitScore: 28,
    evergreenIndex: 35, stability01: 0.30, magnetCount: 1, isFallbackMode: true,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 10, concernLevel: 'low', envConfidence: 'medium',
    breakdown: { majorRoads01: 0.12, industrial01: 0.03, aviation01: 0.02, nightlife01: 0.05, transitCorridor01: 0.08, harshUrbanStack01: 0.06 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'mid_term', operationalSuitability: 'manual', confidenceTendency: 'low' },
    notes: 'MUST-PASS: 1 магнит + fallback → low confidence → manual обязательно',
  },
  {
    id: 'R20',
    label: 'Бирюлёво (stability=0.47) — borderline cliff case',
    archetype: 'edge case — stability just below premium_comfort threshold',
    locationScore: 58, demandScore: 60, seasonalityScore: 52, audienceFitScore: 42,
    evergreenIndex: 58, stability01: 0.47, magnetCount: 5, isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 16, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.32, industrial01: 0.12, aviation01: 0.08, nightlife01: 0.20, transitCorridor01: 0.15, harshUrbanStack01: 0.22 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'stability=0.47 < 0.48 порога → standard (не premium). Cliff-effect кейс для мониторинга',
  },
  {
    id: 'R21',
    label: 'Покровка — premium area, high-comp, weak demand',
    archetype: 'premium area — high competition, weak demand',
    locationScore: 55, demandScore: 42, seasonalityScore: 45, audienceFitScore: 35,
    evergreenIndex: 55, stability01: 0.52, magnetCount: 3, isFallbackMode: false,
    competitorPressureLevel: 'high',
    environmentalFrictionScore: 24, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.28, industrial01: 0.10, aviation01: 0.05, nightlife01: 0.15, transitCorridor01: 0.15, harshUrbanStack01: 0.20 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'mid_term', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'premium_comfort + mid_term: design tension допустима при demand=42 < 52',
  },
  {
    id: 'R22',
    label: 'Тверская — dense business cluster',
    archetype: 'strong urban core — dense business cluster',
    locationScore: 85, demandScore: 88, seasonalityScore: 75, audienceFitScore: 78,
    evergreenIndex: 85, stability01: 0.68, magnetCount: 15, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 35, concernLevel: 'moderate', envConfidence: 'high',
    breakdown: { majorRoads01: 0.45, industrial01: 0.15, aviation01: 0.08, nightlife01: 0.28, transitCorridor01: 0.45, harshUrbanStack01: 0.40 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'short_term', operationalSuitability: 'full_auto', confidenceTendency: 'high' },
    notes: 'MUST-PASS: сильный деловой кластер → short_term + full_auto + high; moderate env не блокирует',
  },
  {
    id: 'R23',
    label: 'Таганская — nightlife + major road stack',
    archetype: 'harsh urban — nightlife + road double burden',
    locationScore: 72, demandScore: 76, seasonalityScore: 68, audienceFitScore: 60,
    evergreenIndex: 72, stability01: 0.60, magnetCount: 10, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 62, concernLevel: 'high', envConfidence: 'high',
    breakdown: { majorRoads01: 0.72, industrial01: 0.35, aviation01: 0.15, nightlife01: 0.55, transitCorridor01: 0.50, harshUrbanStack01: 0.75 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'cautious', operationalSuitability: 'manual', confidenceTendency: 'low' },
    notes: 'MUST-PASS: nightlife=0.55 + majorRoad=0.72 → cautious; cautious cap → low confidence',
  },
  {
    id: 'R24',
    label: 'Щёлковское ш. — good transit, average residential',
    archetype: 'good transit — average residential',
    locationScore: 58, demandScore: 58, seasonalityScore: 52, audienceFitScore: 40,
    evergreenIndex: 58, stability01: 0.50, magnetCount: 5, isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 28, concernLevel: 'moderate', envConfidence: 'high',
    breakdown: { majorRoads01: 0.38, industrial01: 0.18, aviation01: 0.05, nightlife01: 0.20, transitCorridor01: 0.45, harshUrbanStack01: 0.32 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'hybrid', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'Стандартный транзитный профиль — тест стабильности baseline',
  },
  {
    id: 'R25',
    label: 'Охотный ряд — center crossover (KNOWN GAP)',
    archetype: 'high-demand harsh env — best score, elevated friction',
    locationScore: 88, demandScore: 90, seasonalityScore: 82, audienceFitScore: 82,
    evergreenIndex: 88, stability01: 0.70, magnetCount: 18, isFallbackMode: false,
    competitorPressureLevel: 'high',
    environmentalFrictionScore: 40, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.58, industrial01: 0.08, aviation01: 0.05, nightlife01: 0.45, transitCorridor01: 0.55, harshUrbanStack01: 0.48 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'short_term', operationalSuitability: 'semi_auto', confidenceTendency: 'high' },
    notes: 'Pass-2: elevated + сильный центр/спрос/сезонность → short_term при контроле nightlife/industrial/дорог',
  },
  {
    id: 'R26',
    label: 'Кунцево (stability=0.50) — selective boundary',
    archetype: 'edge case — selective_premium at exact stability threshold',
    locationScore: 58, demandScore: 58, seasonalityScore: 52, audienceFitScore: 38,
    evergreenIndex: 58, stability01: 0.50, magnetCount: 5, isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 25, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.32, industrial01: 0.12, aviation01: 0.06, nightlife01: 0.20, transitCorridor01: 0.15, harshUrbanStack01: 0.24 },
    expected: { audienceTypeTendency: 'premium', strategyTendency: 'selective_premium', operationalSuitability: 'semi_auto', confidenceTendency: 'medium' },
    notes: 'stability=0.50 ровно на пороге ≥0.50 selective; inclusive inequality тест',
  },
  {
    id: 'R27',
    label: 'Адлер / Сочи — resort seasonal (KNOWN GAP)',
    archetype: 'resort / seasonal — high seasonality, low stability',
    locationScore: 65, demandScore: 70, seasonalityScore: 92, audienceFitScore: 65,
    evergreenIndex: 65, stability01: 0.38, magnetCount: 6, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 18, concernLevel: 'low', envConfidence: 'high',
    breakdown: { majorRoads01: 0.20, industrial01: 0.08, aviation01: 0.06, nightlife01: 0.25, transitCorridor01: 0.15, harshUrbanStack01: 0.20 },
    expected: { audienceTypeTendency: 'standard', strategyTendency: 'short_term', operationalSuitability: 'semi_auto', confidenceTendency: 'high' },
    notes: 'Pass-2: очень высокая сезонность + тихая среда поднимает short_term при demand 68–71; ops остаётся semi_auto из-за низкой stability',
  },
  {
    id: 'R28',
    label: 'Лефортово — industrial conversion, mixed contested',
    archetype: 'industrial conversion — elevated, mixed-use',
    locationScore: 62, demandScore: 64, seasonalityScore: 58, audienceFitScore: 45,
    evergreenIndex: 62, stability01: 0.55, magnetCount: 6, isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 44, concernLevel: 'elevated', envConfidence: 'high',
    breakdown: { majorRoads01: 0.55, industrial01: 0.48, aviation01: 0.06, nightlife01: 0.22, transitCorridor01: 0.40, harshUrbanStack01: 0.52 },
    expected: { audienceTypeTendency: 'mixed', strategyTendency: 'cautious', operationalSuitability: 'manual', confidenceTendency: 'low' },
    notes: 'score=62 < 68 при elevated → cautious; cautious cap → low confidence',
  },
  {
    id: 'R29',
    label: 'Нижний Новгород, центр — classic STR ровно при demand=72',
    archetype: 'edge — inclusive classic STR demand floor',
    locationScore: 68,
    demandScore: 72,
    seasonalityScore: 75,
    audienceFitScore: 55,
    evergreenIndex: 65,
    stability01: 0.55,
    magnetCount: 7,
    isFallbackMode: false,
    competitorPressureLevel: 'medium',
    environmentalFrictionScore: 28,
    concernLevel: 'moderate',
    envConfidence: 'high',
    breakdown: {
      majorRoads01: 0.48,
      industrial01: 0.15,
      aviation01: 0.06,
      nightlife01: 0.26,
      transitCorridor01: 0.32,
      harshUrbanStack01: 0.36,
    },
    expected: {
      audienceTypeTendency: 'mixed',
      strategyTendency: 'short_term',
      operationalSuitability: 'full_auto',
      confidenceTendency: 'high',
    },
    notes: 'Pass-4: нет «дыры» 71/72/73 — classic STR включает 72; mixed_use + умеренная среда; full_auto при friction<38',
  },
  {
    id: 'R30',
    label: 'Условный «слабый курорт» — сезонность без структурной опоры',
    archetype: 'edge — seasonal lift guard (weak location + evergreen)',
    locationScore: 42,
    demandScore: 69,
    seasonalityScore: 94,
    audienceFitScore: 35,
    evergreenIndex: 40,
    stability01: 0.36,
    magnetCount: 4,
    isFallbackMode: false,
    competitorPressureLevel: 'low',
    environmentalFrictionScore: 18,
    concernLevel: 'low',
    envConfidence: 'high',
    breakdown: {
      majorRoads01: 0.22,
      industrial01: 0.06,
      aviation01: 0.04,
      nightlife01: 0.12,
      transitCorridor01: 0.12,
      harshUrbanStack01: 0.14,
    },
    expected: {
      audienceTypeTendency: 'standard',
      strategyTendency: 'hybrid',
      operationalSuitability: 'semi_auto',
      confidenceTendency: 'medium',
    },
    notes: 'Pass-4: узкий seasonal-lift не срабатывает при location<58 или evergreen<55 — остаётся hybrid',
  },
];

// ── Main runner ───────────────────────────────────────────────────────────────

function main() {
  console.log(`\nResidential validation runner — ${CASES.length} cases\n`);

  const results = CASES.map((f, idx) => {
    const mock = buildMock(f);
    const output = buildResidentialAnalysis(mock);
    const gates = evaluateGates(f, output);

    const statusIcon = gates.allPass ? '✓' : '✗';
    const fails = [
      !gates.audienceMatch && `audience(${audienceKey(output.residentialAudienceType)}≠${f.expected.audienceTypeTendency})`,
      !gates.strategyMatch && `strategy(${strategyKey(output.residentialStrategy)}≠${f.expected.strategyTendency})`,
      !gates.opSuitMatch && `opSuit(${output.operationalSuitability}≠${f.expected.operationalSuitability})`,
      !gates.confidenceMatch && `conf(${output.confidence}≠${f.expected.confidenceTendency})`,
    ].filter(Boolean);

    console.log(`  [${idx + 1}/${CASES.length}] ${statusIcon} ${f.id} — ${f.archetype}`);
    if (fails.length > 0) {
      console.log(`        FAIL: ${fails.join(', ')}`);
    }

    return {
      id: f.id,
      label: f.label,
      archetype: f.archetype,
      inputs: {
        locationScore: f.locationScore,
        demandScore: f.demandScore,
        seasonalityScore: f.seasonalityScore,
        audienceFitScore: f.audienceFitScore,
        evergreenIndex: f.evergreenIndex,
        stability01: f.stability01,
        magnetCount: f.magnetCount,
        isFallbackMode: f.isFallbackMode,
        competitorPressureLevel: f.competitorPressureLevel,
        environmentalFrictionScore: f.environmentalFrictionScore,
        concernLevel: f.concernLevel,
      },
      output: {
        residentialAudienceType: output.residentialAudienceType,
        residentialStrategy: output.residentialStrategy,
        operationalSuitability: output.operationalSuitability,
        confidence: output.confidence,
        confidenceReasons: output.confidenceReasons,
        premiumComfortSignals: output.premiumComfortSignals,
        strategyRationaleRu: output.strategyRationaleRu,
        operationalNoteRu: output.operationalNoteRu,
      },
      expected: f.expected,
      gateResults: gates,
      notes: f.notes,
    };
  });

  const passCount = results.filter(r => r.gateResults.allPass).length;
  const failCount = results.length - passCount;
  const knownGaps: string[] = [];
  const unexpectedFails = results.filter(r => !r.gateResults.allPass);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total: ${results.length} | Pass: ${passCount} | Fail: ${failCount}`);
  if (knownGaps.length > 0) {
    console.log(`Known gaps: ${knownGaps.filter(id => results.find(r => r.id === id && !r.gateResults.allPass)).length}`);
  }
  console.log(`Unexpected fails: ${unexpectedFails.length}`);
  if (unexpectedFails.length > 0) {
    console.log(`  → ${unexpectedFails.map(r => r.id).join(', ')}`);
  }
  console.log('');

  const output = {
    runAt: new Date().toISOString(),
    runnerVersion: 'baseline-v4-pass4-edge-hardening',
    totalCases: results.length,
    passCount,
    failCount,
    knownGapIds: knownGaps,
    unexpectedFailIds: unexpectedFails.map(r => r.id),
    results,
  };

  const outPath = join(__dirname, 'residential-control-set-results.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Saved → ${outPath}`);
}

main();
