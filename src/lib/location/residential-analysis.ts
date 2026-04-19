/**
 * Residential analysis layer — pass 1–3 (strategy + confidence/rationale discipline).
 *
 * Builds on top of LocationAnalysis (commercial engine output) to produce a
 * residential-specific interpretation covering four concerns:
 *   1. Strategy modes  (Block 1)
 *   2. Audience type   (Block 2) — including premium_comfort
 *   3. Operational suitability (Block 3)
 *   4. Confidence      (Block 4) — pass-3: clarity, burden stack, cross-score consistency, ambiguity
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

// ── BLOCK 4: Confidence (pass-3 semantic model) ───────────────────────────────

/**
 * Elevated urban core with clean burden profile: hybrid here is a deliberate
 * trade-off (center gravity vs env), not an ambiguous suburb — allows `high`
 * confidence despite hybrid + elevated.
 */
function hybridElevatedPrimeCoreException(args: {
  level: ReturnType<typeof frictionLevel>;
  locationScore: number;
  demandScore: number;
  magnetCount: number;
  bd: NeighborhoodEnvironmentLayer['breakdown'];
}): boolean {
  const { level, locationScore, demandScore, magnetCount, bd } = args;
  if (level !== 'elevated') return false;
  if (locationScore < 78 || demandScore < 80 || magnetCount < 10) return false;
  if (bd.industrial01 >= 0.2) return false;
  if (bd.nightlife01 > 0.48) return false;
  if (bd.harshUrbanStack01 > 0.52) return false;
  if (bd.majorRoads01 > 0.68) return false;
  return true;
}

/** Count strong environment burdens (partial overlap with strategy guards). */
function countResidentialBurdenAxes(bd: NeighborhoodEnvironmentLayer['breakdown']): number {
  let n = 0;
  if (bd.industrial01 >= 0.45) n += 1;
  if (bd.nightlife01 >= 0.52) n += 1;
  if (bd.majorRoads01 >= 0.6) n += 1;
  if (bd.aviation01 >= 0.65) n += 1;
  if (bd.harshUrbanStack01 >= 0.55) n += 1;
  return n;
}

/**
 * Confidence reflects (not marketing):
 * - clarity of demand / audience signal (magnets, fit, evergreen, stability)
 * - operating-condition stability (foot-traffic stability, friction level)
 * - burden stacking and contradiction between scores and environment
 * - cross-consistency of location vs demand vs seasonality
 * - map / env data quality
 *
 * `high` = aligned signals and stable operating read; `low` = sparse, fallback,
 * or unreliable stack; `medium` = usable but should be validated — including
 * many hybrid+elevated cases where STR is not the headline win.
 */
