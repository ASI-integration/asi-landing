import type { LocationDecision, LocationEvidenceItem } from './location-decision-contract';
import type { AnalysisMeta, LocationAnalysis } from './types';
import {
  FREE_TOP_EVIDENCE_BULLETS_LIMIT,
  forbiddenFreeReportFields,
} from './report-scope-contract';
import { publicLocationScore } from './location-score-public';

export interface FreeLocationReportEvidenceBullet {
  name: string;
  category: string;
  distanceMeters: number;
  distanceLabel: string;
  shortReason?: string;
}

export interface FreeLocationReportCtaViewModel {
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export interface FreeLocationReportViewModel {
  address: string;
  calculatedAt?: string;
  dataFreshness?: string;
  publicScore: number | null;
  shortVerdict: string;
  topEvidenceBullets: FreeLocationReportEvidenceBullet[];
  shortRecommendation: string;
  paidReportTeaser: string;
  cta: FreeLocationReportCtaViewModel;
}

export interface BuildFreeLocationReportViewModelInput {
  address?: string | null;
  calculatedAt?: string | null;
  dataFreshness?: string | null;
  meta?: Pick<AnalysisMeta, 'updatedAt' | 'freshness' | 'cached' | 'refreshing'> | null;
  analysis?: Partial<LocationAnalysis> | null;
  decision?: LocationDecision | null;
  shortRecommendation?: string | null;
  paidReportTeaser?: string | null;
  cta?: Partial<FreeLocationReportCtaViewModel> | null;
}

const DEFAULT_SHORT_VERDICT_RU =
  'Предварительный вывод готов. Для решения по объекту нужен полный разбор.';

const DEFAULT_SHORT_RECOMMENDATION_RU =
  'Используйте общий вывод как первый фильтр. Перед покупкой, арендой или запуском проверьте конкуренцию, риски и экономику в подробном отчёте.';

const DEFAULT_PAID_REPORT_TEASER_RU =
  'В подробном отчёте доступны конкуренты, риски, стратегия запуска и прогноз развития района.';

const DEFAULT_CTA: FreeLocationReportCtaViewModel = {
  primaryLabel: 'Перейти к подробному отчёту',
  primaryHref: '/login',
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function finiteDistance(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function formatDistanceRu(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} м` : `${(meters / 1000).toFixed(1)} км`;
}

function metaFreshness(meta: BuildFreeLocationReportViewModelInput['meta']): string | undefined {
  if (!meta) return undefined;
  if (meta.refreshing && meta.freshness === 'stale') return 'updating';
  if (meta.cached && meta.freshness === 'fresh') return 'cached';
  return meta.freshness;
}

function resolveDecision(input: BuildFreeLocationReportViewModelInput): LocationDecision | null {
  return input.decision ?? input.analysis?.locationDecision ?? null;
}

function resolvePublicScore(
  analysis: BuildFreeLocationReportViewModelInput['analysis'],
  decision: LocationDecision | null,
): number | null {
  const score =
    decision?.publicSummary?.finalScore ??
    decision?.finalScore ??
    decision?.uiProjection?.publicScore ??
    null;
  if (typeof score === 'number' && Number.isFinite(score)) return Math.round(score);
  if (analysis?.locationScore || analysis?.scoringTrace) {
    return Math.round(publicLocationScore(analysis as LocationAnalysis));
  }
  return null;
}

function evidenceKey(evidence: LocationEvidenceItem): string {
  return `${evidence.evidenceId}:${evidence.objectName}:${Math.round(evidence.distanceMeters)}`;
}

function toBullet(evidence: LocationEvidenceItem): FreeLocationReportEvidenceBullet | null {
  const name = cleanText(evidence.objectName);
  const category = cleanText(evidence.typeRu);
  const distanceMeters = finiteDistance(evidence.distanceMeters);
  if (!name || !category || distanceMeters == null) return null;

  const shortReason = cleanText(evidence.publicExplanationRu);
  return {
    name,
    category,
    distanceMeters,
    distanceLabel: formatDistanceRu(distanceMeters),
    ...(shortReason ? { shortReason } : {}),
  };
}

function buildEvidenceBullets(decision: LocationDecision | null): FreeLocationReportEvidenceBullet[] {
  if (!decision?.evidenceItems?.length) return [];

  const byEvidenceId = new Map(decision.evidenceItems.map(e => [e.evidenceId, e]));
  const claimEvidenceIds = [
    ...(decision.publicSummary?.publicDrivers ?? []).map(row => row.trace.evidenceId),
    ...(decision.publicClaims ?? []).map(claim => claim.trace.evidenceId),
  ];
  const orderedEvidence = claimEvidenceIds
    .map(id => byEvidenceId.get(id))
    .filter((item): item is LocationEvidenceItem => Boolean(item));

  const fallbackEvidence = decision.evidenceItems
    .filter(item => item.objectName && Number.isFinite(item.distanceMeters))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const seen = new Set<string>();
  const bullets: FreeLocationReportEvidenceBullet[] = [];
  for (const evidence of [...orderedEvidence, ...fallbackEvidence]) {
    const key = evidenceKey(evidence);
    if (seen.has(key)) continue;
    seen.add(key);
    const bullet = toBullet(evidence);
    if (!bullet) continue;
    bullets.push(bullet);
    if (bullets.length >= FREE_TOP_EVIDENCE_BULLETS_LIMIT.max) break;
  }
  return bullets;
}

function assertNoForbiddenTopLevelFields(viewModel: FreeLocationReportViewModel): void {
  for (const field of forbiddenFreeReportFields) {
    if (Object.prototype.hasOwnProperty.call(viewModel, field)) {
      throw new Error(`Free report renderer exposed forbidden field: ${field}`);
    }
  }
}

export function buildFreeLocationReportViewModel(
  input: BuildFreeLocationReportViewModelInput,
): FreeLocationReportViewModel {
  const decision = resolveDecision(input);
  const cta: FreeLocationReportCtaViewModel = {
    primaryLabel: cleanText(input.cta?.primaryLabel) ?? DEFAULT_CTA.primaryLabel,
    primaryHref: cleanText(input.cta?.primaryHref) ?? DEFAULT_CTA.primaryHref,
    ...(cleanText(input.cta?.secondaryLabel)
      ? { secondaryLabel: cleanText(input.cta?.secondaryLabel) }
      : {}),
    ...(cleanText(input.cta?.secondaryHref)
      ? { secondaryHref: cleanText(input.cta?.secondaryHref) }
      : {}),
  };
  const shortRecommendation =
    cleanText(input.shortRecommendation) ??
    cleanText(decision?.publicSummary?.recommendedStrategyBulletsRu?.[0]) ??
    DEFAULT_SHORT_RECOMMENDATION_RU;

  const viewModel: FreeLocationReportViewModel = {
    address: cleanText(input.address) ?? cleanText(decision?.inputAddress) ?? '',
    ...(cleanText(input.calculatedAt) ?? cleanText(input.meta?.updatedAt)
      ? { calculatedAt: cleanText(input.calculatedAt) ?? cleanText(input.meta?.updatedAt) }
      : {}),
    ...(cleanText(input.dataFreshness) ?? metaFreshness(input.meta)
      ? { dataFreshness: cleanText(input.dataFreshness) ?? metaFreshness(input.meta) }
      : {}),
    publicScore: resolvePublicScore(input.analysis, decision),
    shortVerdict:
      cleanText(decision?.publicSummary?.audienceVerdictRu) ??
      cleanText(decision?.uiProjection?.heroTitle) ??
      cleanText((input.analysis as LocationAnalysis | null | undefined)?.conclusion) ??
      DEFAULT_SHORT_VERDICT_RU,
    topEvidenceBullets: buildEvidenceBullets(decision),
    shortRecommendation,
    paidReportTeaser: cleanText(input.paidReportTeaser) ?? DEFAULT_PAID_REPORT_TEASER_RU,
    cta,
  };

  assertNoForbiddenTopLevelFields(viewModel);
  return viewModel;
}
