import type { IncidentRecord } from './types';

// ─── Decision Engine Types ────────────────────────────────────────────────────

export type EvidenceConfidence = 'low' | 'medium' | 'high';

export type CostTier = 'micro' | 'minor' | 'major';

export type GuestTier = 'strict' | 'trusted' | 'privileged';

export type DelegationLevel = 'soft' | 'medium' | 'hard';

export type CommunicationMode = 'silent' | 'soft' | 'warning' | 'escalation';

export type RecommendedPayer = 'guest' | 'owner' | 'insurance' | 'operator' | 'none';

export interface OpsDecisionInput {
  incident: IncidentRecord;
  evidenceConfidence: EvidenceConfidence;
  costTier: CostTier;
  guestTier: GuestTier;
  toleranceScore: number; // 0..100
  incidentHistoryCount: number; // 0 = first time
  delegationLevel: DelegationLevel;
  bookingChannel: 'ota' | 'direct';
}

export interface EscalationInput {
  blockCheckin: boolean;
  recommendedPayer: RecommendedPayer;
  communicationMode: CommunicationMode;
  evidenceConfidence: EvidenceConfidence;
  delegationLevel: DelegationLevel;
  costTier: CostTier;
}

export interface OpsDecisionResult {
  blockCheckin: boolean;
  recommendedPayer: RecommendedPayer;
  communicationMode: CommunicationMode;
  escalateToHuman: boolean;
  reasons: string[];
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function isHardSafetyBlock(input: OpsDecisionInput): boolean {
  const { incident } = input;
  if (incident.type === 'damage' && incident.severity === 'high') return true;
  if (incident.type === 'unauthorized_access') return true;
  return false;
}

function toleranceBand(toleranceScore: number): 'strict' | 'balanced' | 'relaxed' {
  if (toleranceScore <= 30) return 'strict';
  if (toleranceScore <= 70) return 'balanced';
  return 'relaxed';
}

function isRepeatedIncident(input: OpsDecisionInput): boolean {
  return input.incidentHistoryCount > 0;
}

// ─── Pure Decision Functions ──────────────────────────────────────────────────

export function shouldBlockCheckin(input: OpsDecisionInput): boolean {
  const { incident, evidenceConfidence, costTier, toleranceScore } = input;

  // Hard safety: always block, tolerance cannot override
  if (isHardSafetyBlock(input)) return true;

  // Major cost always blocks
  if (costTier === 'major') return true;

  // Damage at medium severity blocks
  if (incident.type === 'damage' && incident.severity === 'medium') return true;

  // High-confidence smoking evidence blocks
  if (incident.type === 'smoking_suspected' && evidenceConfidence === 'high') return true;

  // Mess and party: block unless tolerance is relaxed
  if (incident.type === 'excessive_mess' || incident.type === 'party_suspected') {
    if (toleranceBand(toleranceScore) === 'relaxed') return false;
    return true;
  }

  // Low-confidence noise-only signals: do not block
  if (incident.type === 'noise_violation' && evidenceConfidence === 'low') return false;

  // Micro cost: do not block
  if (costTier === 'micro') return false;

  return false;
}

export function recommendPayer(input: OpsDecisionInput): RecommendedPayer {
  const { costTier, incidentHistoryCount, evidenceConfidence } = input;

  if (costTier === 'micro') return 'owner';

  if (costTier === 'minor') {
    if (incidentHistoryCount === 0) return 'owner';
    if (
      isRepeatedIncident(input) &&
      (evidenceConfidence === 'medium' || evidenceConfidence === 'high')
    ) {
      return 'guest';
    }
    return 'owner';
  }

  // major
  if (evidenceConfidence === 'high') return 'guest';
  return 'insurance';
}

export function chooseCommunicationMode(input: OpsDecisionInput): CommunicationMode {
  const { costTier, guestTier, incidentHistoryCount, bookingChannel, toleranceScore } = input;

  // Micro: always silent
  if (costTier === 'micro') return 'silent';

  // Major or OTA dispute situations: escalation
  if (costTier === 'major') return 'escalation';
  if (bookingChannel === 'ota' && input.incident.otaCaseRequired) return 'escalation';

  // Minor tier
  const band = toleranceBand(toleranceScore);
  const isFirstTime = incidentHistoryCount === 0;
  const isSoftGuest = guestTier === 'trusted' || guestTier === 'privileged';

  if (isFirstTime && isSoftGuest) {
    // Trusted/privileged first-time minor: softest mode
    return band === 'strict' ? 'soft' : 'silent';
  }

  if (isFirstTime) {
    return 'soft';
  }

  // Repeated minor
  if (band === 'relaxed' && isSoftGuest) return 'soft';
  return 'warning';
}

export function shouldEscalateToHuman(input: EscalationInput): boolean {
  const { blockCheckin, recommendedPayer, communicationMode, evidenceConfidence, delegationLevel, costTier } = input;

  // Always escalate for escalation-mode communication
  if (communicationMode === 'escalation') return true;

  // Guest or insurance liability at non-micro cost
  if (
    (recommendedPayer === 'guest' || recommendedPayer === 'insurance') &&
    costTier !== 'micro'
  ) {
    return true;
  }

  // Low-confidence block: human must confirm
  if (evidenceConfidence === 'low' && blockCheckin) return true;

  // Soft delegation on any non-micro incident
  if (delegationLevel === 'soft' && costTier !== 'micro') return true;

  return false;
}

// ─── Reason Builders ─────────────────────────────────────────────────────────

function collectReasons(
  input: OpsDecisionInput,
  blockCheckin: boolean,
  recommendedPayer: RecommendedPayer,
  communicationMode: CommunicationMode,
  escalateToHuman: boolean,
): string[] {
  const reasons: string[] = [];
  const { incident, costTier, evidenceConfidence, guestTier, delegationLevel, incidentHistoryCount } = input;

  if (isHardSafetyBlock(input)) reasons.push('hard_safety_block');

  if (costTier === 'micro') reasons.push('micro_owner_absorb');

  if (costTier === 'major' && evidenceConfidence === 'high' && recommendedPayer === 'guest') {
    reasons.push('major_high_confidence_guest_liability');
  }

  if (costTier === 'major' && evidenceConfidence !== 'high' && recommendedPayer === 'insurance') {
    reasons.push('major_low_confidence_insurance_absorb');
  }

  if (
    (guestTier === 'trusted' || guestTier === 'privileged') &&
    (communicationMode === 'soft' || communicationMode === 'silent')
  ) {
    reasons.push('trusted_guest_soft_communication');
  }

  if (delegationLevel === 'soft' && escalateToHuman && costTier !== 'micro') {
    reasons.push('soft_delegation_requires_human_review');
  }

  if (evidenceConfidence === 'low' && blockCheckin) {
    reasons.push('low_confidence_block_requires_human_verification');
  }

  if (incidentHistoryCount > 0 && recommendedPayer === 'guest') {
    reasons.push('repeated_incident_guest_liability');
  }

  if (
    (incident.type === 'excessive_mess' || incident.type === 'party_suspected') &&
    blockCheckin
  ) {
    reasons.push('mess_or_party_checkin_blocked');
  }

  if (incident.type === 'smoking_suspected' && evidenceConfidence === 'high' && blockCheckin) {
    reasons.push('high_confidence_smoking_block');
  }

  if (communicationMode === 'escalation') {
    reasons.push('escalation_mode_triggers_human_review');
  }

  return reasons;
}

// ─── Primary Entrypoint ───────────────────────────────────────────────────────

export function evaluateOpsDecision(input: OpsDecisionInput): OpsDecisionResult {
  const blockCheckin = shouldBlockCheckin(input);
  const recommendedPayer = recommendPayer(input);
  const communicationMode = chooseCommunicationMode(input);
  const escalateToHuman = shouldEscalateToHuman({
    blockCheckin,
    recommendedPayer,
    communicationMode,
    evidenceConfidence: input.evidenceConfidence,
    delegationLevel: input.delegationLevel,
    costTier: input.costTier,
  });

  const reasons = collectReasons(
    input,
    blockCheckin,
    recommendedPayer,
    communicationMode,
    escalateToHuman,
  );

  return {
    blockCheckin,
    recommendedPayer,
    communicationMode,
    escalateToHuman,
    reasons,
  };
}
