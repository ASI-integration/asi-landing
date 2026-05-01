/**
 * Canonical RU residential location scoring / sanity rules.
 *
 * Consolidates the scattered demo-only logic that:
 *   - detects Tier-1 demand magnets (including RU-specific weak-office/attraction guards)
 *   - applies score caps to prevent inflated “Сильная” headlines on ordinary residential addresses
 *   - gates / downgrades the displayed audience when business demand is driven only by weak offices
 *   - maps a final displayScore to a RU verdict label + tone
 *
 * Note:
 *   - This file is presentation/guard logic for the RU residential demo path.
 *   - It does NOT mutate `LocationAnalysis` and does not affect the commercial engine scoring.
 */

import type { LocationAnalysis, MagnetItem } from '../types';
import {
  filterResidentialPrimeMagnets,
  type ResidentialPrimeMagnet,
} from '../residential-prime-magnets';
import { GRAVITY_CONFIG } from '../config';
import {
  classifyMagnetSignal,
  hasCredibleTouristAnchors,
  looksLikeWeakLocalAttractionPoi,
} from '../signals/location-signal-taxonomy';
import { classifyCanonicalMagnet } from '../canonical/magnet-registry';

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

// ── Weak office guards ─────────────────────────────────────────────────────────

/**
 * Weak office names that should stay tier-2 in residential demand terms.
 */
const WEAK_OFFICE_NAME_RE =
  /банк|bank|страх|insurance|ингосстрах|росгосстрах|ренессанс|сбер|втб|альфа|тинькоф|тиньк|райффайзен|открытие|турагентств|travel|слетать|офис\s+продаж|салон|local\s+office/i;

const WEAK_OFFICE_SUBTYPES: ReadonlySet<string> = new Set([
  'bank',
  'insurance',
  'commercial',
  'office_anon',
  'travel_agency',
]);

const STRONG_BUSINESS_NAME_RE =
  // Real business/employment magnets — used to decide Tier-1 strength.
  // Important: generic brand offices (e.g. "Марио") must NOT match.
  /бизнес-центр|business\s+center|бц\b|technopark|технопарк|industrial\s+park|industrial|factory|завод\b|кампус|campus|штаб-квартира|headquarters|office\s+cluster|деловой\s+центр/i;

function isStrongTier1BusinessByName(name: string | undefined): boolean {
  if (!name) return false;
  return STRONG_BUSINESS_NAME_RE.test(name);
}

/**
 * CBD / major business-transit hubs.
 *
 * Used to prevent “weak office only” caps from firing in true CBD contexts
 * where the office POI naming may be generic but the transit anchors are explicit.
 *
 * IMPORTANT: keep conservative — do not match ordinary residential metro stations.
 */
const CBD_TRANSIT_ANCHOR_NAME_RE =
  /москва[-\s]?сити|moscow\s+city|деловой\s+центр|мцк\s*деловой\s*центр|city\s+center|central\s+business\s+district|\bcbd\b/i;

function isCbdTransitAnchorName(name: string | undefined): boolean {
  if (!name) return false;
  return CBD_TRANSIT_ANCHOR_NAME_RE.test(name);
}

const METRO_ENTRANCE_OR_EXIT_RE =
  // Names like "Вход 1", "Вход 2", "Выход 3", "Entrance 1", "Exit 2"
  /(?:вход|выход|entrance|exit)\s*(?:№\s*)?\d+/i;

function isMetroEntranceOrExit(name: string | undefined): boolean {
  if (!name) return false;
  return METRO_ENTRANCE_OR_EXIT_RE.test(name);
}

function isMajorTouristAttraction(
  magnet: ResidentialPrimeMagnet,
  raw: MagnetItem | undefined,
): boolean {
  if (isStrongTier1BusinessByName(magnet.name)) return false; // defensive: business word in attraction name shouldn't promote it
  if (!raw) return false;

  // Canonical rule: attractions (including museums/theaters) MUST NOT become Tier‑1
  // residential anchors by raw name/category. Tier‑1 eligibility is decided only by
  // canonical registry output (which may incorporate taxonomy/context).
  const canonical = classifyCanonicalMagnet({ magnet: raw });
  if (canonical.maxResidentialTier !== 1) return false;
  if (canonical.anchorStrength !== 'tier1') return false;

  // Defensive: still respect weak/hidden taxonomy outputs while legacy callers exist.
  if (looksLikeWeakLocalAttractionPoi(raw)) return false;
  const tax = classifyMagnetSignal(raw);
  if (tax.level === 'weak_local_signal') return false;
  if (tax.publicClaimStrength === 'hidden_from_public_copy') return false;

  return true;
}

