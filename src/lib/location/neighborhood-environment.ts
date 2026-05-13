/**
 * Neighborhood environment / livability-friction layer (MVP).
 * OSM-only proxies; never mixed into commercial evergreen scoring here.
 */

import type {
  NeighborhoodEnvironmentConcernLevel,
  NeighborhoodEnvironmentLayer,
  OSMElement,
} from './types';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isHelipadAerodrome(t: Record<string, string>): boolean {
  if (t.aeroway === 'helipad') return true;
  if (t.aerodrome === 'helipad') return true;
  const nameLower = (t.name ?? '').toLowerCase();
  return /heliport|helipad|\bheli pad\b/i.test(nameLower);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function roadTierScore(meters: number, tier: 'motorway' | 'trunk' | 'primary'): number {
  const d = meters;
  const k = tier === 'motorway' ? 1 : tier === 'trunk' ? 0.88 : 0.52;
  let base = 0;
  if (d <= 85) base = 34;
  else if (d <= 170) base = 28;
  else if (d <= 300) base = 20;
  else if (d <= 520) base = 12;
  else if (d <= 780) base = 6;
  else if (d <= 1100) base = 3;
  return base * k;
}

function runwayScore(meters: number): number {
  const d = meters;
  if (d <= 380) return 30;
  if (d <= 850) return 22;
  if (d <= 1600) return 14;
  if (d <= 2400) return 8;
  if (d <= 3200) return 4;
  return 0;
}

function taxiwayScore(meters: number): number {
  const d = meters;
  if (d <= 220) return 12;
  if (d <= 500) return 8;
  if (d <= 900) return 4;
  return 0;
}

function aerodromeScore(meters: number): number {
  const d = meters;
  if (d <= 550) return 18;
  if (d <= 1200) return 12;
  if (d <= 2000) return 7;
  if (d <= 2800) return 3;
  return 0;
}

function industrialProximityScore(meters: number): number {
  const d = meters;
  if (d <= 130) return 28;
  if (d <= 280) return 18;
  if (d <= 600) return 11;
  if (d <= 1100) return 5;
  return 0;
}

function concernFromScore(score: number): NeighborhoodEnvironmentConcernLevel {
  if (score <= 24) return 'low';
  if (score <= 44) return 'moderate';
  if (score <= 64) return 'elevated';
  return 'high';
}

const LABELS_EN: Record<NeighborhoodEnvironmentConcernLevel, string> = {
  low: 'Low concern',
  moderate: 'Moderate concern',
  elevated: 'Elevated concern',
  high: 'High concern',
};

const LABELS_RU: Record<NeighborhoodEnvironmentConcernLevel, string> = {
  low: 'Окружение: спокойное',
  moderate: 'Умеренная нагрузка среды',
  elevated: 'Повышенная нагрузка среды',
  high: 'Высокая нагрузка среды',
};

function pickEnvironmentNarrative(
  friction: number,
  level: NeighborhoodEnvironmentConcernLevel,
  breakdown: NeighborhoodEnvironmentLayer['breakdown'],
  confidence: NeighborhoodEnvironmentLayer['confidence'],
  evergreenIndex?: number,
): { en: string; ru: string } {
  const ev = evergreenIndex;
  const stack = breakdown.harshUrbanStack01;

  const strongCommercialTense =
    typeof ev === 'number' && ev >= 65 && friction >= 28;
  if (strongCommercialTense) {
    return {
      en:
        'Demand signals are strong, while the mapped physical setting leans busier — noise and transport load are worth validating on site; exact unit choice matters more than average.',
      ru:
        'Среда умеренно загружена — перед покупкой или запуском аренды стоит проверить шум и транспорт.',
    };
  }

  const calmish =
    friction <= 32 &&
    (level === 'low' || (level === 'moderate' && stack < 0.42));
  if (calmish) {
    return {
      en:
        'Mapped stressors look moderate overall — environmental load is closer to a typical urban baseline than to a clearly overloaded corridor.',
      ru:
        'По картам нагрузка среды умеренная: повышенная нагрузка по шуму и транспорту не выглядит доминирующей на этом участке.',
    };
  }

  const uneven =
    stack >= 0.48 ||
    (confidence === 'low' && friction >= 20) ||
    ((level === 'elevated' || level === 'high') &&
      typeof ev === 'number' &&
      ev >= 36 &&
      ev < 68);
  if (uneven) {
    return {
      en:
        'Signals are uneven — environmental quality can change within a few blocks; targeted property selection and a short field check pay off.',
      ru:
        'Сигналы неоднородны: возможна неравномерность качества среды внутри района — имеет смысл точечный отбор объекта и короткая полевая проверка.',
    };
  }

  switch (level) {
    case 'low':
      return {
        en: 'No pronounced mapped stressors in this radius — still validate what matters for your stay length and sensitivity.',
        ru:
          'Выраженных источников нагрузки по картам в этом радиусе немного — для вашего сценария проживания всё равно полезна проверка чувствительных факторов.',
      };
    case 'moderate':
      return {
        en: 'Several infrastructure cues suggest a busier envelope; comfort often depends on façade line, floor, and glazing rather than the postcode alone.',
        ru:
          'Есть несколько признаков более оживлённого контура; комфорт чаще зависит от линии дома, этажа и остекления, а не только от адреса.',
      };
    case 'elevated':
      return {
        en: 'Mapped load is clearly above a quiet baseline — treat acoustic and circulation factors as part of underwriting, without equating them to “area quality” in a social sense.',
        ru:
          'По картам нагрузка среды выше спокойного фона — разумно заложить в оценку акустику и транспортный контур, не смешивая это с бытовыми ярлыками о районе.',
      };
    case 'high':
    default:
      return {
        en: 'Multiple strong infrastructure proxies coincide near this point — expect a more demanding physical setting; site diligence is especially valuable.',
        ru:
          'Несколько сильных инфраструктурных признаков совпадают рядом с точкой — среда выглядит более напряжённой; особенно полезна аккуратная проверка на месте.',
      };
  }
}

export function mergeNeighborhoodEnvironmentLayer(
  partial?: Partial<NeighborhoodEnvironmentLayer> | null,
): NeighborhoodEnvironmentLayer {
  const base = emptyNeighborhoodEnvironmentLayer();
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    environmentNarrativeEn: partial.environmentNarrativeEn ?? base.environmentNarrativeEn,
    environmentNarrativeRu: partial.environmentNarrativeRu ?? base.environmentNarrativeRu,
  };
}

