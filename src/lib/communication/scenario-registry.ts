import { CommunicationScenario, ScenarioPreferredMode } from './types';

export type ScenarioDefinition = {
  scenario: CommunicationScenario;
  requiredFacts: string[];
  optionalFacts: string[];
  canAutoAnswer: boolean;
  /** Conservative: if any trigger matches, scenario must escalate. */
  mustEscalateWhen?: (facts: { hasReservation: boolean; hasProperty: boolean; isAmbiguous: boolean; text: string }) => boolean;
  preferredResponseMode: ScenarioPreferredMode;
};

export const SCENARIO_REGISTRY: Record<CommunicationScenario, ScenarioDefinition> = {
  lead_availability_inquiry: {
    scenario: 'lead_availability_inquiry',
    requiredFacts: ['property_or_area', 'dates'],
    optionalFacts: ['guests', 'budget', 'contact'],
    canAutoAnswer: false,
    preferredResponseMode: 'clarify',
  },
  reservation_linked_guest_message: {
    scenario: 'reservation_linked_guest_message',
    requiredFacts: ['reservation'],
    optionalFacts: ['issue_detail', 'time', 'photos'],
    canAutoAnswer: true,
    preferredResponseMode: 'direct_reply',
  },
  checkin_checkout_question: {
    scenario: 'checkin_checkout_question',
    requiredFacts: ['reservation_or_property'],
    optionalFacts: ['time'],
    canAutoAnswer: true,
    preferredResponseMode: 'direct_reply',
  },
  late_arrival: {
    scenario: 'late_arrival',
    requiredFacts: ['reservation_or_property', 'arrival_time'],
    optionalFacts: [],
    canAutoAnswer: true,
    preferredResponseMode: 'direct_reply',
  },
  invoice_receipt_request: {
    scenario: 'invoice_receipt_request',
    requiredFacts: ['reservation_or_dates_or_name'],
    optionalFacts: ['email'],
    canAutoAnswer: true,
    preferredResponseMode: 'direct_reply',
  },
  payment_issue: {
    scenario: 'payment_issue',
    requiredFacts: ['reservation_or_payment_reference'],
    optionalFacts: ['screenshot', 'provider'],
    canAutoAnswer: false,
    mustEscalateWhen: () => true,
    preferredResponseMode: 'escalate',
  },
  complaint_conflict: {
    scenario: 'complaint_conflict',
    requiredFacts: ['issue_detail'],
    optionalFacts: ['reservation_or_property'],
    canAutoAnswer: false,
    mustEscalateWhen: () => true,
    preferredResponseMode: 'escalate',
  },
  extension_change_request: {
    scenario: 'extension_change_request',
    requiredFacts: ['reservation_or_property', 'dates'],
    optionalFacts: ['guests'],
    canAutoAnswer: false,
    preferredResponseMode: 'clarify',
  },
  general_unknown: {
    scenario: 'general_unknown',
    requiredFacts: [],
    optionalFacts: [],
    canAutoAnswer: false,
    preferredResponseMode: 'handoff',
  },
};

