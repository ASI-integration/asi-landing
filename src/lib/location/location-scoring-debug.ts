/**
 * Plain-text debug for demand scoring kernel v1 (locationClaimTrace=1 style surfaces).
 */

import type { LocationDemandScoringKernelResult } from './location-scoring-contract';

export function formatLocationDemandKernelDebug(result: LocationDemandScoringKernelResult): string {
  const lines: string[] = [];
  lines.push('=== demand_kernel_v1 ===');
  lines.push(`dominantDemandType=${result.dominantDemandType}`);
  lines.push(`kernelEvidenceScore=${result.kernelEvidenceScore}`);
  lines.push(`blendedPublicScore=${result.blendedPublicScore}`);
  lines.push(
    `breakdown: raw=${result.scoreBreakdown.rawSumBeforeCaps.toFixed(2)} final=${result.scoreBreakdown.finalWeightedSum.toFixed(2)}`,
  );
  lines.push(
    `caps: supportingΔ=${result.scoreBreakdown.cappedSupportingInfra.toFixed(2)} localΔ=${result.scoreBreakdown.cappedLocalInterest.toFixed(2)} hotelsΔ=${result.scoreBreakdown.cappedHotels.toFixed(2)} tourismΔ=${result.scoreBreakdown.cappedTourismWithoutAnchor.toFixed(2)} noTier1Δ=${result.scoreBreakdown.cappedNoTier1Penalty.toFixed(2)} smallCityΔ=${result.scoreBreakdown.cappedSmallCitySparse.toFixed(2)}`,
  );

  lines.push('-- accepted --');
  for (const d of result.acceptedDrivers) {
    lines.push(
      [
        d.magnetFactId,
        d.sourceName,
        d.category,
        `tier=${d.resolvedTier}`,
        `kind=${d.driverKind}`,
        `vote=${d.demandTypeVote ?? '—'}`,
        `contrib=${d.finalContribution.toFixed(2)}`,
        `tagAlign=${d.tagAlignmentStatus ?? '—'}`,
        `publicDisplay=${d.publicDisplayEligible === true ? 'true' : d.publicDisplayEligible === false ? 'false' : '—'}`,
        d.publicDisplayRejectReason ? `publicReject=${d.publicDisplayRejectReason}` : '',
        d.reason,
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }

  lines.push('-- rejected / capped-out --');
  for (const d of result.rejectedDrivers) {
    lines.push(
      [
        d.magnetFactId,
        d.sourceName,
        `acc=${d.accepted}`,
        `contrib=${d.finalContribution.toFixed(2)}`,
        `tagAlign=${d.tagAlignmentStatus ?? '—'}`,
        `publicDisplay=${d.publicDisplayEligible === true ? 'true' : d.publicDisplayEligible === false ? 'false' : '—'}`,
        d.publicDisplayRejectReason ? `publicReject=${d.publicDisplayRejectReason}` : '',
        d.reason,
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }

  lines.push('-- scored trace (all drivers) --');
  for (const d of result.scoredDrivers) {
    lines.push(
      [
        d.magnetFactId,
        d.sourceName,
        `acc=${d.accepted}`,
        `tier=${d.resolvedTier}`,
        `kind=${d.driverKind}`,
        `vote=${d.demandTypeVote ?? '—'}`,
        `contrib=${d.finalContribution.toFixed(3)}`,
        `tagAlign=${d.tagAlignmentStatus ?? '—'}`,
        `publicDisplayEligible=${d.publicDisplayEligible ?? '—'}`,
        d.publicDisplayRejectReason ? `publicReject=${d.publicDisplayRejectReason}` : '',
        d.reason,
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }

  if (result.warnings.length) {
    lines.push('-- warnings --');
    lines.push(...result.warnings.map(w => `WARN ${w}`));
  }

  lines.push('-- trace --');
  lines.push(...result.debugTrace);

  return lines.join('\n');
}
