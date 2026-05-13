import type { MagnetItem } from './types';
import type { LocationDemandScoredDriver } from './location-scoring-contract';

function magnetIndexFromFactId(magnetFactId: string): number | null {
  const parts = magnetFactId.split(':');
  const i = parts.length >= 2 ? Number.parseInt(parts[1]!, 10) : NaN;
  return Number.isFinite(i) ? i : null;
}

export function magnetForScoredDriver(
  d: LocationDemandScoredDriver,
  magnets: readonly MagnetItem[],
): MagnetItem | undefined {
  const i = magnetIndexFromFactId(d.magnetFactId);
  return i != null ? magnets[i] : undefined;
}

/**
 * OSM default name (`Больница`) and other category-only labels must not read as a verified anchor on the public surface.
 */
export function isGenericMedicalSurfaceName(name: string | undefined): boolean {
  if (name == null) return true;
  const n = name.normalize('NFKC').trim().toLowerCase();
  if (!n) return true;
  if (
    /^(?:больница|госпиталь|поликлиника|клиника|мед(?:ицинский)?\s*центр|диспансер)(?:\s*[.№#]?\s*\d{0,3})?$/iu.test(
      n,
    )
  ) {
    return true;
  }
  if (/^hospital(?:\s+#?\d*)?$/i.test(n) || /^clinic$/i.test(n)) return true;
  return false;
}

function isStrongNamedMedicalSurfaceName(name: string | undefined): boolean {
  if (isGenericMedicalSurfaceName(name)) return false;
  const n = name?.normalize('NFKC').trim().toLowerCase() ?? '';
  return /областн|краев|республик|федеральн|научн|научно-исследовательск|(?:^|\s)нии(?:$|\s|\W)|университетск|перинатальн|онколог|кардиолог|инфекцион|многопрофильн|гематолог|трансфузиолог/i.test(n);
}

function driverContributionWeight(d: LocationDemandScoredDriver): number {
  if (!d.accepted) return 0;
  if (d.driverKind === 'noise' || d.driverKind === 'local_interest') return 0;
  if (d.driverKind === 'supporting_infrastructure') return d.finalContribution * 0.35;
  return d.finalContribution;
}

/** True when every positive-weight strict driver is medical and each is a generic/unamed facility label. */
export function strictPublicDriversAreOnlyGenericMedical(
  strictDrivers: readonly LocationDemandScoredDriver[],
  magnets: readonly MagnetItem[],
): boolean {
  const active = strictDrivers.filter(d => driverContributionWeight(d) > 0);
  if (!active.length) return false;
  const medical = active.filter(d => d.demandTypeVote === 'medical');
  if (!medical.length || medical.length !== active.length) return false;
  return medical.every(d => isGenericMedicalSurfaceName(magnetForScoredDriver(d, magnets)?.name));
}

/** True when the public surface has no positive non-medical demand drivers. */
export function strictPublicDriversAreMedicalOnly(
  strictDrivers: readonly LocationDemandScoredDriver[],
): boolean {
  const active = strictDrivers.filter(d => driverContributionWeight(d) > 0);
  if (!active.length) return false;
  return active.every(d => d.demandTypeVote === 'medical');
}

export function strongestStrictNonMedicalDemandContribution(
  strictDrivers: readonly LocationDemandScoredDriver[],
): number {
  let best = 0;
  for (const d of strictDrivers) {
    if (!d.demandTypeVote || d.demandTypeVote === 'medical') continue;
    if (d.driverKind !== 'real_demand_driver' && d.driverKind !== 'unknown_uncapped') continue;
    best = Math.max(best, driverContributionWeight(d));
  }
  return best;
}

export function countVerifiedMajorMedicalAnchors(
  scored: readonly LocationDemandScoredDriver[],
  magnets: readonly MagnetItem[],
  specialMarketFlags: readonly string[],
): number {
  const anchors = new Set<string>();
  const cluster = specialMarketFlags.includes('regional_medical_cluster');

  for (const d of scored) {
    if (!d.accepted || d.demandTypeVote !== 'medical') continue;
    if (d.driverKind !== 'real_demand_driver') continue;
    const m = magnetForScoredDriver(d, magnets);
    const nameOk = Boolean(m && !isGenericMedicalSurfaceName(m.name));

    if (cluster && d.resolvedTier <= 2) {
      anchors.add(d.magnetFactId);
      continue;
    }

    if (!nameOk) continue;

    if (d.scaleClass === 'verified_major' && d.resolvedTier <= 2) {
      anchors.add(d.magnetFactId);
      continue;
    }
    if (d.resolvedTier === 1) {
      anchors.add(d.magnetFactId);
      continue;
    }
    if (d.resolvedTier <= 2 && d.scaleClass === 'medium') {
      anchors.add(d.magnetFactId);
    }
  }
  return anchors.size;
}

export function countStrongNamedMedicalAnchors(
  scored: readonly LocationDemandScoredDriver[],
  magnets: readonly MagnetItem[],
  specialMarketFlags: readonly string[],
): number {
  const anchors = new Set<string>();
  const cluster = specialMarketFlags.includes('regional_medical_cluster');

  for (const d of scored) {
    if (!d.accepted || d.demandTypeVote !== 'medical') continue;
    if (d.driverKind !== 'real_demand_driver') continue;
    const m = magnetForScoredDriver(d, magnets);
    if (!m || !isStrongNamedMedicalSurfaceName(m.name)) continue;

    if (cluster && d.resolvedTier <= 2) {
      anchors.add(d.magnetFactId);
      continue;
    }
    if (d.resolvedTier === 1 && d.scaleClass !== 'weak_local') {
      anchors.add(d.magnetFactId);
      continue;
    }
    if (d.resolvedTier === 2 && (d.scaleClass === 'verified_major' || d.scaleClass === 'medium')) {
      anchors.add(d.magnetFactId);
    }
  }

  return anchors.size;
}

export interface MedicalPrimaryEvidenceAudit {
  readonly medicalTotal: number;
  readonly strongNamedTotal: number;
  readonly ordinaryNamedTotal: number;
  readonly genericTotal: number;
  readonly strongNamedAnchorCount: number;
  readonly ordinaryOrGenericTotal: number;
  readonly highScoreEligible: boolean;
}

export function auditMedicalPrimaryEvidence(args: {
  scoredDrivers: readonly LocationDemandScoredDriver[];
  magnets: readonly MagnetItem[];
  specialMarketFlags: readonly string[];
}): MedicalPrimaryEvidenceAudit {
  const strongAnchors = new Set<string>();
  let medicalTotal = 0;
  let strongNamedTotal = 0;
  let ordinaryNamedTotal = 0;
  let genericTotal = 0;
  let hasDominantSingleMajor = false;

  for (const d of args.scoredDrivers) {
    if (!d.accepted || d.demandTypeVote !== 'medical') continue;
    if (d.driverKind !== 'real_demand_driver') continue;
    const contribution = driverContributionWeight(d);
    if (contribution <= 0) continue;

    const m = magnetForScoredDriver(d, args.magnets);
    medicalTotal += contribution;

    if (!m || isGenericMedicalSurfaceName(m.name)) {
      genericTotal += contribution;
      continue;
    }

    if (isStrongNamedMedicalSurfaceName(m.name) && d.resolvedTier <= 2 && d.scaleClass !== 'weak_local') {
      strongAnchors.add(d.magnetFactId);
      strongNamedTotal += contribution;
      if (d.resolvedTier === 1 || d.scaleClass === 'verified_major') {
        hasDominantSingleMajor = true;
      }
      continue;
    }

    ordinaryNamedTotal += contribution;
  }

  const ordinaryOrGenericTotal = ordinaryNamedTotal + genericTotal;
  const strongNamedAnchorCount = strongAnchors.size;
  const regionalCluster = args.specialMarketFlags.includes('regional_medical_cluster');
  const strongDominatesOrdinary =
    strongNamedTotal >= Math.max(8, ordinaryOrGenericTotal * 0.75);
  const multipleStrongAnchors =
    strongNamedAnchorCount >= 2 && strongNamedTotal >= Math.max(8, ordinaryOrGenericTotal * 0.55);

  return {
    medicalTotal,
    strongNamedTotal,
    ordinaryNamedTotal,
    genericTotal,
    strongNamedAnchorCount,
    ordinaryOrGenericTotal,
    highScoreEligible:
      (regionalCluster && strongNamedAnchorCount >= 1) ||
      (hasDominantSingleMajor && strongDominatesOrdinary) ||
      multipleStrongAnchors,
  };
}

export function strictPublicDriversAreMedicalLed(
  strictDrivers: readonly LocationDemandScoredDriver[],
): boolean {
  const buckets = new Map<string, number>();
  for (const d of strictDrivers) {
    const w = driverContributionWeight(d);
    if (!d.demandTypeVote || w <= 0) continue;
    buckets.set(d.demandTypeVote, (buckets.get(d.demandTypeVote) ?? 0) + w);
  }

  const medical = buckets.get('medical') ?? 0;
  if (medical < 0.16) return false;

  let strongestOther = 0;
  for (const [type, value] of buckets) {
    if (type === 'medical') continue;
    strongestOther = Math.max(strongestOther, value);
  }

  return strongestOther <= 0 || medical >= strongestOther * 1.05;
}

export function medicalPrimaryHighScoreEligible(args: {
  scoredDrivers: readonly LocationDemandScoredDriver[];
  magnets: readonly MagnetItem[];
  specialMarketFlags: readonly string[];
}): boolean {
  return auditMedicalPrimaryEvidence(args).highScoreEligible;
}

export function medicalPrimaryStrongPublicCopyEligible(args: {
  strictDrivers: readonly LocationDemandScoredDriver[];
  magnets: readonly MagnetItem[];
  specialMarketFlags: readonly string[];
}): boolean {
  if (args.specialMarketFlags.includes('regional_medical_cluster')) return true;

  const medical = args.strictDrivers.filter(
    d => d.demandTypeVote === 'medical' && driverContributionWeight(d) > 0,
  );
  if (!medical.length) return false;

  const strongNamed = medical.filter(d => {
    const m = magnetForScoredDriver(d, args.magnets);
    return m && isStrongNamedMedicalSurfaceName(m.name);
  });
  if (strongNamed.length >= 2) return true;

  if (strongNamed.some(d => d.scaleClass === 'verified_major' && d.resolvedTier <= 2)) return true;
  if (strongNamed.some(d => d.resolvedTier === 1 && d.scaleClass !== 'weak_local')) return true;
  if (strongNamed.some(d => d.resolvedTier === 2 && d.scaleClass === 'medium')) return true;

  return false;
}
