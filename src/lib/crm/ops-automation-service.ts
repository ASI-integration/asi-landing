import { supabase } from '@/lib/supabase';
import { updateCrmContact } from './repository';
import type { CrmContact, CrmOpsAutomationDecision } from './types';
import { buildCrmOpsAutomationPatch, evaluateCrmOpsAutomation } from './ops-automation';

function withDecision(contact: CrmContact, decision: CrmOpsAutomationDecision): CrmContact {
  return { ...contact, opsAutomation: decision };
}

async function recordAutomationChange(input: {
  contactId: string;
  previousStatus: string;
  newStatus: string;
  previousNextStep: string;
  newNextStep: string;
  decision: CrmOpsAutomationDecision;
  timestamp: string;
}): Promise<void> {
  try {
    const { error } = await supabase.from('crm_events').insert({
      contact_id: input.contactId,
      event_type: 'status_change',
      message_text: 'OPS Automation обновила следующий шаг заявки',
      metadata: {
        integration: 'ops_automation_v1',
        previous_status: input.previousStatus,
        new_status: input.newStatus,
        previous_next_step: input.previousNextStep,
        new_next_step: input.newNextStep,
        automation_decision: input.decision.nextAction,
        automation_state: input.decision.automationState,
        reason: input.decision.reason,
      },
      created_at: input.timestamp,
    });
    if (error) {
      console.warn('[ops-automation] audit event insert failed', {
        contactId: input.contactId,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn('[ops-automation] audit event insert failed', { contactId: input.contactId, error });
  }
}

export function attachCrmOpsAutomation(contact: CrmContact, evaluatedAt = new Date().toISOString()): CrmContact {
  return withDecision(contact, evaluateCrmOpsAutomation(contact, evaluatedAt));
}

export async function runCrmOpsAutomation(
  contact: CrmContact,
  evaluatedAt = new Date().toISOString(),
): Promise<CrmContact> {
  const decision = evaluateCrmOpsAutomation(contact, evaluatedAt);
  const patch = buildCrmOpsAutomationPatch(contact, evaluatedAt);

  console.info('[ops-automation] decision', {
    contactId: contact.id,
    previousStatus: contact.status,
    recommendedStatus: decision.recommendedStatus,
    nextAction: decision.nextAction,
    automationState: decision.automationState,
    canAutoPerform: decision.canAutoPerform,
    needsOperatorAction: decision.needsOperatorAction,
    timestamp: evaluatedAt,
    reason: decision.reason,
  });

  if (Object.keys(patch).length === 0) return withDecision(contact, decision);

  try {
    const updated = await updateCrmContact(contact.id, patch);
    await recordAutomationChange({
      contactId: contact.id,
      previousStatus: contact.status,
      newStatus: updated.status,
      previousNextStep: contact.nextStep,
      newNextStep: updated.nextStep,
      decision,
      timestamp: evaluatedAt,
    });
    return attachCrmOpsAutomation(updated, evaluatedAt);
  } catch (error) {
    console.error('[ops-automation] automatic update failed', {
      contactId: contact.id,
      previousStatus: contact.status,
      nextAction: decision.nextAction,
      timestamp: evaluatedAt,
      error,
    });
    return withDecision(contact, {
      ...decision,
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedStatus: null,
      reason: 'Автоматический шаг не сохранён; оператору нужно проверить заявку.',
    });
  }
}

export async function runCrmOpsAutomationBatch(contacts: CrmContact[]): Promise<CrmContact[]> {
  const evaluatedAt = new Date().toISOString();
  return Promise.all(contacts.map((contact) => runCrmOpsAutomation(contact, evaluatedAt)));
}
