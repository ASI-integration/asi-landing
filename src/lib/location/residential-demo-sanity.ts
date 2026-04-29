/**
 * Residential demo presentation sanity layer.
 *
 * Purpose: prevent inflated headline scores and misleading "Сильная локация
 * для командированных" verdicts on ordinary residential addresses where the
 * only "business" signal is a single bank/insurance branch or anonymous office.
 *
 * Pure presentation layer — does NOT mutate `LocationAnalysis`. Applied only
 * by the RU residential demo path. The commercial engine, paywalled report,
 * and standalone v1 report continue to use their own scoring as-is.
 *
 * Rules:
 *   1. Tier-1 demand magnets — reuse `filterResidentialPrimeMagnets` with
 *      additional bank/insurance name guard so Ингосстрах / СберБанк do not
 *      qualify as a strong magnet.
 *   2. Cap rules (lowest result wins):
 *      - 0 tier-1 magnets within 1 km        → score ≤ 70
 *      - 0 tier-1, only tier-2 office/bank   → score ≤ 65
 *      - tier-1 < 2 and headline > 80        → score ≤ 80
 *   3. Audience override — when tier-1 < 1 OR the engine locked BUSINESS
 *      with low audience-fit, present audience as "Жилая".
 *   4. Verdict map — replaces `getBand` label only on the demo headline.
 */

import type { LocationAnalysis, MagnetItem } from './types';
import {
  filterResidentialPrimeMagnets,
  type ResidentialPrimeMagnet,
} from './residential-prime-magnets';

// ── Public types ──────────────────────────────────────────────────────────────

export type ResidentialDemoAudience = 'RESIDENTIAL' | 'BUSINESS' | 'TOURIST' | 'MIXED';
export type ResidentialDemoVerdictTone = 'strong' | 'medium' | 'weak';

export interface ResidentialDemoSanity {
  /** Capped, presentation-only headline score. */
  displayScore: number;
  displayAudience: ResidentialDemoAudience;
  audienceLabelRu: string;
  verdictLabelRu: string;
  verdictTone: ResidentialDemoVerdictTone;
  capApplied: boolean;
  capReasonsRu: string[];
  tier1Count: number;
  tier1Magnets: ResidentialPrimeMagnet[];
}

// ── Bank / insurance name guard ───────────────────────────────────────────────

/**
 * Names that look like bank or insurance branches.
 * These are tier-2 in residential demand terms even when tagged as named offices.
 */
const BANK_INSURANCE_NAME_RE =
  /банк|bank|страхов|insurance|ингосстрах|сбер|втб|альфа|росгосстрах|ренессанс|тинькоф|тиньк|райффайзен|открытие/i;

function looksLikeBankOrInsurance(name: string | undefined): boolean {
  if (!name) return false;
  return BANK_INSURANCE_NAME_RE.test(name);
}

// ── Tier-1 detection ──────────────────────────────────────────────────────────

const TIER1_CATEGORIES: ReadonlySet<string> = new Set([
  'metro',
  'railway_station',
  'airport',
  'hospital',
  'university',
  'business',
  'attraction',
  'convention',
  'stadium',
  'shopping_major',
]);

/** Categories that may still count as tier-1 in the 1.0–1.5 km soft band. */
const TIER1_SOFT_EXTENSION: ReadonlySet<string> = new Set([
  'metro',
  'railway_station',
  'airport',
]);

function isTier1Business(magnet: ResidentialPrimeMagnet, raw: MagnetItem | undefined): boolean {
  if (magnet.anchorType !== 'POSITIVE_DEMAND_ANCHOR') return false;
  if (looksLikeBankOrInsurance(magnet.name)) return false;
  // raw.subType info is the source of truth; bank/office_anon/commercial are
  // already excluded by `filterResidentialPrimeMagnets`. We still defensively
  // require a non-bank subType when present.
  if (raw && raw.subType === 'bank') return false;
  return true;
}

function detectTier1(analysis: LocationAnalysis): ResidentialPrimeMagnet[] {
  const prime = filterResidentialPrimeMagnets(analysis.magnets, { market: 'RU' });
  const rawByKey = new Map<string, MagnetItem>();
  for (const m of analysis.magnets) {
    rawByKey.set(`${m.categoryId}:${m.name.toLowerCase().trim()}`, m);
  }
  const out: ResidentialPrimeMagnet[] = [];
  for (const m of prime) {
    if (!TIER1_CATEGORIES.has(m.categoryId)) continue;
    if (m.anchorType !== 'POSITIVE_DEMAND_ANCHOR') continue;
    const inPrimary = m.distance <= 1000;
    const inSoft = m.distance <= 1500 && TIER1_SOFT_EXTENSION.has(m.categoryId);
    if (!inPrimary && !inSoft) continue;
    if (m.categoryId === 'business') {
      const raw = rawByKey.get(`${m.categoryId}:${m.name.toLowerCase().trim()}`);
      if (!isTier1Business(m, raw)) continue;
    }
    out.push(m);
  }
  return out;
}

/** Tier-2 office/bank/insurance signal — used only to recognise "weak office only" caps. */
function hasTier2OfficeOnlySignal(magnets: MagnetItem[]): boolean {
  const businessMagnets = magnets.filter(m => m.categoryId === 'business');
  if (businessMagnets.length === 0) return false;
  return businessMagnets.every(
    m =>
      m.subType === 'bank' ||
      m.subType === 'commercial' ||
      m.subType === 'office_anon' ||
      looksLikeBankOrInsurance(m.name),
  );
}

