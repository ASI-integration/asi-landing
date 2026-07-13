export type BookingAutomationDisposition =
  | 'execute'
  | 'waiting_external'
  | 'retry_scheduled'
  | 'approval_required'
  | 'handoff_required'
  | 'completed'
  | 'no_action';

export type BookingAutomationActionCode =
  | 'initialize_lifecycle'
  | 'ensure_guest_intake'
  | 'prepare_guest_data_request'
  | 'prepare_documents_request'
  | 'prepare_contract'
  | 'prepare_deposit_request'
  | 'prepare_mvd_draft'
  | 'prepare_checkin_instructions'
  | 'queue_checkin_instructions'
  | 'request_arrival_confirmation'
  | 'activate_turnover_cleaning'
  | 'assign_cleaner'
  | 'recompute_physical_readiness'
  | 'approve_physical_readiness'
  | 'reconcile_operator_alerts';

export type BookingAutomationStep = {
  code: BookingAutomationActionCode;
  domain: string;
  gateKey: string | null;
  disposition: BookingAutomationDisposition;
  reasonCode: string;
  requiresApproval: boolean;
  retryAt: string | null;
  safeMetadata: Record<string, unknown>;
};

export type BookingAutomationPolicyDecision = {
  code: 'allowed' | 'review_required' | 'quiet_hours' | 'rate_limited' | 'blocked' | 'unsafe';
  retryAt?: string | null;
  reasonCode?: string | null;
  communicationIntentId?: string | null;
};

export type BookingAutomationSnapshot = {
  bookingId: string;
  accountId: string;
  propertyId: string;
  lifecycle: { exists: boolean };
  guestIntake: { exists: boolean; status: string; missingFields: string[]; requestPrepared: boolean; policy?: BookingAutomationPolicyDecision | null };
  legal: {
    documentsRequired: boolean; documents: Array<{ status: string }>;
    documentsPolicy?: BookingAutomationPolicyDecision | null;
    contractRequired: boolean; contractStatus: string | null;
    contractPolicy?: BookingAutomationPolicyDecision | null;
    depositRequired: boolean; depositStatus: string | null;
    depositPolicy?: BookingAutomationPolicyDecision | null;
    mvdRequired: boolean; mvdStatus: string | null; canonicalDataComplete: boolean;
    mvdPolicy?: BookingAutomationPolicyDecision | null;
  };
  checkin: { instructionsStatus: string; arrivalStatus: string; prerequisitesComplete: boolean; policy?: BookingAutomationPolicyDecision | null };
  physical: {
    tasksExist: boolean; cleaningStatus: string | null; deterministicCleaner: Record<string, string> | null;
    readinessStatus: string | null; physicalStateChanged: boolean; autoApprovalAuthorized: boolean;
  };
  retry: { nextRetryAt: string | null; attemptCount: number; maxAttempts: number; lastAction: string | null; lastErrorCode: string | null };
  now: string;
};

const step = (
  code: BookingAutomationActionCode,
  domain: string,
  gateKey: string | null,
  disposition: BookingAutomationDisposition,
  reasonCode: string,
  options: { requiresApproval?: boolean; retryAt?: string | null; safeMetadata?: Record<string, unknown> } = {},
): BookingAutomationStep => ({
  code, domain, gateKey, disposition, reasonCode,
  requiresApproval: options.requiresApproval === true,
  retryAt: options.retryAt ?? null,
  safeMetadata: options.safeMetadata ?? {},
});

function communicationOutcome(
  code: BookingAutomationActionCode,
  domain: string,
  gateKey: string,
  policy: BookingAutomationPolicyDecision | null | undefined,
): BookingAutomationStep | null {
  if (!policy) return null;
  const safeMetadata = policy.communicationIntentId ? { referenceId: policy.communicationIntentId, policyDecision: policy.code } : { policyDecision: policy.code };
  if (policy.code === 'review_required') return step(code, domain, gateKey, 'approval_required', 'policy_review_required', { requiresApproval: true, safeMetadata });
  if (policy.code === 'quiet_hours' || policy.code === 'rate_limited') return step(code, domain, gateKey, 'retry_scheduled', policy.code, { retryAt: policy.retryAt ?? null, safeMetadata });
  if (policy.code === 'blocked' || policy.code === 'unsafe') return step(code, domain, gateKey, 'handoff_required', policy.reasonCode ?? (policy.code === 'unsafe' ? 'unsafe_content' : 'policy_blocked'), { safeMetadata });
  return step(code, domain, gateKey, 'waiting_external', 'communication_queued', { safeMetadata });
}

