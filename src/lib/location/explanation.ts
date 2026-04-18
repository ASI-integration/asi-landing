import type { MagnetItem, CompetitorItem, GravityExplanation, Band, ScoreBand, AudienceAnalysis, TargetAudience } from './types';

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

/** Short revenue-logic explanations per category (English) */
const MAGNET_REASON_EN: Record<string, string> = {
  airport:        'air hub — strong traveler flow, stable ADR',
  metro:          'metro access — reliable year-round guest flow',
  hospital:       'medical cluster — steady staff & visitor demand',
  major_hotel:    'quality signal — commercially validated location',
  railway_station: 'rail hub — stable transit and business demand',
  attraction:     'tourist anchor — consistent leisure demand',
  convention:     'conference hub — strong corporate demand spikes',
  university:     'education cluster — recurring semester demand',
  business:       'office district — corporate and workforce demand',
  stadium:        'event venue — periodic occupancy spikes',
  entertainment:  'entertainment anchor — leisure footfall driver',
  shopping_major: 'retail anchor — sustained visitor traffic',
};

/** Short revenue-logic explanations per category (Russian) */
const MAGNET_REASON_RU: Record<string, string> = {
  airport:        'аэропорт — мощный поток деловых и туристических гостей',
  metro:          'метро — стабильный круглогодичный поток',
  hospital:       'медкластер — стабильный поток персонала и посетителей',
  major_hotel:    'индикатор качества — коммерчески подтверждённая локация',
  railway_station: 'ж/д узел — устойчивый транспортный и деловой спрос',
  attraction:     'туристический якорь — постоянный досуговый спрос',
  convention:     'конгресс-центр — корпоративный спрос, деловые мероприятия',
  university:     'университет — сезонный и долгосрочный образовательный спрос',
  business:       'деловой кластер — корпоративный спрос, командированные',
  stadium:        'стадион / арена — периодические пики спроса в дни матчей',
  entertainment:  'развлекательный якорь — досуговый трафик',
  shopping_major: 'торговый центр — высокий поток посетителей',
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
  if (m.categoryId === 'business' && m.subType) {
    if (m.subType === 'industrial' || m.subType === 'factory') {
      return locale === 'ru'
        ? 'промзона — ограниченный спрос на STR'
        : 'industrial zone — limited STR demand';
    }
    if (m.subType === 'commercial') {
      return locale === 'ru'
        ? 'коммерческая зона — смешанный деловой профиль'
        : 'commercial zone — mixed demand profile';
    }
    // office_anon: honest about low signal quality
    if (m.subType === 'office_anon') {
      return locale === 'ru'
        ? 'офисная активность (слабый сигнал)'
        : 'office activity — weak signal';
    }
  }
  const REASONS = locale === 'ru' ? MAGNET_REASON_RU : MAGNET_REASON_EN;
  return REASONS[m.categoryId];
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
  const hasBusiness    = (countByCategory.business ?? 0) > 0;

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
    const audienceDriver = buildAudienceDriverRu(audienceAnalysis, nearestMetroM, hasAttractions, hasBusiness);

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
        : !hasMetro && !hasBusiness
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
    const note = !hasMetro && !hasBusiness
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
  hasBusiness: boolean,
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
    if (hasBusiness) {
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
