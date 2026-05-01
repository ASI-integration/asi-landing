import type { MagnetItem, CompetitorItem, GravityExplanation, Band, ScoreBand, AudienceAnalysis, TargetAudience } from './types';
import {
  hasCredibleBusinessAnchors,
  classifyMagnetSignal,
  hasCredibleTouristAnchors,
  hasCredibleMedicalAnchors,
  hasCredibleEducationAnchors,
  hasCredibleHospitalityCluster,
  looksLikeWeakLocalAttractionPoi,
  getMustSurfaceAnchors,
} from './signals/location-signal-taxonomy';
import { classifyCanonicalMagnet, type CanonicalMagnetType } from './canonical/magnet-registry';

// ── Score band (UI presentation) ──────────────────────────────────────────────

/**
 * Map evergreenIndex to a Band descriptor.
 *
 * When `audience` is supplied the strong-tier label is rendered in Russian,
 * naming the dominant audience type:
 *   BUSINESS → "Сильная деловая локация"
 *   TOURIST  → "Сильная туристическая локация"
 * Omit `audience` to get the neutral English label.
 */
export function getBand(idx: number, audience?: TargetAudience): Band {
  const strongLabel =
    audience === 'BUSINESS' ? 'Сильная локация для командированных'
    : audience === 'TOURIST' ? 'Сильная туристическая локация'
    : 'Strong location';

  if (idx >= 70) return {
    label: strongLabel,
    scoreBand: 'strong',
    textColor: 'text-emerald-400',
    stroke: '#34d399',
    border: 'border-emerald-700/40',
    bg: 'bg-emerald-900/10',
    bar: 'bg-emerald-500',
  };
  if (idx >= 45) return {
    label: audience ? 'Хорошая локация' : 'Solid location',
    scoreBand: 'medium',
    textColor: 'text-amber-400',
    stroke: '#fbbf24',
    border: 'border-amber-700/40',
    bg: 'bg-amber-900/10',
    bar: 'bg-amber-500',
  };
  if (idx > 0) return {
    label: audience ? 'Слабая локация' : 'Needs optimization',
    scoreBand: 'weak',
    textColor: 'text-yellow-400',
    stroke: '#facc15',
    border: 'border-yellow-700/40',
    bg: 'bg-yellow-900/10',
    bar: 'bg-yellow-500',
  };
  return {
    label: audience ? 'Нет данных' : 'No data',
    scoreBand: 'none',
    textColor: 'text-slate-400',
    stroke: '#475569',
    border: 'border-slate-700/40',
    bg: 'bg-slate-900/10',
    bar: 'bg-slate-600',
  };
}

export function bandFromScoreBand(scoreBand: ScoreBand): Band {
  const map: Record<ScoreBand, Band> = {
    strong: getBand(70),
    medium: getBand(45),
    weak:   getBand(1),
    none:   getBand(0),
  };
  return map[scoreBand];
}

// ── Distance formatting ───────────────────────────────────────────────────────

