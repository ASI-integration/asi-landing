import type { MagnetItem, CompetitorItem, GravityExplanation, Band, ScoreBand } from './types';

// ── Score band (UI presentation) ──────────────────────────────────────────────

export function getBand(idx: number): Band {
  if (idx >= 70) return {
    label: 'Strong location',
    scoreBand: 'strong',
    textColor: 'text-emerald-400',
    stroke: '#34d399',
    border: 'border-emerald-700/40',
    bg: 'bg-emerald-900/10',
    bar: 'bg-emerald-500',
  };
  if (idx >= 45) return {
    label: 'Solid location',
    scoreBand: 'medium',
    textColor: 'text-amber-400',
    stroke: '#fbbf24',
    border: 'border-amber-700/40',
    bg: 'bg-amber-900/10',
    bar: 'bg-amber-500',
  };
  if (idx > 0) return {
    label: 'Needs strengthening',
    scoreBand: 'weak',
    textColor: 'text-rose-400',
    stroke: '#f87171',
    border: 'border-rose-700/40',
    bg: 'bg-rose-900/10',
    bar: 'bg-rose-500',
  };
  return {
    label: 'No data',
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

// ── Conclusion generator ──────────────────────────────────────────────────────

export function generateConclusion(
  idx: number,
  magnets: MagnetItem[],
  _competitors: CompetitorItem[],
  countByCategory: Record<string, number>,
  gravity: GravityExplanation,
  locale: 'en' | 'ru' = 'en',
): string {
  if (magnets.length === 0) return '';

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
    if (idx >= 70) {
      const driver = hasMetro
        ? 'Метро рядом — устойчивый поток гостей.'
        : hasAttractions
          ? 'Близость к достопримечательностям обеспечивает стабильный спрос.'
          : 'Насыщенное окружение создаёт постоянный трафик.';
      return `Сильная локация для посуточной аренды. ${driver}${splitNote}${compNote}`;
    }
    if (idx >= 45) {
      const note = !hasMetro && !hasBusiness
        ? 'Транспортная доступность — ключевой фактор усиления.'
        : 'Окружение поддерживает умеренный спрос.';
      return `Рабочая локация. ${note}${splitNote}${compNote} Результат во многом определяется упаковкой и каналами продаж.`;
    }
    return `Магниты вокруг ограничены.${splitNote} Рекомендуется точечное позиционирование и проработка каналов продаж.`;
  }

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
