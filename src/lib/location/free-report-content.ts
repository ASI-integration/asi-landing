const MAX_FREE_REPORT_SIGNALS = 4;

export const FREE_REPORT_RECOMMENDATION_RU =
  'Предварительная оценка видит часть факторов. Для решения по объекту нужен полный анализ карты, конкурентов и сценариев запуска.';

export const FREE_REPORT_STRONG_ANCHOR_RECOMMENDATION_RU =
  'Есть сильный фактор спроса: транспорт, порт, медицина, бизнес или промышленность. Полный отчёт покажет, как это влияет на аренду, коммерцию и риски.';

export const FREE_REPORT_CITY_STRATEGIC_RECOMMENDATION_SUFFICIENT_RU =
  'Локация выглядит перспективной для сценария с деловым и командировочным спросом. В полном отчёте будет видно, как это влияет на аренду, конкуренцию, коммерческий потенциал и риски.';

export const FREE_REPORT_CITY_STRATEGIC_RECOMMENDATION_INSUFFICIENT_RU =
  'По адресу не хватает данных для уверенного вывода. Полный отчёт уточнит локальные факторы: транспорт, конкурентов, формат запуска и риски.';

/** @deprecated Use sufficient/insufficient variants via `free-report-renderer`. */
export const FREE_REPORT_CITY_STRATEGIC_RECOMMENDATION_RU = FREE_REPORT_CITY_STRATEGIC_RECOMMENDATION_INSUFFICIENT_RU;

export const FREE_REPORT_CTA_TITLE_RU = 'Хотите понять, стоит ли заходить в объект?';

export const FREE_REPORT_CTA_TEXT_RU =
  'Подробный отчёт добавит конкурентов, экономику, цену, риски, транспорт, коммерческий потенциал и рекомендации по запуску.';

export const FREE_REPORT_PAID_PREVIEW_ITEMS_RU = [
  'Подробная конкуренция',
  'Расчёт доходности и цены',
  'Коммерческий и пешеходный потенциал',
] as const;

export const FREE_REPORT_LIMITATIONS_RU = [
  'Экономика и ставка аренды доступны только в полном отчёте.',
  'Конкуренция рядом не разобрана подробно.',
  'Пешеходный и коммерческий трафик оценён только предварительно.',
] as const;

type FactorKind =
  | 'medical'
  | 'metro'
  | 'transport'
  | 'education'
  | 'business'
  | 'tourism'
  | 'services'
  | 'residential'
  | 'generic';

type ParsedFactor = {
  raw: string;
  kind: FactorKind;
  distanceMeters: number | null;
  fallbackText?: string;
};

export interface FreeReportCommercialPreview {
  leadRu: string;
  itemsRu: string[];
}

export interface FreeReportInterpretedContent {
  summaryReasonRu: string;
  demandSignalsRu: string[];
  risksAndLimitationsRu: string[];
  commercialPreview: FreeReportCommercialPreview;
  paidPreviewItemsRu: string[];
  recommendationRu: string;
  ctaTitleRu: string;
  ctaTextRu: string;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseDistanceMeters(value: string): number | null {
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(км|м)(?=\s|$|[—.,;:)])/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  return match[2].toLowerCase() === 'км' ? Math.round(amount * 1000) : Math.round(amount);
}

