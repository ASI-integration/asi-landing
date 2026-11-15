/** Offline assessment of supplied receipts, never a collector or authority grant.
 * READY_FOR_DEMO describes only the bounded synthetic staging pilot. It does not
 * claim production readiness, automation coverage, or permission to execute.
 */
export const STRIGUNOV_CRITERIA = {
  G2: ['effective_allowlists', 'seven_no_send_flags', 'approved_human_login'],
  G3: ['historical_write_unknown_no_replay', 'reserved_roots_reconciled_records_preserved', 'fresh_approved_nonoverlapping_scope'],
  G4: ['intake_duplicate_one_booking', 'authorized_crm_booking', 'cleaning_linen_supplies_readback', 'readiness_readback', 'unknown_stops_without_retry_or_cleanup'],
  G5: ['human_ui_exact_booking', 'unauthenticated_cross_account_denied', 'get_ui_no_writes', 'independent_interval_no_send'],
  G6: ['prior_gates_source_run_bound', 'independent_route_review_no_guest_data', 'explicit_owner_acceptance'],
} as const;

export type StrigunovGate = keyof typeof STRIGUNOV_CRITERIA;
export type EvidenceStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export interface ReadinessIdentity {
  readonly environment: 'staging';
  readonly sourceSha: string;
  readonly target: string;
  readonly runId: string;
  readonly accountId: string;
  readonly propertyId: string;
  readonly intervalId: string;
}
export interface ReadinessEvidence {
  readonly gate: StrigunovGate;
  readonly criterion: string;
  readonly kind: 'source' | 'ci' | 'staging';
  readonly status: EvidenceStatus;
  readonly reference: string;
  readonly sourceSha: string;
  readonly identity?: ReadinessIdentity;
}
export interface StrigunovReadinessInput {
  readonly identity?: ReadinessIdentity;
  readonly evidence?: readonly ReadinessEvidence[];
}

const gates = Object.keys(STRIGUNOV_CRITERIA) as StrigunovGate[];
const identityKeys: readonly (keyof ReadinessIdentity)[] = [
  'environment', 'sourceSha', 'target', 'runId', 'accountId', 'propertyId', 'intervalId',
];
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** No I/O, clocks, environment reads, callbacks, retries, or input mutation.
 * References are supplied evidence labels; this function cannot authenticate them.
 * An unresolved historical write is compatible with G3 only when the dedicated
 * no-replay/reconciliation criteria are proven; UNKNOWN never becomes PASS.
 */
export function assessStrigunovReadiness(input: StrigunovReadinessInput = {}) {
  const identity = input.identity;
  const validIdentity = identity !== undefined &&
    identity.environment === 'staging' &&
    identityKeys.every(key => nonempty(identity[key])) &&
    /^[a-f0-9]{40}$/i.test(identity.sourceSha);
  const evidence = input.evidence ?? [];
  const stages = gates.map(gate => {
    const criteria = STRIGUNOV_CRITERIA[gate].map(criterion => {
      const matching = evidence.filter(item => item.gate === gate && item.criterion === criterion);
      const source = matching.filter(item => item.kind === 'source' &&
        nonempty(item.reference) && validIdentity && item.sourceSha === identity?.sourceSha);
      const ci = matching.filter(item => item.kind === 'ci' &&
        nonempty(item.reference) && validIdentity && item.sourceSha === identity?.sourceSha);
      const staging = matching.filter(item => item.kind === 'staging' &&
        nonempty(item.reference) && validIdentity && item.sourceSha === identity?.sourceSha &&
        identityKeys.every(key => item.identity?.[key] === identity?.[key]));
      const summarize = (items: readonly ReadinessEvidence[]): EvidenceStatus =>
        items.some(item => item.status === 'FAIL') ? 'FAIL' :
          items.length > 0 && items.every(item => item.status === 'PASS') ? 'PASS' : 'UNKNOWN';
      const sourceStatus = summarize(source);
      const stagingStatus = summarize(staging);
      const missingEvidence: string[] = [];
      if (!validIdentity) missingEvidence.push('MISSING_OR_INVALID_STAGING_IDENTITY');
      if (sourceStatus === 'UNKNOWN') missingEvidence.push('MISSING_SOURCE_EVIDENCE');
      if (stagingStatus === 'UNKNOWN') missingEvidence.push('MISSING_STAGING_ACCEPTANCE_EVIDENCE');
      const status: EvidenceStatus = sourceStatus === 'FAIL' || stagingStatus === 'FAIL' ? 'FAIL' :
        sourceStatus === 'PASS' && stagingStatus === 'PASS' ? 'PASS' : 'UNKNOWN';
      return { criterion, sourceStatus, ciStatus: summarize(ci), stagingStatus, status, missingEvidence };
    });
    const status: EvidenceStatus = criteria.some(item => item.status === 'FAIL') ? 'FAIL' :
      criteria.every(item => item.status === 'PASS') ? 'PASS' : 'UNKNOWN';
    return { gate, status, criteria };
  });
  return {
    scope: 'BOUNDED_SYNTHETIC_STAGING_PILOT' as const,
    status: stages.every(stage => stage.status === 'PASS') ? 'READY_FOR_DEMO' as const : 'NOT_READY' as const,
    authorized: false as const,
    stages,
  };
}
