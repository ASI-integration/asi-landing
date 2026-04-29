/**
 * Residential demo presentation sanity layer.
 *
 * Purpose: prevent inflated headline scores and misleading "Сильная локация
 * для командированных" verdicts on ordinary residential addresses where the
 * only "business" signal is a weak office cluster (bank/insurance/travel/sales office).
 *
 * Pure presentation layer — does NOT mutate `LocationAnalysis`. Applied only
 * by the RU residential demo path. The commercial engine, paywalled report,
 * and standalone v1 report continue to use their own scoring as-is.
 *
 * Rules:
 *   1. Tier-1 demand magnets — reuse `filterResidentialPrimeMagnets` with
 *      stronger weak-office deny list and named business-center requirement.
 *   2. Cap rules (lowest result wins):
 *      - 0 tier-1 magnets within 1 km        → score ≤ 70
 *      - 0 tier-1, only tier-2 office/bank   → score ≤ 65
 *      - tier-1 < 2 and headline > 80        → score ≤ 80
 *      - business cluster is weak-office-only → score ≤ 70
 *   3. Audience override — when weak-office-only cluster drives BUSINESS,
 *      downgrade to MIXED/RESIDENTIAL.
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

// ── Weak office guards ────────────────────────────────────────────────────────

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

const METRO_ENTRANCE_OR_EXIT_RE =
  // Names like "Вход 1", "Вход 2", "Выход 3", "Entrance 1", "Exit 2"
  /(?:вход|выход|entrance|exit)\s*(?:№\s*)?\d+/i;

function isMetroEntranceOrExit(name: string | undefined): boolean {
  if (!name) return false;
  return METRO_ENTRANCE_OR_EXIT_RE.test(name);
}

const MAJOR_TOURIST_ATTRACTION_NAME_RE =
  // Explicit major tourist categories. Keep strict to avoid
  // demoting everything (e.g. generic sculptures should stay Tier-2).
  /(?:музей|театр|театральный|концертный\s+зал|концерт|стадион|арена|конгресс-центр|выставка|выставочный\s+центр|конвенц|экспо|landmark|достопримечательность|major\s+attraction)/i;

function isMajorTouristAttraction(magnet: ResidentialPrimeMagnet, raw: MagnetItem | undefined): boolean {
  if (isStrongTier1BusinessByName(magnet.name)) return false; // defensive: business word in attraction name shouldn't promote it
  if (MAJOR_TOURIST_ATTRACTION_NAME_RE.test(magnet.name)) return true;

  // "Tourist site with strong category/source" fallback — only when both
  // strength + attractionScore are clearly high.
  if (raw?.strengthClass === 'strong' && raw.attractionScore >= 4.2) return true;

  return false;
}

function looksLikeWeakOffice(name: string | undefined): boolean {
  if (!name) return false;
  return WEAK_OFFICE_NAME_RE.test(name);
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
  if (looksLikeWeakOffice(magnet.name)) return false;
  if (raw?.subType && WEAK_OFFICE_SUBTYPES.has(raw.subType)) return false;
  const strongSubtype = raw?.subType === 'factory' || raw?.subType === 'industrial';
  if (!strongSubtype && !STRONG_BUSINESS_NAME_RE.test(magnet.name)) return false;
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
      const raw = rawByKey.get(`${m.categoryId}:${m.name.toLowerCase().trim()}`);
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
const CAP_REASON_WEAK_CLUSTER =
  'Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён.';

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

  const businessClusterDetected = analysis.audienceAnalysis?.businessClusterDetected === true;
  const weakOnly = hasTier2OfficeOnlySignal(analysis.magnets);
  const weakClusterOnly = businessClusterDetected && weakOnly;
  // Cap D: detected business cluster made only of weak offices must not exceed 70.
  if (weakClusterOnly && cappedScore > 70) {
    cappedScore = 70;
    if (!capReasons.includes(CAP_REASON_WEAK_CLUSTER)) capReasons.push(CAP_REASON_WEAK_CLUSTER);
  }

  const capApplied = cappedScore !== baseScore;

  // Audience override
  const aa = analysis.audienceAnalysis;
  const audienceFit = analysis.locationScore?.breakdown.audience_fit_score ?? 0;
  const hasTier1BusinessMagnet = tier1.some(m => m.categoryId === 'business');
  const hasBusinessRelevantDemandAnchor = tier1.some(m =>
    m.categoryId === 'hospital' ||
    m.categoryId === 'university' ||
    m.categoryId === 'railway_station' ||
    m.categoryId === 'airport',
  );
  let displayAudience: ResidentialDemoAudience = 'RESIDENTIAL';
  const hasTier1Transit = tier1.some(m => m.categoryId === 'metro' || m.categoryId === 'railway_station' || m.categoryId === 'airport');
  if (weakClusterOnly) {
    displayAudience = audienceFit >= 35 && hasTier1Transit ? 'MIXED' : 'RESIDENTIAL';
  } else if (tier1Count >= 2 && aa) {
    if (aa.primaryAudience === 'BUSINESS' && audienceFit >= 35) {
      // RU demo must not show BUSINESS based on metro + weak offices + local amenities.
      // Allow only when there's at least one real business Tier-1 magnet
      // OR a strong medical/university/rail/airport demand anchor.
      displayAudience = (hasTier1BusinessMagnet || hasBusinessRelevantDemandAnchor) ? 'BUSINESS' : 'MIXED';
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