function looksLikeWeakOffice(name: string | undefined): boolean {
  if (!name) return false;
  return WEAK_OFFICE_NAME_RE.test(name);
}

// ── Tier-1 detection ───────────────────────────────────────────────────────────

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

function isTier1Business(
  magnet: ResidentialPrimeMagnet,
  raw: MagnetItem | undefined,
): boolean {
  if (magnet.anchorType !== 'POSITIVE_DEMAND_ANCHOR') return false;
  if (looksLikeWeakOffice(magnet.name)) return false;
  if (raw?.subType && WEAK_OFFICE_SUBTYPES.has(raw.subType)) return false;

  if (!raw) return false;
  const canonical = classifyCanonicalMagnet({ magnet: raw });
  if (canonical.maxResidentialTier !== 1) return false;
  if (canonical.anchorStrength !== 'tier1') return false;
  if (!canonical.audiences.business && !canonical.audiences.corporate) return false;
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

    const raw = rawByKey.get(`${m.categoryId}:${m.name.toLowerCase().trim()}`);

    // Business: only count real business/employment magnets as Tier-1.
    if (m.categoryId === 'business') {
      if (!isTier1Business(m, raw)) continue;
    }

    // Attractions: generic sculptures/art objects must not become Tier-1 tourist magnets.
    if (m.categoryId === 'attraction') {
      if (!isMajorTouristAttraction(m, raw)) continue;
    }

    out.push(m);
  }

  // Metro anchors: station + entrances/exits count as a single Tier-1 transport anchor.
  const metros = out.filter(m => m.categoryId === 'metro');
  if (metros.length > 0) {
    const nonEntranceMetros = metros.filter(m => !isMetroEntranceOrExit(m.name));
    if (nonEntranceMetros.length > 0) {
      // Keep station entries; drop entrance/exit entries.
      return out.filter(m => m.categoryId !== 'metro' || !isMetroEntranceOrExit(m.name));
    }

    // If we only have entrances/exits, keep just the closest one.
    const closest = [...metros].sort((a, b) => a.distance - b.distance)[0];
    return out.filter(m => m.categoryId !== 'metro' || m.name === closest.name);
  }

  return out;
}

// ── Tier-2 / local POI signal ────────────────────────────────────────────────

/** Tier-2 office/bank/insurance signal — used only to recognise "weak office only" caps. */
function hasTier2OfficeOnlySignal(magnets: MagnetItem[]): boolean {
  const businessMagnets = magnets.filter(m => m.categoryId === 'business');
  if (businessMagnets.length === 0) return false;

  return businessMagnets.every(m => {
    const st = m.subType?.toLowerCase().trim();
    if (st === 'office') {
      // Generic "office" subType is weak/local by default.
      // Only real employment/business magnets qualify as Tier-1 by name.
      return !isStrongTier1BusinessByName(m.name);
    }
    return (
      (st ? WEAK_OFFICE_SUBTYPES.has(st) : false) ||
      looksLikeWeakOffice(m.name)
    );
  });
}

// ── Tier-2 secondary-cluster detection ────────────────────────────────────────
//
// When a location has no Tier-1 magnet but has multiple credible Tier-2 demand
// anchors within walking range (civic/admin, mid-tier hotel, named attraction,
// food cluster, etc.), the gravity engine collapses the score to ~5/100 because
// raw attraction × decay never reaches the moderate band. This count drives a
// presentation-only moderate floor in `applyResidentialLocationRules`.

/**
 * Counts independent Tier-2 demand signals near the subject.
 * Each row contributes at most 1.
 */
