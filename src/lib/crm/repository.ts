import { supabase } from '@/lib/supabase';
import {
  buildCrmPropertyAutomationSummary,
  missingDataActionsForFields,
  type CrmPropertyAutomationSummary,
} from './automation-loop';
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
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';

const CONTACT_SELECT =
  'id, name, role, source, contact, telegram_user_id, telegram_username, telegram_chat_id, status, property_id, property_count, notes, next_action, next_action_due_at, last_message, last_activity_at, lead_id, awaiting_reply, created_at, updated_at';

const EVENT_SELECT =
  'id, contact_id, event_type, message_text, property_id, metadata, acknowledged_at, created_at';

type PropertyRow = {
  id: string;
  account_id: string;
  name: string;
  address_line: string | null;
  city: string | null;
  timezone: string | null;
  status: OpsProperty['status'];
  created_at: string;
  updated_at: string;
};

type MasterCardRow = {
  id: string;
  property_id: string;
  public_title: string | null;
  short_description: string | null;
  full_description: string | null;
  amenities: unknown;
  house_rules: string | null;
  check_in_instructions: string | null;
  check_out_instructions: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  parking_info: string | null;
  deposit_info: string | null;
  extra_fees_info: string | null;
  cancellation_info: string | null;
  guest_contacts_info: string | null;
  internal_notes: string | null;
  content_version: number;
  publication_status: PropertyMasterCard['publicationStatus'];
  created_at: string;
  updated_at: string;
};

type MediaRow = {
  id: string;
  property_id: string;
  url: string | null;
  storage_path: string | null;
  title: string | null;
  description: string | null;
  sort_order: number;
  is_cover: boolean;
  status: PropertyMedia['status'];
  created_at: string;
  updated_at: string;
};

