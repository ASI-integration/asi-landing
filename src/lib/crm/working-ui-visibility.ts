import { matchesTestOrAcceptanceMarker } from '@/lib/pilot-data/test-markers';
import type { OpsOperatorTask } from '@/lib/ops-board/types';
import { isWizardAcceptanceCrmContact } from './contact-display';
import { isQueueTestGuestContact, queueTestGuestProbeFromContact } from './queue';
import type { CrmContact } from './types';

const PILOT_CHAIN_USERNAME_PATTERN = /^pilot_chain_/i;

function nameLooksLikePilotChainAcceptance(name: string): boolean {
  const upper = name.trim().toUpperCase();
  return upper.includes('ASI_PILOT') || upper.includes('PILOT_CHAIN');
}

export function isHiddenWorkingUiCrmContact(contact: CrmContact): boolean {
  if (
    isWizardAcceptanceCrmContact({
      name: contact.name,
      telegramUsername: contact.telegramUsername,
      note: contact.note,
    })
  ) {
    return true;
  }

  if (nameLooksLikePilotChainAcceptance(contact.name)) return true;

  const username = contact.telegramUsername.trim().replace(/^@+/, '');
  if (PILOT_CHAIN_USERNAME_PATTERN.test(username)) return true;
  if (matchesTestOrAcceptanceMarker(username)) return true;
  if (matchesTestOrAcceptanceMarker(contact.name)) return true;
  if (matchesTestOrAcceptanceMarker(contact.note)) return true;

  return isQueueTestGuestContact(queueTestGuestProbeFromContact(contact));
}

export function filterWorkingUiCrmContacts(
  contacts: CrmContact[],
  options?: { includeTest?: boolean },
): CrmContact[] {
  if (options?.includeTest) return contacts;
  return contacts.filter((contact) => !isHiddenWorkingUiCrmContact(contact));
}

export function isHiddenWorkingUiOpsTask(task: OpsOperatorTask): boolean {
  const haystack = [
    task.description,
    task.title,
    task.guestName,
    task.ownerName,
    task.objectLabel,
    task.objectId,
    task.dedupKey,
    JSON.stringify(task.metadata ?? {}),
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n');

  if (matchesTestOrAcceptanceMarker(haystack)) return true;

  const dedup = String(task.dedupKey ?? '').toLowerCase();
  if (dedup.includes('pilot_chain') && nameLooksLikePilotChainAcceptance(task.ownerName ?? '')) {
    return true;
  }

  return false;
}

export function filterWorkingUiOpsTasks(
  tasks: OpsOperatorTask[],
  options?: { includeTest?: boolean },
): OpsOperatorTask[] {
  if (options?.includeTest) return tasks;
  return tasks.filter((task) => !isHiddenWorkingUiOpsTask(task));
}
