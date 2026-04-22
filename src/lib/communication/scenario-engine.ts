import {
  ClassifyResult,
  CommunicationDecision,
  CommunicationEntityResolution,
  CommunicationScenario,
  CommunicationContext,
  IdentityResolution,
  IntentResult,
  ResponsePlan,
} from './types';
import { SCENARIO_REGISTRY } from './scenario-registry';

function normalize(s: string): string {
  return s.toLowerCase();
}

function detectScenario(input: {
  text: string;
  classification: ClassifyResult;
  intent: IntentResult;
  entityResolution: CommunicationEntityResolution;
}): { scenario: CommunicationScenario; confidence: number; reason: string } {
  const text = input.text ?? '';
  const n = normalize(text);
  const hasReservation = Boolean(input.entityResolution.reservationId);

  const invoice = /invoice|receipt|квитанц|счет|счёт|чек|инвойс/i.test(text);
  if (invoice) return { scenario: 'invoice_receipt_request', confidence: 0.86, reason: 'keyword:invoice_receipt' };

  // Payment: distinguish "I want to pay" (request) from "payment failed/refund/charged" (issue).
  const paymentAny = /payment|pay|paid|refund|chargeback|card|банк|оплат|платеж|платёж|возврат/i.test(text);
  const paymentIssue = /failed|declined|charged|chargeback|refund|dispute|ошибк|не прош(ел|ла)|списал(и|ось)|возврат/i.test(text);
  if (input.intent.intent === 'payment_request' && paymentAny && !paymentIssue) {
    return { scenario: hasReservation ? 'reservation_linked_guest_message' : 'general_unknown', confidence: 0.55, reason: 'intent:payment_request' };
  }
  if (paymentAny && paymentIssue) return { scenario: 'payment_issue', confidence: 0.82, reason: 'keyword:payment_issue' };

  const complaint = /complaint|angry|unacceptable|terrible|scam|fraud|noise|dirty|refund|жалоб|ужас|плох|гряз|шум|мошен/i.test(text);
  if (complaint) return { scenario: 'complaint_conflict', confidence: 0.78, reason: 'keyword:complaint' };

  const lateArrival = /late arrival|after midnight|arriv(e|al).*late|поздн.*заезд|приед(у|ем).*поздно|после\s*полуночи/i.test(text);
  if (lateArrival) return { scenario: 'late_arrival', confidence: 0.8, reason: 'keyword:late_arrival' };

  const change = /extend|extension|change|modify|reschedule|перенест|продл(ить|ение)|изменить|сменить/i.test(text);
  if (change) return { scenario: 'extension_change_request', confidence: 0.72, reason: 'keyword:change_request' };

  const checkinCheckout =
    input.intent.intent === 'check_in_info' ||
    input.intent.intent === 'check_out' ||
    /check[- ]?in|check[- ]?out|заезд|выезд|код|доступ|lock|door/i.test(n);
  if (checkinCheckout) {
    return { scenario: 'checkin_checkout_question', confidence: 0.72 + (hasReservation ? 0.12 : 0), reason: 'intent_or_keyword:checkin_checkout' };
  }

  const leadLike = input.intent.intent === 'booking_inquiry';
  if (leadLike && !hasReservation) {
    return { scenario: 'lead_availability_inquiry', confidence: 0.7, reason: 'intent:booking_inquiry_unlinked' };
  }

  if (hasReservation) {
    return { scenario: 'reservation_linked_guest_message', confidence: 0.66, reason: 'has_reservation_link' };
  }

  return { scenario: 'general_unknown', confidence: 0.35, reason: 'fallback' };
}