function detectTier2ClusterCount(analysis: LocationAnalysis): number {
  const m = analysis.magnets;
  let count = 0;

  // Civic / administrative anchor (townhall, government office, ZAGS)
  if (m.some(x => x.categoryId === 'civic' && x.distance <= 900)) count++;

  // Mid-tier (1–3★) hotel
  if (m.some(x => x.categoryId === 'mid_hotel' && x.distance <= 700)) count++;

  // Major (4–5★) hotel
  if (m.some(x => x.categoryId === 'major_hotel' && x.distance <= 900)) count++;

  // Convention / expo center
  if (m.some(x => x.categoryId === 'convention' && x.distance <= 900)) count++;

  // Major shopping cluster
  if (m.some(x => x.categoryId === 'shopping_major' && x.distance <= 900)) count++;

  // Named attraction (even if not "major tourist" by the strict Tier-1 filter),
  // but only when credible per taxonomy (corporate/factory museums must not inflate
  // the secondary-cluster counter).
  if (m.some(x => {
    if (x.categoryId !== 'attraction' || x.distance > 800) return false;
    const t = classifyMagnetSignal(x);
    if (t.level !== 'tier1_anchor' && t.level !== 'tier2_anchor') return false;
    if (t.publicClaimStrength === 'hidden_from_public_copy') return false;
    return true;
  })) count++;

  // Dense food cluster — uses existing GRAVITY_CONFIG thresholds.
  const foodNearby = m.filter(
    x => x.categoryId === 'food' && x.distance <= GRAVITY_CONFIG.foodClusterRadius,
  );
  if (foodNearby.length >= GRAVITY_CONFIG.foodClusterMinCount) count++;

  // Real (non-weak) business cluster: ≥2 named business magnets that are
  // neither weak-office subtypes nor on the weak-office name list.
  const realBusiness = m.filter(x => {
    if (x.categoryId !== 'business') return false;
    if (x.distance > 700) return false;
    if (looksLikeWeakOffice(x.name)) return false;
    if (x.subType && WEAK_OFFICE_SUBTYPES.has(x.subType)) return false;
    return true;
  });
  if (realBusiness.length >= 2) count++;

  // Transit access only counts as a +1 modifier if at least one other Tier-2
  // signal already fired (must not become a sole signal).
  if (
    count > 0 &&
    analysis.accessibilityStops.some(s => s.distance <= 350)
  ) count++;

  return count;
}

// ── Audience helpers ───────────────────────────────────────────────────────────

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

const CAP_REASON_WEAK_CLUSTER =
  'Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён.';

const CAP_REASON_BUSINESS_WITHOUT_TIER1_ANCHORS =
  'Деловой профиль не подтверждён сильными магнитами (вторичный кластер); оценка ограничена для публичного вывода.';

const CAP_REASON_TOURIST_WEAK_ONLY =
  'Есть отдельный культурный объект рядом, но сильный туристический поток не подтверждён; оценка ограничена.';

const FLOOR_REASON_TIER2_CLUSTER =
  'Есть несколько локальных магнитов спроса (вторичный кластер); оценка не должна схлопываться в «почти ноль».';

/**
 * Apply RU residential demo sanity rules.
 *
 * This is the canonical rules engine used by the RU demo presentation layer.
 */
