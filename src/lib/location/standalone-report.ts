import type { LocationAnalysis, RecommendedStrategy, SpatialTier } from './types';
import type { CommercialFormatFitEntry, CommercialOverallVerdict } from './commercial-format-fit';
import { buildCommercialFormatFit } from './commercial-format-fit';
import { createDisabledSpatialFoundation } from './spatial-foundation';
import {
  filterResidentialPrimeMagnets,
  type PrimeMagnetAnchorType,
  type ResidentialMarketMode,
} from './residential-prime-magnets';
import {
  buildFullLocationReport,
  locationReportInputFromLegacy,
  type UnifiedLocationReport,
} from './unified-report';

export type LocationStandaloneReportSectionId =
  | 'summary'
  | 'business_fit'
  | 'magnets'
  | 'competition'
  | 'income_strategy'
  | 'next_step';

export type LocationStandaloneReport = {
  version: 'v1';
  address: string;
  generated_at_iso: string;
  unifiedReport?: UnifiedLocationReport;
  sections: Array<
    | {
        id: 'summary';
        verdict: string;
        drivers: string[];
        income_rub_month: number | null;
        recommended_strategy: RecommendedStrategy | null;
      }
    | {
        id: 'business_fit';
        business_fit_verdict: 'fit' | 'not_fit' | 'unknown';
        primary_magnets: Array<{ title: string; distance_m: number; anchor_type?: PrimeMagnetAnchorType }>;
        note: string | null;
      }
    | {
        id: 'magnets';
        primary: Array<{
          category_id: string;
          name: string;
          distance_m: number;
          anchor_type: PrimeMagnetAnchorType;
          anchor_label_ru: string;
          category_label_ru: string;
        }>;
        secondary: Array<{
          category_id: string;
          name: string;
          distance_m: number;
          anchor_type: PrimeMagnetAnchorType;
          anchor_label_ru: string;
          category_label_ru: string;
        }>;
        /** Present when no prime magnets passed the residential filter. */
        no_magnets_note?: string;
      }
    | {
        id: 'competition';
        competitor_count: number;
        pressure_level: LocationAnalysis['gravityExplanation']['competitorPressureLevel'];
      }
    | {
        id: 'income_strategy';
        recommended_strategy: RecommendedStrategy | null;
        monthly_income_rub: {
          short_term: number | null;
          hybrid: number | null;
          mid_term: number | null;
        };
        positioning_hint: string | null;
      }
    | {
        id: 'next_step';
        cta: 'get_full_breakdown';
      }
  >;
};

// ── Commercial standalone report ─────────────────────────────────────────────

export type LocationCommercialReport = {
  version: 'v2-commercial';
  address: string;
  generated_at_iso: string;
  unifiedReport?: UnifiedLocationReport;
  flow: {
    transitShare: number;
    localActiveShare: number;
    destinationShare: number;
    flowCharacter: string;
    modifierTier: string;
    flowConclusion: string;
  };
  formatFit: {
    overallVerdict: CommercialOverallVerdict;
    overallVerdictLabelRu: string;
    entries: Array<{
      format: string;
      formatLabelRu: string;
      fitLevel: 'high' | 'medium' | 'low' | 'poor';
      explanationRu: string;
      supportingFactorsRu: string[];
      limitingFactorsRu: string[];
    }>;
  };
  /** Spatial foundation v1 — explainability + UI tier (new reports always include this). */
  spatial?: {
    spatial_tier: SpatialTier;
    enabled: boolean;
    barrier_penalty_applied: boolean;
    corridor_snap_m: number | null;
    distance_inflation_m: number;
    barrier_kinds: string[];
    geometric_confidence_note_ru: string;
  };
  anchors: Array<{ categoryId: string; name: string; distance_m: number; icon: string }>;
  barriers: string[];
  competition: {
    competitor_count: number;
    pressure_level: 'low' | 'medium' | 'high';
  };
  recommendation: string;
};

export type PersistableLocationReport = LocationStandaloneReport | LocationCommercialReport;

/**
 * Canonical sellable report payloads must be versioned persisted reports.
 * Legacy /report/[id] generator output has no version field and must never
 * pass this guard as a commercial/location report.
 */
export function isCanonicalLocationReportPayload(x: any): x is PersistableLocationReport {
  return isLocationStandaloneReportV1(x) || isLocationCommercialReport(x);
}

export function isLocationCommercialReport(x: any): x is LocationCommercialReport {
  return Boolean(
    x &&
    x.version === 'v2-commercial' &&
    typeof x.address === 'string' &&
    typeof x.generated_at_iso === 'string' &&
    x.flow &&
    x.formatFit,
  );
}

function buildFlowConclusion(args: {
  transitShare: number;
  localActiveShare: number;
  destinationShare: number;
}): string {
  const { transitShare, localActiveShare, destinationShare } = args;
  if (destinationShare >= 0.45)
    return 'У точки есть сильный целевой поток — люди приходят сюда намеренно.';
  if (transitShare >= 0.50)
    return 'В локации преобладает транзитный поток — высокая проходимость, но низкая задерживаемость.';
  if (localActiveShare >= 0.40)
    return 'Активная локальная аудитория — жители и работающие рядом.';
  return 'Поток смешанный: часть людей проходит транзитом, часть приходит целенаправленно.';
}

