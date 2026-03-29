import type {
  CleanerIssueReportInput,
  IncidentRecord,
} from '@/lib/ops/types';
import type { UnitState } from '@/lib/ops/unit-state';
import type {
  UnitStateIncidentPatch,
  CleanerIncidentProcessingResult,
  CheckinReadinessEvaluationResult,
} from '@/lib/ops/mappers';
import type {
  OpsDecisionResult,
  EvidenceConfidence,
  CostTier,
  GuestTier,
  DelegationLevel,
} from '@/lib/ops/decision-engine';

import {
  processCleanerIssueReport,
  evaluateCheckinReadinessAfterCleanerIncident,
} from '@/lib/ops/mappers';
import { evaluateOpsDecision } from '@/lib/ops/decision-engine';

export interface CleanerIncidentDecisionContext {
  evidenceConfidence: EvidenceConfidence;
  costTier: CostTier;
  guestTier: GuestTier;
  toleranceScore: number;
  incidentHistoryCount: number;
  delegationLevel: DelegationLevel;
  bookingChannel: 'ota' | 'direct';
}

export interface CleanerIncidentServiceResult {
  incident: IncidentRecord;
  unitStatePatch: UnitStateIncidentPatch;
  nextUnitState: UnitState;
  canProceed: boolean;
  decision: OpsDecisionResult;
}

export function handleCleanerIssueReport(
  current: UnitState,
  input: CleanerIssueReportInput,
  context: CleanerIncidentDecisionContext,
): CleanerIncidentServiceResult {
  const { incident, unitStatePatch }: CleanerIncidentProcessingResult =
    processCleanerIssueReport(input);

  const { nextUnitState, canProceed }: CheckinReadinessEvaluationResult =
    evaluateCheckinReadinessAfterCleanerIncident(current, input);

  const decision = evaluateOpsDecision({
    incident,
    evidenceConfidence: context.evidenceConfidence,
    costTier: context.costTier,
    guestTier: context.guestTier,
    toleranceScore: context.toleranceScore,
    incidentHistoryCount: context.incidentHistoryCount,
    delegationLevel: context.delegationLevel,
    bookingChannel: context.bookingChannel,
  });

  return { incident, unitStatePatch, nextUnitState, canProceed, decision };
}
