import type { LaunchReadiness, OperationalReadiness } from '../ops-v17/types';
import type { PreCheckinReadinessSnapshot } from '../booking-ops/pre-checkin-control-center';
import type { CheckinExecutionSnapshot } from '../booking-ops/checkin-execution-autopilot';
import type { InStayCheckoutSnapshot, BookingCloseMissingPrerequisite, GuestStayIssueRow } from '../booking-ops/instay-checkout-autopilot';
import type { shouldBlockCheckinInstructions } from '../booking-ops/guest-legal-deposit-mvd-execution';
import { isFresh, makeDecision, type DecisionAction, type DecisionEvidence, type DecisionReason,
  type DecisionStatus, type DecisionTopic, type PlatformDecision } from './decision';
import { snapshotProblem, type IdentifiedScope, type ScopedSnapshot } from './snapshot';

export type ResidentialOpsOutput =
  | { kind: 'pilot'; launch: LaunchReadiness; operational: OperationalReadiness }
  | { kind: 'pre_checkin'; readiness: PreCheckinReadinessSnapshot }
  | { kind: 'checkin'; checkin: CheckinExecutionSnapshot; legalGuard: Awaited<ReturnType<typeof shouldBlockCheckinInstructions>> }
  | { kind: 'in_stay' | 'checkout' | 'deposit'; checkout: InStayCheckoutSnapshot }
  | { kind: 'closeout'; checkout: InStayCheckoutSnapshot; prerequisites: BookingCloseMissingPrerequisite[] };

