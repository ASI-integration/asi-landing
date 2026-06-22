import { supabase } from '@/lib/supabase';
import { archiveCrmContactFromQueue } from './repository';

export async function recordCrmQueueArchivedEvent(input: {
  contactId: string;
  operatorEmail: string;
  objectTitle?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('crm_events').insert({
    contact_id: input.contactId,
    event_type: 'crm_queue_archived',
    message_text: 'Оператор скрыл объект из очереди CRM',
    metadata: {
      operator_email: input.operatorEmail,
      object_title: input.objectTitle ?? null,
      role: 'operator',
    },
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[crm-queue-archive] crm event insert failed', { error: error.message });
  }
}

export async function archiveCrmQueueContact(input: {
  contactId: string;
  operatorEmail: string;
  objectTitle?: string | null;
}): Promise<{ contactId: string }> {
  await archiveCrmContactFromQueue(input.contactId, input.operatorEmail);
  await recordCrmQueueArchivedEvent(input);
  return { contactId: input.contactId };
}