// ── Audience helpers ──────────────────────────────────────────────────────────

function audienceLabelRu(a: ResidentialDemoAudience): string {
  switch (a) {
    case 'BUSINESS':    return 'Деловой';
    case 'TOURIST':     return 'Туристический';
    case 'MIXED':       return 'Смешанная';
    case 'RESIDENTIAL': return 'Жилая';
  }
}

// ── Verdict map ───────────────────────────────────────────────────────────────

function buildVerdict(args: {
  displayScore: number;
  tier1Count: number;
  displayAudience: ResidentialDemoAudience;
  capApplied: boolean;
}): { label: string; tone: ResidentialDemoVerdictTone } {
  const { displayScore, tier1Count, displayAudience, capApplied } = args;

  // "Сильная" only when at least 2 independent tier-1 magnets confirmed
  // AND no caps fired AND score still strong.
  if (displayScore >= 80 && tier1Count >= 2 && !capApplied) {
    if (displayAudience === 'BUSINESS') {
      return { label: 'Сильная локация для командированных', tone: 'strong' };
    }
    if (displayAudience === 'TOURIST') {
      return { label: 'Сильная туристическая локация', tone: 'strong' };
    }
    return { label: 'Сильная локация для посуточной аренды', tone: 'strong' };
  }

  if (displayScore >= 70 && tier1Count >= 2) {
    return { label: 'Хорошая локация', tone: 'medium' };
  }

  if (displayScore >= 60) {
    return { label: 'Обычная жилая локация с умеренным потенциалом', tone: 'medium' };
  }

  if (displayScore >= 45) {
    return { label: 'Спокойная жилая зона, спрос требует проверки', tone: 'weak' };
  }

  return { label: 'Слабый спрос — нужен точечный сценарий', tone: 'weak' };
}

// ── Main entry ────────────────────────────────────────────────────────────────

const CAP_REASON_NO_TIER1 =
  'Нет сильных магнитов спроса в радиусе 1 км; оценка ограничена.';
const CAP_REASON_OFFICE_ONLY =
  'Рядом только локальные офисные сигналы (банк/страховая) — деловой профиль не подтверждён.';
const CAP_REASON_SINGLE_TIER1 =
  '«Сильный» диапазон требует не менее двух независимых магнитов — один сигнал недостаточен.';

export function applyResidentialDemoSanity(analysis: LocationAnalysis): ResidentialDemoSanity {
  const tier1 = detectTier1(analysis);
  const tier1Count = tier1.length;
  const baseScore = analysis.evergreenIndex;
  const capReasons: string[] = [];

  let cappedScore = baseScore;

  // Cap A: no tier-1 magnets at all → ≤ 70
  if (tier1Count === 0 && cappedScore > 70) {
    cappedScore = 70;
    if (!capReasons.includes(CAP_REASON_NO_TIER1)) capReasons.push(CAP_REASON_NO_TIER1);
  }

  // Cap B: only tier-2 office/bank business signals → ≤ 65
  if (tier1Count === 0 && hasTier2OfficeOnlySignal(analysis.magnets) && cappedScore > 65) {
    cappedScore = 65;
    if (!capReasons.includes(CAP_REASON_NO_TIER1)) capReasons.push(CAP_REASON_NO_TIER1);
    if (!capReasons.includes(CAP_REASON_OFFICE_ONLY)) capReasons.push(CAP_REASON_OFFICE_ONLY);
  }

  // Cap C: fewer than 2 tier-1 magnets cannot justify "strong" band > 80
  if (tier1Count < 2 && cappedScore > 80) {
    cappedScore = 80;
    if (!capReasons.includes(CAP_REASON_SINGLE_TIER1)) capReasons.push(CAP_REASON_SINGLE_TIER1);
  }

  const capApplied = cappedScore !== baseScore;

  // Audience override
  const aa = analysis.audienceAnalysis;
  const audienceFit = analysis.locationScore?.breakdown.audience_fit_score ?? 0;
  let displayAudience: ResidentialDemoAudience = 'RESIDENTIAL';
  if (tier1Count >= 2 && aa) {
    if (aa.primaryAudience === 'BUSINESS' && audienceFit >= 35) {
      displayAudience = 'BUSINESS';
    } else if (aa.primaryAudience === 'TOURIST' && !aa.fallbackMode) {
      displayAudience = 'TOURIST';
    } else {
      displayAudience = 'MIXED';
    }
  } else if (tier1Count === 1 && aa && aa.primaryAudience === 'TOURIST' && !aa.fallbackMode) {
    displayAudience = 'TOURIST';
  } else {
    displayAudience = 'RESIDENTIAL';
  }

  const verdict = buildVerdict({
    displayScore: cappedScore,
    tier1Count,
    displayAudience,
    capApplied,
  });

  return {
    displayScore: cappedScore,
    displayAudience,
    audienceLabelRu: audienceLabelRu(displayAudience),
    verdictLabelRu: verdict.label,
    verdictTone: verdict.tone,
    capApplied,
    capReasonsRu: capReasons,
    tier1Count,
    tier1Magnets: tier1,
  };
}
