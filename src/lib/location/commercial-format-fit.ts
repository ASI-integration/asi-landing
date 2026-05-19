/**
 * Commercial format fit layer — rule-based fit scoring for 6 retail/commercial formats.
 * Uses existing signals already computed by the gravity engine.
 * Intentionally rule-based and explainable: no magic scores.
 */

import type { LocationAnalysis, DemandType } from './types';
import {
  evaluateStreetRetailSuitability,
  streetRetailFitCap,
  type StreetRetailSuitabilityResult,
} from './street-retail-suitability';

export type CommercialFormatType =
  | 'retail'
  | 'food_beverage'
  | 'service'
  | 'convenience'
  | 'showroom'
  | 'destination_venue';

export type CommercialFormatFitLevel = 'high' | 'medium' | 'low' | 'poor';

export interface CommercialFormatFitEntry {
  format: CommercialFormatType;
  /** Russian label for /ru UI */
  formatLabelRu: string;
  fitLevel: CommercialFormatFitLevel;
  /** Short 1–2 sentence explanation (Russian) */
  explanationRu: string;
  supportingFactorsRu: string[];
  limitingFactorsRu: string[];
}

export type CommercialOverallVerdict = 'strong' | 'selective' | 'weak' | 'poor';

export interface CommercialFormatFit {
  entries: CommercialFormatFitEntry[];
  overallVerdict: CommercialOverallVerdict;
  overallVerdictLabelRu: string;
  /** Top 1–2 formats worth pursuing first */
  bestFormats: CommercialFormatType[];
  /** Street-retail gates: area flow vs entrance/frontage (retail format only). */
  streetRetailSuitability?: StreetRetailSuitabilityResult;
}

// ── Internal scoring helpers ────────────────────────────────────────────────

function hasMagnetCategory(analysis: LocationAnalysis, ...ids: string[]): boolean {
  return analysis.magnets.some(m => ids.includes(m.categoryId));
}

function nearMagnets(analysis: LocationAnalysis, maxDistM: number, ...ids: string[]): boolean {
  return analysis.magnets.some(m => ids.includes(m.categoryId) && m.distance <= maxDistM);
}

function industrialBarrier(analysis: LocationAnalysis): boolean {
  const ind = analysis.neighborhoodEnvironment.breakdown.industrial01 ?? 0;

  // Raised floor: low-moderate industrial01 (railway adjacent, construction sites,
  // historic industrial fabric) does not block commercial scoring.
  if (ind <= 0.50) return false;

  // Strong urban-anchor escape hatch (0.50 < ind ≤ 0.85):
  // A nearby metro station is the strongest signal of genuine urban commercial
  // context and is incompatible with a true industrial zone.
  // This covers transit hubs (railway infrastructure tagged industrial),
  // creative/gentrified districts (historic factories in OSM), and dense central
  // streets with incidental landuse artefacts.
  // We require metro specifically — not just any shopping or attraction — because
  // suburban centres may have a local mall (shopping_major) without being urban-core.
  const hasMetroAnchor = hasMagnetCategory(analysis, 'metro');
  if (ind <= 0.85 && hasMetroAnchor && analysis.evergreenIndex >= 60) return false;

  // ind > 0.85 without redeeming urban anchors → genuine industrial barrier
  return true;
}

function transportCorridorHeavy(analysis: LocationAnalysis): boolean {
  return (analysis.neighborhoodEnvironment.breakdown.transitCorridor01 ?? 0) > 0.5
    || (analysis.neighborhoodEnvironment.breakdown.majorRoads01 ?? 0) > 0.55;
}

// ── Per-format fit logic ────────────────────────────────────────────────────

