import { supabase } from '@/lib/supabase';
import { normalizeCrmContactRow } from './view-model';
import type {
  CreateCrmContactInput,
  CrmContactRow,
  CrmContactViewModel,
  CrmEventRow,
  RecordCrmEventInput,
  UpdateCrmContactInput,
  UpsertCrmFromTelegramInput,
} from './types';

const CONTACT_SELECT =
  'id, name, role, source, contact, telegram_user_id, telegram_username, telegram_chat_id, status, property_id, property_count, notes, next_action, next_action_due_at, last_message, last_activity_at, lead_id, awaiting_reply, created_at, updated_at';

const EVENT_SELECT =
  'id, contact_id, event_type, message_text, property_id, metadata, acknowledged_at, created_at';

function nowIso(): string {
  return new Date().toISOString();
}

function chatIdString(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

async function findContactByTelegram(input: {
  telegramUserId?: string | null;
  telegramChatId?: string | number | null;
}): Promise<CrmContactRow | null> {
  const userId = input.telegramUserId?.trim();
  const chatId = chatIdString(input.telegramChatId);

  if (userId) {
    const { data, error } = await supabase
      .from('crm_contacts')
      .select(CONTACT_SELECT)
      .eq('telegram_user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as CrmContactRow;
  }

  if (chatId) {
    const { data, error } = await supabase
      .from('crm_contacts')
      .select(CONTACT_SELECT)
      .eq('telegram_chat_id', chatId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as CrmContactRow;
  }

  return null;
}

async function fetchEventsForContacts(contactIds: string[]): Promise<Map<string, CrmEventRow[]>> {
  const map = new Map<string, CrmEventRow[]>();
  if (contactIds.length === 0) return map;

  const { data, error } = await supabase
    .from('crm_events')
    .select(EVENT_SELECT)
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false })
    .limit(Math.min(contactIds.length * 30, 500));

  if (error) throw error;

  for (const row of (data ?? []) as CrmEventRow[]) {
    const list = map.get(row.contact_id) ?? [];
    if (list.length < 30) list.push(row);
    map.set(row.contact_id, list);
  }

  return map;
}

export async function listCrmContacts(limit = 250): Promise<CrmContactViewModel[]> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select(CONTACT_SELECT)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as CrmContactRow[];
  const eventsByContact = await fetchEventsForContacts(rows.map((row) => row.id));

  return rows.map((row) => normalizeCrmContactRow(row, eventsByContact.get(row.id) ?? []));
}

export async function getCrmContactById(contactId: string): Promise<CrmContactViewModel | null> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select(CONTACT_SELECT)
    .eq('id', contactId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as CrmContactRow;
  const { data: events, error: eventsError } = await supabase
    .from('crm_events')
    .select(EVENT_SELECT)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (eventsError) throw eventsError;

  return normalizeCrmContactRow(row, (events ?? []) as CrmEventRow[]);
}

export async function createCrmContact(input: CreateCrmContactInput): Promise<CrmContactViewModel> {
  const now = nowIso();
  const { data, error } = await supabase
    .from('crm_contacts')
    .insert({
      name: input.name.trim() || 'Без имени',
      role: input.role,
      source: input.source ?? 'manual',
      contact: input.contact?.trim() || null,
      telegram_user_id: input.telegramUserId?.trim() || null,
      telegram_username: input.telegramUsername?.replace(/^@+/, '') || null,
      telegram_chat_id: chatIdString(input.telegramChatId),
      status: input.status ?? 'new',
      property_id: input.propertyId?.trim() || null,
      property_count: input.propertyCount ?? null,
      notes: input.notes?.trim() ?? '',
      next_action: input.nextAction?.trim() ?? '',
      next_action_due_at: input.nextActionDueAt ?? null,
      last_activity_at: now,
      updated_at: now,
    })
    .select(CONTACT_SELECT)
    .single();

  if (error) throw error;
  return normalizeCrmContactRow(data as CrmContactRow, []);
}

export async function updateCrmContact(
  contactId: string,
  input: UpdateCrmContactInput,
): Promise<CrmContactViewModel | null> {
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.nextAction !== undefined) patch.next_action = input.nextAction.trim();
  if (input.nextActionDueAt !== undefined) patch.next_action_due_at = input.nextActionDueAt;
  if (input.propertyId !== undefined) patch.property_id = input.propertyId?.trim() || null;
  if (input.propertyCount !== undefined) patch.property_count = input.propertyCount;
  if (input.awaitingReply !== undefined) patch.awaiting_reply = input.awaitingReply;

  const { data, error } = await supabase
    .from('crm_contacts')
    .update(patch)
    .eq('id', contactId)
    .select(CONTACT_SELECT)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as CrmContactRow;
  const { data: events } = await supabase
    .from('crm_events')
    .select(EVENT_SELECT)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(50);

  return normalizeCrmContactRow(row, (events ?? []) as CrmEventRow[]);
}

