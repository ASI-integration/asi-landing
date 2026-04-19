/**
 * Residential analysis layer — pass 1 + pass-2 strategy refinement (elevated-zone STR nuance).
 *
 * Builds on top of LocationAnalysis (commercial engine output) to produce a
 * residential-specific interpretation covering four concerns:
 *   1. Strategy modes  (Block 1)
 *   2. Audience type   (Block 2) — including premium_comfort
 *   3. Operational suitability (Block 3)
 *   4. Confidence      (Block 4)
 *
 * Does NOT modify commercial scoring; purely additive.
 */

import type {
  LocationAnalysis,
  ResidentialAudienceType,
  ResidentialStrategy,
  OperationalSuitability,
  ResidentialAnalysisConfidence,
  ResidentialAnalysisOutput,
  NeighborhoodEnvironmentLayer,
  NeighborhoodEnvironmentConcernLevel,
} from './types';

// ── Internal helpers ──────────────────────────────────────────────────────────

function frictionLevel(env: NeighborhoodEnvironmentLayer): 'low' | 'moderate' | 'elevated' | 'high' {
  return env.concernLevel;
}

function isElevatedOrHigh(level: NeighborhoodEnvironmentConcernLevel): boolean {
  return level === 'elevated' || level === 'high';
}

/** Only `elevated` — `high` stays a hard ceiling for STR (double-burden / harsh cases). */
function isElevatedOnly(level: NeighborhoodEnvironmentConcernLevel): boolean {
  return level === 'elevated';
}

/**
 * When concern is elevated (not high), STR can still be viable if business / centrality /
 * transport clearly dominate and residential "nightlife + heavy stack" burdens are not dominant.
 * This replaces the old blanket `!isElevatedOrHigh` veto on short_term.
 */
function elevatedUrbanCoreAllowsShortTerm(args: {
  level: NeighborhoodEnvironmentConcernLevel;
  locationScore: number;
  demandScore: number;
  seasonalityScore: number;
  audienceFitScore: number;
  bd: NeighborhoodEnvironmentLayer['breakdown'];
}): boolean {
  const { level, locationScore, demandScore, seasonalityScore, audienceFitScore, bd } = args;
  if (!isElevatedOnly(level)) return false;

  const sumLocDemand = locationScore + demandScore;
  // Strong urban / center crossover: both score and demand must clear a high bar together.
  if (sumLocDemand < 170) return false;
  if (demandScore < 87 || seasonalityScore < 76 || locationScore < 84) return false;
  if (audienceFitScore < 70) return false;

  // Burden stacking — keep STR off when industrial or "party strip" living load dominates.
  if (bd.industrial01 >= 0.52) return false;
  if (bd.nightlife01 >= 0.62) return false;
  // Heavy road + meaningful nightlife = neighbor / access friction typical of cautious cases.
  if (bd.majorRoads01 >= 0.62 && bd.nightlife01 >= 0.42) return false;
  // Transport / tolerance: need either strong transit spine or a contained harsh-urban stack.
  const transportStrong = bd.transitCorridor01 >= 0.42;
  const stackContained = bd.harshUrbanStack01 <= 0.52;
  if (!transportStrong && !stackContained) return false;

  return true;
}

/**
 * Resort / peak-season markets: exceptional seasonality can justify short_term when demand
 * sits just below the normal STR floor, but only in low-friction (non-elevated) contexts.
 */
function lowFrictionSeasonalShortTermEligible(args: {
  level: NeighborhoodEnvironmentConcernLevel;
  demandScore: number;
  seasonalityScore: number;
  environmentalFrictionScore: number;
}): boolean {
  const { level, demandScore, seasonalityScore, environmentalFrictionScore } = args;
  if (isElevatedOrHigh(level)) return false;
  if (environmentalFrictionScore >= 32) return false;
  if (seasonalityScore < 90) return false;
  // Narrow band: lifts only "almost there" demand, not weak suburbs.
  if (demandScore < 68 || demandScore >= 72) return false;
  return true;
}

