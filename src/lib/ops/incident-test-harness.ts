import { handleCleanerIssueReport } from '@/lib/ops/incident-service';
import type { CleanerIncidentDecisionContext } from '@/lib/ops/incident-service';
import type { CleanerIssueReportInput } from '@/lib/ops/types';
import type { UnitState } from '@/lib/ops/unit-state';

const defaultContext: CleanerIncidentDecisionContext = {
  evidenceConfidence: 'medium',
  costTier:           'minor',
  guestTier:          'trusted',
  toleranceScore:     50,
  incidentHistoryCount: 0,
  delegationLevel:    'medium',
  bookingChannel:     'direct',
};

type SimOverrides = {
  guestTier?:          CleanerIncidentDecisionContext['guestTier'];
  costTier?:           CleanerIncidentDecisionContext['costTier'];
  evidenceConfidence?: CleanerIncidentDecisionContext['evidenceConfidence'];
};

export function runIncidentTestScenario(overrides?: SimOverrides) {
  const current: UnitState = {
    id:                         'test-unit',
    property_id:                'test-property',
    current_state:              'ready',
    current_reservation_id:     null,
    dirty:                      false,
    ready_for_checkin:          true,
    blocked_reason:             null,
    last_checkout_at:           null,
    last_turnover_completed_at: null,
    updated_at:                 new Date().toISOString(),
  } as UnitState;

  const input: CleanerIssueReportInput = {
    propertyId:  'test-property',
    reportedBy:  'cleaner',
    issueType:   'damage',
    severity:    'medium',
    notes:       'Broken chair and excessive trash',
    reportedAt:  new Date().toISOString(),
  };

  const context = { ...defaultContext, ...overrides };
  const result = handleCleanerIssueReport(current, input, context);

  return {
    before: current,
    input,
    context,
    result,
  };
}

export function runExcessiveMessScenario(overrides?: SimOverrides) {
  const current: UnitState = {
    id:                         'test-unit',
    property_id:                'test-property',
    current_state:              'ready',
    current_reservation_id:     null,
    dirty:                      false,
    ready_for_checkin:          true,
    blocked_reason:             null,
    last_checkout_at:           null,
    last_turnover_completed_at: null,
    updated_at:                 new Date().toISOString(),
  } as UnitState;

  const input: CleanerIssueReportInput = {
    propertyId:  'test-property',
    reportedBy:  'cleaner',
    issueType:   'excessive_mess',
    severity:    'medium',
    notes:       'Large amount of trash and apartment needs deep cleaning',
    reportedAt:  new Date().toISOString(),
  };

  const context = { ...defaultContext, ...overrides };
  const result = handleCleanerIssueReport(current, input, context);

  return {
    before: current,
    input,
    context,
    result,
  };
}

export function runMicroIncidentScenario(overrides?: SimOverrides) {
  const current: UnitState = {
    id:                         'test-unit',
    property_id:                'test-property',
    current_state:              'ready',
    current_reservation_id:     null,
    dirty:                      false,
    ready_for_checkin:          true,
    blocked_reason:             null,
    last_checkout_at:           null,
    last_turnover_completed_at: null,
    updated_at:                 new Date().toISOString(),
  } as UnitState;

  const input: CleanerIssueReportInput = {
    propertyId:  'test-property',
    reportedBy:  'cleaner',
    issueType:   'damage',
    severity:    'low',
    notes:       'Small broken plate',
    reportedAt:  new Date().toISOString(),
  };

  const context: CleanerIncidentDecisionContext = {
    evidenceConfidence:   'medium',
    costTier:             'micro',
    guestTier:            'trusted',
    toleranceScore:       50,
    incidentHistoryCount: 0,
    delegationLevel:      'medium',
    bookingChannel:       'direct',
    ...overrides,
  };

  const result = handleCleanerIssueReport(current, input, context);

  return {
    before: current,
    input,
    context,
    result,
  };
}

export function runMajorOtaScenario(overrides?: SimOverrides) {
  const current: UnitState = {
    id:                         'test-unit',
    property_id:                'test-property',
    current_state:              'ready',
    current_reservation_id:     null,
    dirty:                      false,
    ready_for_checkin:          true,
    blocked_reason:             null,
    last_checkout_at:           null,
    last_turnover_completed_at: null,
    updated_at:                 new Date().toISOString(),
  } as UnitState;

  const input: CleanerIssueReportInput = {
    propertyId:  'test-property',
    reportedBy:  'cleaner',
    issueType:   'smoking_suspected',
    severity:    'high',
    notes:       'Strong smoke smell and evidence of indoor smoking',
    reportedAt:  new Date().toISOString(),
  };

  const context: CleanerIncidentDecisionContext = {
    evidenceConfidence:   'high',
    costTier:             'major',
    guestTier:            'strict',
    toleranceScore:       20,
    incidentHistoryCount: 1,
    delegationLevel:      'soft',
    bookingChannel:       'ota',
    ...overrides,
  };

  const result = handleCleanerIssueReport(current, input, context);

  return {
    before: current,
    input,
    context,
    result,
  };
}

export function runAllIncidentScenarios(overrides?: SimOverrides) {
  return [
    inspectIncidentResult(runIncidentTestScenario(overrides),    'damage_minor_direct'),
    inspectIncidentResult(runExcessiveMessScenario(overrides),   'excessive_mess_direct'),
    inspectIncidentResult(runMicroIncidentScenario(overrides),   'micro_breakage_direct'),
    inspectIncidentResult(runMajorOtaScenario(overrides),        'major_smoking_ota'),
  ];
}

export function inspectIncidentResult(
  output: {
    before: UnitState;
    input: CleanerIssueReportInput;
    context: CleanerIncidentDecisionContext;
    result: {
      nextUnitState: UnitState;
      canProceed: boolean;
      decision: {
        blockCheckin: boolean;
        recommendedPayer: string;
        communicationMode: string;
        escalateToHuman: boolean;
        reasons: string[];
      };
    };
  },
  scenarioName: string,
) {
  return {
    scenario:           scenarioName,
    issueType:          output.input.issueType,
    severity:           output.input.severity,
    before_state:       output.before.current_state,
    after_state:        output.result.nextUnitState.current_state,
    ready_before:       output.before.ready_for_checkin,
    ready_after:        output.result.nextUnitState.ready_for_checkin,
    can_proceed:        output.result.canProceed,
    decision_block:     output.result.decision.blockCheckin,
    decision_payer:     output.result.decision.recommendedPayer,
    decision_comms:     output.result.decision.communicationMode,
    decision_escalate:  output.result.decision.escalateToHuman,
    decision_reasons:   output.result.decision.reasons,
  };
}