function formatDistanceRu(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} км`;
}

function formatDistanceRangeRu(distances: number[]): string | null {
  const valid = distances.filter(value => Number.isFinite(value) && value >= 0);
  if (!valid.length) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (Math.abs(max - min) < 25) return formatDistanceRu(min);
  if (max < 1000) return `${Math.round(min / 10) * 10}–${Math.round(max / 10) * 10} м`;
  if (min >= 1000) {
    return `${(min / 1000).toFixed(1).replace('.', ',')}–${(max / 1000).toFixed(1).replace('.', ',')} км`;
  }
  return `${formatDistanceRu(min)}–${formatDistanceRu(max)}`;
}

function factorKind(value: string): FactorKind {
  const text = value.toLowerCase();
  if (/метро/.test(text)) return 'metro';
  if (/мед|больниц|клиник|госпитал|поликлиник|аптек/.test(text)) return 'medical';
  if (/транспорт|порт|логист|вокзал|станци|аэропорт|останов|мцд|автобус|ж\/д|железн/.test(text)) return 'transport';
  if (/универс|институт|школ|образован|вуз/.test(text)) return 'education';
  if (/бизнес|офис|делов|промышлен|технопарк/.test(text)) return 'business';
  if (/турис|достопр|музе|театр|парк|событ|досуг/.test(text)) return 'tourism';
  if (/сервис|магазин|торгов|тц|молл|инфраструкт|кафе|ресторан|городск|локальн/.test(text)) return 'services';
  if (/жил|двор|дом|спальн|район/.test(text)) return 'residential';
  return 'generic';
}

function baseFactorText(kind: FactorKind, distances: number[]): string {
  const distance = formatDistanceRangeRu(distances);
  const suffix = distance ? `: около ${distance}.` : '.';

  if (kind === 'medical') return `Медицинские учреждения рядом${suffix}`;
  if (kind === 'metro') return `Метро в пешей доступности${suffix}`;
  if (kind === 'transport') return `Транспорт рядом${suffix}`;
  if (kind === 'education') return `Учебные учреждения рядом${suffix}`;
  if (kind === 'business') return `Деловая инфраструктура рядом${suffix}`;
  if (kind === 'tourism') return `Точки досуга и событий рядом${suffix}`;
  if (kind === 'services') return `Городская инфраструктура рядом${suffix}`;
  if (kind === 'residential') return `Жилая среда рядом${suffix}`;
  return `Сильные объекты спроса рядом${suffix}`;
}

function demandSignalText(kind: FactorKind, distances: number[]): string {
  const distance = formatDistanceRangeRu(distances);
  const distancePart = distance ? ` Ориентир по карте: около ${distance}.` : '';

  if (kind === 'metro') {
    return `Метро в пешей доступности: объект проще продвигать для гостей без автомобиля.${distancePart}`;
  }
  if (kind === 'medical') {
    return `Медицинские учреждения рядом: возможен спрос от пациентов, сопровождающих и командировочных.${distancePart}`;
  }
  if (kind === 'transport') {
    return `Транспортные узлы рядом: адрес удобнее рассматривать для коротких поездок и командировок.${distancePart}`;
  }
  if (kind === 'education') {
    return `Учебные учреждения рядом: возможен дополнительный спрос от семей, абитуриентов и приезжающих специалистов.${distancePart}`;
  }
  if (kind === 'business') {
    return `Деловая инфраструктура рядом: возможен спрос от командировочных и сотрудников компаний.${distancePart}`;
  }
  if (kind === 'tourism') {
    return `Точки досуга рядом: адрес может быть удобен для коротких городских поездок.${distancePart}`;
  }
  if (kind === 'services') {
    return `Повседневная инфраструктура рядом: гостям проще закрывать бытовые задачи без долгих поездок.${distancePart}`;
  }
  if (kind === 'residential') {
    return `Жилая среда рядом: подходит для спокойного размещения, но нужно проверить конкуренцию.${distancePart}`;
  }
  return `Окружение даёт первичные сигналы спроса: адрес стоит проверять вместе с конкуренцией и экономикой.${distancePart}`;
}

function fallbackFactorText(raw: string): string | null {
  const cleaned = cleanText(raw)
    .replace(/\s*—\s*/g, ' — ')
    .replace(/\s*·\s*/g, ' · ');
  if (!cleaned) return null;

  const distance = parseDistanceMeters(cleaned);
  const kind = factorKind(cleaned);
  if (cleaned.includes('·') && distance != null) return baseFactorText(kind, [distance]);
  if (/·.*·.*—.*—/.test(cleaned)) return baseFactorText(kind, distance == null ? [] : [distance]);
  return cleaned;
}

function parseFactor(rawFactor: string): ParsedFactor | null {
  const raw = cleanText(rawFactor);
  if (!raw) return null;

  const parts = raw.split('·').map(cleanText).filter(Boolean);
  if (parts.length >= 3) {
    const [name, category, ...rest] = parts;
    const tail = rest.join(' · ');
    const distanceMeters = parseDistanceMeters(tail) ?? parseDistanceMeters(raw);
    return {
      raw,
      kind: factorKind(`${name} ${category}`),
      distanceMeters,
    };
  }

  return {
    raw,
    kind: factorKind(raw),
    distanceMeters: parseDistanceMeters(raw),
    fallbackText: fallbackFactorText(raw) ?? undefined,
  };
}

function parsedFactors(rawFactors: string[]): ParsedFactor[] {
  const parsed: ParsedFactor[] = [];
  const seenRawFacts = new Set<string>();

  for (const rawFactor of rawFactors) {
    const factor = parseFactor(rawFactor);
    if (!factor) continue;

    const key = `${factor.kind}:${factor.distanceMeters ?? 'no-distance'}:${factor.raw.toLowerCase()}`;
    if (seenRawFacts.has(key)) continue;
    seenRawFacts.add(key);
    parsed.push(factor);
  }

  return parsed;
}

function groupedDistances(parsed: ParsedFactor[]): Map<FactorKind, number[]> {
  const grouped = new Map<FactorKind, number[]>();
  for (const factor of parsed) {
    const distances = grouped.get(factor.kind) ?? [];
    if (factor.distanceMeters != null) distances.push(factor.distanceMeters);
    grouped.set(factor.kind, distances);
  }
  return grouped;
}

function isInterpretedFreeSignal(text: string): boolean {
  return /^(Метро в пешей доступности|Медицинские учреждения рядом|Транспортные узлы рядом|Учебные учреждения рядом|Деловая инфраструктура рядом|Точки досуга рядом|Повседневная инфраструктура рядом|Жилая среда рядом|Окружение даёт первичные сигналы спроса):/.test(text);
}

export function normalizeFreeReportFactors(rawFactors: string[]): string[] {
  const parsed = parsedFactors(rawFactors);
  const grouped = groupedDistances(parsed);
  const out: string[] = [];
  const seenText = new Set<string>();

  for (const factor of parsed) {
    if (out.length >= MAX_FREE_REPORT_SIGNALS) break;
    const text = factor.fallbackText && isInterpretedFreeSignal(factor.fallbackText)
      ? factor.fallbackText
      : demandSignalText(factor.kind, grouped.get(factor.kind) ?? []);
    if (seenText.has(text)) continue;
    seenText.add(text);
    out.push(text);
  }

  return out;
}

function summarySignalLabels(kinds: Set<FactorKind>): string {
  const labels: string[] = [];
  if (kinds.has('metro') || kinds.has('transport')) labels.push('транспорт');
  if (kinds.has('medical')) labels.push('медицинские объекты');
  if (kinds.has('business')) labels.push('деловая инфраструктура');
  if (kinds.has('services')) labels.push('повседневная инфраструктура');
  if (kinds.has('education')) labels.push('учебные учреждения');
  if (kinds.has('tourism')) labels.push('точки досуга');
  if (kinds.has('residential')) labels.push('жилую среду');

  if (!labels.length) return 'видны только базовые картографические сигналы';
  if (labels.length === 1) return `рядом есть ${labels[0]}`;
  return `рядом есть ${labels.slice(0, -1).join(', ')} и ${labels[labels.length - 1]}`;
}

function scorePotentialLabel(score: number | null | undefined): string {
  if (score == null) return 'предварительный';
  if (score >= 75) return 'хороший';
  if (score >= 50) return 'умеренный';
  return 'ограниченный';
}

function buildSummaryReason(rawFactors: string[], score: number | null | undefined): string {
  const kinds = new Set(parsedFactors(rawFactors).map(factor => factor.kind));
  return `Локация имеет ${scorePotentialLabel(score)} потенциал: ${summarySignalLabels(kinds)}, но для точного вывода нужны данные по конкуренции, спросу и сценарию запуска.`;
}

function hasStrongFreeReportSignal(rawFactors: string[]): boolean {
  return parsedFactors(rawFactors).some(factor =>
    factor.kind === 'transport' ||
    factor.kind === 'medical' ||
    factor.kind === 'business' ||
    factor.raw.toLowerCase().includes('портово-логист'),
  );
}

function commercialLabel(kind: FactorKind): string | null {
  if (kind === 'services') return 'магазины и повседневные сервисы';
  if (kind === 'business') return 'офисы и деловая инфраструктура';
  if (kind === 'medical') return 'клиники и медицинские объекты';
  if (kind === 'metro' || kind === 'transport') return 'станции и транспортные узлы';
  if (kind === 'education') return 'учебные учреждения';
  if (kind === 'tourism') return 'точки досуга и городские маршруты';
  return null;
}

function buildCommercialPreview(rawFactors: string[]): FreeReportCommercialPreview {
  const labels = parsedFactors(rawFactors)
    .map(factor => commercialLabel(factor.kind))
    .filter((label): label is string => Boolean(label));
  const uniqueLabels = Array.from(new Set(labels)).slice(0, 3);

  if (!uniqueLabels.length) {
    return {
      leadRu: 'Предварительный сигнал коммерческой активности',
      itemsRu: ['Коммерческий потенциал в бесплатной версии виден ограниченно: для вывода нужны данные по потоку, формату запуска и конкурентам.'],
    };
  }

  return {
    leadRu: 'Предварительный сигнал коммерческой активности',
    itemsRu: [
      `Возможен дополнительный спрос за счёт повседневной активности рядом: ${uniqueLabels.join(', ')}.`,
      'Это не оценка реального пешеходного трафика: для решения нужен подробный разбор.',
    ],
  };
}

export function buildFreeReportInterpretedContent(args: {
  evidenceBullets: string[];
  score?: number | null;
}): FreeReportInterpretedContent {
  const recommendationRu = hasStrongFreeReportSignal(args.evidenceBullets)
    ? FREE_REPORT_STRONG_ANCHOR_RECOMMENDATION_RU
    : FREE_REPORT_RECOMMENDATION_RU;
  return {
    summaryReasonRu: buildSummaryReason(args.evidenceBullets, args.score),
    demandSignalsRu: normalizeFreeReportFactors(args.evidenceBullets),
    risksAndLimitationsRu: [...FREE_REPORT_LIMITATIONS_RU],
    commercialPreview: buildCommercialPreview(args.evidenceBullets),
    paidPreviewItemsRu: [...FREE_REPORT_PAID_PREVIEW_ITEMS_RU],
    recommendationRu,
    ctaTitleRu: FREE_REPORT_CTA_TITLE_RU,
    ctaTextRu: FREE_REPORT_CTA_TEXT_RU,
  };
}
