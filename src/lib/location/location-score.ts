import type {
  LocationScoreOutput,
  LocationScoreRating,
  RecommendedStrategy,
  GravityExplanation,
  FootTrafficSummary,
  AudienceAnalysis,
} from './types';
import { GRAVITY_CONFIG } from './config';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function ratingFromLocationScore(locationScore: number): LocationScoreRating {
  if (locationScore >= 85) return 'exceptional';
  if (locationScore >= 70) return 'strong';
  if (locationScore >= 55) return 'viable';
  if (locationScore >= 40) return 'weak';
  return 'risky';
}

function basePriceProxyRUB(locationScore: number): number {
  if (locationScore >= 70) return 4_500;
  if (locationScore >= 45) return 3_000;
  return 2_000;
}

function computeADR(basePrice: number, locationScore: number): number {
  return basePrice * (0.6 + 0.8 * (locationScore / 100));
}

function computeOccupancy01(demandScore: number, supplyScore: number): number {
  const supplyPenalty = (100 - supplyScore) / 100;
  const occ =
    0.35 +
    0.5 * (demandScore / 100) -
    0.2 * supplyPenalty;
  return clamp(occ, 0.2, 0.9);
}

function recommendStrategy(b: { demand_score: number; seasonality_score: number }): RecommendedStrategy {
  if (b.demand_score > 75 && b.seasonality_score > 65) return 'short_term';
  if (b.demand_score > 55) return 'hybrid';
  return 'mid_term';
}

function incomeByStrategyRUB(args: {
  basePrice: number;
  locationScore: number;
  demandScore: number;
  supplyScore: number;
}): LocationScoreOutput['estimated_monthly_income'] {
  const adrBase = computeADR(args.basePrice, args.locationScore);
  const occBase = computeOccupancy01(args.demandScore, args.supplyScore);

  const model = (adrMul: number, occMul: number) => {
    const adr = adrBase * adrMul;
    const occ = clamp(occBase * occMul, 0.2, 0.9);
    return Math.round(adr * occ * 30);
  };

  return {
    short_term: model(1.12, 0.93),
    hybrid: model(1.0, 1.0),
    mid_term: model(0.88, 1.06),
  };
}

function splitFactors(
  candidates: Array<{ text: string; kind: 'positive' | 'negative'; weight: number }>,
): { top_positive_factors: string[]; top_negative_factors: string[] } {
  const pos = candidates.filter(c => c.kind === 'positive').sort((a, b) => b.weight - a.weight);
  const neg = candidates.filter(c => c.kind === 'negative').sort((a, b) => b.weight - a.weight);
  return {
    top_positive_factors: pos.slice(0, 4).map(x => x.text),
    top_negative_factors: neg.slice(0, 4).map(x => x.text),
  };
}

