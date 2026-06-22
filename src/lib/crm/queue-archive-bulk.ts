import { supabase } from '@/lib/supabase';
import { archiveCrmContactsFromQueue, listCrmContacts } from './repository';
import { excludeArchivedQueueContacts, listTestGuestContactsForBulkArchive } from './queue';

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

export async function archiveCrmQueueTestGuests(
  operatorEmail: string,
): Promise<{ archivedIds: string[] }> {
  const contacts = excludeArchivedQueueContacts(await listCrmContacts({ excludeArchived: true }));
  const targets = listTestGuestContactsForBulkArchive(contacts);
  const ids = targets.map((contact) => contact.id);
  const archivedIds = await archiveCrmContactsFromQueue(ids, operatorEmail);
  if (archivedIds.length > 0) {
    await recordCrmQueueTestGuestsArchivedEvent({
      operatorEmail,
      archivedCount: archivedIds.length,
      sampleContactId: archivedIds[0] ?? null,
    });
  }
  return { archivedIds };
}
