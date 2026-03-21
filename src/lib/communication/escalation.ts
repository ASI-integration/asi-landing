import {
  ClassifyResult,
  EscalationEvent,
  EscalationReason,
  MessageCategory,
} from './types';

/**
 * Escalation event model.
 *
 * An EscalationEvent signals that the automated flow cannot confidently
 * resolve a message and an operator should be aware of it.
 *
 * Current behaviour: events are created and logged via the audit layer.
 * Future: forward to an operator queue, webhook, or ticketing system.
 */

export function createEscalationEvent(params: {
  reason: EscalationReason;
  chat_id: number;
  update_id?: number;
  classification?: ClassifyResult;
  summary: string;
}): EscalationEvent {
  return {
    reason: params.reason,
    chat_id: params.chat_id,
    update_id: params.update_id,
    category: params.classification?.category,
    summary: params.summary,
    created_at: new Date().toISOString(),
  };
}

/**
 * Determines whether a classification + reply outcome warrants an escalation
 * event.  Conservative rules — better to over-escalate than under.
 */
export function shouldEscalate(
  classification: ClassifyResult,
  llmSucceeded: boolean,
): boolean {
  const { category, slots } = classification;

  // Urgent access issue — always escalate even if LLM replied.
  if (category === MessageCategory.Issue && slots.isUrgent && slots.isAccessRelated) {
    return true;
  }

  // LLM failed on a guest message or issue — operator attention needed.
  if (!llmSucceeded && category !== MessageCategory.Start && category !== MessageCategory.Greeting) {
    return true;
  }

  return false;
}

/**
 * Builds the escalation reason given the context.
 */
export function deriveEscalationReason(
  classification: ClassifyResult,
  llmSucceeded: boolean,
): EscalationReason {
  const { category, slots } = classification;

  if (category === MessageCategory.Issue && slots.isUrgent && slots.isAccessRelated) {
    return EscalationReason.UrgentIssue;
  }

  if (!llmSucceeded) {
    return EscalationReason.LLMUncertain;
  }

  return EscalationReason.RequiresOperator;
}