export function emptyNeighborhoodEnvironmentLayer(): NeighborhoodEnvironmentLayer {
  return {
    environmentalFrictionScore: 0,
    concernLevel: 'low',
    concernLabelEn: LABELS_EN.low,
    concernLabelRu: LABELS_RU.low,
    reasonsEn: ['Insufficient mapped data to assess environmental friction near this point.'],
    reasonsRu: ['Недостаточно данных карт, чтобы оценить нагрузку среды у этой точки.'],
    environmentNarrativeEn:
      'Insufficient mapped data to summarise how the surroundings will feel day to day.',
    environmentNarrativeRu: 'Недостаточно данных карт для краткого вывода о комфорте среды.',
    confidence: 'low',
    breakdown: {
      majorRoads01: 0,
      industrial01: 0,
      aviation01: 0,
      nightlife01: 0,
      transitCorridor01: 0,
      harshUrbanStack01: 0,
    },
  };
}

export interface NeighborhoodEnvironmentContext {
  /** Commercial index — optional copy only; never used for math, only for one explainability line. */
  evergreenIndex?: number;
}

/**
 * Builds the MVP neighborhood-environment layer from raw OSM elements (including ways with `center`).
 */
export function buildNeighborhoodEnvironmentLayer(
  elements: OSMElement[],
  lat: number,
  lon: number,
  context?: NeighborhoodEnvironmentContext,
): NeighborhoodEnvironmentLayer {
  if (!elements.length) {
    return emptyNeighborhoodEnvironmentLayer();
  }

  let minMotorway = Infinity;
  let minTrunk = Infinity;
  let minPrimary = Infinity;
  let minRunway = Infinity;
  let minTaxiway = Infinity;
  let minAerodrome = Infinity;
  let minIndustrial = Infinity;
  let industrialWithin600 = 0;
  let nightclubWithin350 = 0;
  let barPubWithin300 = 0;
  let transitStopsWithin320 = 0;
  let sawMotorwayOrTrunkWay = false;
  let sawRunway = false;
  let freightRailWithin260 = 0;

  for (const el of elements) {
    const elat = el.lat ?? el.center?.lat;
    const elon = el.lon ?? el.center?.lon;
    if (elat == null || elon == null) continue;
    const t = el.tags ?? {};
    const d = haversineMeters(lat, lon, elat, elon);

    const hw = t.highway;
    if (hw === 'motorway' || hw === 'motorway_link') {
      minMotorway = Math.min(minMotorway, d);
      if (el.type === 'way') sawMotorwayOrTrunkWay = true;
    }
    if (hw === 'trunk' || hw === 'trunk_link') {
      minTrunk = Math.min(minTrunk, d);
      if (el.type === 'way') sawMotorwayOrTrunkWay = true;
    }
    if (hw === 'primary' || hw === 'primary_link') {
      minPrimary = Math.min(minPrimary, d);
    }

    if (t.aeroway === 'runway') {
      minRunway = Math.min(minRunway, d);
      sawRunway = true;
    }
    if (t.aeroway === 'taxiway') {
      minTaxiway = Math.min(minTaxiway, d);
    }
    if ((t.aeroway === 'aerodrome' || t.aeroway === 'terminal') && !isHelipadAerodrome(t)) {
      minAerodrome = Math.min(minAerodrome, d);
    }

    const industrialHit =
      t.landuse === 'industrial' ||
      t.man_made === 'works' ||
      t.building === 'industrial' ||
      t.industrial === 'warehouse';
    if (industrialHit) {
      minIndustrial = Math.min(minIndustrial, d);
      if (d <= 600) industrialWithin600 += 1;
    }

    if (t.amenity === 'nightclub' && d <= 350) nightclubWithin350 += 1;
    if ((t.amenity === 'bar' || t.amenity === 'pub') && d <= 300) barPubWithin300 += 1;

    const transitHit =
      t.highway === 'bus_stop' ||
      t.public_transport === 'stop_position' ||
      t.railway === 'tram_stop';
    if (transitHit && d <= 320) transitStopsWithin320 += 1;

    if (t.railway === 'rail' && (t.usage === 'freight' || t.freight === 'yes') && d <= 260) {
      freightRailWithin260 += 1;
    }
  }

  const roadMotor = Number.isFinite(minMotorway) ? roadTierScore(minMotorway, 'motorway') : 0;
  const roadTrunk = Number.isFinite(minTrunk) ? roadTierScore(minTrunk, 'trunk') : 0;
  const roadPrim = Number.isFinite(minPrimary) ? roadTierScore(minPrimary, 'primary') : 0;
  let roadsRaw = Math.max(roadMotor, roadTrunk, roadPrim);
  if (freightRailWithin260 > 0) {
    roadsRaw = Math.min(34, roadsRaw + 4);
  }

  let industrialRaw = Number.isFinite(minIndustrial) ? industrialProximityScore(minIndustrial) : 0;
  if (industrialWithin600 >= 4) industrialRaw = Math.min(30, industrialRaw + 6);
  else if (industrialWithin600 >= 2) industrialRaw = Math.min(30, industrialRaw + 3);

  const rw = Number.isFinite(minRunway) ? runwayScore(minRunway) : 0;
  const tw = Number.isFinite(minTaxiway) ? taxiwayScore(minTaxiway) : 0;
  const ad = Number.isFinite(minAerodrome) ? aerodromeScore(minAerodrome) : 0;
  let aviationRaw = Math.min(32, Math.max(rw + tw * 0.45, ad * 0.95));
  if (rw > 0 && ad > 0) aviationRaw = Math.min(32, aviationRaw + 3);

  const nightclubsRaw = Math.min(22, nightclubWithin350 * 9);
  const barsRaw = Math.min(12, barPubWithin300 * 2.5);
  let nightlifeRaw = Math.min(24, nightclubsRaw + barsRaw);

  let transitRaw = 0;
  if (transitStopsWithin320 >= 14) transitRaw = 18;
  else if (transitStopsWithin320 >= 9) transitRaw = 13;
  else if (transitStopsWithin320 >= 6) transitRaw = 8;
  else if (transitStopsWithin320 >= 4) transitRaw = 4;

  let stackRaw = 0;
  if (roadsRaw >= 14 && industrialRaw >= 12) stackRaw += 10;
  if (roadsRaw >= 10 && nightlifeRaw >= 8) stackRaw += 6;
  if (aviationRaw >= 18 && roadsRaw >= 10) stackRaw += 5;
  stackRaw = Math.min(12, stackRaw);

  const friction = Math.round(
    clamp(roadsRaw + industrialRaw + aviationRaw + nightlifeRaw + transitRaw + stackRaw, 0, 100),
  );
  const level = concernFromScore(friction);

  const ROAD_MAX = 38;
  const IND_MAX = 30;
  const AVI_MAX = 32;
  const NIGHT_MAX = 24;
  const TRANSIT_MAX = 18;
  const STACK_MAX = 12;

  const breakdown = {
    majorRoads01: clamp(roadsRaw / ROAD_MAX, 0, 1),
    industrial01: clamp(industrialRaw / IND_MAX, 0, 1),
    aviation01: clamp(aviationRaw / AVI_MAX, 0, 1),
    nightlife01: clamp(nightlifeRaw / NIGHT_MAX, 0, 1),
    transitCorridor01: clamp(transitRaw / TRANSIT_MAX, 0, 1),
    harshUrbanStack01: clamp(stackRaw / STACK_MAX, 0, 1),
  };

  let confidence: NeighborhoodEnvironmentLayer['confidence'] = 'high';
  if (elements.length < 10) confidence = 'low';
  else if (elements.length < 22) confidence = 'medium';
  if (!sawMotorwayOrTrunkWay && !sawRunway && elements.length < 35) {
    confidence = confidence === 'high' ? 'medium' : confidence;
  }

  const reasonsEn: string[] = [];
  const reasonsRu: string[] = [];

  if (roadsRaw >= 10) {
    reasonsEn.push('High traffic load near the property (major roads / corridor proxy).');
    reasonsRu.push('Высокая транспортная нагрузка рядом с объектом (магистрали и коридоры).');
  }
  if (industrialRaw >= 10) {
    reasonsEn.push('Industrial or logistics-related mapped land use nearby.');
    reasonsRu.push('Поблизости есть признаки производственной или складской среды — проверьте шум и транспорт на месте.');
  }
  if (aviationRaw >= 12) {
    reasonsEn.push('Close to airport infrastructure or runway geometry in OSM (aviation noise proxy).');
    reasonsRu.push('Близость к аэропортной инфраструктуре или ВПП может давать шум и нагрузку.');
  }
  if (nightlifeRaw >= 8) {
    reasonsEn.push('Dense late-night venue footprint (nightlife intensity proxy).');
    reasonsRu.push('Плотная сеть ночных заведений рядом — возможна повышенная ночная нагрузка.');
  }
  if (transitRaw >= 8) {
    reasonsEn.push('Very high transit stop density — busy pedestrian–bus corridor proxy.');
    reasonsRu.push('Очень плотная сеть остановок — признак оживлённого транзитного коридора.');
  }
  if (stackRaw >= 6) {
    reasonsEn.push('Several strong environment stressors stack in the same radius.');
    reasonsRu.push('Несколько сильных факторов нагрузки среды совпадают в одном радиусе.');
  }

  if (reasonsEn.length === 0) {
    reasonsEn.push('No major environmental stressors detected from neutral OSM proxies in this radius.');
    reasonsRu.push('По нейтральным признакам OSM существенных источников нагрузки среды не выявлено.');
  }

  if (confidence === 'low') {
    reasonsEn.push('Low map coverage confidence — conclusions are indicative only.');
    reasonsRu.push('Низкая уверенность из‑за разреженных данных карты — вывод ориентировочный.');
  } else if (confidence === 'medium') {
    reasonsEn.push('Moderate map coverage — edge cases may be missing from OSM.');
    reasonsRu.push('Умеренная полнота карты — часть пограничных сигналов может отсутствовать в OSM.');
  }

  const narrative = pickEnvironmentNarrative(friction, level, breakdown, confidence, context?.evergreenIndex);

  return {
    environmentalFrictionScore: friction,
    concernLevel: level,
    concernLabelEn: LABELS_EN[level],
    concernLabelRu: LABELS_RU[level],
    reasonsEn: reasonsEn.slice(0, 6),
    reasonsRu: reasonsRu.slice(0, 6),
    environmentNarrativeEn: narrative.en,
    environmentNarrativeRu: narrative.ru,
    confidence,
    breakdown,
  };
}