export function applyResidentialLocationRules(
  analysis: LocationAnalysis,
): ResidentialDemoSanity {
  const tier1 = detectTier1(analysis);
  const tier1Count = tier1.length;
  const baseScore = analysis.evergreenIndex;
  const capReasons: string[] = [];

  let cappedScore = baseScore;
  const tier2ClusterCount = detectTier2ClusterCount(analysis);

  const aa = analysis.audienceAnalysis;
  const audienceFit = analysis.locationScore?.breakdown.audience_fit_score ?? 0;

  const hasTier1BusinessMagnet = tier1.some(m => m.categoryId === 'business');
  const hasTier1Transit = tier1.some(m =>
    m.categoryId === 'metro' ||
    m.categoryId === 'railway_station' ||
    m.categoryId === 'airport',
  );
  // “True business/corporate/transit” anchors: these can justify BUSINESS display
  // and exempt from “no true business anchor” caps. Universities are NOT in this
  // list: they support demand but are not a reliable corporate-travel driver alone.
  const hasTrueBusinessContextAnchor = tier1.some(m =>
    m.categoryId === 'hospital' ||
    m.categoryId === 'railway_station' ||
    m.categoryId === 'airport' ||
    (m.categoryId === 'metro' && isCbdTransitAnchorName(m.name)),
  );

  const hasCbdTransitContext = tier1.some(m =>
    (m.categoryId === 'metro' || m.categoryId === 'railway_station') &&
    isCbdTransitAnchorName(m.name),
  );

  // Cap A: no tier-1 magnets at all → ≤ 70
  if (tier1Count === 0 && cappedScore > 70) {
    cappedScore = 70;
    if (!capReasons.includes(CAP_REASON_NO_TIER1)) capReasons.push(CAP_REASON_NO_TIER1);
  }

  // Cap B: only tier-2 office/bank business signals → ≤ 65
  if (
    tier1Count === 0 &&
    hasTier2OfficeOnlySignal(analysis.magnets) &&
    cappedScore > 65
  ) {
    cappedScore = 65;
    if (!capReasons.includes(CAP_REASON_NO_TIER1)) capReasons.push(CAP_REASON_NO_TIER1);
    if (!capReasons.includes(CAP_REASON_OFFICE_ONLY)) capReasons.push(CAP_REASON_OFFICE_ONLY);
  }

  // Cap C: fewer than 2 tier-1 magnets cannot justify "strong" band > 80
  if (tier1Count < 2 && cappedScore > 80) {
    cappedScore = 80;
    if (!capReasons.includes(CAP_REASON_SINGLE_TIER1)) capReasons.push(CAP_REASON_SINGLE_TIER1);
  }

  const businessClusterDetected = analysis.audienceAnalysis?.businessClusterDetected === true;
  const weakOnly = hasTier2OfficeOnlySignal(analysis.magnets);
  // Weak-office-only cluster is a residential guard, but must NOT apply in explicit
  // CBD / transit hubs where office POI naming is frequently generic.
  const weakClusterOnly = businessClusterDetected && weakOnly && !hasCbdTransitContext;

  // Cap D: detected business cluster made only of weak offices must not exceed 70.
  if (weakClusterOnly && cappedScore > 70) {
    cappedScore = 70;
    if (!capReasons.includes(CAP_REASON_WEAK_CLUSTER)) capReasons.push(CAP_REASON_WEAK_CLUSTER);
  }

  // Cap E: "BUSINESS" primary audience without any Tier-1 business-relevant anchors must not display
  // a strong headline (prevents secondary-cluster areas from surfacing as "Сильная ... командированных").
  //
  // This is intentionally stricter than the general verdict rules: it applies even when Tier-1 magnets
  // exist (e.g. shopping_major + attraction), because those can bias the model towards BUSINESS without
  // representing true employment / commute-driven demand.
  if (
    aa?.primaryAudience === 'BUSINESS' &&
    !hasTier1BusinessMagnet &&
    !hasTrueBusinessContextAnchor &&
    !hasTier1Transit &&
    tier2ClusterCount >= 2 &&
    cappedScore > 55
  ) {
    cappedScore = 55;
    if (!capReasons.includes(CAP_REASON_BUSINESS_WITHOUT_TIER1_ANCHORS)) {
      capReasons.push(CAP_REASON_BUSINESS_WITHOUT_TIER1_ANCHORS);
    }
  }

  // Floor: if there are several independent Tier-2 demand anchors but no Tier-1,
  // a near-zero score looks like a bug/regression for "secondary cluster" areas.
  // Keep the floor conservative: still weak-to-moderate, never "strong".
  if (tier1Count === 0 && tier2ClusterCount >= 3 && cappedScore < 35) {
    cappedScore = 35;
    if (!capReasons.includes(FLOOR_REASON_TIER2_CLUSTER)) capReasons.push(FLOOR_REASON_TIER2_CLUSTER);
  }

  const capApplied = cappedScore !== baseScore;

  // ── Audience override (gating rules) ──────────────────────────────────────

  // Shopping_major limitation:
  // business audience is allowed only when there's at least one real business Tier-1
  // OR a strong medical/rail/airport/CBD-transit demand anchor.
  // "shopping_major" itself must not be sufficient.
  let displayAudience: ResidentialDemoAudience = 'RESIDENTIAL';

  if (weakClusterOnly) {
    displayAudience = audienceFit >= 35 && hasTier1Transit ? 'MIXED' : 'RESIDENTIAL';
  } else if (tier1Count >= 2 && aa) {
    if (aa.primaryAudience === 'BUSINESS' && audienceFit >= 35) {
      displayAudience = (hasTier1BusinessMagnet || hasTrueBusinessContextAnchor)
        ? 'BUSINESS'
        : 'MIXED';
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

  // Guard: TOURIST must be backed by at least one credible tourist anchor.
  // If only weak/local/corporate cultural POIs exist, do not allow "strong tourist"
  // display or a 100/100 headline.
  if (displayAudience === 'TOURIST' && !hasCredibleTouristAnchors(analysis.magnets)) {
    displayAudience = tier1Count > 0 ? 'MIXED' : 'RESIDENTIAL';
    if (cappedScore > 70) cappedScore = 70;
    if (!capReasons.includes(CAP_REASON_TOURIST_WEAK_ONLY)) capReasons.push(CAP_REASON_TOURIST_WEAK_ONLY);
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

