import { getCrmContactById, updateCrmContact } from '@/lib/crm/repository';
import type { CrmContact } from '@/lib/crm/types';
import { initialConnectionState } from '@/lib/channel-manager-connection/flow';
import {
  mergeChannelManagerConnectionIntoNote,
  parseChannelManagerConnectionBlock,
} from '@/lib/channel-manager-connection/note-block';
import { emitPilotChainAuditEvent, logPilotChainStep } from './audit-events';
import { extractLinkedObjectId } from './note-blocks';
import type { PilotChainStepResult } from './types';

function connectionNeedsUpdate(contact: CrmContact, objectId: string): boolean {
  const existing = contact.channelManagerConnection ?? parseChannelManagerConnectionBlock(contact.note);
  if (!existing) return true;
  if (existing.objectId && existing.objectId !== objectId) return true;
  if (existing.contactId && existing.contactId !== contact.id) return true;
  return false;
}

export async function prepareChannelManagerDraft(
  contact: CrmContact,
  objectId: string,
): Promise<{ contact: CrmContact; step: PilotChainStepResult }> {
  if (!connectionNeedsUpdate(contact, objectId)) {
    return {
      contact,
      step: { step: 'object_to_channel_manager', outcome: 'skipped', objectId },
    };
  }

  const existing = contact.channelManagerConnection ?? parseChannelManagerConnectionBlock(contact.note);
  const state = existing
    ? {
        ...existing,
        objectId,
        contactId: contact.id,
        updatedAt: new Date().toISOString(),
      }
    : {
        ...initialConnectionState({ objectId, contactId: contact.id }),
        updatedAt: new Date().toISOString(),
      };

  const note = mergeChannelManagerConnectionIntoNote(contact.note, state);
  const updated = await updateCrmContact(contact.id, { note });

  logPilotChainStep('object_to_channel_manager_prepared', {
    contactId: contact.id,
    objectId,
    created: !existing,
  });
  await emitPilotChainAuditEvent({
    contactId: contact.id,
    eventType: 'object_to_channel_manager_prepared',
    objectId,
    metadata: {
      cm_status: state.status,
      cm_method: state.method,
    },
  });

  return {
    contact: updated,
    step: {
      step: 'object_to_channel_manager',
      outcome: existing ? 'updated' : 'created',
      auditEvent: 'object_to_channel_manager_prepared',
      objectId,
    },
  };
}

export async function runObjectToChannelManagerStep(
  contact: CrmContact,
  objectId: string | null,
): Promise<{ contact: CrmContact; step: PilotChainStepResult }> {
  if (!objectId) {
    return {
      contact,
      step: { step: 'object_to_channel_manager', outcome: 'not_applicable' },
    };
  }
  return prepareChannelManagerDraft(contact, objectId);
}

export async function runObjectToChannelManagerStepByContactId(contactId: string): Promise<{
  contact: CrmContact | null;
  step: PilotChainStepResult;
  objectId: string | null;
}> {
  const contact = await getCrmContactById(contactId);
  if (!contact) {
    return {
      contact: null,
      step: { step: 'object_to_channel_manager', outcome: 'not_applicable' },
      objectId: null,
    };
  }
  const objectId = extractLinkedObjectId(contact);
  const result = await runObjectToChannelManagerStep(contact, objectId);
  return { ...result, objectId };
}