type ResidentialShortTermRationaleKind = 'default' | 'elevated_core_override' | 'seasonal_demand_lift';

interface ResidentialStrategyRun {
  strategy: ResidentialStrategy;
  shortTermRationaleKind: ResidentialShortTermRationaleKind;
}

// ── BLOCK 2: Residential audience type ───────────────────────────────────────

/**
 * Classify the residential audience type based on livability signals.
 *
 * premium_comfort fires only when:
 * - Environment concern is low (friction < 25)
 * - No meaningful nightlife or industrial burden
 * - Roads load is below a moderate threshold
 * - Foot-traffic is stable (predictable flow)
 * - Location score is enough to show real demand presence
 *
 * mixed_use_adjacent: decent location score but moderate+ friction
 * standard_residential: everything else
 */
function computeResidentialAudienceType(
  env: NeighborhoodEnvironmentLayer,
  locationScore: number,
  stability01: number,
): { audienceType: ResidentialAudienceType; premiumComfortSignals: string[] } {
  const bd = env.breakdown;
  const level = frictionLevel(env);

  const nightlifeLow = bd.nightlife01 < 0.28;
  const industrialLow = bd.industrial01 < 0.20;
  const roadsLow = bd.majorRoads01 < 0.38;
  const aviationLow = bd.aviation01 < 0.30;
  const stackLow = bd.harshUrbanStack01 < 0.30;

  if (
    level === 'low' &&
    nightlifeLow &&
    industrialLow &&
    roadsLow &&
    aviationLow &&
    stackLow &&
    locationScore >= 48 &&
    stability01 >= 0.48
  ) {
    const signals: string[] = [];
    if (env.environmentalFrictionScore < 15) signals.push('Минимальная общая нагрузка среды');
    if (bd.nightlife01 < 0.15) signals.push('Тихий ночной профиль');
    if (bd.industrial01 < 0.10) signals.push('Нет промышленных зон поблизости');
    if (bd.majorRoads01 < 0.25) signals.push('Спокойная транспортная среда');
    if (stability01 >= 0.65) signals.push('Высокая стабильность потока');
    if (bd.aviation01 < 0.10) signals.push('Нет авиационной нагрузки');
    return { audienceType: 'premium_comfort', premiumComfortSignals: signals };
  }

  if (locationScore >= 62 && env.environmentalFrictionScore >= 26) {
    return { audienceType: 'mixed_use_adjacent', premiumComfortSignals: [] };
  }

  return { audienceType: 'standard_residential', premiumComfortSignals: [] };
}

// ── BLOCK 1: Residential strategy ────────────────────────────────────────────

/**
 * Residential-aware strategy selection.
 *
 * cautious_manual_only: noisy / risky locations that should not be auto-priced.
 *   Triggered by: high friction + weak score, nightlife+industrial stack, or
 *   high competition with weak demand.
 *
 * selective_premium_short_term: quiet locations with enough demand and stability.
 *   Requires: low friction, decent score, no fallback, stable flow.
 *
 * short_term: strong demand + seasonality + not excessively noisy.
 *
 * hybrid: moderate demand.
 *
 * mid_term: weak demand.
 */