function buildBarriersRu(analysis: LocationAnalysis): string[] {
  const barriers: string[] = [];
  const env = analysis.neighborhoodEnvironment;
  if ((env.breakdown.industrial01 ?? 0) > 0.4)
    barriers.push('Промышленная инфраструктура снижает потребительский контекст');
  if ((env.breakdown.majorRoads01 ?? 0) > 0.55)
    barriers.push('Перегруженные магистрали затрудняют пешеходный подход');
  if ((env.breakdown.nightlife01 ?? 0) > 0.45)
    barriers.push('Ночная активность — возможные конфликты формата');
  if ((env.breakdown.aviation01 ?? 0) > 0.4)
    barriers.push('Близость авиационных объектов (шум)');
  if (analysis.gravityExplanation.competitorPressureLevel === 'high')
    barriers.push('Высокая конкурентная плотность');
  return barriers;
}

function buildCommercialRecommendation(
  verdict: CommercialOverallVerdict,
  entries: CommercialFormatFitEntry[],
): string {
  const highFormats = entries.filter(e => e.fitLevel === 'high').map(e => e.formatLabelRu);
  const mediumFormats = entries.filter(e => e.fitLevel === 'medium').map(e => e.formatLabelRu);

  if (verdict === 'strong') {
    return `Сильная коммерческая точка. Форматы с высоким потенциалом: ${highFormats.join(', ')}. Подходит для запуска при правильном позиционировании.`;
  }
  if (verdict === 'selective') {
    const best = [...highFormats, ...mediumFormats].slice(0, 2);
    return `Точечный потенциал: выбор формата критичен. Приоритет: ${best.join(', ')}. Остальные форматы несут повышенный риск.`;
  }
  if (verdict === 'weak') {
    return 'Слабая коммерческая локация. Требует глубокого анализа концепции и целевой аудитории перед запуском.';
  }
  return 'Локация не рекомендуется для коммерческого использования без существенного обоснования.';
}

