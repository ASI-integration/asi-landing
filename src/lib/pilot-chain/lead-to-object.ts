import { createPilotObjectId } from '@/lib/communication/pilot-object-intake';
import { getCrmContactById, updateCrmContact } from '@/lib/crm/repository';
import type { CrmContact, CrmOwnerObject } from '@/lib/crm/types';
import { computeObjectReadiness } from '@/lib/object-readiness/engine';
import { upsertPilotObjectKnowledge } from '@/lib/pilot-readiness/repository';
import { emitPilotChainAuditEvent, logPilotChainStep } from './audit-events';
import {
  buildChannelManagerHrefForContact,
  buildOnboardingNoteBlock,
  defaultObjectTitleForContact,
  extractLinkedObjectId,
  mapReadinessToOnboardingStatus,
  mergePilotChainNoteBlocks,
  readinessInputFromContact,
} from './note-blocks';
import { shouldAutoProvisionObjectFromLead } from './status-triggers';
import type { PilotChainStepResult } from './types';

export async function ensureLeadObjectDraft(contact: CrmContact): Promise<{
  contact: CrmContact;
  step: PilotChainStepResult;
  objectId: string | null;
}> {
  if (!shouldAutoProvisionObjectFromLead(contact.status)) {
    return {
      contact,
      step: { step: 'lead_to_object', outcome: 'not_applicable' },
      objectId: extractLinkedObjectId(contact),
    };
  }

  const existingObjectId = extractLinkedObjectId(contact);
  if (existingObjectId) {
    logPilotChainStep('skipped_existing_object', { contactId: contact.id, objectId: existingObjectId });
    await emitPilotChainAuditEvent({
      contactId: contact.id,
      eventType: 'skipped_existing_object',
      objectId: existingObjectId,
    });
    return {
      contact,
      step: {
        step: 'lead_to_object',
        outcome: 'skipped',
        auditEvent: 'skipped_existing_object',
        objectId: existingObjectId,
      },
      objectId: existingObjectId,
    };
  }

  const objectId = createPilotObjectId({
    city: contact.city || 'город',
    objectName: defaultObjectTitleForContact(contact),
  });
  const title = defaultObjectTitleForContact(contact);
  const ownerContact = [contact.name, contact.phone, contact.telegramUsername ? `@${contact.telegramUsername}` : '']
    .filter(Boolean)
    .join(' · ');

  const knowledgeResult = await upsertPilotObjectKnowledge({
    property_id: objectId,
    object_name: title,
    address: contact.city || null,
    active: true,
    communication_autopilot: 'disabled',
    photos_deferred: true,
  });
  if (!knowledgeResult.ok) {
    console.warn('[pilot-chain] passport upsert failed', knowledgeResult.error);
  }

  const readiness = computeObjectReadiness(readinessInputFromContact(contact));
  const onboardingStatus = mapReadinessToOnboardingStatus(readiness);
  const channelManagerHref = buildChannelManagerHrefForContact(contact.id, objectId);
  const ownerObject: CrmOwnerObject = {
    objectId,
    title,
    readinessPercent: readiness.readiness_percent,
    isActiveSession: true,
  };
  const onboardingBlock = buildOnboardingNoteBlock({
    objectId,
    contactId: contact.id,
    onboardingStatus,
    readiness,
    contact,
    channelManagerHref,
    lastMessage: contact.note?.slice(0, 200) || undefined,
  });
  const note = mergePilotChainNoteBlocks({
    existingNote: contact.note,
    ownerObjects: [ownerObject],
    onboardingBlock,
  });

  const nextStep =
    readiness.readiness_status === 'ready_for_channel_manager'
      ? 'Открыть менеджер каналов и начать подключение каналов.'
      : readiness.next_best_step_ru;

  const updated = await updateCrmContact(contact.id, {
    note,
    objectsCount: 1,
    nextStep,
  });

  logPilotChainStep('lead_to_object_created', { contactId: contact.id, objectId });
  await emitPilotChainAuditEvent({
    contactId: contact.id,
    eventType: 'lead_to_object_created',
    objectId,
    metadata: {
      owner_contact: ownerContact,
      pilot_status: contact.status,
    },
  });

  return {
    contact: updated,
    step: {
      step: 'lead_to_object',
      outcome: 'created',
      auditEvent: 'lead_to_object_created',
      objectId,
    },
    objectId,
  };
}

export async function refreshLeadObjectDraft(contact: CrmContact, objectId: string): Promise<CrmContact> {
  const readiness = computeObjectReadiness(readinessInputFromContact(contact));
  const onboardingStatus = mapReadinessToOnboardingStatus(readiness);
  const channelManagerHref = buildChannelManagerHrefForContact(contact.id, objectId);
  const title = defaultObjectTitleForContact(contact);
  const ownerObjects: CrmOwnerObject[] = (contact.ownerObjects ?? []).map((item) =>
    item.objectId === objectId
      ? { ...item, title, readinessPercent: readiness.readiness_percent }
      : item,
  );
  if (!ownerObjects.some((item) => item.objectId === objectId)) {
    ownerObjects.unshift({
      objectId,
      title,
      readinessPercent: readiness.readiness_percent,
      isActiveSession: true,
    });
  }

  const onboardingBlock = buildOnboardingNoteBlock({
    objectId,
    contactId: contact.id,
    onboardingStatus,
    readiness,
    contact,
    channelManagerHref,
    lastMessage: contact.onboarding?.lastMessage || 'обновлено из CRM',
  });
  const note = mergePilotChainNoteBlocks({
    existingNote: contact.note,
    ownerObjects,
    onboardingBlock,
  });

  return updateCrmContact(contact.id, {
    note,
    objectsCount: ownerObjects.length,
    nextStep: readiness.next_best_step_ru,
  });
}

export async function runLeadToObjectStep(contactId: string): Promise<{
  contact: CrmContact | null;
  step: PilotChainStepResult;
  objectId: string | null;
}> {
  const contact = await getCrmContactById(contactId);
  if (!contact) {
    return {
      contact: null,
      step: { step: 'lead_to_object', outcome: 'not_applicable' },
      objectId: null,
    };
  }

  const result = await ensureLeadObjectDraft(contact);
  if (result.step.outcome === 'created') {
    return result;
  }

  const objectId = result.objectId;
  if (!objectId) {
    return result;
  }

  const refreshed = await refreshLeadObjectDraft(result.contact, objectId);
  return {
    contact: refreshed,
    step: {
      step: 'lead_to_object',
      outcome: result.step.outcome === 'skipped' ? 'skipped' : 'updated',
      auditEvent: result.step.auditEvent,
      objectId,
    },
    objectId,
  };
}