function computeResidentialConfidence(args: {
  magnetCount: number;
  audienceFitScore: number;
  evergreenIndex: number;
  isFallbackMode: boolean;
  env: NeighborhoodEnvironmentLayer;
  demandScore: number;
  seasonalityScore: number;
  locationScore: number;
  stability01: number;
  strategy: ResidentialStrategy;
}): { confidence: ResidentialAnalysisConfidence; reasons: string[] } {
  const {
    magnetCount,
    audienceFitScore,
    evergreenIndex,
    isFallbackMode,
    env,
    demandScore,
    seasonalityScore,
    locationScore,
    stability01,
    strategy,
  } = args;
  const level = frictionLevel(env);
  const bd = env.breakdown;
  const reasons: string[] = [];

  let score = 2;

  // ── Signal clarity (demand + audience alignment) ────────────────────────────
  if (magnetCount >= 7) score += 2;
  else if (magnetCount >= 4) score += 1;
  else if (magnetCount <= 2) {
    score -= 1;
    reasons.push('Мало магнитов спроса — ядро вывода ориентировочное');
  }

  if (magnetCount <= 1 && !isFallbackMode) {
    score -= 1;
    reasons.push('Почти одиночный магнит — слабая опора для аудиторного профиля');
  }

  if (audienceFitScore >= 55) score += 2;
  else if (audienceFitScore >= 32) score += 1;

  if (evergreenIndex >= 65) score += 1;

  if (stability01 >= 0.65) {
    score += 1;
  } else if (stability01 < 0.38 && (strategy === 'short_term' || strategy === 'selective_premium_short_term')) {
    score -= 1;
    reasons.push('Нестабильный пешеходный профиль — краткосрочный сценарий менее предсказуем');
  }

  if (isFallbackMode) {
    score -= 2;
    reasons.push('Режим резерва аудитории — целевые магниты не выделены, вывод хрупкий');
  }

  // ── Cross-consistency (location / demand / seasonality) ───────────────────
  const locDem = Math.abs(locationScore - demandScore);
  const locSea = Math.abs(locationScore - seasonalityScore);
  const demSea = Math.abs(demandScore - seasonalityScore);
  const spreadMax = Math.max(locDem, locSea, demSea);
  if (spreadMax >= 28 && Math.min(locationScore, demandScore, seasonalityScore) < 52) {
    score -= 1;
    reasons.push('Сильный разброс локация/спрос/сезонность при средних значениях — сигнал неоднороден');
  }

  // ── Conflicting signals: gravity vs livability load ─────────────────────────
  const conflictingSignals = evergreenIndex >= 62 && isElevatedOrHigh(level) && demandScore < 62;
  if (conflictingSignals) {
    score -= 1;
    reasons.push('Конфликт: сильная гравитация при умеренном спросе на фоне тяжёлой среды');
  }

  const burdenAxes = countResidentialBurdenAxes(bd);
  if (burdenAxes >= 3) {
    score -= 2;
    reasons.push('Несколько сильных осей нагрузки среды одновременно — риск стекается');
  } else if (burdenAxes === 2) {
    score -= 1;
    reasons.push('Двойная нагрузка среды (дорога/ночная жизнь/промка и т.п.) — осторожнее в выводах');
  }

  // Friction level vs demand
  if (isElevatedOrHigh(level) && demandScore < 50) {
    score -= 2;
    reasons.push('Тяжёлая среда при слабом спросе — жилой прогноз ненадёжен');
  } else if (isElevatedOrHigh(level)) {
    score -= 1;
    reasons.push('Повышенная или высокая нагрузка среды снижает уверенность в комфорт-сценарии');
  }

  if (env.confidence === 'low') {
    score -= 1;
    reasons.push('Низкая достоверность слоя среды по карте — модель среды может недоучитывать факторы');
  }

  if (strategy === 'cautious_manual_only') {
    if (score > 2) score = 2;
    reasons.push('Стратегия cautious_manual_only: уверенность в авто-режиме низкая по определению');
  }

  let confidence: ResidentialAnalysisConfidence = score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';

  // Hybrid in elevated/high friction without prime-core exception: medium at most
  // (avoids «фальшивая уверенность» там, где STR не выиграл, а среда спорная).
  if (
    strategy === 'hybrid' &&
    isElevatedOrHigh(level) &&
    !hybridElevatedPrimeCoreException({ level, locationScore, demandScore, magnetCount, bd })
  ) {
    if (confidence === 'high') {
      confidence = 'medium';
      reasons.push('Гибрид на фоне elevated/high: сильный спрос не отменяет спорную среду — без максимальной уверенности');
    }
  }

  // Industrial / harsh stack in non-cautious strategies: never `high` without prime exception path above
  if (
    strategy !== 'cautious_manual_only' &&
    (bd.industrial01 >= 0.52 || (bd.harshUrbanStack01 >= 0.62 && bd.industrial01 >= 0.35)) &&
    !hybridElevatedPrimeCoreException({ level, locationScore, demandScore, magnetCount, bd })
  ) {
    if (confidence === 'high') {
      confidence = 'medium';
      reasons.push('Промышленный или жёсткий городской стек ограничивает верхнюю уверенность');
    }
  }

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

function describeAggressiveBlockerRu(args: {
  strategy: ResidentialStrategy;
  env: NeighborhoodEnvironmentLayer;
  locationScore: number;
  demandScore: number;
  seasonalityScore: number;
  audienceType: ResidentialAudienceType;
  isFallbackMode: boolean;
  magnetCount: number;
}): string | null {
  const { strategy, env, locationScore, demandScore, seasonalityScore, audienceType, isFallbackMode, magnetCount } = args;
  const level = frictionLevel(env);
  const bd = env.breakdown;

  if (strategy === 'cautious_manual_only') {
    if (isElevatedOrHigh(level) && locationScore < 68) {
      return `Более агрессивные режимы отсечены: при ${env.concernLevel} среде итоговый score локации ${locationScore} ниже порога устойчивого STR.`;
    }
    if (bd.nightlife01 > 0.5 && bd.industrial01 > 0.5) {
      return `Посуточка и гибрид отсекаются: одновременно сильные ночная и промышленная нагрузка — жилой комфорт и соседи в приоритете.`;
    }
    if (bd.nightlife01 > 0.5 && bd.majorRoads01 > 0.6) {
      return `STR и гибрид с высокой интенсивностью отсекаются: ночная активность + магистральная нагрузка дают типичный «осторожный» профиль.`;
    }
    return `Более агрессивные стратегии отсекаются правилами риска среды и спроса для этой точки.`;
  }

  if (strategy === 'selective_premium_short_term') {
    if (demandScore > 72 && seasonalityScore > 60 && level !== 'high') {
      const aud =
        audienceType === 'premium_comfort'
          ? 'тихий premium'
          : audienceType === 'mixed_use_adjacent'
            ? 'смешанная жилая среда'
            : 'стандартный жилой контур';
      return `Классическая посуточка не выбрана: при профиле «${aud}» и не максимальной нагрузке среды выгоднее избирательный STR, чем массовый поток.`;
    }
    return null;
  }

  if (strategy === 'hybrid' || strategy === 'mid_term') {
    if (demandScore > 72 && seasonalityScore > 60 && (isElevatedOrHigh(level) || env.environmentalFrictionScore >= 38)) {
      return `Чистая посуточка не прошла: сочетание нагрузки среды (${env.concernLevel}, индекс ${env.environmentalFrictionScore}/100) и порогов спроса/сезонности оставляет гибрид или средний срок как более устойчивый режим.`;
    }
  }

  if (strategy === 'mid_term') {
    if (demandScore <= 52 || isFallbackMode || magnetCount <= 2) {
      return `STR и гибрид не выиграли: спрос ${demandScore}${isFallbackMode ? ', режим резерва аудитории' : ''}${magnetCount <= 2 ? ', мало магнитов' : ''} — краткосрочный сценарий слабый.`;
    }
  }

  if (strategy === 'hybrid' && audienceType === 'premium_comfort' && locationScore < 56) {
    return `Selective premium не включён: при тихом профиле score локации ${locationScore} не дотягивает до порога избирательной посуточки — остаётся гибрид.`;
  }

  return null;
}

function buildStrategyRationaleRu(args: {
  strategy: ResidentialStrategy;
  audienceType: ResidentialAudienceType;
  env: NeighborhoodEnvironmentLayer;
  locationScore: number;
  demandScore: number;
  seasonalityScore: number;
  audienceFitScore: number;
  magnetCount: number;
  isFallbackMode: boolean;
  competitorPressureLevel: 'low' | 'medium' | 'high';
  shortTermRationaleKind: ResidentialShortTermRationaleKind;
  confidence: ResidentialAnalysisConfidence;
  stability01: number;
}): string {
  const {
    strategy,
    audienceType,
    env,
    locationScore,
    demandScore,
    seasonalityScore,
    audienceFitScore,
    magnetCount,
    isFallbackMode,
    competitorPressureLevel,
    shortTermRationaleKind,
    confidence,
    stability01,
  } = args;
  const bd = env.breakdown;
  const audLabel =
    audienceType === 'premium_comfort'
      ? 'тихий premium-комфорт'
      : audienceType === 'mixed_use_adjacent'
        ? 'смешанная среда у коммерции'
        : 'типичный жилой контур';

  const strengthBits: string[] = [];
  if (demandScore >= 75) strengthBits.push(`спрос ${demandScore}`);
  if (seasonalityScore >= 78) strengthBits.push(`сезонность ${seasonalityScore}`);
  if (locationScore >= 72) strengthBits.push(`локация ${locationScore}`);
  if (magnetCount >= 8) strengthBits.push(`${magnetCount} магнитов`);
  if (audienceFitScore >= 60) strengthBits.push(`аудиторное попадание ${audienceFitScore}`);
  const strength = strengthBits.length > 0 ? strengthBits.slice(0, 3).join(', ') : `базовые score (локация ${locationScore}, спрос ${demandScore})`;

  const confPhrase =
    confidence === 'high'
      ? 'Уверенность высокая: сигналы согласованы.'
      : confidence === 'medium'
        ? 'Уверенность средняя: вывод рабочий, но есть зоны неопределённости.'
        : 'Уверенность низкая: опирайтесь на ручную проверку и локальные факты.';

  const blocker = describeAggressiveBlockerRu({
    strategy,
    env,
    locationScore,
    demandScore,
    seasonalityScore,
    audienceType,
    isFallbackMode,
    magnetCount,
  });

  switch (strategy) {
    case 'selective_premium_short_term': {
      const core = `Выбран избирательный STR: ${audLabel}, нагрузка среды ${env.environmentalFrictionScore}/100 (${env.concernLevel}), стабильность потока ${(stability01 * 100).toFixed(0)}%. Опора на силу: ${strength}.`;
      const tail = blocker ? ` ${blocker}` : '';
      return `${core}${tail} ${confPhrase}`;
    }
    case 'short_term': {
      let core: string;
      if (shortTermRationaleKind === 'elevated_core_override') {
        core = `Посуточка в зоне ${env.concernLevel}: спрос ${demandScore} и сезонность ${seasonalityScore} перевешивают нагрузку при сильном транспорте (коридор ${(bd.transitCorridor01 * 100).toFixed(0)}%) и без доминирования промки/ночной полосы.`;
      } else if (shortTermRationaleKind === 'seasonal_demand_lift') {
        core = `Посуточка через сезонный лифт: сезонность ${seasonalityScore} очень высокая при спокойной среде и спросе ${demandScore} около STR-порога — курортно-пиковый сценарий.`;
      } else {
        core = `Посуточка: спрос ${demandScore} и сезонность ${seasonalityScore} на фоне умеренной среды (${env.concernLevel}, ${env.environmentalFrictionScore}/100).`;
      }
      const comp =
        competitorPressureLevel === 'high'
          ? ` Конкуренция высокая (${competitorPressureLevel}) — держите дисциплину цены и заселений.`
          : '';
      return `${core} Ключевая опора: ${strength}.${comp}${blocker ? ` ${blocker}` : ''} ${confPhrase}`;
    }
    case 'cautious_manual_only': {
      const core = `Ручной осторожный режим: среда ${env.concernLevel}, трение ${env.environmentalFrictionScore}/100; локация ${locationScore}, спрос ${demandScore}.`;
      const mid = blocker ? ` ${blocker}` : '';
      return `${core}${mid} ${confPhrase}`;
    }
    case 'hybrid': {
      const core = `Гибрид посуточно/средний срок: ${audLabel}; спрос ${demandScore} без устойчивого «чистого» STR-окна при текущих порогах среды (${env.concernLevel}).`;
      return `${core} Опора: ${strength}.${blocker ? ` ${blocker}` : ''} ${confPhrase}`;
    }
    case 'mid_term': {
      const core = `Среднесрок: ${audLabel}${isFallbackMode ? ', аудитория в резерве' : ''}; краткосрочный спрос недостаточен (спрос ${demandScore}).`;
      return `${core} ${blocker ? `${blocker} ` : ''}${confPhrase}`;
    }
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
    seasonalityScore,
    locationScore,
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
  const strategyRationaleRu = buildStrategyRationaleRu({
    strategy: residentialStrategy,
    audienceType,
    env,
    locationScore,
    demandScore,
    seasonalityScore,
    audienceFitScore,
    magnetCount,
    isFallbackMode,
    competitorPressureLevel,
    shortTermRationaleKind,
    confidence,
    stability01,
  });

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