export function buildDecisionAndPlan(input: {
  text: string;
  classification: ClassifyResult;
  intent: IntentResult;
  identity: IdentityResolution;
  context: CommunicationContext;
  entityResolution: CommunicationEntityResolution;
}): { decision: CommunicationDecision; plan: ResponsePlan } {
  const scenarioPick = detectScenario({
    text: input.text,
    classification: input.classification,
    intent: input.intent,
    entityResolution: input.entityResolution,
  });
  const def = SCENARIO_REGISTRY[scenarioPick.scenario];

  const knownFacts: Record<string, unknown> = {
    lang: input.classification.lang,
    intent: input.intent.intent,
    intentConfidence: input.intent.confidence,
    category: input.classification.category,
    reservationStatus: input.context.reservation.status,
    identityRole: input.identity.role,
    identityStatus: input.identity.status,
    reservationId: input.entityResolution.reservationId ?? null,
    propertyId: input.entityResolution.propertyId ?? null,
    leadId: input.entityResolution.leadId ?? null,
  };

  const missingFacts: string[] = [];

  const hasReservation = Boolean(input.entityResolution.reservationId);
  const hasProperty = Boolean(input.entityResolution.propertyId);
  const isAmbiguous = input.entityResolution.status === 'ambiguous';

  // Scenario-specific missing facts: conservative and operationally useful.
  if (scenarioPick.scenario === 'lead_availability_inquiry') {
    if (!input.context.memory.propertyLocation) missingFacts.push('property_or_area');
    if (!input.context.memory.checkInDate) missingFacts.push('dates');
  }
  if (scenarioPick.scenario === 'checkin_checkout_question') {
    if (!hasReservation && !hasProperty) missingFacts.push('reservation_or_property');
  }
  if (scenarioPick.scenario === 'late_arrival') {
    if (!hasReservation && !hasProperty) missingFacts.push('reservation_or_property');
    if (!/(\b\d{1,2}:\d{2}\b)|(\b\d{1,2}\s*(am|pm)\b)|(\bпосле\b)|(\bвечер(ом)?\b)|(\bноч(ью)?\b)/i.test(input.text)) {
      missingFacts.push('arrival_time');
    }
  }
  if (scenarioPick.scenario === 'invoice_receipt_request') {
    if (!hasReservation && !input.context.memory.guestName && !input.context.memory.checkInDate) {
      missingFacts.push('reservation_or_dates_or_name');
    }
  }
  if (scenarioPick.scenario === 'payment_issue') {
    if (!hasReservation) missingFacts.push('reservation_or_payment_reference');
  }
  if (scenarioPick.scenario === 'complaint_conflict') {
    if (input.text.trim().length < 20) missingFacts.push('issue_detail');
    if (!hasReservation && !hasProperty) missingFacts.push('reservation_or_property');
  }
  if (scenarioPick.scenario === 'extension_change_request') {
    if (!hasReservation && !hasProperty) missingFacts.push('reservation_or_property');
    if (!input.context.memory.checkInDate) missingFacts.push('dates');
  }

  const mustEscalate = Boolean(def.mustEscalateWhen?.({ hasReservation, hasProperty, isAmbiguous, text: input.text }));

  let nextAction: CommunicationDecision['nextAction'] = 'reply';
  if (mustEscalate) nextAction = 'escalate';
  else if (isAmbiguous) nextAction = 'ask_clarifying_question';
  else if (missingFacts.length > 0) nextAction = 'ask_clarifying_question';
  else if (!def.canAutoAnswer && def.preferredResponseMode !== 'direct_reply') nextAction = 'ask_clarifying_question';

  const decision: CommunicationDecision = {
    scenario: scenarioPick.scenario,
    confidence: Math.max(0, Math.min(1, scenarioPick.confidence)),
    requiredFacts: def.requiredFacts,
    knownFacts,
    missingFacts,
    entityResolution: input.entityResolution,
    nextAction,
    reason: `${scenarioPick.reason}; missing=${missingFacts.join(',') || 'none'}; entity=${input.entityResolution.status}`,
  };

  const plan: ResponsePlan = {
    scenario: decision.scenario,
    resolvedEntities: {
      reservationId: decision.entityResolution.reservationId,
      propertyId: decision.entityResolution.propertyId,
      leadId: decision.entityResolution.leadId,
    },
    knownFacts,
    missingFacts,
    allowedClaims: [
      'Only claim reservation/property linkage when resolved by evidence',
      'Only use grounded knowledge and property templates when property is known',
      'Acknowledge and summarize guest request',
    ],
    forbiddenAssumptions: [
      'Do not guess property, dates, price, policies, or access codes',
      'Do not claim payment succeeded/failed without explicit evidence',
      'Do not claim escalation actions were taken unless system actually escalated',
    ],
    deterministicFirst: [
      'invoice_receipt_request',
      'late_arrival',
      'checkin_checkout_question',
      'payment_issue',
      'complaint_conflict',
    ].includes(decision.scenario),
    llmAssistedWording: true,
  };

  return { decision, plan };
}

