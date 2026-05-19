import type { LocationDecision, LocationEvidenceItem } from './location-decision-contract';
import type { AnalysisMeta, LocationAnalysis } from './types';
import {
  FREE_TOP_EVIDENCE_BULLETS_LIMIT,
  forbiddenFreeReportFields,
} from './report-scope-contract';
import { publicLocationScore } from './location-score-public';
import {
  FREE_LOCATION_REPORT_CTA,
  FREE_PAID_REPORT_TEASER_RU,
  buildLocationReportStructureViewModel,
  type LocationReportStructureViewModel,
} from './location-report-structure';
import {
  FREE_REPORT_RECOMMENDATION_RU,
  FREE_REPORT_STRONG_ANCHOR_RECOMMENDATION_RU,
  FREE_REPORT_CITY_STRATEGIC_RECOMMENDATION_RU,
} from './free-report-content';
import { isCityLevelStrategicAnchor } from './location-evidence-anchor';
import { CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID } from './location-public-summary';

export interface FreeLocationReportEvidenceBullet {
  name: string;
  category: string;
  distanceMeters: number | null;
  distanceLabel: string | null;
  shortReason?: string;
  isCityLevelStrategic?: boolean;
}

export interface FreeLocationReportCtaViewModel {
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export interface FreeLocationReportViewModel {
  structure: LocationReportStructureViewModel;
  address: string;
  calculatedAt?: string;
  dataFreshness?: string;
  publicScore: number | null;
  publicScoreLabelRu?: string | null;
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
  FREE_REPORT_RECOMMENDATION_RU;

const DEFAULT_PAID_REPORT_TEASER_RU =
  FREE_PAID_REPORT_TEASER_RU;

const DEFAULT_CTA: FreeLocationReportCtaViewModel = {
  primaryLabel: FREE_LOCATION_REPORT_CTA.primaryLabel,
  primaryHref: FREE_LOCATION_REPORT_CTA.primaryHref,
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
  if (isCityLevelStrategicAnchor(evidence)) {
    return `city-strategic:${evidence.factId}`;
  }
  const name = (evidence.objectName ?? '')
    .toLowerCase()
    .replace(/(?:^|\s)(?:гбуз|фгбу|фгбуз|гбу|мбуз|ооо|ао|пао)(?=\s|$)/g, ' ')
    .replace(/\b(?:ккод|код)\b/g, ' ')
    .replace(/краев(?:ой|ого)|городск(?:ой|ая|ого)|клиническ(?:ий|ая|ого)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const distBucket =
    evidence.distanceMeters != null && Number.isFinite(evidence.distanceMeters)
      ? Math.round(evidence.distanceMeters / 100)
      : 'no-distance';
  return `${evidence.typeRu.toLowerCase().trim()}:${name}:${distBucket}`;
}

function toBullet(evidence: LocationEvidenceItem): FreeLocationReportEvidenceBullet | null {
  const name = cleanText(evidence.objectName);
  const category = cleanText(evidence.typeRu);
  if (!name || !category) return null;

  const shortReason = cleanText(evidence.publicExplanationRu);
  if (isCityLevelStrategicAnchor(evidence)) {
    return {
      name,
      category,
      distanceMeters: null,
      distanceLabel: null,
      isCityLevelStrategic: true,
      shortReason: shortReason ?? name,
    };
  }

  const distanceMeters = finiteDistance(evidence.distanceMeters);
  if (distanceMeters == null) return null;

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
    .filter(
      item =>
        item.objectName &&
        (isCityLevelStrategicAnchor(item) ||
          (Number.isFinite(item.distanceMeters) && (item.distanceMeters ?? 0) > 0)),
    )
    .sort((a, b) => {
      if (isCityLevelStrategicAnchor(a)) return -1;
      if (isCityLevelStrategicAnchor(b)) return 1;
      const da = a.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      const db = b.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

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

function recommendationForDecision(decision: LocationDecision | null): string {
  if (decision?.dataIntegrity?.scoreBlockedDueToIncompleteData || decision?.dataIntegrity?.analysisIncomplete) {
    return FREE_REPORT_RECOMMENDATION_RU;
  }
  const hasCityLevelStrategic = Boolean(
    decision?.publicSummary?.presentationDiagnostics?.hasCityLevelStrategicAnchor ||
      decision?.evidenceItems?.some(isCityLevelStrategicAnchor) ||
      decision?.magnetFacts?.some(
        mf => mf.id === CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID || isCityLevelStrategicAnchor(mf),
      ),
  );
  if (hasCityLevelStrategic) {
    return FREE_REPORT_CITY_STRATEGIC_RECOMMENDATION_RU;
  }
  const hasStrongPublicAnchor = Boolean(
    decision?.publicSummary?.publicDrivers?.some(row =>
      /транспорт|порт|логист|медицин|бизнес|делов|промышлен/i.test(row.textRu),
    ) ||
      decision?.evidenceItems?.some(item =>
        /транспорт|порт|логист|медицин|бизнес|делов|промышлен/i.test(`${item.typeRu} ${item.publicExplanationRu}`),
      ),
  );
  return hasStrongPublicAnchor ? FREE_REPORT_STRONG_ANCHOR_RECOMMENDATION_RU : DEFAULT_SHORT_RECOMMENDATION_RU;
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
  const shortRecommendation = recommendationForDecision(decision);

  const viewModel: FreeLocationReportViewModel = {
    structure: buildLocationReportStructureViewModel('free'),
    address: cleanText(input.address) ?? cleanText(decision?.inputAddress) ?? '',
    ...(cleanText(input.calculatedAt) ?? cleanText(input.meta?.updatedAt)
      ? { calculatedAt: cleanText(input.calculatedAt) ?? cleanText(input.meta?.updatedAt) }
      : {}),
    ...(cleanText(input.dataFreshness) ?? metaFreshness(input.meta)
      ? { dataFreshness: cleanText(input.dataFreshness) ?? metaFreshness(input.meta) }
      : {}),
    publicScore: resolvePublicScore(input.analysis, decision),
    publicScoreLabelRu: decision?.publicSummary?.publicScoreLabelRu ?? null,
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