type SetupProfileRow = {
  property_id: string;
  data: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function mapProperty(row: PropertyRow): OpsProperty {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.name,
    address: row.address_line,
    city: row.city,
    timezone: row.timezone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAmenities(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapMasterCard(row: MasterCardRow): PropertyMasterCard {
  return {
    id: row.id,
    propertyId: row.property_id,
    publicTitle: row.public_title,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    amenities: mapAmenities(row.amenities),
    houseRules: row.house_rules,
    checkInInstructions: row.check_in_instructions,
    checkOutInstructions: row.check_out_instructions,
    wifiName: row.wifi_name,
    wifiPassword: row.wifi_password,
    parkingInfo: row.parking_info,
    depositInfo: row.deposit_info,
    extraFeesInfo: row.extra_fees_info,
    cancellationInfo: row.cancellation_info,
    guestContactsInfo: row.guest_contacts_info,
    internalNotes: row.internal_notes,
    contentVersion: row.content_version,
    publicationStatus: row.publication_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMedia(row: MediaRow): PropertyMedia {
  return {
    id: row.id,
    propertyId: row.property_id,
    url: row.url,
    storagePath: row.storage_path,
    title: row.title,
    description: row.description,
    sortOrder: row.sort_order,
    isCover: row.is_cover,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chatIdString(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function isProtectedCrmRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

function shouldKeepExistingRole(existing: CrmContactRow, nextRole: string | null | undefined): boolean {
  if (!nextRole || nextRole === 'unknown') return true;
  if (nextRole === 'lead' && (isProtectedCrmRole(existing.role) || existing.status === 'pilot_active')) return true;
  return false;
}

function shouldKeepExistingStatus(existing: CrmContactRow, nextStatus: string | null | undefined, nextRole: string | null | undefined): boolean {
  if (!nextStatus) return true;
  if (existing.status === 'pilot_active' && nextStatus !== 'pilot_active') return true;
  if (nextRole === 'lead' && isProtectedCrmRole(existing.role) && (nextStatus === 'new' || nextStatus === 'qualified')) {
    return true;
  }
  return false;
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

async function fetchCrmPropertySummaries(
  propertyIds: string[],
): Promise<Map<string, CrmPropertyAutomationSummary>> {
  const ids = [...new Set(propertyIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, CrmPropertyAutomationSummary>();
  if (ids.length === 0) return map;

  const [
    propertiesResult,
    masterCardsResult,
    mediaResult,
    setupProfilesResult,
  ] = await Promise.all([
    supabase.from('properties').select('*').in('id', ids),
    supabase.from('property_master_cards').select('*').in('property_id', ids),
    supabase.from('property_media').select('*').in('property_id', ids).neq('status', 'deleted'),
    supabase.from('property_setup_profiles').select('property_id, data').in('property_id', ids),
  ]);

  if (propertiesResult.error) throw propertiesResult.error;
  if (masterCardsResult.error) throw masterCardsResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (setupProfilesResult.error) throw setupProfilesResult.error;

  const masterByPropertyId = new Map<string, PropertyMasterCard>();
  for (const row of (masterCardsResult.data ?? []) as MasterCardRow[]) {
    masterByPropertyId.set(row.property_id, mapMasterCard(row));
  }

  const mediaByPropertyId = new Map<string, PropertyMedia[]>();
  for (const row of (mediaResult.data ?? []) as MediaRow[]) {
    const list = mediaByPropertyId.get(row.property_id) ?? [];
    list.push(mapMedia(row));
    mediaByPropertyId.set(row.property_id, list);
  }

  const setupByPropertyId = new Map<string, unknown>();
  for (const row of (setupProfilesResult.data ?? []) as SetupProfileRow[]) {
    setupByPropertyId.set(row.property_id, row.data);
  }

  for (const row of (propertiesResult.data ?? []) as PropertyRow[]) {
    const property = mapProperty(row);
    map.set(property.id, buildCrmPropertyAutomationSummary({
      property,
      masterCard: masterByPropertyId.get(property.id) ?? null,
      setup: setupByPropertyId.get(property.id) as Record<string, unknown> | null | undefined,
      media: mediaByPropertyId.get(property.id) ?? [],
    }));
  }

  return map;
}

export async function listCrmPropertyOptions(limit = 250): Promise<CrmPropertyAutomationSummary[]> {
  const { data, error } = await supabase
    .from('properties')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  const summaries = await fetchCrmPropertySummaries(ids);
  return ids.map((id) => summaries.get(id)).filter((item): item is CrmPropertyAutomationSummary => Boolean(item));
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
  const propertiesById = await fetchCrmPropertySummaries(
    rows.map((row) => row.property_id).filter((id): id is string => Boolean(id)),
  );

  return rows.map((row) => normalizeCrmContactRow(
    row,
    eventsByContact.get(row.id) ?? [],
    row.property_id ? propertiesById.get(row.property_id) ?? null : null,
  ));
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

  const propertiesById = await fetchCrmPropertySummaries(row.property_id ? [row.property_id] : []);
  return normalizeCrmContactRow(
    row,
    (events ?? []) as CrmEventRow[],
    row.property_id ? propertiesById.get(row.property_id) ?? null : null,
  );
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
  const row = data as CrmContactRow;
  const propertiesById = await fetchCrmPropertySummaries(row.property_id ? [row.property_id] : []);
  return normalizeCrmContactRow(
    row,
    [],
    row.property_id ? propertiesById.get(row.property_id) ?? null : null,
  );
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
  if (input.status === undefined && input.propertyId?.trim()) patch.status = 'creating_object';

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

  const propertiesById = await fetchCrmPropertySummaries(row.property_id ? [row.property_id] : []);
  return normalizeCrmContactRow(
    row,
    (events ?? []) as CrmEventRow[],
    row.property_id ? propertiesById.get(row.property_id) ?? null : null,
  );
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
    const row = data as CrmContactRow;
    const propertiesById = await fetchCrmPropertySummaries(row.property_id ? [row.property_id] : []);
    return normalizeCrmContactRow(
      row,
      [],
      row.property_id ? propertiesById.get(row.property_id) ?? null : null,
    );
  }

  const patch: Record<string, unknown> = {
    updated_at: now,
    last_activity_at: now,
  };
  if (input.name?.trim()) patch.name = input.name.trim();
  if (!shouldKeepExistingRole(existing, input.role)) patch.role = input.role;
  if (input.source) patch.source = input.source;
  if (input.telegramUsername) patch.telegram_username = input.telegramUsername.replace(/^@+/, '');
  if (input.telegramChatId != null) patch.telegram_chat_id = chatIdString(input.telegramChatId);
  if (input.propertyId) patch.property_id = input.propertyId;
  if (input.leadId) patch.lead_id = input.leadId;
  if (!shouldKeepExistingStatus(existing, input.status, input.role)) patch.status = input.status;
  if (!input.status && input.propertyId && !shouldKeepExistingStatus(existing, 'creating_object', input.role)) {
    patch.status = 'creating_object';
  }
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

  const row = data as CrmContactRow;
  const propertiesById = await fetchCrmPropertySummaries(row.property_id ? [row.property_id] : []);
  return normalizeCrmContactRow(
    row,
    (events ?? []) as CrmEventRow[],
    row.property_id ? propertiesById.get(row.property_id) ?? null : null,
  );
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
  if (input.eventType === 'escalation' || input.eventType === 'missing_data') {
    contactPatch.status = 'needs_reaction';
    contactPatch.awaiting_reply = true;
  }
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
  severity?: 'critical' | 'high' | 'normal' | null;
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
      missing_data_actions: missingDataActionsForFields(input.missingFields ?? [], input.propertyId),
      severity: input.severity ?? null,
      priority: input.severity ?? null,
      reply_preview: input.replyText ?? null,
      notification_type: input.type,
    },
  });
}