function fmRu(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10}м` : `${(m / 1000).toFixed(1)}км`;
}

// ── Accessibility verdicts (strict thresholds) ────────────────────────────────

type AccessVerdict = 'пешая доступность' | 'умеренная доступность' | 'не пешая доступность';

export function accessVerdictRu(distanceMeters: number): AccessVerdict {
  if (distanceMeters <= 800) return 'пешая доступность';
  if (distanceMeters <= 1500) return 'умеренная доступность';
  return 'не пешая доступность';
}

function nearestDistance(magnets: MagnetItem[], categoryId: string): number | null {
  let best = Infinity;
  for (const m of magnets) {
    if (m.categoryId !== categoryId) continue;
    if (Number.isFinite(m.distance) && m.distance < best) best = m.distance;
  }
  return Number.isFinite(best) ? best : null;
}

// ── Revenue-connected magnet reason lines ─────────────────────────────────────

type FamilyReasonMap = Readonly<Record<CanonicalMagnetType, string>>;

/** Short revenue-logic explanations per canonical magnet family (English) */
const MAGNET_REASON_EN_BY_FAMILY: FamilyReasonMap = {
  railway_station: 'rail hub — stable transit and business demand',
  metro_station: 'metro access — reliable year-round guest flow',
  transport_hub: 'major transit hub — high recurring flow',
  airport: 'air hub — strong traveler flow, stable ADR',
  port: 'port/terminal — mixed trade and passenger flow',
  industrial_anchor: 'industrial anchor — workforce-driven demand (mixed context)',
  industrial_zone: 'industrial zone — limited STR demand (mixed context)',
  business_center: 'business center — corporate and workforce demand',
  office_cluster: 'office cluster — recurring corporate demand',
  hospital: 'medical anchor — steady staff & visitor demand',
  medical_cluster: 'medical cluster — steady staff & visitor demand',
  university: 'education cluster — recurring semester demand',
  shopping_mall: 'retail anchor — sustained visitor traffic',
  park: 'park — lifestyle and family context (not a tier-1 anchor by itself)',
  beach: 'beach — leisure context (seasonality depends on market)',
  waterfront: 'waterfront — leisure context (seasonality depends on market)',
  resort_area: 'resort area — leisure demand (seasonality depends on market)',
  stadium: 'stadium — periodic occupancy spikes',
  event_venue: 'event venue — periodic occupancy spikes',
  cultural_landmark: 'cultural landmark — leisure demand context',
  museum: 'museum — leisure demand context',
  theater: 'theater — leisure demand context',
  tourist_attraction: 'tourist attraction — leisure demand context',
  hotel_cluster: 'hotel cluster — confirms commercial viability',
  residential_density: 'residential density — local demand context',
  weak_amenity: 'local amenity — weak context signal',
  tertiary_local_amenity: 'local amenity — weak context signal',
};

/** Short revenue-logic explanations per canonical magnet family (Russian) */
const MAGNET_REASON_RU_BY_FAMILY: FamilyReasonMap = {
  railway_station: 'ж/д узел — устойчивый транспортный и деловой спрос',
  metro_station: 'метро — стабильный круглогодичный поток',
  transport_hub: 'крупный транспортный узел — устойчивый поток',
  airport: 'аэропорт — мощный поток деловых и туристических гостей',
  port: 'порт/терминал — смешанный пассажирский/грузовой контекст',
  industrial_anchor: 'промышленный якорь — спрос от занятости (смешанный контекст)',
  industrial_zone: 'промзона — ограниченный спрос на STR (смешанный контекст)',
  business_center: 'деловой центр — корпоративный спрос, командированные',
  office_cluster: 'офисный кластер — повторяющийся деловой спрос',
  hospital: 'медкластер — стабильный поток персонала и посетителей',
  medical_cluster: 'медкластер — стабильный поток персонала и посетителей',
  university: 'университет — сезонный и долгосрочный образовательный спрос',
  shopping_mall: 'торговый центр — высокий поток посетителей',
  park: 'парк — семейный/лайфстайл контекст (не Tier‑1 сам по себе)',
  beach: 'пляж — досуговый контекст (сезонность зависит от рынка)',
  waterfront: 'набережная — досуговый контекст (сезонность зависит от рынка)',
  resort_area: 'курортная зона — досуговый спрос (сезонность зависит от рынка)',
  stadium: 'стадион — периодические пики спроса',
  event_venue: 'площадка мероприятий — периодические пики спроса',
  cultural_landmark: 'культурный объект — досуговый контекст',
  museum: 'музей — досуговый контекст',
  theater: 'театр — досуговый контекст',
  tourist_attraction: 'туристический объект — досуговый контекст',
  hotel_cluster: 'кластер отелей — подтверждение коммерческой состоятельности зоны',
  residential_density: 'жилая плотность — локальный контекст',
  weak_amenity: 'локальная инфраструктура — слабый сигнал',
  tertiary_local_amenity: 'локальная инфраструктура — слабый сигнал',
};

/**
 * Priority order for picking which magnets to reference in the conclusion.
 * Categories that directly drive occupancy and ADR come first.
 */
const CONCLUSION_PRIORITY = [
  'airport', 'metro', 'hospital', 'major_hotel', 'railway_station',
  'convention', 'attraction', 'university', 'business', 'stadium',
  'entertainment', 'shopping_major',
] as const;

/**
 * Pick the top 2 magnets worth naming in the conclusion, in priority order.
 * Weak categories (food, shopping_local, education_local) are excluded.
 */
function pickTopDrivers(magnets: MagnetItem[]): MagnetItem[] {
  const out: MagnetItem[] = [];
  const usedCats = new Set<string>();

  // Anchor recall contract: must-surface anchors (credible airport / railway /
  // CBD metro / business center / hospital / university / attraction / mall)
  // always lead the drivers list. They cannot be displaced by weaker POIs.
  const mustSurface = getMustSurfaceAnchors(magnets);
  for (const m of mustSurface) {
    if (out.length >= 2) break;
    if (usedCats.has(m.categoryId)) continue;
    out.push(m);
    usedCats.add(m.categoryId);
  }
  if (out.length >= 2) return out;

  // Pre-compute best attraction score so we can deprioritise hospital
  // when tourist anchors clearly dominate (e.g. Kremlin museums vs distant
  // military-medical office).
  const bestAttractionScore = Math.max(
    0,
    ...magnets
      .filter(m => m.categoryId === 'attraction' && m.strengthClass !== 'weak')
      .map(m => m.attractionScore),
  );

  for (const cat of CONCLUSION_PRIORITY) {
    if (out.length >= 2) break;
    const best = magnets
      .filter(m => {
        if (m.strengthClass === 'weak') return false;
        if (m.categoryId !== cat) return false;
        // Domain anchor validity: weak/local POIs (corporate museum, small clinic,
        // school/kindergarten, single small hotel, civic office, mini-market) must
        // never appear in the strong-driver sentence even if their strengthClass
        // is medium — the per-domain taxonomy is authoritative.
        const tax = classifyMagnetSignal(m);
        if (tax.level === 'weak_local_signal' || tax.publicClaimStrength === 'hidden_from_public_copy') return false;
        if (cat === 'airport') {
          if (m.attractionScore >= 3.8) return true;
          return m.distance <= 2200 && m.attractionScore >= 2;
        }
        // Skip hospital when a significantly stronger tourist anchor exists.
        // Prevents "medical cluster 960m away" from overshadowing museums at 12m.
        if (cat === 'hospital' && bestAttractionScore > 0 && m.attractionScore < bestAttractionScore * 0.65) return false;
        // Same threshold as hotelNote: marginal hotels don't belong in the drivers sentence.
        if (cat === 'major_hotel' && m.attractionScore < 3.0 && m.distance > 550) return false;
        return true;
      })
      .sort((a, b) => b.attractionScore - a.attractionScore)[0];
    if (best && !usedCats.has(cat)) {
      out.push(best);
      usedCats.add(cat);
    }
  }
  return out;
}

function fmDist(m: number, locale: 'en' | 'ru'): string {
  if (locale === 'ru') {
    return m < 1000 ? `${Math.round(m / 10) * 10}м` : `${(m / 1000).toFixed(1)}км`;
  }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Resolve a per-magnet reason line, with subType overrides for business magnets */
function getMagnetReason(m: MagnetItem, locale: 'en' | 'ru'): string | undefined {
  const c = classifyCanonicalMagnet({ magnet: m });
  const reasons = locale === 'ru' ? MAGNET_REASON_RU_BY_FAMILY : MAGNET_REASON_EN_BY_FAMILY;
  return reasons[c.family];
}

/** Build a concise "key drivers" sentence from the top magnets */
function buildDriversLine(magnets: MagnetItem[], locale: 'en' | 'ru'): string {
  const top = pickTopDrivers(magnets);
  if (top.length === 0) return '';
  const parts = top.map(m => {
    const dist = fmDist(m.distance, locale);
    const reason = getMagnetReason(m, locale);
    return reason
      ? `${m.name} (${dist}) — ${reason}`
      : `${m.name} (${dist})`;
  });
  return parts.join('; ');
}

// ── Conclusion generator ──────────────────────────────────────────────────────

export function generateConclusion(
  idx: number,
  magnets: MagnetItem[],
  _competitors: CompetitorItem[],
  countByCategory: Record<string, number>,
  gravity: GravityExplanation,
  locale: 'en' | 'ru' = 'en',
  audienceAnalysis?: AudienceAnalysis,
): string {
  if (magnets.length === 0) return '';

  const nearestMetroM = nearestDistance(magnets, 'metro');
  const hasMetro       = (countByCategory.metro ?? 0) > 0;
  const hasAttractions = (countByCategory.attraction ?? 0) > 0;
  const hasBusinessAnchors = hasCredibleBusinessAnchors(magnets);

  const driversLine = buildDriversLine(magnets, locale);

  const splitNote = gravity.demandDistribution === 'split'
    ? (locale === 'ru' ? ' Спрос распределён между несколькими зонами притяжения.' : ' Demand is spread across several attraction zones.')
    : gravity.clusterDetected
      ? (locale === 'ru' ? ' Рядом сформирована зона устойчивого спроса.' : ' A stable demand cluster sits nearby.')
      : '';

  const compNote = gravity.competitorPressureLevel === 'high'
    ? (locale === 'ru' ? ' Конкуренция высокая — важна упаковка и дифференциация объекта.' : ' Competition is high — positioning and differentiation matter.')
    : gravity.competitorPressureLevel === 'medium'
      ? (locale === 'ru' ? ' Конкуренция умеренная.' : ' Competition is moderate.')
      : '';

  // Hotel note: only fire when the hotel is genuinely close OR a strong contributor.
  // A distant or borderline-chain match should not produce "commercially validated" copy.
  const bestHotel = magnets
    .filter(m => m.categoryId === 'major_hotel')
    .sort((a, b) => b.attractionScore - a.attractionScore)[0];
  const hotelIsSignificant = bestHotel != null && (
    bestHotel.distance <= 550 || bestHotel.attractionScore >= 3.0
  );
  const hotelNote = hotelIsSignificant
    ? (locale === 'ru'
      ? ' Наличие крупного отеля рядом — подтверждение коммерческой состоятельности зоны.'
      : ' A major hotel nearby confirms this as a commercially viable area.')
    : '';

  if (locale === 'ru') {
    // Audience-specific driver line
    const audienceDriver = buildAudienceDriverRu(audienceAnalysis, nearestMetroM, hasAttractions, hasBusinessAnchors);

    // Domain anchor validity: never emit a "Сильная …" verdict unless at least
    // one credible anchor (business / tourist / medical / education /
    // hospitality cluster) backs it. Weak-only contexts (corporate museum,
    // small clinic, school, single small hotel, civic, mini-market) get the
    // moderate fallback wording.
    const hasAnyCredibleAnchor =
      hasBusinessAnchors ||
      hasCredibleTouristAnchors(magnets) ||
      hasCredibleMedicalAnchors(magnets) ||
      hasCredibleEducationAnchors(magnets) ||
      hasCredibleHospitalityCluster(magnets);

    if (idx >= 70 && !hasAnyCredibleAnchor) {
      const hasWeakAttraction = magnets.some(looksLikeWeakLocalAttractionPoi);
      const fallback = hasWeakAttraction
        ? 'Есть отдельный культурный объект рядом, но сильный туристический поток не подтверждён.'
        : 'Есть отдельные сигналы спроса рядом, но крупный якорь не подтверждён.';
      const driverPart = driversLine ? ` Сигналы: ${driversLine}.` : '';
      return `${fallback}${driverPart}${hotelNote}${splitNote}${compNote}`.trim();
    }

    if (idx >= 70) {
      const strongLabel =
        audienceAnalysis?.primaryAudience === 'BUSINESS' ? 'Сильная локация для командированных'
        : audienceAnalysis?.primaryAudience === 'TOURIST' ? 'Сильная туристическая локация'
        : 'Сильная локация для посуточной аренды';
      const b2bNote =
        audienceAnalysis?.primaryAudience === 'BUSINESS'
          ? ' Подходит для делового потока и командированных.'
          : '';
      const driverPart = driversLine ? ` Ключевые драйверы: ${driversLine}.` : ` ${audienceDriver}`;
      return `${strongLabel}.${b2bNote}${driverPart}${hotelNote}${splitNote}${compNote}`.trim();
    }
    if (idx >= 45) {
      const note = audienceAnalysis?.primaryAudience === 'BUSINESS'
        ? 'Подходит для делового потока и командированных.'
        : !hasMetro && !hasBusinessAnchors
          ? 'Транспортная доступность — ключевой фактор усиления.'
          : audienceDriver;
      const driverPart = driversLine ? ` Ближайшие магниты: ${driversLine}.` : '';
      return `Рабочая локация. ${note}${driverPart}${hotelNote}${splitNote}${compNote} Результат во многом определяется упаковкой и каналами продаж.`.trim();
    }
    const weakNote = audienceAnalysis?.fallbackMode
      ? 'Деловых магнитов нет — ориентация на туристический сегмент.'
      : audienceAnalysis?.primaryAudience === 'BUSINESS'
        ? 'Деловые магниты есть, но далеко — поток командированных будет слабым.'
        : audienceDriver || 'Значимых магнитов вокруг не обнаружено.';
    const driverPart = driversLine ? ` Найденные сигналы: ${driversLine}.` : '';
    return `${weakNote}${driverPart}${splitNote} Рекомендуется точечное позиционирование и проработка каналов продаж.`.trim();
  }

  // ── English ──────────────────────────────────────────────────────────────────

  if (idx >= 70) {
    const driverPart = driversLine
      ? `Supported by ${driversLine}.`
      : hasMetro
        ? 'Metro nearby drives a steady guest flow.'
        : hasAttractions
          ? 'Proximity to attractions supports consistent demand.'
          : 'A dense amenity mix keeps footfall active.';
    return `Strong short-term rental location. ${driverPart}${hotelNote}${splitNote}${compNote}`.trim();
  }

  if (idx >= 45) {
    const note = !hasMetro && !hasBusinessAnchors
      ? 'Transit access is the main lever to improve performance.'
      : 'The surroundings support moderate demand.';
    const driverPart = driversLine ? ` Key nearby drivers: ${driversLine}.` : '';
    return `Workable location. ${note}${driverPart}${hotelNote}${splitNote}${compNote} Results still depend heavily on positioning and distribution channels.`.trim();
  }

  const driverPart = driversLine ? ` Weak signals found: ${driversLine}.` : '';
  return `Nearby demand magnets are limited.${driverPart}${splitNote} Focus on niche positioning and channel mix.`.trim();
}

// ── Russian audience driver builder ──────────────────────────────────────────

function buildAudienceDriverRu(
  audienceAnalysis: AudienceAnalysis | undefined,
  nearestMetroM: number | null,
  hasAttractions: boolean,
  hasBusinessAnchors: boolean,
): string {
  if (!audienceAnalysis) {
    // Fallback when audienceAnalysis is not available
    if (nearestMetroM != null) {
      const acc = accessVerdictRu(nearestMetroM);
      if (acc === 'пешая доступность') return 'Метро в пешей доступности — это усиливает спрос без зависимости от такси.';
      if (acc === 'умеренная доступность') return 'Метро на умеренном удалении — гости чаще используют транспорт/такси.';
      return `Метро далеко (${fmRu(nearestMetroM)}) — пешая доступность отсутствует.`;
    }
    return hasAttractions
      ? 'Близость к достопримечательностям обеспечивает стабильный спрос.'
      : 'Насыщенное окружение создаёт постоянный трафик.';
  }

  const { primaryAudience, primaryMagnets, fallbackMode, demandFlowLabel } = audienceAnalysis;

  // ── BUSINESS dominant ──────────────────────────────────────────────────────
  if (primaryAudience === 'BUSINESS') {
    const topBusiness = primaryMagnets.find(m => m.type === 'business');

    if (topBusiness && topBusiness.distance <= 500) {
      return `Рядом ${topBusiness.name} (${fmRu(topBusiness.distance)}) — ${demandFlowLabel}.`;
    }
    if (topBusiness) {
      return `Деловой поток: ${topBusiness.name} (${fmRu(topBusiness.distance)}) — ${demandFlowLabel}.`;
    }
    if (hasBusinessAnchors) {
      return `Деловое окружение — ${demandFlowLabel}.`;
    }
    if (nearestMetroM != null) {
      const acc = accessVerdictRu(nearestMetroM);
      const base = `Метро: ${fmRu(nearestMetroM)} — ${acc}.`;
      return `${base} Деловая аудитория — ${demandFlowLabel}.`;
    }
    return `Деловая аудитория — ${demandFlowLabel}.`;
  }

  // ── TOURIST dominant ───────────────────────────────────────────────────────
  const topTourist = primaryMagnets.find(m => m.type === 'tourist');

  if (fallbackMode) {
    if (topTourist) {
      return `Деловых магнитов нет — туристический поток: рядом ${topTourist.name} (${fmRu(topTourist.distance)}).`;
    }
    return 'Деловых магнитов нет — акцент на туристический и транзитный поток.';
  }

  if (topTourist) {
    return `Близость к ${topTourist.name} (${fmRu(topTourist.distance)}) обеспечивает туристический спрос.`;
  }

  if (nearestMetroM != null) {
    const acc = accessVerdictRu(nearestMetroM);
    if (acc === 'пешая доступность') return 'Метро в пешей доступности — это усиливает спрос.';
    if (acc === 'умеренная доступность') return 'Метро на умеренном удалении — часть гостей будет добираться на транспорте.';
    return `Метро далеко (${fmRu(nearestMetroM)}) — пешая доступность отсутствует.`;
  }
  return 'Насыщенное окружение создаёт постоянный трафик.';
}
