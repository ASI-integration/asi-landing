import { supabase } from '@/lib/supabase';
import { archiveCrmContactsFromQueue, listCrmContacts } from './repository';
import {
  buildQueueItem,
  excludeArchivedQueueContacts,
  isQueueItemArchivable,
  isQueueTestGuestContact,
  queueTestGuestProbeFromContact,
} from './queue';

export type ArchiveCrmQueueTestGuestsResult = {
  foundCount: number;
  archivedCount: number;
  archivedIds: string[];
  skippedCount: number;
  skippedIds: string[];
  reason?: string;
};

export async function recordCrmQueueTestGuestsArchivedEvent(input: {
  operatorEmail: string;
  archivedCount: number;
  sampleContactId?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('crm_events').insert({
    contact_id: input.sampleContactId ?? null,
    event_type: 'crm_queue_test_guests_archived',
    message_text: 'Оператор скрыл тестовые обращения из очереди CRM',
    metadata: {
      operator_email: input.operatorEmail,
      archived_count: input.archivedCount,
      role: 'operator',
    },
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[crm-queue-archive-bulk] crm event insert failed', { error: error.message });
  }
}

function normalizeContactIds(contactIds: string[]): string[] {
  return [...new Set(contactIds.map((id) => id.trim()).filter(Boolean))];
}

export async function archiveCrmQueueTestGuests(
  operatorEmail: string,
  contactIds: string[],
): Promise<ArchiveCrmQueueTestGuestsResult> {
  const requestedIds = normalizeContactIds(contactIds);
  const foundCount = requestedIds.length;

  if (foundCount === 0) {
    return {
      foundCount: 0,
      archivedCount: 0,
      archivedIds: [],
      skippedCount: 0,
      skippedIds: [],
      reason: 'no_contact_ids_provided',
    };
  }

  const contacts = excludeArchivedQueueContacts(await listCrmContacts({ excludeArchived: true }));
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));

  const toArchive: string[] = [];
  const skippedIds: string[] = [];

  for (const contactId of requestedIds) {
    const contact = contactsById.get(contactId);
    if (!contact) {
      skippedIds.push(contactId);
      continue;
    }
    if (!isQueueTestGuestContact(queueTestGuestProbeFromContact(contact))) {
      skippedIds.push(contactId);
      continue;
    }
    if (!isQueueItemArchivable(buildQueueItem(contact))) {
      skippedIds.push(contactId);
      continue;
    }
    toArchive.push(contactId);
  }

  if (toArchive.length === 0) {
    return {
      foundCount,
      archivedCount: 0,
      archivedIds: [],
      skippedCount: skippedIds.length,
      skippedIds,
      reason: 'no_eligible_test_guest_contacts',
    };
  }

  const archivedIds = await archiveCrmContactsFromQueue(toArchive, operatorEmail);
  if (archivedIds.length > 0) {
    await recordCrmQueueTestGuestsArchivedEvent({
      operatorEmail,
      archivedCount: archivedIds.length,
      sampleContactId: archivedIds[0] ?? null,
    });
  }

  const notArchived = toArchive.filter((id) => !archivedIds.includes(id));
  const allSkipped = [...skippedIds, ...notArchived];

  return {
    foundCount,
    archivedCount: archivedIds.length,
    archivedIds,
    skippedCount: allSkipped.length,
    skippedIds: allSkipped,
    reason: archivedIds.length === 0 ? 'archive_update_matched_zero_rows' : undefined,
  };
}
