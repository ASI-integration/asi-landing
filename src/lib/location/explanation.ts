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

  if (locale === 'ru') {
    const splitNote = gravity.demandDistribution === 'split'
      ? ' Спрос распределён между несколькими зонами притяжения.'
      : gravity.clusterDetected
        ? ' Рядом сформирована зона устойчивого спроса.'
        : '';
    const compNote = gravity.competitorPressureLevel === 'high'
      ? ' Конкуренция высокая — важна упаковка и дифференциация объекта.'
      : gravity.competitorPressureLevel === 'medium'
        ? ' Конкуренция умеренная.'
        : '';

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
      return `${strongLabel}.${b2bNote} ${audienceDriver}${splitNote}${compNote}`.trim();
    }
    if (idx >= 45) {
      const note = audienceAnalysis?.primaryAudience === 'BUSINESS'
        ? 'Подходит для делового потока и командированных.'
        : !hasMetro && !hasBusiness
          ? 'Транспортная доступность — ключевой фактор усиления.'
          : audienceDriver;
      return `Рабочая локация. ${note}${splitNote}${compNote} Результат во многом определяется упаковкой и каналами продаж.`;
    }
    const weakNote = audienceAnalysis?.fallbackMode
      ? 'Деловых магнитов нет — ориентация на туристический сегмент.'
      : audienceAnalysis?.primaryAudience === 'BUSINESS'
        ? 'Деловые магниты есть, но далеко — поток командированных будет слабым.'
        : audienceDriver || 'Магниты вокруг ограничены.';
    return `${weakNote}${splitNote} Рекомендуется точечное позиционирование и проработка каналов продаж.`;
  }

  // ── English ──────────────────────────────────────────────────────────────────

  const splitNote = gravity.demandDistribution === 'split'
    ? ' Demand is spread across several attraction zones.'
    : gravity.clusterDetected
      ? ' A stable demand cluster sits nearby.'
      : '';

  const compNote = gravity.competitorPressureLevel === 'high'
    ? ' Competition is high — positioning and differentiation matter.'
    : gravity.competitorPressureLevel === 'medium'
      ? ' Competition is moderate.'
      : '';

  if (idx >= 70) {
    const driver = hasMetro
      ? 'Metro nearby drives a steady guest flow.'
      : hasAttractions
        ? 'Proximity to attractions supports consistent demand.'
        : 'A dense amenity mix keeps footfall active.';
    return `Strong short-term rental location. ${driver}${splitNote}${compNote}`;
  }

  if (idx >= 45) {
    const note = !hasMetro && !hasBusiness
      ? 'Transit access is the main lever to improve performance.'
      : 'The surroundings support moderate demand.';
    return `Workable location. ${note}${splitNote}${compNote} Results still depend heavily on positioning and distribution channels.`;
  }

  return `Nearby demand magnets are limited.${splitNote} Focus on niche positioning and channel mix.`;
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