export function buildCommercialReport(args: {
  address: string;
  analysis: LocationAnalysis;
}): LocationCommercialReport {
  const { analysis } = args;
  const generatedAtIso = new Date().toISOString();
  const unifiedReport = buildFullLocationReport(
    locationReportInputFromLegacy({
      address: args.address,
      locale: 'ru',
      mode: 'commercial',
      requestedAtIso: generatedAtIso,
    }),
    { analysis, generatedAtIso },
  );
  const ft = analysis.footTraffic;
  const { transitShare, localActiveShare, destinationShare } = ft.transitVsTarget;
  const formatFit = buildCommercialFormatFit(analysis);

  const anchors = (analysis.strongestMagnets ?? []).slice(0, 5).map(m => ({
    categoryId: m.categoryId,
    name: m.name,
    distance_m: Math.round(m.distance),
    icon: m.icon,
  }));

  const sf = args.analysis.spatialFoundation ?? createDisabledSpatialFoundation();

  return {
    version: 'v2-commercial',
    address: args.address,
    generated_at_iso: generatedAtIso,
    unifiedReport,
    spatial: {
      spatial_tier: sf.spatialTier,
      enabled: sf.enabled,
      barrier_penalty_applied: sf.barrierPenaltyApplied,
      corridor_snap_m: sf.corridorSnapM,
      distance_inflation_m: sf.distanceInflationM,
      barrier_kinds: sf.barrierKindsDetected,
      geometric_confidence_note_ru: sf.geometricConfidenceNoteRu,
    },
    flow: {
      transitShare: Math.round(transitShare * 100) / 100,
      localActiveShare: Math.round(localActiveShare * 100) / 100,
      destinationShare: Math.round(destinationShare * 100) / 100,
      flowCharacter: ft.flowCharacter,
      modifierTier: ft.modifierTier,
      flowConclusion: buildFlowConclusion({ transitShare, localActiveShare, destinationShare }),
    },
    formatFit: {
      overallVerdict: formatFit.overallVerdict,
      overallVerdictLabelRu: formatFit.overallVerdictLabelRu,
      entries: formatFit.entries,
    },
    anchors,
    barriers: buildBarriersRu(analysis),
    competition: {
      competitor_count: analysis.competitors.length,
      pressure_level: analysis.gravityExplanation.competitorPressureLevel,
    },
    recommendation: buildCommercialRecommendation(formatFit.overallVerdict, formatFit.entries),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function isLocationStandaloneReportV1(x: any): x is LocationStandaloneReport {
  return Boolean(
    x &&
    x.version === 'v1' &&
    typeof x.address === 'string' &&
    typeof x.generated_at_iso === 'string' &&
    Array.isArray(x.sections),
  );
}

function strategyTitleRu(s: RecommendedStrategy): string {
  if (s === 'short_term') return 'Посуточная аренда (деловой фокус)';
  if (s === 'hybrid') return 'Гибрид (посуточно + среднесрок)';
  return 'Среднесрочная аренда';
}

function pickBusinessFitVerdict(
  analysis: LocationAnalysis,
  primeMagnets: ReturnType<typeof filterResidentialPrimeMagnets>,
): {
  business_fit_verdict: 'fit' | 'not_fit' | 'unknown';
  note: string | null;
} {
  const aa = analysis.audienceAnalysis;
  if (!aa) return { business_fit_verdict: 'unknown', note: null };

  // Use policy-filtered prime magnets (within 1.5 km) for business-fit determination
  const hasPrimaryAccess = primeMagnets.some(m => m.distance <= 1500);

  if (aa.primaryAudience === 'BUSINESS' && hasPrimaryAccess) {
    return { business_fit_verdict: 'fit', note: 'Подходит для делового потока и командированных.' };
  }

  if (aa.primaryAudience === 'BUSINESS' && !hasPrimaryAccess) {
    return {
      business_fit_verdict: 'not_fit',
      note: 'Деловой сценарий возможен, но первостепенные магниты слишком далеко (≥ 1.5 км).',
    };
  }

  return { business_fit_verdict: 'not_fit', note: 'По сигналам окружения деловой сценарий не доминирует.' };
}


export function buildLocationStandaloneReport(args: {
  address: string;
  analysis: LocationAnalysis;
  verdict: string;
  /** Market mode for prime magnet selection. Defaults to 'RU'. */
  market?: ResidentialMarketMode;
}): LocationStandaloneReport {
  const { analysis } = args;
  const generatedAtIso = new Date().toISOString();
  const market = args.market ?? 'RU';
  const unifiedReport = buildFullLocationReport(
    locationReportInputFromLegacy({
      address: args.address,
      locale: market === 'RU' ? 'ru' : 'en',
      mode: 'residential',
      requestedAtIso: generatedAtIso,
    }),
    { analysis, generatedAtIso, market },
  );
  const score = analysis.locationScore;
  const drivers = (score?.top_positive_factors ?? []).slice(0, 3);

  const recommended = score?.recommended_strategy ?? null;
  const incomeRecommended =
    score && recommended
      ? (recommended === 'short_term'
          ? score.estimated_monthly_income.short_term
          : recommended === 'mid_term'
            ? score.estimated_monthly_income.mid_term
            : score.estimated_monthly_income.hybrid)
      : null;

  // ── Residential prime magnets (policy-filtered) ───────────────────────────
  // Apply the closed allowlist + distance + persistence + market rules.
  // Primary: top 3 by default; secondary: items 4–5 (hard max 5 total).
  const primeMagnets = filterResidentialPrimeMagnets(analysis.magnets, {
    market,
    defaultTop: 3,
    hardMax: 5,
  });
  const primaryPrime = primeMagnets.slice(0, 3);
  const secondaryPrime = primeMagnets.slice(3, 5);

  // Business-fit section: use prime-filtered magnets within 1.5 km
  const businessFit = pickBusinessFitVerdict(analysis, primeMagnets);
  const primaryMagnetRows = primaryPrime.map(m => ({
    title: `${m.categoryLabelRu}: ${m.name}`,
    distance_m: Math.round(m.distance),
    anchor_type: m.anchorType,
  }));

  const toMagnetRow = (m: (typeof primeMagnets)[number]) => ({
    category_id: m.categoryId,
    name: m.name,
    distance_m: Math.round(m.distance),
    anchor_type: m.anchorType,
    anchor_label_ru: m.anchorLabelRu,
    category_label_ru: m.categoryLabelRu,
  });

  return {
    version: 'v1',
    address: args.address,
    generated_at_iso: generatedAtIso,
    unifiedReport,
    sections: [
      {
        id: 'summary',
        verdict: args.verdict,
        drivers,
        income_rub_month: incomeRecommended,
        recommended_strategy: recommended,
      },
      {
        id: 'business_fit',
        business_fit_verdict: businessFit.business_fit_verdict,
        primary_magnets: primaryMagnetRows,
        note: businessFit.note,
      },
      {
        id: 'magnets',
        primary: primaryPrime.map(toMagnetRow),
        secondary: secondaryPrime.map(toMagnetRow),
        no_magnets_note:
          primeMagnets.length === 0
            ? 'В радиусе 1 км не обнаружено prime-магнитов, отвечающих требованиям устойчивого спроса.'
            : undefined,
      },
      {
        id: 'competition',
        competitor_count: analysis.competitors.length,
        pressure_level: analysis.gravityExplanation.competitorPressureLevel,
      },
      {
        id: 'income_strategy',
        recommended_strategy: recommended,
        monthly_income_rub: {
          short_term: score?.estimated_monthly_income.short_term ?? null,
          hybrid: score?.estimated_monthly_income.hybrid ?? null,
          mid_term: score?.estimated_monthly_income.mid_term ?? null,
        },
        positioning_hint: recommended ? `Рекомендуемая стратегия: ${strategyTitleRu(recommended)}.` : null,
      },
      { id: 'next_step', cta: 'get_full_breakdown' },
    ],
  };
}

