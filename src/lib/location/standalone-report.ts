import type { LocationAnalysis, MagnetItem, RecommendedStrategy } from './types';

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
        primary_magnets: Array<{ title: string; distance_m: number }>;
        note: string | null;
      }
    | {
        id: 'magnets';
        primary: Array<{ category_id: string; name: string; distance_m: number }>;
        secondary: Array<{ category_id: string; name: string; distance_m: number }>;
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

function pickBusinessFitVerdict(analysis: LocationAnalysis): {
  business_fit_verdict: 'fit' | 'not_fit' | 'unknown';
  note: string | null;
} {
  const aa = analysis.audienceAnalysis;
  if (!aa) return { business_fit_verdict: 'unknown', note: null };

  const primary = analysis.strongestMagnets ?? [];
  const hasPrimaryAccess = primary.some(m => m.distance <= 1500);

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

function asPrimaryMagnetTitleRu(m: MagnetItem): string {
  if (m.categoryId === 'metro') return `Метро: ${m.name}`;
  if (m.categoryId === 'railway_station') return `Транспортный узел: ${m.name}`;
  if (m.categoryId === 'business') return `Деловой магнит: ${m.name}`;
  return `${m.categoryLabel}: ${m.name}`;
}

export function buildLocationStandaloneReport(args: {
  address: string;
  analysis: LocationAnalysis;
  verdict: string;
}): LocationStandaloneReport {
  const { analysis } = args;
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

  const businessFit = pickBusinessFitVerdict(analysis);
  const primaryMagnets = (analysis.strongestMagnets ?? []).slice(0, 3);
  const primaryMagnetRows = primaryMagnets.map(m => ({ title: asPrimaryMagnetTitleRu(m), distance_m: m.distance }));

  const secondary = analysis.magnets
    .filter(m => !primaryMagnets.some(p => p.categoryId === m.categoryId && p.name === m.name))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  return {
    version: 'v1',
    address: args.address,
    generated_at_iso: new Date().toISOString(),
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
        primary: primaryMagnets.map(m => ({ category_id: m.categoryId, name: m.name, distance_m: m.distance })),
        secondary: secondary.map(m => ({ category_id: m.categoryId, name: m.name, distance_m: m.distance })),
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

