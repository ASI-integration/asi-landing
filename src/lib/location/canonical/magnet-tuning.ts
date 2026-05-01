import type { CanonicalMagnetDecision } from './magnet-classifier';

export type MagnetTuningProfile = Readonly<{
  distanceDecayMultiplier: number;
  audienceFitMultiplier: number;
  seasonalityMultiplier: number;
  localDemandMultiplier: number;
  confidencePenaltyMultiplier: number;
}>;

export const defaultTuningProfile: MagnetTuningProfile = Object.freeze({
  distanceDecayMultiplier: 1,
  audienceFitMultiplier: 1,
  seasonalityMultiplier: 1,
  localDemandMultiplier: 1,
  confidencePenaltyMultiplier: 1,
});

type ValidateResult = { profile: MagnetTuningProfile; warnings: string[] };

function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

/**
 * Validate and clamp tuning profile values into safe ranges.
 *
 * Hard rules:
 * - Only numeric multipliers are allowed.
 * - Multipliers are clamped to conservative bounds.
 */
export function validateTuningProfile(p: Partial<MagnetTuningProfile> | null | undefined): ValidateResult {
  const warnings: string[] = [];
  const base = p ?? {};

  const mk = (k: keyof MagnetTuningProfile, min: number, max: number) => {
    const raw = (base as any)[k];
    const v = clamp(Number(raw), min, max);
    if (raw == null) return v;
    if (!Number.isFinite(Number(raw))) warnings.push(`tuning:${String(k)}_non_finite`);
    else if (Number(raw) !== v) warnings.push(`tuning:${String(k)}_clamped`);
    return v;
  };

  // Conservative bounds: allow gentle tuning only.
  const profile: MagnetTuningProfile = {
    distanceDecayMultiplier: mk('distanceDecayMultiplier', 0.75, 1.25),
    audienceFitMultiplier: mk('audienceFitMultiplier', 0.75, 1.25),
    seasonalityMultiplier: mk('seasonalityMultiplier', 0.85, 1.15),
    localDemandMultiplier: mk('localDemandMultiplier', 0.75, 1.25),
    confidencePenaltyMultiplier: mk('confidencePenaltyMultiplier', 0.75, 1.35),
  };

  return { profile, warnings };
}

export type ApplyMagnetTuningInput = Readonly<{
  canonical: CanonicalMagnetDecision;
  baseContribution: number;
  /** 0..1 mapping confidence from raw POI → canonical; lower = harsher penalty allowed. */
  confidence01?: number;
  /** True for unknown/ambiguous raw inputs (strict-mode downgrade path). */
  unknownOrAmbiguous?: boolean;
}>;

export type ApplyMagnetTuningOutput = Readonly<{
  tunedContribution: number;
  appliedProfile: MagnetTuningProfile;
  warnings: string[];
}>;

/**
 * Apply safe data-driven tuning to a numeric contribution.
 *
 * Forbidden by construction:
 * - Cannot change canonical identity/family/tiers/eligibility/anti-signals.
 * - Cannot force prime or Tier-1 credit.
 *
 * This function only returns a tuned numeric contribution with clamps.
 */
export function applyMagnetTuning(
  input: ApplyMagnetTuningInput,
  tuningProfile: Partial<MagnetTuningProfile> | null | undefined,
): ApplyMagnetTuningOutput {
  const { profile, warnings } = validateTuningProfile(tuningProfile);

  const base = Number.isFinite(input.baseContribution) ? input.baseContribution : 0;
  const conf = input.confidence01 == null ? 1 : clamp(input.confidence01, 0, 1);

  // Core multiplicative tuning (small, bounded).
  let tuned =
    base *
    profile.distanceDecayMultiplier *
    profile.audienceFitMultiplier *
    profile.seasonalityMultiplier *
    profile.localDemandMultiplier;

  // Confidence penalty: lower confidence allows only a *downward* effect.
  // Never boosts low-confidence magnets upward.
  const penalty = (1 - conf) * (profile.confidencePenaltyMultiplier - 1);
  if (penalty > 0) tuned = tuned * clamp(1 - penalty, 0.55, 1);

  // Hard safety: unknown/ambiguous magnets cannot be amplified beyond base.
  if (input.unknownOrAmbiguous) {
    tuned = Math.min(tuned, base);
  }

  // Hard safety: weak/tertiary families must remain weak contributors.
  if (input.canonical.family === 'weak_amenity' || input.canonical.family === 'tertiary_local_amenity') {
    tuned = Math.min(tuned, base);
  }

  // Global clamp: never allow extreme swings.
  tuned = clamp(tuned, 0, base * 1.25);

  return { tunedContribution: tuned, appliedProfile: profile, warnings };
}