/** Pure and deterministic. Real-world facts are only read, never inferred or advanced. */
export function planBookingOpsAutomation(snapshot: BookingAutomationSnapshot, maxActions = 5): BookingAutomationStep[] {
  const limit = Math.max(0, Math.min(5, Math.floor(maxActions)));
  const planned: BookingAutomationStep[] = [];
  const mutatedGates = new Set<string>();
  let executable = 0;
  const add = (candidate: BookingAutomationStep) => {
    if (candidate.disposition === 'execute') {
      if (executable >= limit) return;
      if (candidate.gateKey && mutatedGates.has(candidate.gateKey)) return;
      executable += 1;
      if (candidate.gateKey) mutatedGates.add(candidate.gateKey);
    }
    planned.push(candidate);
  };

  const nowMs = new Date(snapshot.now).getTime();
  const retryMs = snapshot.retry.nextRetryAt ? new Date(snapshot.retry.nextRetryAt).getTime() : 0;
  if (retryMs > nowMs) {
    add(step((snapshot.retry.lastAction as BookingAutomationActionCode) || 'reconcile_operator_alerts', 'automation', null, 'retry_scheduled', snapshot.retry.lastErrorCode ?? 'retry_not_due', { retryAt: snapshot.retry.nextRetryAt }));
    return planned;
  }
  if (snapshot.retry.attemptCount >= snapshot.retry.maxAttempts && snapshot.retry.lastErrorCode) {
    add(step((snapshot.retry.lastAction as BookingAutomationActionCode) || 'reconcile_operator_alerts', 'automation', null, 'handoff_required', 'retry_exhausted', { safeMetadata: { automationAttemptCount: snapshot.retry.attemptCount, failureCode: snapshot.retry.lastErrorCode } }));
    return planned;
  }

  if (!snapshot.lifecycle.exists) add(step('initialize_lifecycle', 'lifecycle', 'booking_received', 'execute', 'lifecycle_missing'));

  const intakeComplete = ['completed'].includes(snapshot.guestIntake.status) && snapshot.guestIntake.missingFields.length === 0;
  if (!snapshot.guestIntake.exists) add(step('ensure_guest_intake', 'guest_intake', 'guest_data_complete', 'execute', 'guest_intake_missing'));
  if (!intakeComplete && !snapshot.guestIntake.requestPrepared) {
    add(step('prepare_guest_data_request', 'guest_intake', 'guest_data_complete', 'execute', 'guest_data_missing'));
  } else if (!intakeComplete) {
    add(communicationOutcome('prepare_guest_data_request', 'guest_intake', 'guest_data_complete', snapshot.guestIntake.policy)
      ?? step('prepare_guest_data_request', 'guest_intake', 'guest_data_complete', 'waiting_external', 'waiting_for_guest'));
  }

  const documentsRequested = snapshot.legal.documents.some((item) => ['requested', 'received', 'verified'].includes(item.status));
  const documentsInvalid = snapshot.legal.documents.some((item) => ['rejected', 'expired', 'missing'].includes(item.status));
  if (snapshot.legal.documentsRequired && !documentsRequested) add(step('prepare_documents_request', 'documents', 'documents_requested', 'execute', 'documents_not_requested'));
  else if (documentsInvalid) add(step('prepare_documents_request', 'documents', 'documents_verified', 'handoff_required', 'documents_invalid'));
  else if (snapshot.legal.documentsRequired && !snapshot.legal.documents.every((item) => item.status === 'verified')) add(communicationOutcome('prepare_documents_request', 'documents', 'documents_verified', snapshot.legal.documentsPolicy) ?? step('prepare_documents_request', 'documents', 'documents_verified', 'waiting_external', 'waiting_for_documents'));

  if (snapshot.legal.contractRequired && (!snapshot.legal.contractStatus || snapshot.legal.contractStatus === 'not_started')) add(step('prepare_contract', 'contract', 'contract_prepared', 'execute', 'contract_not_prepared'));
  else if (snapshot.legal.contractRequired && !['signed'].includes(snapshot.legal.contractStatus ?? '')) add(communicationOutcome('prepare_contract', 'contract', 'contract_signed', snapshot.legal.contractPolicy) ?? step('prepare_contract', 'contract', 'contract_signed', 'waiting_external', 'waiting_for_signature'));

  if (snapshot.legal.depositRequired && (!snapshot.legal.depositStatus || snapshot.legal.depositStatus === 'not_requested')) add(step('prepare_deposit_request', 'deposit', 'deposit_requested', 'execute', 'deposit_not_requested'));
  else if (snapshot.legal.depositRequired && snapshot.legal.depositStatus === 'failed') add(step('prepare_deposit_request', 'deposit', 'deposit_received', 'handoff_required', 'payment_exception'));
  else if (snapshot.legal.depositRequired && snapshot.legal.depositStatus !== 'received') add(communicationOutcome('prepare_deposit_request', 'deposit', 'deposit_received', snapshot.legal.depositPolicy) ?? step('prepare_deposit_request', 'deposit', 'deposit_received', 'waiting_external', 'waiting_for_payment'));

  if (snapshot.legal.mvdRequired && (!snapshot.legal.mvdStatus || snapshot.legal.mvdStatus === 'not_started')) {
    add(snapshot.legal.canonicalDataComplete
      ? step('prepare_mvd_draft', 'mvd', 'mvd_report_prepared', 'execute', 'mvd_not_prepared')
      : step('prepare_guest_data_request', 'mvd', 'guest_data_complete', 'waiting_external', 'mvd_data_request_active'));
  } else if (snapshot.legal.mvdRequired && !['submitted', 'accepted'].includes(snapshot.legal.mvdStatus ?? '')) add(communicationOutcome('prepare_mvd_draft', 'mvd', 'mvd_report_submitted', snapshot.legal.mvdPolicy) ?? step('prepare_mvd_draft', 'mvd', 'mvd_report_submitted', 'waiting_external', 'waiting_for_mvd_submission'));

  if (snapshot.checkin.instructionsStatus === 'not_prepared') {
    add(snapshot.checkin.prerequisitesComplete
      ? step('prepare_checkin_instructions', 'checkin', 'checkin_instructions_sent', 'execute', 'instructions_not_prepared')
      : step('prepare_checkin_instructions', 'checkin', 'checkin_instructions_sent', 'no_action', 'checkin_prerequisites_incomplete'));
  } else if (snapshot.checkin.instructionsStatus === 'prepared') add(step('queue_checkin_instructions', 'checkin', 'checkin_instructions_sent', 'execute', 'instructions_ready_to_queue'));
  else if (snapshot.checkin.instructionsStatus === 'queued') add(communicationOutcome('queue_checkin_instructions', 'checkin', 'checkin_instructions_sent', snapshot.checkin.policy) ?? step('queue_checkin_instructions', 'checkin', 'checkin_instructions_sent', 'waiting_external', 'instructions_queued'));
  else if (snapshot.checkin.instructionsStatus === 'sent' && snapshot.checkin.arrivalStatus === 'unknown') add(step('request_arrival_confirmation', 'checkin', null, 'execute', 'arrival_time_unknown'));

  if (!snapshot.physical.tasksExist) add(step('activate_turnover_cleaning', 'physical', 'property_ready', 'execute', 'physical_tasks_missing'));
  else if (snapshot.physical.cleaningStatus === 'pending') {
    add(snapshot.physical.deterministicCleaner
      ? step('assign_cleaner', 'physical', 'cleaning', 'execute', 'deterministic_cleaner_available', { safeMetadata: snapshot.physical.deterministicCleaner })
      : step('assign_cleaner', 'physical', 'cleaning', 'handoff_required', 'no_eligible_cleaner'));
  } else if (snapshot.physical.cleaningStatus && !['verified', 'blocked', 'cancelled'].includes(snapshot.physical.cleaningStatus)) {
    add(step('recompute_physical_readiness', 'physical', 'cleaning', 'waiting_external', 'waiting_for_cleaning_fact'));
  }
  if (snapshot.physical.physicalStateChanged || !snapshot.physical.readinessStatus) add(step('recompute_physical_readiness', 'physical', 'property_ready', 'execute', 'physical_readiness_stale'));
  if (snapshot.physical.readinessStatus === 'ready_for_review') add(snapshot.physical.autoApprovalAuthorized
    ? step('approve_physical_readiness', 'physical', 'property_ready', 'execute', 'auto_approval_authorized')
    : step('approve_physical_readiness', 'physical', 'property_ready', 'approval_required', 'physical_readiness_approval_required', { requiresApproval: true }));

  if (planned.length === 0) add(step('reconcile_operator_alerts', 'automation', null, 'completed', 'automation_complete'));
  return planned;
}
