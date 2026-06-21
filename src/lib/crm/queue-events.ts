import { supabase } from '@/lib/supabase';
import type { CrmQueueMessage } from './queue';

export type CrmEventRow = {
  id: string;
  contact_id: string;
  event_type: string;
  message_text: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const EVENT_AUTHOR_LABELS: Record<string, string> = {
  guest_test_question: 'Гость',
  guest_concierge_answered: 'ASI',
  missing_data: 'Гость',
  operator_followup_required: 'Гость',
};

function authorForEvent(row: CrmEventRow): string {
  const metadata = row.metadata ?? {};
  const role = typeof metadata.role === 'string' ? metadata.role : '';
  if (role === 'owner' || role === 'manager') return 'Владелец';
  if (role === 'guest') return 'Гость';
  return EVENT_AUTHOR_LABELS[row.event_type] ?? 'ASI';
}

function previewText(row: CrmEventRow): string {
  const metadata = row.metadata ?? {};
  const replyPreview = typeof metadata.reply_preview === 'string' ? metadata.reply_preview.trim() : '';
  if (replyPreview) return replyPreview;
  const safeReply = typeof metadata.safeGuestReply === 'string' ? metadata.safeGuestReply.trim() : '';
  if (safeReply) return safeReply;
  return String(row.message_text ?? '').trim();
}

function toMessage(row: CrmEventRow): CrmQueueMessage {
  return {
    id: row.id,
    author: authorForEvent(row),
    text: previewText(row) || '—',
    createdAt: row.created_at,
  };
}

export async function listRecentCrmEventsForFeed(limit = 50): Promise<CrmEventRow[]> {
  try {
    const { data, error } = await supabase
      .from('crm_events')
      .select('id,contact_id,event_type,message_text,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return data as CrmEventRow[];
  } catch {
    return [];
  }
}

export async function listCrmEventsByContactIds(
  contactIds: string[],
  limitPerContact = 8
): Promise<Record<string, CrmQueueMessage[]>> {
  if (contactIds.length === 0) return {};

  try {
    const { data, error } = await supabase
      .from('crm_events')
      .select('id,contact_id,event_type,message_text,metadata,created_at')
      .in('contact_id', contactIds)
      .order('created_at', { ascending: false });

    if (error || !data) return {};

    const grouped: Record<string, CrmQueueMessage[]> = {};
    for (const row of data as CrmEventRow[]) {
      const contactId = row.contact_id;
      if (!grouped[contactId]) grouped[contactId] = [];
      if (grouped[contactId].length >= limitPerContact) continue;
      grouped[contactId].push(toMessage(row));
    }

    return grouped;
  } catch {
    return {};
  }
}