function blockerReason(key: string): DecisionReason {
  if (key === 'cleaning_scheduled' || key === 'cleaning_incomplete' || key === 'physical:cleaning_not_verified') return 'cleaning_incomplete';
  if (key === 'property_ready' || key === 'property_not_ready') return 'property_not_ready';
  if (key === 'access_issue') return 'access_issue';
  if (key === 'open_stay_issues' || key === 'guest_issue_open') return 'open_incident';
  if (key === 'deposit_return_incomplete') return 'deposit_unresolved';
  return 'domain_blocker';
}
/** Maps canonical outputs; it does not calculate gates or invoke legacy stateful status getters. */
export function adaptResidentialOpsDecision(identity: IdentifiedScope, topic: Exclude<DecisionTopic, 'communication' | 'location' | 'incident'>,
  snapshot: ScopedSnapshot<ResidentialOpsOutput>, now: number): PlatformDecision {
  const fail = (reason: DecisionReason, status: DecisionStatus = 'unavailable') => makeDecision({
    identity, topic, now, status, reasons: [reason], blockers: [reason] });
  const problem = snapshotProblem(identity, snapshot, now);
  if (problem || !snapshot.available) return fail(problem ?? 'unavailable');
  const value = snapshot.value;
  if (!value || value.kind !== topic) return fail('malformed');
  const evidence: DecisionEvidence[] = [];
  const ref = (source: DecisionEvidence['source'], observedAt: string, index = 0) => evidence.push({ source, index, observedAt, origin: 'canonical' });
  const finish = (blockers: DecisionReason[], manual: DecisionReason[], allowed: DecisionAction[], warnings: DecisionReason[] = []) =>
    makeDecision({ identity, topic, now, status: blockers.length ? 'blocked' : manual.length ? 'review_required' : 'allowed',
      reasons: blockers.length ? blockers : manual.length ? manual : allowed.length ? ['verified'] : ['stage_complete'],
      blockers, manualControls: manual,
      limitations: warnings, evidence, allowedActions: blockers.length ? ['request_operator_review', 'remediate'] : allowed });
  try {
    if (value.kind === 'pilot') {
      const { launch, operational: ops } = value;
      if (!launch || !ops || typeof ops.ready !== 'boolean' || !Array.isArray(ops.blockers)
        || !Array.isArray(ops.manualControls) || !Array.isArray(ops.checks) || !ops.checks.length
        || !Array.isArray(launch.blockingItems) || !Array.isArray(launch.warnings)
        || !['draft', 'collecting_data', 'needs_verification', 'blocked', 'ready_for_pilot', 'pilot_active', 'degraded'].includes(launch.status)
        || ops.checks.some(c => !['ready', 'manual', 'blocked'].includes(c.status))) return fail('malformed');
      ref('ops_launch', snapshot.observedAt);
      ops.checks.forEach((_, i) => ref('ops_operational', snapshot.observedAt, i));
      const blockers: DecisionReason[] = !ops.ready || ops.blockers.length || launch.blockingItems.length
        || ops.checks.some(c => c.status === 'blocked') || !['ready_for_pilot', 'pilot_active'].includes(launch.status) ? ['domain_blocker'] : [];
      const manual: DecisionReason[] = ops.manualControls.length || ops.checks.some(c => c.status === 'manual') ? ['manual_control'] : [];
      return finish(blockers, manual, ['review_pilot'], launch.warnings.length ? ['domain_warning'] : []);
    }
    if (!identity.bookingId) return fail('scope_mismatch');
    if (value.kind === 'pre_checkin') {
      const r = value.readiness;
      if (!r || r.bookingId !== identity.bookingId) return fail('scope_mismatch');
      if (!isFresh(r.lastRecomputedAt, now)) return fail('stale');
      if (!Array.isArray(r.hardBlockers) || !Array.isArray(r.warnings) || !Array.isArray(r.requiredActions)
        || !['ready_for_checkin', 'needs_attention', 'blocked', 'overdue', 'checked_in', 'closed'].includes(r.status)) return fail('malformed');
      ref('pre_checkin', r.lastRecomputedAt);
      const blockers = r.hardBlockers.map(b => blockerReason(b.key));
      const complete = r.status === 'checked_in' || r.status === 'closed';
      if (['blocked', 'overdue'].includes(r.status) && !blockers.length) blockers.push('property_not_ready');
      const manual: DecisionReason[] = (!complete && r.requiredActions.length) || r.warnings.length
        || r.status === 'needs_attention' ? ['manual_control'] : [];
      return finish(blockers, manual, complete ? [] : ['prepare_operator_draft'], r.warnings.length ? ['domain_warning'] : []);
    }
    if (value.kind === 'checkin') {
      const r = value.checkin, guard = value.legalGuard;
      if (!r || r.bookingId !== identity.bookingId || r.preCheckin?.bookingId !== identity.bookingId
        || (r.execution && r.execution.bookingId !== identity.bookingId)
        || (r.lifecycle && r.lifecycle.bookingId !== identity.bookingId)
        || guard?.readiness?.bookingId !== identity.bookingId || guard.readiness.propertyId !== identity.propertyId) return fail('scope_mismatch');
      if (!isFresh(r.updatedAt, now) || !isFresh(r.preCheckin.lastRecomputedAt, now)
        || !isFresh(guard.readiness.lastCheckedAt, now)) return fail('stale');
      if (typeof guard.block !== 'boolean' || typeof r.lifecycleReady !== 'boolean' || !Array.isArray(r.blockers)
        || !Array.isArray(r.preCheckin.hardBlockers) || !Array.isArray(r.preCheckin.warnings)
        || !['ready_for_checkin', 'needs_attention', 'blocked', 'overdue', 'checked_in', 'closed'].includes(r.preCheckin.status)
        || !Array.isArray(guard.readiness.blockers)
        || !['not_prepared', 'prepared', 'queued', 'sent', 'failed'].includes(r.instructionsStatus)
        || !['unknown', 'ready', 'issue', 'resolved'].includes(r.accessStatus)
        || !['not_ready', 'ready_to_send_instructions', 'instructions_queued', 'instructions_sent', 'arrival_pending',
          'arrival_confirmed', 'access_ready', 'access_issue', 'checked_in', 'blocked'].includes(r.status)) return fail('malformed');
      ref('checkin', r.updatedAt); ref('legal_guard', guard.readiness.lastCheckedAt!);
      const blockers = r.blockers.filter(b => b.key !== 'checkin_instructions_sent').map(b => blockerReason(b.key));
      blockers.push(...r.preCheckin.hardBlockers.filter(b => b.key !== 'checkin_instructions_sent').map(b => blockerReason(b.key)));
      const complete = r.status === 'checked_in' || r.execution?.status === 'checked_in'
        || r.preCheckin.status === 'checked_in' || r.preCheckin.status === 'closed';
      // Terminal stages suppress obsolete work even if an older readiness flag is false.
      if (!complete && (!r.lifecycleReady || ['blocked', 'overdue'].includes(r.preCheckin.status))) blockers.push('property_not_ready');
      if (guard.block || guard.readiness.blockers.length) blockers.push('legal_blocked');
      if (r.accessStatus === 'issue') blockers.push('access_issue');
      else if (!complete && !['ready', 'resolved'].includes(r.accessStatus)) blockers.push('access_unverified');
      if (r.status === 'not_ready' || r.status === 'blocked' || r.status === 'access_issue'
        || r.instructionsStatus === 'failed') blockers.push('domain_blocker');
      const manual: DecisionReason[] = r.preCheckin.warnings.length ? ['manual_control'] : [];
      if (complete) return finish(blockers, manual, []);
      if ((r.status === 'instructions_sent' && r.instructionsStatus !== 'sent')
        || (r.status === 'instructions_queued' && r.instructionsStatus !== 'queued')) blockers.push('conflicting');
      // Access readiness does not prove that a releasable instruction draft exists.
      if (r.instructionsStatus === 'not_prepared') manual.push('manual_control');
      if (manual.length) return finish(blockers, manual, ['prepare_operator_draft', 'request_operator_review']);
      const allowed: DecisionAction[] = r.instructionsStatus === 'sent' ? [] : ['prepare_operator_draft'];
      if (r.instructionsStatus === 'prepared' || r.instructionsStatus === 'queued') allowed.push('release_instructions');
      if (r.accessStatus === 'ready' || r.accessStatus === 'resolved') allowed.push('release_access');
      // Advisory proposal only: transport, ownership and canonical domain guards must re-run.
      return finish(blockers, [], allowed);
    }
    const r = value.checkout;
    if (!r || r.bookingId !== identity.bookingId || (r.execution && r.execution.bookingId !== identity.bookingId)
      || (r.lifecycle && r.lifecycle.bookingId !== identity.bookingId)
      || !Array.isArray(r.openIssues) || r.openIssues.some(i => i.bookingId !== identity.bookingId)) return fail('scope_mismatch');
    if (!isFresh(r.updatedAt, now) || r.openIssues.some(i => !isFresh(i.updatedAt, now))) return fail('stale');
    if (!Array.isArray(r.blockers) || !Number.isInteger(r.openIssuesCount) || r.openIssuesCount < 0
      || r.openIssuesCount !== r.openIssues.length
      || !['not_ready', 'ready', 'held', 'partially_held', 'returned', 'waived'].includes(r.depositReturnStatus)
      || !['open', 'ready_to_close', 'closed', 'blocked'].includes(r.closureStatus)
      || !['not_requested', 'requested', 'confirmed', 'missed'].includes(r.checkoutConfirmationStatus)
      || !['not_started', 'scheduled', 'done', 'issue_found', 'failed'].includes(r.inspectionStatus)
      || !['not_checked_in', 'in_stay', 'guest_issue_open', 'guest_issue_blocked', 'checkout_preparing',
        'checkout_instructions_queued', 'checkout_pending', 'checked_out', 'inspection_pending', 'inspection_done',
        'deposit_return_ready', 'ready_to_close', 'closed', 'blocked'].includes(r.status)) return fail('malformed');
    ref('checkout', r.updatedAt);
    const blockers = r.blockers.map(b => blockerReason(b.key));
    if (r.openIssuesCount > 0) blockers.push('open_incident');
    if (r.status === 'blocked' || r.closureStatus === 'blocked') blockers.push('domain_blocker');
    // Closeout always needs the canonical guard, including for an already closed display.
    if (value.kind === 'closeout') {
      if (!Array.isArray(value.prerequisites)) return fail('unavailable');
      if (value.prerequisites.some(p => p.key === 'legal_readiness_unavailable')) return fail('unavailable');
      value.prerequisites.forEach((_, i) => ref('close_prerequisites', snapshot.observedAt, i));
      if (value.prerequisites.length) blockers.push('close_prerequisites', ...value.prerequisites.map(p => blockerReason(p.key)));
    }
    const closed = r.status === 'closed' || r.closureStatus === 'closed'
      || r.execution?.status === 'closed' || r.execution?.closureStatus === 'closed';
    if (closed) {
      // Display/guard disagreement is review evidence, never a new closeout readiness gate.
      const manual: DecisionReason[] = ['returned', 'waived'].includes(r.depositReturnStatus) ? [] : ['deposit_unresolved'];
      return finish(blockers, manual, blockers.length || manual.length ? ['request_operator_review'] : []);
    }
    if (value.kind === 'in_stay') return finish(blockers, ['operator_controlled'], ['request_operator_review']);
    if (value.kind === 'checkout') {
      const complete = r.checkoutConfirmationStatus === 'confirmed'
        || ['checked_out', 'inspection_pending', 'inspection_done', 'deposit_return_ready', 'ready_to_close'].includes(r.status);
      if (complete) return finish(blockers, [], []);
      if (r.status === 'not_checked_in') return finish(blockers, ['conflicting'], ['request_operator_review']);
      return finish(blockers, ['checkout_pending'], ['prepare_operator_draft', 'request_operator_review']);
    }
    if (value.kind === 'deposit') {
      if (!['returned', 'waived'].includes(r.depositReturnStatus)) blockers.push('deposit_unresolved');
      // Preparation is not actual return; resolved deposits need no repeated recording.
      return finish(blockers, [], []);
    }
    if (value.kind !== 'closeout') return fail('unavailable');
    if (!['inspection_done', 'deposit_return_ready', 'ready_to_close'].includes(r.status)) {
      return finish(blockers, ['conflicting'], ['request_operator_review']);
    }
    // The canonical guard also accepts record.depositIntakeStatus=returned and explicit non-required deposits.
    // Do not introduce a second closeout engine from the snapshot's display status.
    return finish(blockers, [], ['close_booking']);
  } catch {
    return fail('malformed');
  }
}