function computeResidentialStrategy(args: {
  locationScore: number;
  demandScore: number;
  seasonalityScore: number;
  audienceFitScore: number;
  env: NeighborhoodEnvironmentLayer;
  competitorPressureLevel: 'low' | 'medium' | 'high';
  stability01: number;
  isFallbackMode: boolean;
  audienceType: ResidentialAudienceType;
}): ResidentialStrategyRun {
  const { locationScore, demandScore, seasonalityScore, audienceFitScore, env, competitorPressureLevel, stability01, isFallbackMode, audienceType } = args;
  const level = frictionLevel(env);
  const bd = env.breakdown;

  const nightlifeBurden = bd.nightlife01 > 0.50;
  const industrialBurden = bd.industrial01 > 0.50;
  const majorRoadBurden = bd.majorRoads01 > 0.60;

  const finish = (strategy: ResidentialStrategy, shortTermRationaleKind: ResidentialShortTermRationaleKind = 'default'): ResidentialStrategyRun => ({
    strategy,
    shortTermRationaleKind,
  });

  // cautious_manual_only: location is too risky / noisy for auto-operation
  if (isElevatedOrHigh(level) && locationScore < 68) return finish('cautious_manual_only');
  if (nightlifeBurden && industrialBurden) return finish('cautious_manual_only');
  if (nightlifeBurden && majorRoadBurden) return finish('cautious_manual_only');
  if (competitorPressureLevel === 'high' && demandScore < 45 && level !== 'low') return finish('cautious_manual_only');

  // selective_premium_short_term: quiet premium — comfort-first audience, low friction, stable
  if (
    audienceType === 'premium_comfort' &&
    env.environmentalFrictionScore < 28 &&
    locationScore >= 56 &&
    audienceFitScore >= 36 &&
    stability01 >= 0.50 &&
    !isFallbackMode
  ) {
    return finish('selective_premium_short_term');
  }

  // short_term: strong demand + seasonality; elevated zones use selective eligibility, not a blanket veto
  const classicShortTerm =
    demandScore > 72 && seasonalityScore > 60 && !isElevatedOrHigh(level);
  const elevatedCoreShortTerm =
    demandScore > 72 &&
    seasonalityScore > 60 &&
    elevatedUrbanCoreAllowsShortTerm({
      level,
      locationScore,
      demandScore,
      seasonalityScore,
      audienceFitScore,
      bd,
    });
  const seasonalLiftShortTerm =
    lowFrictionSeasonalShortTermEligible({
      level,
      demandScore,
      seasonalityScore,
      environmentalFrictionScore: env.environmentalFrictionScore,
    }) && seasonalityScore > 60;

  if (classicShortTerm) return finish('short_term', 'default');
  if (elevatedCoreShortTerm) return finish('short_term', 'elevated_core_override');
  if (seasonalLiftShortTerm) return finish('short_term', 'seasonal_demand_lift');

  // hybrid: decent demand
  if (demandScore > 52) return finish('hybrid');

  return finish('mid_term');
}

// ── BLOCK 4: Confidence ───────────────────────────────────────────────────────

/**
 * Honest confidence based on signal strength and data quality.
 * Not a marketing rating — degrades with fallback mode, sparse data,
 * conflicting signals, and high-friction + weak-demand combos.
 */
function computeResidentialConfidence(args: {
  magnetCount: number;
  audienceFitScore: number;
  evergreenIndex: number;
  isFallbackMode: boolean;
  env: NeighborhoodEnvironmentLayer;
  demandScore: number;
  stability01: number;
  strategy: ResidentialStrategy;
}): { confidence: ResidentialAnalysisConfidence; reasons: string[] } {
  const { magnetCount, audienceFitScore, evergreenIndex, isFallbackMode, env, demandScore, stability01, strategy } = args;
  const level = frictionLevel(env);
  const reasons: string[] = [];

  let score = 2; // start at medium baseline

  // Signal strength
  if (magnetCount >= 7) score += 2;
  else if (magnetCount >= 4) score += 1;
  else if (magnetCount <= 2) {
    score -= 1;
    reasons.push('Мало магнитов спроса — оценка ориентировочная');
  }

  if (audienceFitScore >= 55) score += 2;
  else if (audienceFitScore >= 32) score += 1;

  if (evergreenIndex >= 65) score += 1;
  if (stability01 >= 0.65) score += 1;

  // Fallback mode: no viable primary magnets detected
  if (isFallbackMode) {
    score -= 2;
    reasons.push('Аудиторный режим: резерв — целевых магнитов не найдено');
  }

  // Conflicting signals: strong gravity but high friction
  const conflictingSignals = evergreenIndex >= 62 && isElevatedOrHigh(level) && demandScore < 62;
  if (conflictingSignals) {
    score -= 1;
    reasons.push('Конфликт сигналов: сильная гравитация, но высокая нагрузка среды');
  }

  // High friction + weak demand — unreliable residential picture
  if (isElevatedOrHigh(level) && demandScore < 50) {
    score -= 2;
    reasons.push('Высокая нагрузка среды при слабом спросе — прогноз ненадёжен');
  } else if (isElevatedOrHigh(level)) {
    score -= 1;
    reasons.push('Повышенная нагрузка среды снижает уверенность');
  }

  // Sparse neighborhood data
  if (env.confidence === 'low') {
    score -= 1;
    reasons.push('Разреженные данные карты для среды — вывод ориентировочный');
  } else if (env.confidence === 'medium' && score > 3) {
    score -= 0; // no extra penalty at medium
  }

  // Strategy itself reflects risk
  if (strategy === 'cautious_manual_only') {
    if (score > 2) score = 2; // cap at medium when strategy is cautious
    reasons.push('Стратегия cautious_manual_only ограничивает уверенность');
  }

  const confidence: ResidentialAnalysisConfidence =
    score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';

  return { confidence, reasons };
}

