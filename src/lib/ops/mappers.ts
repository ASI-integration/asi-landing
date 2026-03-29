import type { CleanerIssueReportInput, IncidentRecord } from './types';
import { type UnitState, UnitStateValue } from './unit-state';

// ─── Incident → Unit-State Patch ─────────────────────────────────────────────

export interface UnitStateIncidentPatch {
  status?: 'idle' | 'dirty' | 'ready' | 'occupied' | 'maintenance';
  readyForCheckin?: boolean;
  incidentDetected?: boolean;
  incidentSeverity?: 'low' | 'medium' | 'high';
}

export function mapIncidentToUnitStatePatch(
  incident: IncidentRecord,
): UnitStateIncidentPatch {
  const patch: UnitStateIncidentPatch = {
    incidentDetected: true,
    incidentSeverity: incident.severity,
  };

  switch (incident.type) {
    case 'damage':
      patch.status = 'maintenance';
      patch.readyForCheckin = false;
      break;
    case 'excessive_mess':
    case 'party_suspected':
    case 'smoking_suspected':
      patch.status = 'dirty';
      patch.readyForCheckin = false;
      break;
    // 'noise_violation' and 'unauthorized_access': incidentDetected only
  }

  return patch;
}

// ─── Cleaner Report → Incident + Unit-State Patch ────────────────────────────

export interface CleanerIncidentProcessingResult {
  incident: IncidentRecord;
  unitStatePatch: UnitStateIncidentPatch;
}

export function processCleanerIssueReport(
  input: CleanerIssueReportInput,
): CleanerIncidentProcessingResult {
  const incident = mapCleanerIssueToIncident(input);
  const unitStatePatch = mapIncidentToUnitStatePatch(incident);
  return { incident, unitStatePatch };
}

// ─── Apply Incident Patch to Unit State ───────────────────────────────────────

export function applyIncidentPatchToUnitState(
  current: UnitState,
  patch: UnitStateIncidentPatch,
): UnitState {
  const next = { ...current };

  if (patch.status !== undefined) {
    switch (patch.status) {
      case 'dirty':
        next.current_state = UnitStateValue.TurnoverNeeded;
        next.dirty = true;
        break;
      case 'maintenance':
        next.current_state = UnitStateValue.Blocked;
        next.blocked_reason = 'incident_maintenance';
        break;
      case 'idle':
        next.current_state = UnitStateValue.Idle;
        break;
      case 'ready':
        next.current_state = UnitStateValue.Ready;
        break;
      case 'occupied':
        next.current_state = UnitStateValue.Occupied;
        break;
    }
  }

  if (patch.readyForCheckin !== undefined) {
    next.ready_for_checkin = patch.readyForCheckin;
  }

  // patch.incidentDetected and patch.incidentSeverity have no corresponding
  // fields on UnitState — not mapped.

  return next;
}

// ─── Simulate Cleaner Incident on Unit State ──────────────────────────────────

export function simulateCleanerIncidentOnUnitState(
  current: UnitState,
  input: CleanerIssueReportInput,
): UnitState {
  const { unitStatePatch } = processCleanerIssueReport(input);
  return applyIncidentPatchToUnitState(current, unitStatePatch);
}

// ─── Evaluate Check-in Readiness After Cleaner Incident ───────────────────────

export interface CheckinReadinessEvaluationResult {
  nextUnitState: UnitState;
  canProceed: boolean;
}

export function evaluateCheckinReadinessAfterCleanerIncident(
  current: UnitState,
  input: CleanerIssueReportInput,
): CheckinReadinessEvaluationResult {
  const nextUnitState = simulateCleanerIncidentOnUnitState(current, input);
  const canProceed = canProceedToCheckinAfterIncident(nextUnitState);
  return { nextUnitState, canProceed };
}

// ─── Readiness Gate with Optional Incident ────────────────────────────────────

export interface ReadinessGateWithIncidentInput {
  current: UnitState;
  cleanerInput?: CleanerIssueReportInput;
}

export interface ReadinessGateWithIncidentResult {
  nextUnitState: UnitState;
  canProceed: boolean;
  incidentApplied: boolean;
}

export function evaluateReadinessWithOptionalIncident(
  input: ReadinessGateWithIncidentInput,
): ReadinessGateWithIncidentResult {
  if (input.cleanerInput !== undefined) {
    const { nextUnitState, canProceed } = evaluateCheckinReadinessAfterCleanerIncident(
      input.current,
      input.cleanerInput,
    );
    return { nextUnitState, canProceed, incidentApplied: true };
  }

  return {
    nextUnitState:   input.current,
    canProceed:      canProceedToCheckinAfterIncident(input.current),
    incidentApplied: false,
  };
}

// ─── Check-in Proceed Decision ────────────────────────────────────────────────

export function canProceedToCheckinAfterIncident(unitState: UnitState): boolean {
  if (!unitState.ready_for_checkin) return false;
  if (unitState.current_state === UnitStateValue.Blocked) return false;
  if (unitState.current_state === UnitStateValue.TurnoverNeeded) return false;
  return true;
}

// ─── Cleaner Issue → Incident ─────────────────────────────────────────────────

export function mapCleanerIssueToIncident(
  input: CleanerIssueReportInput,
): IncidentRecord {
  const hasEvidence =
    (input.photoUrls != null && input.photoUrls.length > 0) ||
    (input.videoUrls != null && input.videoUrls.length > 0);

  return {
    incidentId:           crypto.randomUUID(),
    propertyId:           input.propertyId,
    reservationRef:       input.reservationRef,
    source:               'cleaner',
    type:                 input.issueType,
    severity:             input.severity,
    evidenceStatus:       hasEvidence ? 'collected' : 'pending',
    contactStrategy:      'operator_review',
    otaCaseRequired:      false,
    directGuestSensitive: true,
    createdAt:            input.reportedAt,
  };
}