export async function upsertCrmContactFromTelegram(
  input: UpsertCrmFromTelegramInput,
): Promise<CrmContactViewModel | null> {
  const allowCreate = input.allowCreate !== false;
  const existing = await findContactByTelegram({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
  });

  const now = nowIso();
  const name =
    input.name?.trim() ||
    (input.telegramUsername ? `@${input.telegramUsername.replace(/^@+/, '')}` : '') ||
    input.telegramUserId ||
    'Без имени';

  if (!existing && !allowCreate) return null;

  if (!existing) {
    const { data, error } = await supabase
      .from('crm_contacts')
      .insert({
        name,
        role: input.role,
        source: input.source ?? 'telegram',
        telegram_user_id: input.telegramUserId,
        telegram_username: input.telegramUsername?.replace(/^@+/, '') || null,
        telegram_chat_id: chatIdString(input.telegramChatId),
        status: input.status ?? 'new',
        property_id: input.propertyId?.trim() || null,
        lead_id: input.leadId ?? null,
        last_message: input.lastMessage?.trim() || null,
        last_activity_at: now,
        updated_at: now,
      })
      .select(CONTACT_SELECT)
      .single();

    if (error) throw error;
    return normalizeCrmContactRow(data as CrmContactRow, []);
  }

  const patch: Record<string, unknown> = {
    updated_at: now,
    last_activity_at: now,
  };
  if (input.name?.trim()) patch.name = input.name.trim();
  if (input.role && input.role !== 'unknown') patch.role = input.role;
  if (input.source) patch.source = input.source;
  if (input.telegramUsername) patch.telegram_username = input.telegramUsername.replace(/^@+/, '');
  if (input.telegramChatId != null) patch.telegram_chat_id = chatIdString(input.telegramChatId);
  if (input.propertyId) patch.property_id = input.propertyId;
  if (input.leadId) patch.lead_id = input.leadId;
  if (input.status) patch.status = input.status;
  if (input.lastMessage?.trim()) patch.last_message = input.lastMessage.trim();

  const { data, error } = await supabase
    .from('crm_contacts')
    .update(patch)
    .eq('id', existing.id)
    .select(CONTACT_SELECT)
    .single();

  if (error) throw error;

  const { data: events } = await supabase
    .from('crm_events')
    .select(EVENT_SELECT)
    .eq('contact_id', existing.id)
    .order('created_at', { ascending: false })
    .limit(30);

  return normalizeCrmContactRow(data as CrmContactRow, (events ?? []) as CrmEventRow[]);
}

export async function recordCrmCommunicationEvent(input: RecordCrmEventInput): Promise<void> {
  let contactId = input.contactId?.trim() || null;
  let contact: CrmContactRow | null = null;

  if (!contactId) {
    contact = await findContactByTelegram({
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
    });
    contactId = contact?.id ?? null;
  }

  if (!contactId && input.allowCreateContact && input.contactHints) {
    const hints = input.contactHints;
    const created = await upsertCrmContactFromTelegram({
      ...hints,
      allowCreate: true,
    });
    contactId = created?.id ?? null;
  }

  if (!contactId) return;

  const now = nowIso();
  const isReactionEvent =
    input.eventType === 'escalation' ||
    input.eventType === 'missing_data' ||
    input.eventType === 'message_inbound';

  const contactPatch: Record<string, unknown> = {
    updated_at: now,
    last_activity_at: now,
  };
  if (input.messageText?.trim()) contactPatch.last_message = input.messageText.trim();
  if (input.propertyId) contactPatch.property_id = input.propertyId;
  if (isReactionEvent && input.eventType === 'message_inbound') {
    contactPatch.awaiting_reply = true;
  }

  await supabase.from('crm_contacts').update(contactPatch).eq('id', contactId);

  await supabase.from('crm_events').insert({
    contact_id: contactId,
    event_type: input.eventType,
    message_text: input.messageText?.trim() || null,
    property_id: input.propertyId?.trim() || null,
    metadata: input.metadata ?? {},
    created_at: now,
  });
}

export async function recordCrmEventFromOwnerNotification(input: {
  type: 'auto_reply_sent' | 'escalation_created' | 'blocked' | 'missing_data';
  guestChatId: number;
  guestName?: string | null;
  guestUsername?: string | null;
  messageText: string;
  replyText?: string | null;
  propertyId?: string | null;
  intent?: string | null;
  escalationReason?: string | null;
  missingFields?: string[];
  allowCreateContact?: boolean;
  source?: 'telegram' | 'test';
  role?: 'guest' | 'owner' | 'lead';
}): Promise<void> {
  const eventType =
    input.type === 'auto_reply_sent'
      ? 'auto_reply'
      : input.type === 'blocked'
        ? 'blocked'
        : input.type === 'missing_data'
          ? 'missing_data'
          : 'escalation';

  await recordCrmCommunicationEvent({
    telegramChatId: input.guestChatId,
    allowCreateContact: input.allowCreateContact ?? false,
    contactHints: input.allowCreateContact
      ? {
          name: input.guestName,
          role: input.role ?? 'guest',
          source: input.source ?? 'telegram',
          telegramUserId: String(input.guestChatId),
          telegramUsername: input.guestUsername,
          telegramChatId: input.guestChatId,
          propertyId: input.propertyId,
          status: input.source === 'test' ? 'testing_communication' : undefined,
        }
      : undefined,
    eventType,
    messageText: input.messageText,
    propertyId: input.propertyId,
    metadata: {
      intent: input.intent ?? null,
      escalation_reason: input.escalationReason ?? null,
      missing_fields: input.missingFields ?? [],
      reply_preview: input.replyText ?? null,
      notification_type: input.type,
    },
  });
}