const FIT_RANK: Record<CommercialFormatFitLevel, number> = {
  poor: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function capFitLevel(
  level: CommercialFormatFitLevel,
  cap: CommercialFormatFitLevel,
): CommercialFormatFitLevel {
  return FIT_RANK[level] > FIT_RANK[cap] ? cap : level;
}

function scoreRetail(
  a: LocationAnalysis,
  streetRetail?: StreetRetailSuitabilityResult,
): CommercialFormatFitEntry {
  const { transitShare, destinationShare, localActiveShare } = a.footTraffic.transitVsTarget;
  const idx = a.evergreenIndex;
  const dt: DemandType = a.demandType;
  const hasShoppingAnchor = hasMagnetCategory(a, 'shopping_major', 'shopping_local');
  const hasBusinessCluster = a.audienceAnalysis?.businessClusterDetected ?? false;
  const hasTransit = hasMagnetCategory(a, 'metro', 'railway_station');
  const competitive = a.gravityExplanation.competitorPressureLevel === 'high';
  const industrial = industrialBarrier(a);

  const supporting: string[] = [];
  const limiting: string[] = [];

  let fitLevel: CommercialFormatFitLevel;

  if (
    streetRetail?.areaTargetFlowStrong &&
    (hasShoppingAnchor || hasBusinessCluster || hasTransit) &&
    !industrial
  ) {
    fitLevel = 'high';
    supporting.push('Сильный целевой поток в зоне (H3 / проходимость)');
    if (hasShoppingAnchor) supporting.push('Торговый якорь в зоне');
    if (hasBusinessCluster) supporting.push('Деловой кластер рядом');
    if (hasTransit) supporting.push('Транзитный узел усиливает проходимость');
  } else if (
    idx >= 60 &&
    destinationShare >= 0.40 &&
    (hasShoppingAnchor || hasBusinessCluster || hasTransit) &&
    !industrial
  ) {
    fitLevel = 'high';
    supporting.push('Сильный целевой поток');
    if (hasShoppingAnchor) supporting.push('Торговый якорь в зоне');
    if (hasBusinessCluster) supporting.push('Деловой кластер рядом');
    if (hasTransit) supporting.push('Транзитный узел усиливает проходимость');
  } else if (
    idx >= 45 &&
    (destinationShare >= 0.30 || dt === 'business-led' || dt === 'tourism-led') &&
    !industrial
  ) {
    fitLevel = 'medium';
    if (destinationShare >= 0.30) supporting.push('Умеренный целевой поток');
    if (dt === 'business-led') supporting.push('Деловая аудитория');
    if (dt === 'tourism-led') supporting.push('Туристический трафик');
  } else if (idx >= 30 && !industrial) {
    fitLevel = 'low';
    if (transitShare > 0.5) limiting.push('Преобладает транзит — низкая конверсия в retail');
    if (idx < 45) limiting.push('Слабый индекс локации');
  } else {
    fitLevel = 'poor';
    limiting.push('Слишком слабый спрос или промышленные барьеры');
  }

  if (competitive) limiting.push('Высокая конкурентная плотность');
  if (industrial) limiting.push('Промышленное окружение — сдерживает потребительский поток');
  if (transitShare > 0.55 && fitLevel !== 'poor') limiting.push('Высокий транзит снижает задерживаемость');
  if (localActiveShare >= 0.35 && fitLevel !== 'poor') supporting.push('Активный локальный поток');

  if (streetRetail) {
    const cap = streetRetailFitCap(streetRetail);
    const beforeCap = fitLevel;
    fitLevel = capFitLevel(fitLevel, cap);

    if (streetRetail.areaTargetFlowStrong && !streetRetail.strongStreetRetailAllowed) {
      if (beforeCap === 'high' && fitLevel !== 'high') {
        limiting.push(
          'Сильный поток в зоне не заменяет первую линию, уличный вход и доступность входной группы',
        );
      }
    }

    if (streetRetail.floorClass === 'below_street') {
      limiting.push('Цоколь / подвал / ниже уровня улицы — уличный ритейл по проходимости не подтверждается');
    } else if (streetRetail.floorClass === 'upper_or_interior') {
      limiting.push('Помещение не на уровне улицы / 1 этажа — уличный ритейл по этой оценке не подтверждается');
    } else if (streetRetail.firstLine === false) {
      limiting.push('Не первая линия — поток рядом не гарантирует вход в помещение');
    }

    for (const w of streetRetail.manualCheckWarningsRu) {
      if (!limiting.includes(w)) limiting.push(w);
    }

    if (
      streetRetail.frontageAccessibilityScore !== null &&
      streetRetail.strongStreetRetailAllowed
    ) {
      supporting.push('Входная группа и фронт подтверждены — поток может дойти до входа');
      if (streetRetail.frontageAccessibilityScore >= 70) {
        supporting.push('Хорошая видимость и доступность входа с улицы');
      }
    } else if (streetRetail.areaTargetFlowStrong) {
      supporting.push('В зоне есть целевой поток — нужна проверка входной группы на месте');
    }
  }

  const explain =
    streetRetail && !streetRetail.strongStreetRetailAllowed && streetRetail.areaTargetFlowStrong
      ? 'Рядом есть целевой поток, но без подтверждённой первой линии и входной группы ASI не даёт сильную рекомендацию по уличному ритейлу.'
      : fitLevel === 'high'
        ? 'Локация формирует устойчивый целевой поток и имеет нужные якоря. Хорошая база для розничного формата.'
        : fitLevel === 'medium'
          ? 'Потенциал есть, но поток смешан или якоря умеренные. Подходит при правильном позиционировании.'
          : fitLevel === 'low'
            ? 'Поток в основном транзитный или индекс невысокий. Розница возможна, но с ограниченным охватом.'
            : 'Локация слишком слабая для розничного формата без серьёзного обоснования.';

  return {
    format: 'retail',
    formatLabelRu: 'Розница (Retail)',
    fitLevel,
    explanationRu: explain,
    supportingFactorsRu: supporting,
    limitingFactorsRu: limiting,
  };
}

function scoreFoodBeverage(a: LocationAnalysis): CommercialFormatFitEntry {
  const { transitShare, destinationShare, localActiveShare } = a.footTraffic.transitVsTarget;
  const idx = a.evergreenIndex;
  const density = a.footTraffic.movementDensity;
  const hasBusinessOrUniv = hasMagnetCategory(a, 'business', 'university', 'shopping_major', 'entertainment');
  const hasTransit = hasMagnetCategory(a, 'metro', 'railway_station');
  const industrial = industrialBarrier(a);

  const supporting: string[] = [];
  const limiting: string[] = [];
  let fitLevel: CommercialFormatFitLevel;

  // F&B benefits from any significant flow — transit, local, or destination
  const totalFlow = transitShare + localActiveShare + destinationShare;
  const flowScore = (density === 'high' ? 3 : density === 'moderate' ? 2 : 1);

  if (
    idx >= 55 &&
    flowScore >= 2 &&
    (hasBusinessOrUniv || hasTransit) &&
    !industrial
  ) {
    fitLevel = 'high';
    if (density === 'high') supporting.push('Высокая плотность движения');
    if (hasTransit) supporting.push('Транзитный узел — стабильный поток');
    if (hasBusinessOrUniv) supporting.push('Деловой / образовательный якорь рядом');
    if (localActiveShare >= 0.30) supporting.push('Активная локальная аудитория');
  } else if (idx >= 38 && flowScore >= 1 && !industrial) {
    fitLevel = 'medium';
    if (density !== 'low') supporting.push('Умеренная проходимость');
    if (hasBusinessOrUniv) supporting.push('Есть рядом аудитория для обеда/кофе');
  } else if (idx >= 25 && !industrial) {
    fitLevel = 'low';
    if (density === 'low') limiting.push('Низкая плотность движения');
    if (idx < 38) limiting.push('Слабый общий индекс локации');
  } else {
    fitLevel = 'poor';
    limiting.push('Недостаточно проходимости для F&B без особой концепции');
  }

  if (industrial) limiting.push('Промышленное окружение не формирует аудиторию F&B');
  if (destinationShare < 0.20 && localActiveShare < 0.25 && fitLevel !== 'poor')
    limiting.push('Мало целевого и локального потока — конверсия будет низкой');

  const explain =
    fitLevel === 'high'
      ? 'Хорошая проходимость и якоря создают устойчивый спрос на кафе, кофейни, ресторан.'
      : fitLevel === 'medium'
        ? 'Поток умеренный — подходит для кофе-точки или небольшого формата с завтраками/обедами.'
        : fitLevel === 'low'
          ? 'Проходимость ограничена. F&B возможен как destination с чёткой концепцией.'
          : 'Слабая точка для F&B без выраженного трафика.';

  return {
    format: 'food_beverage',
    formatLabelRu: 'Кафе / F&B',
    fitLevel,
    explanationRu: explain,
    supportingFactorsRu: supporting,
    limitingFactorsRu: limiting,
  };
}

function scoreService(a: LocationAnalysis): CommercialFormatFitEntry {
  const { localActiveShare } = a.footTraffic.transitVsTarget;
  const idx = a.evergreenIndex;
  const dt: DemandType = a.demandType;
  const hasBusinessMagnet = hasMagnetCategory(a, 'business');
  const hasResidentialContext = localActiveShare >= 0.30;
  const industrial = industrialBarrier(a);

  const supporting: string[] = [];
  const limiting: string[] = [];
  let fitLevel: CommercialFormatFitLevel;

  if (
    idx >= 50 &&
    (hasResidentialContext || dt === 'business-led') &&
    !industrial
  ) {
    fitLevel = 'high';
    if (hasResidentialContext) supporting.push('Высокий локальный поток — постоянная аудитория');
    if (dt === 'business-led') supporting.push('Деловой спрос — сервисные услуги востребованы');
    if (hasBusinessMagnet) supporting.push('Деловые объекты рядом');
  } else if (idx >= 35 && !industrial) {
    fitLevel = 'medium';
    if (localActiveShare >= 0.20) supporting.push('Умеренный локальный поток');
    if (dt === 'mixed') supporting.push('Смешанная аудитория');
  } else if (idx >= 20) {
    fitLevel = 'low';
    if (localActiveShare < 0.20) limiting.push('Мало локальной аудитории для регулярного сервиса');
    if (idx < 35) limiting.push('Слабый индекс — невысокий стабильный трафик');
  } else {
    fitLevel = 'poor';
    limiting.push('Нет устойчивой аудитории для сервисного бизнеса');
  }

  if (industrial) limiting.push('Промышленное окружение снижает сервисный спрос');

  const explain =
    fitLevel === 'high'
      ? 'Локальный поток или деловая аудитория создают устойчивый спрос на сервис (барбершоп, химчистка, ремонт).'
      : fitLevel === 'medium'
        ? 'Аудитория есть, но поток умеренный. Сервисный формат возможен при хорошем позиционировании.'
        : fitLevel === 'low'
          ? 'Поток слабый или нелокальный. Сервис потребует активного привлечения клиентов.'
          : 'Точка не формирует базу для стабильного сервисного бизнеса.';

  return {
    format: 'service',
    formatLabelRu: 'Сервис / услуги',
    fitLevel,
    explanationRu: explain,
    supportingFactorsRu: supporting,
    limitingFactorsRu: limiting,
  };
}

function scoreConvenience(a: LocationAnalysis): CommercialFormatFitEntry {
  const { transitShare, localActiveShare, destinationShare } = a.footTraffic.transitVsTarget;
  const idx = a.evergreenIndex;
  const hasTransit = hasMagnetCategory(a, 'metro', 'railway_station');
  const density = a.footTraffic.movementDensity;
  const industrial = industrialBarrier(a);
  const dt: DemandType = a.demandType;

  // Tourist-dominant locations: sightseers don't buy daily essentials.
  // We exempt railway hubs only when they are genuinely transit-dominant (high
  // transitShare or explicitly transport-led demand type) — e.g. Gare du Nord,
  // Kursky. Tourist areas that merely have an adjacent suburban rail or Tube stop
  // (Nevsky, Covent Garden, Times Square) are NOT transit contexts and remain capped.
  const hasAttractionAnchor = hasMagnetCategory(a, 'attraction');
  const hasRailwayHub = hasMagnetCategory(a, 'railway_station');
  const railwayIsTransitContext =
    hasRailwayHub && (dt === 'transport-led' || transitShare >= 0.26);
  const touristCap = hasAttractionAnchor && !railwayIsTransitContext && destinationShare >= 0.50;

  const supporting: string[] = [];
  const limiting: string[] = [];
  let fitLevel: CommercialFormatFitLevel;

  // Convenience benefits from transit corridors and local activity
  const hasGoodFlow = (transitShare >= 0.35 || localActiveShare >= 0.35) && density !== 'low';

  if (
    idx >= 45 &&
    (hasTransit || hasGoodFlow) &&
    !industrial &&
    !touristCap
  ) {
    fitLevel = 'high';
    if (hasTransit) supporting.push('Транзитный узел рядом — стабильный импульсный спрос');
    if (transitShare >= 0.35) supporting.push('Высокий транзитный поток');
    if (localActiveShare >= 0.35) supporting.push('Активная локальная аудитория');
    if (density === 'high') supporting.push('Высокая плотность движения');
  } else if (idx >= 30 && !industrial) {
    fitLevel = 'medium';
    if (touristCap) {
      // Meaningful flow exists but it's tourist-driven, not daily-need driven
      supporting.push('Высокий поток в точке');
      limiting.push('Туристическая аудитория не формирует стабильный повседневный спрос');
    } else {
      if (density !== 'low') supporting.push('Умеренная плотность движения');
      if (localActiveShare >= 0.20) supporting.push('Есть локальная аудитория');
    }
  } else if (idx >= 20) {
    fitLevel = 'low';
    if (density === 'low') limiting.push('Низкая плотность движения');
    limiting.push('Слабая транзитная или локальная база');
  } else {
    fitLevel = 'poor';
    limiting.push('Нет достаточного потока для convenience-формата');
  }

  if (industrial) limiting.push('Промышленное окружение — мало жилой / рабочей аудитории рядом');
  if (dt === 'tourism-led' && !hasTransit)
    limiting.push('Туристический спрос нестабилен для повседневного convenience');

  const explain =
    fitLevel === 'high'
      ? 'Транзитная и локальная аудитория создают импульсный спрос — хорошая точка для магазина у дома или мини-маркета.'
      : fitLevel === 'medium'
        ? touristCap
          ? 'Высокий поток в точке, но аудитория преимущественно туристическая — не формирует стабильный повседневный спрос для convenience.'
          : 'Умеренный поток позволяет рассмотреть convenience при достаточном жилом контексте.'
        : fitLevel === 'low'
          ? 'Поток слабый. Формат возможен только при концентрированной жилой застройке рядом.'
          : 'Слабая точка для convenience — нет стабильного ежедневного трафика.';

  return {
    format: 'convenience',
    formatLabelRu: 'Магазин у дома / convenience',
    fitLevel,
    explanationRu: explain,
    supportingFactorsRu: supporting,
    limitingFactorsRu: limiting,
  };
}

function scoreShowroom(a: LocationAnalysis): CommercialFormatFitEntry {
  const { destinationShare, transitShare } = a.footTraffic.transitVsTarget;
  const idx = a.evergreenIndex;
  const hasAccessibility = hasMagnetCategory(a, 'metro', 'railway_station');
  const dt: DemandType = a.demandType;
  const industrial = industrialBarrier(a);
  const transportHeavy = transportCorridorHeavy(a);
  const hasBusinessCluster = a.audienceAnalysis?.businessClusterDetected ?? false;

  // Tourist-dominant: high destinationShare driven by attractions (museums, monuments,
  // parks) creates the wrong audience for considered-purchase or appointment formats.
  // We do NOT gate on businessClusterDetected here — dense urban areas always have
  // office buildings nearby, so businessClusterDetected fires even at Red Square or
  // the Eiffel Tower. Instead we rely on destinationShare >= 0.50 as the saturation
  // threshold (tourist flow dominates) plus the absence of an explicit business demand type.
  //
  // We use nearMagnets(350) instead of hasMagnetCategory: showroom viability depends
  // on the immediate-vicinity context. A memorial plaque or small heritage site 400 m
  // away does not define the block as a tourist zone for appointment-based visits.
  // Genuine tourist anchors (Red Square 169 m, Museum of Broadway 108 m, Covent
  // Garden 219 m) are always within 350 m of the destination; commercial strips like
  // Leningradsky auto-showrooms have their nearest attraction > 350 m away.
  const hasTouristAnchor = nearMagnets(a, 350, 'attraction');
  const touristDominant =
    hasTouristAnchor &&
    destinationShare >= 0.50 &&
    dt !== 'business-led';

  // Transit hub: locations whose primary context is transport throughput, not commerce.
  // We use dt==='transport-led' as the gate (explicit signal from the demand engine)
  // rather than raw transitShare, which overlaps with business districts that also
  // have significant rail throughput but are legitimately showroom-capable.
  // The !hasBusinessCluster guard keeps genuine business hubs (Canary Wharf,
  // Frankfurt Hbf area) out of this bucket — train stations don't have business clusters
  // but financial districts do, even when their Overpass demand type comes back
  // as transport-led due to their heavy DLR/rail usage.
  const isTransitHub =
    hasMagnetCategory(a, 'railway_station') &&
    dt === 'transport-led' &&
    !hasBusinessCluster;

  const supporting: string[] = [];
  const limiting: string[] = [];
  let fitLevel: CommercialFormatFitLevel;

  // Showroom needs: purposeful visitors, accessibility, business context.
  // HIGH requires explicit business context (demand type or cluster) — tourist-heavy
  // destinationShare does not qualify, even with metro and high ev.
  if (
    !touristDominant &&
    !isTransitHub &&
    idx >= 55 &&
    destinationShare >= 0.45 &&
    hasAccessibility &&
    (dt === 'business-led' || hasBusinessCluster) &&
    !industrial
  ) {
    fitLevel = 'high';
    supporting.push('Высокий целевой поток — клиенты приходят с намерением');
    supporting.push('Транспортная доступность');
    if (dt === 'business-led') supporting.push('Деловая аудитория — релевантна для B2B шоурумов');
    if (hasBusinessCluster) supporting.push('Деловой кластер в зоне');
  } else if (
    !touristDominant &&
    !isTransitHub &&
    idx >= 40 &&
    (destinationShare >= 0.33 || dt === 'business-led') &&
    !industrial
  ) {
    fitLevel = 'medium';
    if (destinationShare >= 0.33) supporting.push('Умеренный целевой поток');
    if (dt === 'business-led') supporting.push('Деловая аудитория');
    if (hasBusinessCluster) supporting.push('Деловой кластер рядом');
    if (!hasAccessibility) limiting.push('Ограниченная транспортная доступность');
  } else if (idx >= 28 && !isTransitHub) {
    // Tourist-dominant and other sub-threshold cases land here
    fitLevel = 'low';
    if (touristDominant) limiting.push('Туристический поток не конвертируется в аудиторию шоурума');
    if (transitShare > 0.5) limiting.push('Случайный транзит — не нужная аудитория для шоурума');
    if (!hasAccessibility) limiting.push('Нет метро / ж/д рядом — сложнее добраться');
    if (idx < 40) limiting.push('Слабый индекс — низкий целенаправленный трафик');
  } else {
    fitLevel = 'poor';
    if (isTransitHub)
      limiting.push('Транзитный хаб — пассажирский поток не является аудиторией шоурума');
    else
      limiting.push('Нет базы для appointment-based формата');
  }

  if (industrial) limiting.push('Промышленное окружение создаёт барьер восприятия бренда');
  if (transportHeavy && fitLevel !== 'poor')
    limiting.push('Перегруженные дороги рядом затрудняют парковку и доступ');

  const explain =
    fitLevel === 'high'
      ? 'Целевой поток, деловой контекст и доступность создают правильную базу для шоурума или appointment-based формата.'
      : fitLevel === 'medium'
        ? 'Умеренный потенциал — шоурум возможен, особенно при известности бренда или B2B-ориентации.'
        : fitLevel === 'low'
          ? touristDominant
            ? 'Высокий поток в точке — туристический. Посетители достопримечательностей не являются целевой аудиторией шоурума.'
            : 'Шоурум возможен, но потребует значительных усилий по привлечению — локация не работает «на себя».'
          : isTransitHub
            ? 'Транзитный хаб: проходимость высокая, но пассажирский поток не соответствует аудитории шоурума.'
            : 'Слабая точка для шоурума без целенаправленного потока.';

  return {
    format: 'showroom',
    formatLabelRu: 'Шоурум / appointment',
    fitLevel,
    explanationRu: explain,
    supportingFactorsRu: supporting,
    limitingFactorsRu: limiting,
  };
}

function scoreDestinationVenue(a: LocationAnalysis): CommercialFormatFitEntry {
  const { destinationShare } = a.footTraffic.transitVsTarget;
  const idx = a.evergreenIndex;
  const dt: DemandType = a.demandType;
  const hasMajorAnchor = hasMagnetCategory(a, 'shopping_major', 'attraction', 'stadium', 'convention', 'university');
  const hasTransit = hasMagnetCategory(a, 'metro', 'railway_station');
  const industrial = industrialBarrier(a);
  const cluster = a.gravityExplanation.clusterDetected;

  const supporting: string[] = [];
  const limiting: string[] = [];
  let fitLevel: CommercialFormatFitLevel;

  if (
    idx >= 68 &&
    destinationShare >= 0.50 &&
    (hasMajorAnchor || cluster) &&
    !industrial
  ) {
    fitLevel = 'high';
    supporting.push('Сильный целевой поток от якорных объектов');
    if (hasMajorAnchor) supporting.push('Крупный якорь формирует catchment-зону');
    if (cluster) supporting.push('Кластер притяжения — устойчивый спрос');
    if (hasTransit) supporting.push('Транспортная доступность для широкой аудитории');
  } else if (
    idx >= 50 &&
    (destinationShare >= 0.38 || dt === 'tourism-led') &&
    !industrial
  ) {
    fitLevel = 'medium';
    if (destinationShare >= 0.38) supporting.push('Умеренный целевой поток');
    if (dt === 'tourism-led') supporting.push('Туристический спрос');
    if (!hasMajorAnchor) limiting.push('Нет мощного якоря — catchment-зона ограничена');
  } else if (idx >= 35) {
    fitLevel = 'low';
    if (idx < 50) limiting.push('Слабый индекс — нет достаточного внешнего спроса');
    if (!hasTransit) limiting.push('Ограниченная транспортная доступность');
    limiting.push('Destination-формат требует мощных якорей или исключительной концепции');
  } else {
    fitLevel = 'poor';
    limiting.push('Нет фундамента для destination-формата');
  }

  if (industrial) limiting.push('Промышленное окружение несовместимо с destination-концепцией');

  const explain =
    fitLevel === 'high'
      ? 'Якорные объекты и сильный целевой поток формируют хорошую базу для destination-venue.'
      : fitLevel === 'medium'
        ? 'Потенциал есть при сильной концепции, но локация сама по себе не тянет destination-поток.'
        : fitLevel === 'low'
          ? 'Destination-формат возможен при уникальной концепции, но трафик придётся строить с нуля.'
          : 'Точка слишком слабая для destination-формата.';

  return {
    format: 'destination_venue',
    formatLabelRu: 'Destination / мероприятия',
    fitLevel,
    explanationRu: explain,
    supportingFactorsRu: supporting,
    limitingFactorsRu: limiting,
  };
}

// ── Overall verdict ───────────────────────────────────────────────────────────

function computeOverallVerdict(entries: CommercialFormatFitEntry[]): {
  verdict: CommercialOverallVerdict;
  labelRu: string;
} {
  const counts = { high: 0, medium: 0, low: 0, poor: 0 };
  for (const e of entries) counts[e.fitLevel]++;

  if (counts.high >= 3) return { verdict: 'strong', labelRu: 'Сильная коммерческая точка' };
  if (counts.high >= 1 || counts.medium >= 3)
    return { verdict: 'selective', labelRu: 'Точечный потенциал — формат важен' };
  if (counts.low >= 3)
    return { verdict: 'weak', labelRu: 'Слабый потенциал — высокий риск' };
  return { verdict: 'poor', labelRu: 'Не рекомендуется для коммерческого использования' };
}

// ── Public builder ────────────────────────────────────────────────────────────

export function buildCommercialFormatFit(
  analysis: LocationAnalysis,
  options?: { objectContext?: Record<string, unknown> | null },
): CommercialFormatFit {
  const streetRetailSuitability = evaluateStreetRetailSuitability(
    analysis,
    options?.objectContext,
  );
  const entries: CommercialFormatFitEntry[] = [
    scoreRetail(analysis, streetRetailSuitability),
    scoreFoodBeverage(analysis),
    scoreService(analysis),
    scoreConvenience(analysis),
    scoreShowroom(analysis),
    scoreDestinationVenue(analysis),
  ];

  const sf = analysis.spatialFoundation;
  if (sf?.enabled && sf.spatialTier === 'stub') {
    const stubLine =
      'Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте.';
    for (const e of entries) {
      e.limitingFactorsRu = [...e.limitingFactorsRu, stubLine];
    }
  }
  if (sf?.enabled && sf.barrierPenaltyApplied) {
    const barrierLine =
      'Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).';
    for (const e of entries) {
      e.limitingFactorsRu = [...e.limitingFactorsRu, barrierLine];
    }
  }

  const { verdict, labelRu } = computeOverallVerdict(entries);
  const bestFormats = entries
    .filter(e => e.fitLevel === 'high')
    .map(e => e.format)
    .concat(
      entries.filter(e => e.fitLevel === 'medium').map(e => e.format),
    )
    .slice(0, 2);

  const retailEntry = entries.find(e => e.format === 'retail');
  if (retailEntry) {
    for (const note of streetRetailSuitability.methodologyNotesRu) {
      if (!retailEntry.limitingFactorsRu.includes(note)) {
        retailEntry.limitingFactorsRu = [...retailEntry.limitingFactorsRu, note];
      }
    }
  }

  return {
    entries,
    overallVerdict: verdict,
    overallVerdictLabelRu: labelRu,
    bestFormats,
    streetRetailSuitability,
  };
}

export const FIT_LEVEL_LABEL_RU: Record<CommercialFormatFitLevel, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
  poor: 'Не подходит',
};

export const FIT_LEVEL_COLOR: Record<CommercialFormatFitLevel, string> = {
  high: 'text-emerald-400',
  medium: 'text-amber-400',
  low: 'text-orange-400',
  poor: 'text-slate-500',
};
