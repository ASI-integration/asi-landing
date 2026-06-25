import { getCrmContactById, listCrmContacts } from '@/lib/crm/repository';
import { contactMapsFromContacts } from '@/lib/pilot-readiness/passport-bridge';
import { runChannelManagerToOpsStep } from './channel-manager-to-ops';
import { runLeadToObjectStep } from './lead-to-object';
import { extractLinkedObjectId } from './note-blocks';
import { runObjectToChannelManagerStep } from './object-to-channel-manager';
import type { PilotChainResult } from './types';

export async function runPilotChainForContact(contactId: string): Promise<PilotChainResult> {
  const steps: PilotChainResult['steps'] = [];
  let opsTaskId: string | null = null;

  const leadStep = await runLeadToObjectStep(contactId);
  steps.push(leadStep.step);
  let contact = leadStep.contact;
  let objectId = leadStep.objectId ?? (contact ? extractLinkedObjectId(contact) : null);

  if (!contact) {
    return { contactId, objectId, steps, contact: null, opsTaskId: null };
  }

  const cmStep = await runObjectToChannelManagerStep(contact, objectId);
  steps.push(cmStep.step);
  contact = cmStep.contact;
  objectId = objectId ?? extractLinkedObjectId(contact);

  const opsStep = await runChannelManagerToOpsStep(contact, objectId);
  steps.push(opsStep.step);
  opsTaskId = opsStep.opsTaskId;

  const refreshed = await getCrmContactById(contactId);
  return {
    contactId,
    objectId: objectId ?? extractLinkedObjectId(refreshed ?? contact),
    steps,
    contact: refreshed ?? contact,
    opsTaskId,
  };
}

export async function runPilotChainForProperty(propertyId: string): Promise<PilotChainResult | null> {
  const id = propertyId.trim();
  if (!id) return null;

  const contacts = await listCrmContacts({ excludeArchived: true });
  const { byObjectId } = contactMapsFromContacts(contacts);
  const linked = byObjectId.get(id);
  if (!linked?.contactId) return null;

  return runPilotChainForContact(linked.contactId);
}
