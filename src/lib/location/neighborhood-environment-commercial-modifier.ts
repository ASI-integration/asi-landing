/**
 * Soft headline modifier for composite `location_score` based on neighborhood-environment
 * concern (OSM friction proxies). Does not touch evergreen / magnet math.
 */

import type {
  NeighborhoodEnvironmentCommercialModifierSnapshot,
  NeighborhoodEnvironmentLayer,
} from './types';
import { NEIGHBORHOOD_ENV_SCORE_MODIFIER } from './config';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function modifierLayerGloballyEnabled(): boolean {
  const v = process.env.ASI_NEIGHBORHOOD_ENV_SCORE_MODIFIER;
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}

function nominalReductionFraction(
  concern: 'elevated' | 'high',
  neighborhoodConfidence: 'medium' | 'high',
): number {
  if (concern === 'elevated') {
    return neighborhoodConfidence === 'high' ? 0.06 : 0.04;
  }
  return neighborhoodConfidence === 'high' ? 0.08 : 0.07;
}

export function computeNeighborhoodEnvironmentCommercialModifier(input: {
  baseLocationScore: number;
  neighborhoodEnvironment: NeighborhoodEnvironmentLayer;
  osmElementCount: number;
}): NeighborhoodEnvironmentCommercialModifierSnapshot {
  const base = clamp(Math.round(input.baseLocationScore), 0, 100);
  const ne = input.neighborhoodEnvironment;
  const n = input.osmElementCount;
  const layerEnabled = modifierLayerGloballyEnabled();

  if (!layerEnabled) {
    return {
      layerEnabled: false,
      applied: false,
      baseLocationScore: base,
      adjustedLocationScore: base,
      pointsRemoved: 0,
      nominalReductionFraction: 0,
      concernLevel: ne.concernLevel,
      neighborhoodConfidence: ne.confidence,
      osmElementCount: n,
      osmCoverageOkForPenalty: n >= NEIGHBORHOOD_ENV_SCORE_MODIFIER.minOsmElementsForPenalty,
      skipReason: 'layer_disabled',
      warningOnlyHighConcernLowConfidence: false,
      strongBandFloorApplied: false,
      explainEn: 'Neighborhood-environment headline modifier is disabled.',
      explainRu: 'Мягкий модификатор по среде отключён.',
    };
  }

  const osmOk = n >= NEIGHBORHOOD_ENV_SCORE_MODIFIER.minOsmElementsForPenalty;
  const concern = ne.concernLevel;

  if (concern === 'low' || concern === 'moderate') {
    return {
      layerEnabled: true,
      applied: false,
      baseLocationScore: base,
      adjustedLocationScore: base,
      pointsRemoved: 0,
      nominalReductionFraction: 0,
      concernLevel: concern,
      neighborhoodConfidence: ne.confidence,
      osmElementCount: n,
      osmCoverageOkForPenalty: osmOk,
      skipReason: 'concern_below_elevated',
      warningOnlyHighConcernLowConfidence: false,
      strongBandFloorApplied: false,
      explainEn:
        concern === 'moderate'
          ? 'Environment concern is moderate — narrative only; headline commercial score unchanged.'
          : 'Environment concern is low — headline commercial score unchanged.',
      explainRu:
        concern === 'moderate'
          ? 'Нагрузка среды умеренная — только текстовый слой; итоговый коммерческий балл не меняется.'
          : 'Нагрузка среды низкая — итоговый коммерческий балл не меняется.',
    };
  }

  const warnOnly = concern === 'high' && ne.confidence === 'low';

  if (ne.confidence === 'low') {
    return {
      layerEnabled: true,
      applied: false,
      baseLocationScore: base,
      adjustedLocationScore: base,
      pointsRemoved: 0,
      nominalReductionFraction: 0,
      concernLevel: concern,
      neighborhoodConfidence: ne.confidence,
      osmElementCount: n,
      osmCoverageOkForPenalty: osmOk,
      skipReason: 'neighborhood_confidence_low',
      warningOnlyHighConcernLowConfidence: warnOnly,
      strongBandFloorApplied: false,
      explainEn: warnOnly
        ? 'High mapped environment concern, but map-coverage confidence for this sub-model is low — no headline penalty; validate on site.'
        : 'Map-coverage confidence for the environment sub-model is low — no headline penalty.',
      explainRu: warnOnly
        ? 'По картам нагрузка среды высокая, но уверенность подмодели низкая — штраф к баллу не применяется; нужна проверка на месте.'
        : 'Низкая уверенность подмодели среды по картам — штраф к баллу не применяется.',
    };
  }

  if (!osmOk) {
    return {
      layerEnabled: true,
      applied: false,
      baseLocationScore: base,
      adjustedLocationScore: base,
      pointsRemoved: 0,
      nominalReductionFraction: 0,
      concernLevel: concern,
      neighborhoodConfidence: ne.confidence,
      osmElementCount: n,
      osmCoverageOkForPenalty: false,
      skipReason: 'osm_too_sparse',
      warningOnlyHighConcernLowConfidence: false,
      strongBandFloorApplied: false,
      explainEn: 'OSM element count is very low here — skipping headline penalty to avoid false precision.',
      explainRu: 'Очень мало объектов OSM в выборке — числовой штраф к баллу отключён, чтобы не создавать ложной точности.',
    };
  }

  const confBand = ne.confidence === 'high' ? 'high' : 'medium';
  const nominal = nominalReductionFraction(concern, confBand);
  const rawPoints = base * nominal;
  let pointsRemoved = Math.min(
    NEIGHBORHOOD_ENV_SCORE_MODIFIER.maxPointReduction,
    Math.max(0, Math.round(rawPoints)),
  );
  let strongBandFloorApplied = false;
  // elevated → floor 70 (protect solid demand cores from a one-step band drop).
  // high → floor 67 (allow meaningful reduction when environment concern is serious).
  const strongBandFloor = concern === 'high' ? 67 : 70;
  if (base >= strongBandFloor) {
    const maxByStrongFloor = base - strongBandFloor;
    if (pointsRemoved > maxByStrongFloor) strongBandFloorApplied = true;
    pointsRemoved = Math.min(pointsRemoved, maxByStrongFloor);
  }
  const adjusted = clamp(base - pointsRemoved, 0, 100);

  if (pointsRemoved <= 0 || adjusted === base) {
    return {
      layerEnabled: true,
      applied: false,
      baseLocationScore: base,
      adjustedLocationScore: base,
      pointsRemoved: 0,
      nominalReductionFraction: nominal,
      concernLevel: concern,
      neighborhoodConfidence: ne.confidence,
      osmElementCount: n,
      osmCoverageOkForPenalty: true,
      skipReason: 'no_numeric_change',
      warningOnlyHighConcernLowConfidence: false,
      strongBandFloorApplied: false,
      explainEn: 'Modifier evaluated to a zero-point change at this headline level.',
      explainRu: 'Модификатор на этом уровне балла не изменил итог.',
    };
  }

  const pct = Math.round(nominal * 1000) / 10;
  const floorNoteEn = strongBandFloorApplied
    ? ' Strong headline floor (70) capped the reduction to avoid a one-step rating band drop.'
    : '';
  const floorNoteRu = strongBandFloorApplied
    ? ' Сработал пол для strong-бэнда (70), чтобы один слой не опускал рейтинг на ступень ниже.'
    : '';
  return {
    layerEnabled: true,
    applied: true,
    baseLocationScore: base,
    adjustedLocationScore: adjusted,
    pointsRemoved,
    nominalReductionFraction: nominal,
    concernLevel: concern,
    neighborhoodConfidence: ne.confidence,
    osmElementCount: n,
    osmCoverageOkForPenalty: true,
    skipReason: null,
    warningOnlyHighConcernLowConfidence: false,
    strongBandFloorApplied,
    explainEn: `Soft environment-friction adjustment: −${pointsRemoved} pts on the headline score (~${pct}% nominal, capped) while demand signals stay unchanged.${floorNoteEn}`,
    explainRu: `Мягкая корректировка по нагрузке среды: −${pointsRemoved} к итоговому баллу (ориентир ~${pct}%, с ограничением), сигналы спроса не менялись.${floorNoteRu}`,
  };
}