// ── BLOCK 3: Operational suitability ─────────────────────────────────────────

/**
 * How safely can this location be operated in automated / semi-automated mode.
 *
 * full_auto: clear strong signals, low friction, high confidence, no high competition.
 * manual: cautious strategy, low confidence, or high-friction + weak location.
 * semi_auto: everything in between.
 */
function computeOperationalSuitability(args: {
  strategy: ResidentialStrategy;
  confidence: ResidentialAnalysisConfidence;
  env: NeighborhoodEnvironmentLayer;
  locationScore: number;
  competitorPressureLevel: 'low' | 'medium' | 'high';
  stability01: number;
}): OperationalSuitability {
  const { strategy, confidence, env, locationScore, competitorPressureLevel, stability01 } = args;
  const level = frictionLevel(env);

  // manual: risky or unreliable conditions
  if (strategy === 'cautious_manual_only') return 'manual';
  if (confidence === 'low') return 'manual';
  if (isElevatedOrHigh(level) && locationScore < 62) return 'manual';

  // Volatile pedestrian / resort flow: STR can fit, but pricing and ops need human oversight
  if (strategy === 'short_term' && stability01 < 0.42) return 'semi_auto';

  // full_auto: clean strong signals, low friction, high confidence
  if (
    confidence === 'high' &&
    (strategy === 'short_term' || strategy === 'selective_premium_short_term') &&
    env.environmentalFrictionScore < 38 &&
    competitorPressureLevel !== 'high'
  ) {
    return 'full_auto';
  }

  return 'semi_auto';
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

function buildOperationalNoteRu(
  suitability: OperationalSuitability,
  strategy: ResidentialStrategy,
): string {
  if (suitability === 'manual') {
    if (strategy === 'cautious_manual_only') {
      return 'Ручное управление ценообразованием и заселениями — авто-режим не рекомендуется.';
    }
    return 'Требует ручной проверки перед настройкой автоматики — данных недостаточно для надёжного авто-режима.';
  }
  if (suitability === 'full_auto') {
    return 'Сигналы чистые и стабильные — локация подходит для полного авто-режима.';
  }
  return 'Рекомендуется полуавтоматический режим: автоматика с регулярным ручным контролем.';
}

function buildStrategyRationaleRu(
  strategy: ResidentialStrategy,
  audienceType: ResidentialAudienceType,
  env: NeighborhoodEnvironmentLayer,
  locationScore: number,
  shortTermRationaleKind: ResidentialShortTermRationaleKind,
): string {
  switch (strategy) {
    case 'selective_premium_short_term':
      return `Тихая среда (нагрузка ${env.environmentalFrictionScore}/100) + достаточный спрос: ставка на quality-first гостей, избирательная посуточная аренда.`;
    case 'short_term':
      if (shortTermRationaleKind === 'elevated_core_override') {
        return (
          `Посуточная модель: сильный спрос и сезонность перевешивают повышенную нагрузку среды (${env.concernLevel}) ` +
          `при сильном транспортном каркасе и без промышленного / «ночного» доминирования — STR уместен с дисциплиной заселений и уважением к соседям.`
        );
      }
      if (shortTermRationaleKind === 'seasonal_demand_lift') {
        return `Посуточка опирается на очень высокую сезонность при спокойной среде и спросе чуть ниже обычного STR-порога — типичный курортный / пиковый профиль.`;
      }
      return `Высокий стабильный спрос вытягивает посуточку: риски среды умеренные, нагрузка приемлема для STR.`;
    case 'cautious_manual_only':
      return `Нагрузка среды (${env.concernLevel}) + ограниченный потенциал (score ${locationScore}) — авто-прайсинг ненадёжен, нужен ручной мониторинг.`;
    case 'hybrid':
      return `Умеренный спрос без явного premium-профиля: гибрид посуточно / среднесрок даёт лучший баланс.`;
    case 'mid_term':
      return `Слабые сигналы краткосрочного спроса: среднесрочная аренда снижает операционные риски.`;
  }
}

// ── Top-level builder ─────────────────────────────────────────────────────────

/**
 * Build the full residential analysis layer from a computed LocationAnalysis.
 * Called after the commercial engine completes; adds no I/O.
 */
export function buildResidentialAnalysis(analysis: LocationAnalysis): ResidentialAnalysisOutput {
  const score = analysis.locationScore;
  const env = analysis.neighborhoodEnvironment;

  const locationScore = score?.location_score ?? analysis.evergreenIndex;
  const demandScore = score?.breakdown.demand_score ?? analysis.evergreenIndex;
  const seasonalityScore = score?.breakdown.seasonality_score ?? 50;
  const audienceFitScore = score?.breakdown.audience_fit_score ?? 0;
  const stability01 = analysis.footTraffic?.stability01 ?? 0.3;
  const magnetCount = analysis.magnets?.length ?? 0;
  const isFallbackMode = analysis.audienceAnalysis?.fallbackMode ?? false;
  const competitorPressureLevel = analysis.gravityExplanation?.competitorPressureLevel ?? 'low';

  // Block 2: audience type
  const { audienceType, premiumComfortSignals } = computeResidentialAudienceType(
    env,
    locationScore,
    stability01,
  );

  // Block 1: strategy
  const { strategy: residentialStrategy, shortTermRationaleKind } = computeResidentialStrategy({
    locationScore,
    demandScore,
    seasonalityScore,
    audienceFitScore,
    env,
    competitorPressureLevel,
    stability01,
    isFallbackMode,
    audienceType,
  });

  // Block 4: confidence
  const { confidence, reasons: confidenceReasons } = computeResidentialConfidence({
    magnetCount,
    audienceFitScore,
    evergreenIndex: analysis.evergreenIndex,
    isFallbackMode,
    env,
    demandScore,
    stability01,
    strategy: residentialStrategy,
  });

  // Block 3: operational suitability
  const operationalSuitability = computeOperationalSuitability({
    strategy: residentialStrategy,
    confidence,
    env,
    locationScore,
    competitorPressureLevel,
    stability01,
  });

  const operationalNoteRu = buildOperationalNoteRu(operationalSuitability, residentialStrategy);
  const strategyRationaleRu = buildStrategyRationaleRu(
    residentialStrategy,
    audienceType,
    env,
    locationScore,
    shortTermRationaleKind,
  );

  return {
    residentialAudienceType: audienceType,
    residentialStrategy,
    operationalSuitability,
    confidence,
    confidenceReasons,
    premiumComfortSignals,
    operationalNoteRu,
    strategyRationaleRu,
  };
}