/** Russian-locale distance string: "300 м" or "1.4 км" */
function formatDistRu(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`;
}

export function buildLocationScoreOutput(input: {
  evergreenIndex: number;
  gravityExplanation: GravityExplanation;
  competitorPressure: number;
  magnetCount: number;
  hasMetro: boolean;
  attractionCount: number;
  footTraffic: FootTrafficSummary;
  audienceAnalysis: AudienceAnalysis;
  accessibilityStopCount?: number;
}): LocationScoreOutput {
  // ── Component scores (keep as floats — round only at the final step) ────────
  // Early Math.round() on sub-scores quantises inputs into the weighted formula
  // and kills the small differences that distinguish 88 from 94 from 99.

  const supply_score = clamp(
    100 - (clamp(input.competitorPressure, 0, GRAVITY_CONFIG.competitorPressureMax) / GRAVITY_CONFIG.competitorPressureMax) * 100,
    0,
    100,
  );

  const attractionScaled = clamp(input.gravityExplanation.scoreBreakdown.attraction, 0, 999);
  const magnet_score = clamp((attractionScaled / 70) * 100, 0, 100);
  const seasonality_score = clamp((input.footTraffic.stability01 ?? 0) * 100, 0, 100);

  // demand_score: evergreen + magnet blend (no circularity — evergreenIndex is already computed)
  const demand_score = clamp(0.6 * input.evergreenIndex + 0.4 * magnet_score, 0, 100);

  // accessibility_score: metro = strong base; additional stops add up to ~35 pts
  const accessibility_score = clamp(
    (input.hasMetro ? 60 : 0) + Math.min(40, (input.accessibilityStopCount ?? 0) * 5),
    0,
    100,
  );

  const audience_fit_score = clamp(input.audienceAnalysis.audienceFitScore, 0, 100);

  // ── Final weighted location score — ONE round, at the very end ──────────────
  // AudienceFit 40% | Demand 25% | Competition 20% | Accessibility 15%
  const location_score = clamp(
    Math.round(
      0.40 * audience_fit_score +
      0.25 * demand_score +
      0.20 * supply_score +
      0.15 * accessibility_score,
    ),
    0,
    100,
  );

  // Round breakdown fields for UI display only — the floats were already used in location_score above.
  const breakdown = {
    demand_score:      Math.round(demand_score),
    supply_score:      Math.round(supply_score),
    magnet_score:      Math.round(magnet_score),
    seasonality_score: Math.round(seasonality_score),
    audience_fit_score: Math.round(audience_fit_score),
    accessibility_score: Math.round(accessibility_score),
  };
  const recommended_strategy = recommendStrategy(breakdown);
  const rating = ratingFromLocationScore(location_score);

  const basePrice = basePriceProxyRUB(location_score);
  const estimated_monthly_income = incomeByStrategyRUB({
    basePrice,
    locationScore: location_score,
    demandScore: demand_score,
    supplyScore: supply_score,
  });

  // ── Factor candidates ────────────────────────────────────────────────────────

  const {
    primaryAudience,
    primaryMagnets,
    fallbackMode,
    audienceSharePct,
    businessClusterDetected,
    primaryDriverLabel,
  } = input.audienceAnalysis;

  const factors: Array<{ text: string; kind: 'positive' | 'negative'; weight: number }> = [];

  // ── PRIMARY DRIVER (always first — explains WHY this location makes money) ──
  factors.push({
    text: primaryDriverLabel,
    kind: audience_fit_score >= 35 ? 'positive' : 'negative',
    weight: 100,
  });

  if (primaryAudience === 'BUSINESS') {
    const topBusiness = primaryMagnets.find(m => m.type === 'business');

    if (topBusiness) {
      const d = formatDistRu(topBusiness.distance);

      if (topBusiness.distance <= 500) {
        factors.push({
          text: `Стабильный поток командированных: ${topBusiness.name} (${d}) — постоянный деловой спрос в шаговой доступности.`,
          kind: 'positive',
          weight: 93,
        });
      } else if (topBusiness.distance <= 1500) {
        factors.push({
          text: `Деловой трафик в зоне доступности: ${topBusiness.name} (${d}) обеспечивает корпоративный поток.`,
          kind: 'positive',
          weight: 80,
        });
      } else {
        factors.push({
          text: `${topBusiness.name} (${d}) — деловой магнит далеко, поток командированных будет слабым.`,
          kind: 'negative',
          weight: 72,
        });
      }

      if (businessClusterDetected) {
        factors.push({
          text: `Кластер деловых объектов в радиусе 1 км — несколько источников командированных усиливают спрос.`,
          kind: 'positive',
          weight: 88,
        });
      }

      if (audienceSharePct >= 60) {
        factors.push({
          text: `Деловой поток доминирует: ${audienceSharePct}% взвешенного спроса — бизнес-аудитория.`,
          kind: 'positive',
          weight: 85,
        });
      }
    } else {
      factors.push({
        text: 'Значимых деловых объектов не обнаружено — корпоративный спрос не прогнозируется.',
        kind: 'negative',
        weight: 82,
      });
    }

    if (audience_fit_score < 30) {
      factors.push({
        text: 'Слабый деловой сигнал: деловые магниты либо отсутствуют, либо слишком далеко.',
        kind: 'negative',
        weight: 78,
      });
    }
  } else {
    // TOURIST (primary or auto-fallback)
    const topTourist = primaryMagnets.find(m => m.type === 'tourist');
    if (topTourist) {
      const d = formatDistRu(topTourist.distance);
      factors.push({
        text: `Туристический поток: ${topTourist.name} (${d}) — источник leisure-спроса.`,
        kind: 'positive',
        weight: 85,
      });
    }
    if (fallbackMode) {
      factors.push({
        text: 'Деловых магнитов не обнаружено — анализ переключён на туристическую аудиторию.',
        kind: 'negative',
        weight: 62,
      });
    }
  }

  // ── Demand / magnets ────────────────────────────────────────────────────────
  if (demand_score >= 70) {
    factors.push({ text: 'Сильные сигналы спроса в зоне.', kind: 'positive', weight: demand_score });
  } else if (demand_score <= 45) {
    factors.push({ text: 'Сигналы спроса ограничены — сильнее влияет упаковка и каналы продаж.', kind: 'negative', weight: 100 - demand_score });
  }

  // ── Transit — explain value to business travelers, not just "nearby" ────────
  if (input.hasMetro) {
    factors.push({
      text: 'Metro доступно без автомобиля — гостям проще добираться без такси.',
      kind: 'positive',
      weight: 72,
    });
  } else {
    factors.push({
      text: 'Метро рядом нет — гостям чаще нужно такси/авто; учитывайте это в цене и описании.',
      kind: 'negative',
      weight: 45,
    });
  }

  // ── Tourist attractions (suppressed when BUSINESS is locked at ≥65 %) ───────
  if (primaryAudience !== 'BUSINESS' || audienceSharePct < 65) {
    if (input.attractionCount >= 2) {
      factors.push({ text: 'Несколько достопримечательностей рядом поддерживают досуговый и выходной спрос.', kind: 'positive', weight: 62 + input.attractionCount * 2 });
    } else if (input.attractionCount === 0) {
      factors.push({ text: 'Достопримечательностей рядом нет — досуговый спрос ограничен.', kind: 'negative', weight: 55 });
    }
  }

  // ── Demand cluster ──────────────────────────────────────────────────────────
  if (input.gravityExplanation.clusterDetected) {
    factors.push({
      text: 'Рядом кластер сильных магнитов — концентрированная зона спроса повышает стабильную загрузку.',
      kind: 'positive',
      weight: 65 + Math.min(20, input.gravityExplanation.clusterSize * 3),
    });
  }

  // ── Magnet density ──────────────────────────────────────────────────────────
  if (input.magnetCount <= 2) {
    factors.push({ text: 'Мало магнитов спроса рядом — драйверов вокруг объекта недостаточно.', kind: 'negative', weight: 65 });
  } else if (input.magnetCount >= 7) {
    factors.push({ text: 'Насыщенное окружение поддерживает загрузку в течение года.', kind: 'positive', weight: 55 + input.magnetCount });
  }

  // ── Supply / competition ────────────────────────────────────────────────────
  if (supply_score >= 70) {
    factors.push({ text: 'Конкурентное давление ниже среднего — проще занять нишу и удерживать цену.', kind: 'positive', weight: supply_score });
  } else if (supply_score <= 45) {
    factors.push({ text: 'Высокая конкуренция — критичны упаковка, цена и качество отзывов.', kind: 'negative', weight: 100 - supply_score });
  }

  // ── Seasonality proxy ───────────────────────────────────────────────────────
  if (seasonality_score >= 65) {
    factors.push({ text: 'Спрос устойчивый — ниже риск сезонных провалов.', kind: 'positive', weight: seasonality_score });
  } else if (seasonality_score <= 40) {
    factors.push({ text: 'Вероятны сезонные качели — нужна стратегия управления доходом.', kind: 'negative', weight: 100 - seasonality_score });
  }

  return {
    location_score,
    rating,
    breakdown,
    estimated_monthly_income,
    ...splitFactors(factors),
    recommended_strategy,
  };
}