const incidentReasons: Record<string, DecisionReason> = {
  cleaning_incomplete: 'cleaning_incomplete', cleaning: 'cleaning_incomplete',
  access_issue: 'access_issue', access: 'access_issue', lock_issue: 'access_issue',
  maintenance: 'maintenance_issue', maintenance_issue: 'maintenance_issue',
  guest_complaint: 'guest_complaint', complaint: 'guest_complaint',
  late_checkout: 'late_checkout', late_checkout_request: 'late_checkout',
  lost_item: 'lost_item', noise: 'noise_complaint', noisy_neighbor: 'noise_complaint', noise_complaint: 'noise_complaint',
  deposit_dispute: 'deposit_dispute',
};
export function adaptResidentialIncidentDecision(identity: IdentifiedScope, snapshot: ScopedSnapshot<GuestStayIssueRow>, now: number): PlatformDecision {
  const problem = snapshotProblem(identity, snapshot, now);
  const fail = (reason: DecisionReason) => makeDecision({ identity, topic: 'incident', now,
    status: 'unavailable', reasons: [reason], blockers: [reason] });
  if (problem || !snapshot.available) return fail(problem ?? 'unavailable');
  const issue = snapshot.value;
  if (!issue || !identity.bookingId || issue.bookingId !== identity.bookingId) return fail('scope_mismatch');
  if (typeof issue.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(issue.id)) return fail('malformed');
  if (!isFresh(issue.updatedAt, now)) return fail('stale');
  if (!['open', 'triaged', 'assigned', 'resolved', 'blocked', 'cancelled'].includes(issue.status)
    || typeof issue.issueType !== 'string') return fail('malformed');
  const reason = Object.hasOwn(incidentReasons, issue.issueType) ? incidentReasons[issue.issueType] : 'other_incident';
  return makeDecision({ identity, topic: 'incident', now, status: 'review_required',
    reasons: [reason], blockers: ['open', 'triaged', 'assigned', 'blocked'].includes(issue.status) ? ['open_incident'] : [],
    manualControls: ['operator_controlled'], allowedActions: ['request_operator_review', 'remediate'],
    evidence: [{ source: 'stay_issue', index: 0, recordId: issue.id, observedAt: issue.updatedAt, origin: 'canonical' }] });
}
