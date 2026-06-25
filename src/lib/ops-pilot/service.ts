import { isPilotParticipantStatus, resolvePilotRolloutStatus } from '@/lib/crm/pilot-rollout';
import { listCrmContacts } from '@/lib/crm/repository';
import type { CrmContact } from '@/lib/crm/types';
import { listOpsOperatorTasks } from '@/lib/ops-board/repository';
import type { OpsOperatorTask } from '@/lib/ops-board/types';
import { extractLinkedObjectId } from '@/lib/pilot-chain/note-blocks';
import { buildOpsPilotParticipantSnapshot } from './snapshot';
import type { OpsPilotOperatorAction, OpsPilotParticipant } from './types';

const STAGE_SORT_ORDER: Record<OpsPilotParticipant['stage'], number> = {
  needs_manual_control: 0,
  ops_task_created: 1,
  ready_for_cm_check: 2,
  cm_preparing: 3,
  object_filling: 4,
  object_created: 5,
  access_received: 6,
  new_lead: 7,
  ready_for_next_step: 8,
};

function sortParticipants(items: OpsPilotParticipant[]): OpsPilotParticipant[] {
  return [...items].sort((left, right) => {
    const stageDiff = STAGE_SORT_ORDER[left.stage] - STAGE_SORT_ORDER[right.stage];
    if (stageDiff !== 0) return stageDiff;
    if (left.isStalled !== right.isStalled) return left.isStalled ? -1 : 1;
    const leftTs = left.lastUpdatedAt ? Date.parse(left.lastUpdatedAt) : 0;
    const rightTs = right.lastUpdatedAt ? Date.parse(right.lastUpdatedAt) : 0;
    return leftTs - rightTs;
  });
}

function hasPilotChainOpsTask(contactId: string, opsTasks: OpsOperatorTask[]): boolean {
  return opsTasks.some(
    (task) => task.contactId === contactId && task.taskType === 'verify_channel_manager',
  );
}

function looksLikePilotAcceptanceContact(contact: CrmContact): boolean {
  const name = contact.name.trim().toUpperCase();
  return name.includes('ASI_PILOT') || name.includes('PILOT_CHAIN');
}

export function isOpsPilotVisibleContact(contact: CrmContact, opsTasks: OpsOperatorTask[] = []): boolean {
  if (contact.crmArchived) return false;
  if (!isPilotParticipantStatus(contact.status)) return false;

  const rollout = resolvePilotRolloutStatus(contact.status);
  if (rollout === 'active_pilot' || rollout === 'invited') return true;
  if (extractLinkedObjectId(contact)) return true;
  if (looksLikePilotAcceptanceContact(contact)) return true;
  if (hasPilotChainOpsTask(contact.id, opsTasks)) return true;

  // Скрываем шум от анонимных telegram guest без контура пилота.
  if (contact.name.trim() === 'Telegram guest' && contact.source === 'telegram') return false;

  return Boolean(contact.city?.trim()) || contact.objectsCount > 0;
}

export function filterPilotParticipantContacts(
  contacts: CrmContact[],
  opsTasks: OpsOperatorTask[] = [],
): CrmContact[] {
  return contacts.filter((contact) => isOpsPilotVisibleContact(contact, opsTasks));
}

export async function listOpsPilotParticipants(): Promise<{
  participants: OpsPilotParticipant[];
  opsTasks: OpsOperatorTask[];
}> {
  const opsResult = await listOpsOperatorTasks({ status: 'all' });
  const opsTasks = opsResult.ok ? opsResult.tasks : [];
  const contacts = filterPilotParticipantContacts(
    await listCrmContacts({ excludeArchived: true }),
    opsTasks,
  );
  const participants = sortParticipants(
    contacts.map((contact) => buildOpsPilotParticipantSnapshot(contact, opsTasks)),
  );
  return { participants, opsTasks };
}

export function buildOperatorActionPatch(
  action: OpsPilotOperatorAction,
  note?: string | null,
): Partial<CrmContact> {
  switch (action) {
    case 'mark_manual_control':
      return { communicationStatus: 'needs_manual_reaction' };
    case 'mark_waiting_owner':
      return { communicationStatus: 'waiting_reply' };
    case 'add_note': {
      const trimmed = String(note ?? '').trim().slice(0, 500);
      return trimmed ? { nextStep: trimmed } : {};
    }
    default:
      return {};
  }
}
