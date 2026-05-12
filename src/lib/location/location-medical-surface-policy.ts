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

  const namedNonGeneric = medical.filter(d => {
    const m = magnetForScoredDriver(d, args.magnets);
    return m && !isGenericMedicalSurfaceName(m.name);
  });
  if (namedNonGeneric.length >= 2) return true;

  if (namedNonGeneric.some(d => d.scaleClass === 'verified_major' && d.resolvedTier <= 2)) return true;
  if (namedNonGeneric.some(d => d.resolvedTier === 1 && d.scaleClass !== 'weak_local')) return true;
  if (namedNonGeneric.some(d => d.resolvedTier === 2 && d.scaleClass === 'medium')) return true;

  return false;
}
