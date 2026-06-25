import { parseChannelManagerConnectionBlock } from '@/lib/channel-manager-connection/note-block';
import { supabase } from '@/lib/supabase';
import { formatCrmContactNameForDisplay } from './contact-display';
import { filterWorkingUiCrmContacts } from './working-ui-visibility';
import { demoCrmContacts } from './demo-data';
import { NormalizedCrmContactInput } from './normalize';
import { normalizePilotRolloutStorageStatus } from './pilot-rollout';
import { CrmContact, CrmOnboarding, CrmOnboardingStatus, CrmOwnerObject, CrmSource, CrmStatus } from './types';

type CrmContactRow = {
  id: string;
  name: string;
  contact?: string | null;
  phone: string | null;
  telegram_username: string | null;
  email: string | null;
  role: string;
  source: string;
  property_count: number | null;
  city: string | null;
  notes: string | null;
  status: string;
  communication_status?: string | null;
  awaiting_reply?: boolean | null;
  last_activity_at: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  created_at: string;
  updated_at: string;
  crm_archived?: boolean | null;
  archived_at?: string | null;
  archived_by?: string | null;
};

export type CrmContactFilters = {
  status?: CrmStatus | 'all';
  source?: CrmSource | 'all';
  search?: string;
  excludeArchived?: boolean;
  includeTest?: boolean;
};

const STATUS_FILTER_VALUES: Partial<Record<CrmStatus, string[]>> = {
  new: ['new', 'new_lead', 'pilot_candidate', 'contact', 'qualified', 'needs_reaction'],
  waitlist: ['waitlist', 'pilot_waitlist'],
  invited: ['invited', 'instruction_sent', 'pilot_selected'],
  onboarding: [
    'onboarding',
    'waiting_object_data',
    'needs_clarification',
    'access_received',
    'object_filled',
    'creating_object',
    'object_setup',
    'test_object_selected',
    'ready_for_test',
    'testing_communication',
  ],
  active_pilot: ['active_pilot', 'pilot', 'pilot_active'],
  paused: ['paused'],
  rejected: ['rejected', 'not_relevant', 'not_fit'],
  new_lead: ['new_lead', 'new', 'pilot_candidate'],
  contact: ['contact', 'qualified', 'needs_reaction'],
  waiting_object_data: ['waiting_object_data', 'needs_clarification'],
  access_received: ['access_received', 'object_filled'],
  test_object_selected: ['test_object_selected', 'pilot_selected'],
  object_setup: ['object_setup', 'creating_object'],
  ready_for_test: ['ready_for_test', 'testing_communication'],
  pilot: ['pilot', 'pilot_active', 'active_pilot'],
  not_relevant: ['not_relevant', 'not_fit'],
};

const SOURCE_FILTER_VALUES: Partial<Record<CrmSource, string[]>> = {
  form: ['form', 'landing', 'pilot_form'],
  other: ['other', 'test'],
};

function toRole(value: string): CrmContact['role'] {
  if (value === 'owner' || value === 'manager' || value === 'partner') return value;
  return 'unknown';
}

function toSource(value: string): CrmSource {
  if (value === 'telegram' || value === 'form' || value === 'manual' || value === 'bragin_group' || value === 'other') {
    return value;
  }
  if (value === 'landing' || value === 'pilot_form') return 'form';
  return 'other';
}

function toStatus(value: string): CrmStatus {
  const map: Record<string, CrmStatus> = {
    new_lead: 'new',
    pilot_candidate: 'new',
    needs_clarification: 'waiting_object_data',
    qualified: 'contact',
    creating_object: 'object_setup',
    object_filled: 'access_received',
    testing_communication: 'ready_for_test',
    needs_reaction: 'contact',
    pilot_active: 'active_pilot',
    pilot: 'active_pilot',
    pilot_selected: 'test_object_selected',
    pilot_waitlist: 'waitlist',
    not_fit: 'rejected',
    not_relevant: 'rejected',
  };
  return map[value] ?? (value as CrmStatus);
}

function toCommunicationStatus(row: CrmContactRow): CrmContact['communicationStatus'] {
  const value = row.communication_status;
  if (
    value === 'no_contact' ||
    value === 'wrote_first' ||
    value === 'waiting_reply' ||
    value === 'replied' ||
    value === 'needs_manual_reaction' ||
    value === 'has_problem' ||
    value === 'escalation_closed'
  ) {
    return value;
  }
  if (row.status === 'needs_reaction') return 'needs_manual_reaction';
  if (row.awaiting_reply) return 'waiting_reply';
  if (row.last_activity_at) return 'replied';
  return 'no_contact';
}

const ONBOARDING_STATUS_BY_LABEL: Record<string, CrmOnboardingStatus> = {
  'онбординг начат': 'onboarding_started',
  'идёт подключение': 'onboarding_started',
  'не хватает данных': 'missing_required_data',
  'готов к менеджеру каналов': 'ready_for_channel_manager',
  'готов к Менеджеру каналов': 'ready_for_channel_manager',
  'готов к Менеджеру Каналов': 'ready_for_channel_manager',
  'Менеджер каналов открыт': 'channel_manager_started',
  'менеджер каналов открыт': 'channel_manager_started',
  'Менеджер Каналов открыт': 'channel_manager_started',
  'нужна реакция оператора': 'needs_operator',
  'требует внимания': 'needs_operator',
};

const ONBOARDING_STATUS_BY_SLUG: Record<string, CrmOnboardingStatus> = {
  onboarding_started: 'onboarding_started',
  missing_required_data: 'missing_required_data',
  ready_for_channel_manager: 'ready_for_channel_manager',
  channel_manager_started: 'channel_manager_started',
  needs_operator: 'needs_operator',
};

const OWNER_OBJECTS_HEADER = 'Объекты владельца';

function parseOwnerObjects(note: string | null | undefined): CrmOwnerObject[] {
  const lines = String(note ?? '').split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => line === OWNER_OBJECTS_HEADER);
  if (start === -1) return [];

  const objects: CrmOwnerObject[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) break;
    const match = line.match(
      /^((?:OBJ-\d+)|(?:pilot_[^\s|]+))\s*\|\s*(.+?)\s*\|\s*готовность:\s*(\d+)%\s*\|\s*активная сессия:\s*(да|нет)$/i,
    );
    if (!match) continue;
    objects.push({
      objectId: match[1],
      title: match[2].trim(),
      readinessPercent: Number(match[3]),
      isActiveSession: match[4].toLowerCase() === 'да',
    });
  }
  return objects;
}

function parseOnboarding(note: string | null | undefined): CrmOnboarding | null {
  const lines = String(note ?? '').split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => line === 'Онбординг ASI');
  if (start === -1) return null;
  const get = (prefix: string): string => {
    const line = lines.slice(start + 1).find((item) => item.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
  };
  const statusLabel = get('Статус:');
  const status =
    ONBOARDING_STATUS_BY_LABEL[statusLabel.toLowerCase()] ??
    ONBOARDING_STATUS_BY_LABEL[statusLabel] ??
    ONBOARDING_STATUS_BY_SLUG[statusLabel];
  if (!status) return null;
  const missingRaw = get('Не хватает:');
  const missing = !missingRaw || missingRaw === 'ничего'
    ? []
    : missingRaw.split(',').map((item) => item.trim()).filter(Boolean);
  const href = get('Менеджер каналов:');
  const readinessRaw = get('Готовность:').replace('%', '').trim();
  const readinessPercent = readinessRaw && /^\d+$/.test(readinessRaw) ? Number(readinessRaw) : null;
  const missingOptionalRaw = get('Не хватает (дополнительно):');
  const missingOptional =
    !missingOptionalRaw || missingOptionalRaw === 'ничего'
      ? []
      : missingOptionalRaw.split(',').map((item) => item.trim()).filter(Boolean);
  const channelsRaw = get('Каналы:');
  const rulesRaw = get('Правила:');
  const photosCountRaw = get('Фото:').replace(/[^\d]/g, '');
  return {
    status,
    statusLabel,
    missing,
    lastMessage: get('Последнее сообщение:'),
    channelManagerHref: href || null,
    readinessPercent,
    readinessStatusLabel: get('Статус готовности:') || null,
    nextBestStep: get('Следующий шаг:') || null,
    missingOptional,
    objectType: get('Тип объекта:') || null,
    checkinTime: get('Заезд:') || null,
    checkoutTime: get('Выезд:') || null,
    channels: channelsRaw ? channelsRaw.split(',').map((item) => item.trim()).filter(Boolean) : [],
    rules: rulesRaw ? rulesRaw.split(',').map((item) => item.trim()).filter(Boolean) : [],
    wifiName: get('Wi-Fi имя:') || null,
    wifiPassword: get('Wi-Fi пароль:') || null,
    photosCount: photosCountRaw && /^\d+$/.test(photosCountRaw) ? Number(photosCountRaw) : null,
  };
}

function toContact(row: CrmContactRow): CrmContact {
  const ownerObjects = parseOwnerObjects(row.notes);
  const activeObject = ownerObjects.find((item) => item.isActiveSession) ?? ownerObjects[0] ?? null;
  return {
    id: row.id,
    name: formatCrmContactNameForDisplay(row.name, row.telegram_username),
    phone: row.phone ?? row.contact ?? '',
    telegramUsername: row.telegram_username ?? '',
    email: row.email,
    role: toRole(row.role),
    source: toSource(row.source),
    objectsCount: ownerObjects.length > 0 ? ownerObjects.length : (row.property_count ?? 0),
    city: row.city ?? '',
    note: row.notes ?? '',
    status: toStatus(row.status),
    communicationStatus: toCommunicationStatus(row),
    lastContactAt: row.last_activity_at,
    nextStep: row.next_action ?? '',
    nextActionAt: row.next_action_due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    crmArchived: row.crm_archived === true,
    archivedAt: row.archived_at ?? null,
    archivedBy: row.archived_by ?? null,
    onboarding: parseOnboarding(row.notes),
    channelManagerConnection: parseChannelManagerConnectionBlock(row.notes),
    ownerObjects,
    activeObjectTitle: activeObject?.title ?? null,
  };
}

function toRow(input: NormalizedCrmContactInput) {
  return {
    name: input.name,
    phone: input.phone || null,
    contact: input.phone || input.telegramUsername || input.email || null,
    telegram_username: input.telegramUsername || null,
    email: input.email,
    role: input.role,
    source: input.source,
    property_count: input.objectsCount,
    city: input.city || null,
    notes: input.note || '',
    status: normalizePilotRolloutStorageStatus(input.status),
    communication_status: input.communicationStatus,
    last_activity_at: input.lastContactAt,
    next_action: input.nextStep || '',
    next_action_due_at: input.nextActionAt,
  };
}

function demoContacts(filters: CrmContactFilters): CrmContact[] {
  const search = filters.search?.trim().toLowerCase() ?? '';
  const filtered = demoCrmContacts.filter((contact) => {
    if (filters.excludeArchived && contact.crmArchived) return false;
    if (filters.status && filters.status !== 'all' && contact.status !== filters.status) return false;
    if (filters.source && filters.source !== 'all' && contact.source !== filters.source) return false;
    if (!search) return true;
    const haystack = [contact.name, contact.phone, contact.telegramUsername].join(' ').toLowerCase();
    return haystack.includes(search);
  });
  return filterWorkingUiCrmContacts(filtered, { includeTest: filters.includeTest });
}

function shouldUseDemoFallback(error: unknown): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /crm_contacts|relation|schema cache|not configured/i.test(message);
}

export async function listCrmContacts(filters: CrmContactFilters = {}): Promise<CrmContact[]> {
  try {
    let query = supabase
      .from('crm_contacts')
      .select('*')
      .order('next_action_due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (filters.status && filters.status !== 'all') {
      query = query.in('status', STATUS_FILTER_VALUES[filters.status] ?? [filters.status]);
    }
    if (filters.source && filters.source !== 'all') {
      query = query.in('source', SOURCE_FILTER_VALUES[filters.source] ?? [filters.source]);
    }
    if (filters.search?.trim()) {
      const escaped = filters.search.trim().replace(/[%_]/g, '\\$&');
      query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,contact.ilike.%${escaped}%,telegram_username.ilike.%${escaped}%`);
    }
    if (filters.excludeArchived) {
      query = query.eq('crm_archived', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    const contacts = (data ?? []).map((row) => toContact(row as CrmContactRow));
    return filterWorkingUiCrmContacts(contacts, { includeTest: filters.includeTest });
  } catch (error) {
    if (shouldUseDemoFallback(error)) return demoContacts(filters);
    throw error;
  }
}

export async function getCrmContactById(id: string): Promise<CrmContact | null> {
  try {
    const { data, error } = await supabase.from('crm_contacts').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) {
      if (process.env.NODE_ENV !== 'production') {
        const demo = demoCrmContacts.find((contact) => contact.id === id);
        if (demo) return demo;
      }
      return null;
    }
    return toContact(data as CrmContactRow);
  } catch (error) {
    if (shouldUseDemoFallback(error)) {
      return demoCrmContacts.find((contact) => contact.id === id) ?? null;
    }
    throw error;
  }
}

export async function createCrmContact(input: NormalizedCrmContactInput): Promise<CrmContact> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .insert(toRow(input))
    .select('*')
    .single();
  if (error) throw error;
  return toContact(data as CrmContactRow);
}

export async function updateCrmContact(id: string, input: Partial<NormalizedCrmContactInput>): Promise<CrmContact> {
  const patch = toRow({
    name: '',
    phone: '',
    telegramUsername: '',
    email: null,
    role: 'unknown',
    source: 'manual',
    objectsCount: 0,
    city: '',
    note: '',
    status: 'new',
    communicationStatus: 'no_contact',
    lastContactAt: null,
    nextStep: '',
    nextActionAt: null,
    ...input,
  });

  const allowedPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      if (key === 'telegram_username') return 'telegramUsername' in input;
      if (key === 'property_count') return 'objectsCount' in input;
      if (key === 'last_activity_at') return 'lastContactAt' in input;
      if (key === 'next_action') return 'nextStep' in input;
      if (key === 'next_action_due_at') return 'nextActionAt' in input;
      if (key === 'communication_status') return 'communicationStatus' in input;
      if (key === 'notes') return 'note' in input;
      if (key === 'contact') return 'phone' in input || 'telegramUsername' in input || 'email' in input;
      return camelKey in input;
    })
  );

  const { data, error } = await supabase
    .from('crm_contacts')
    .update(allowedPatch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return toContact(data as CrmContactRow);
}

export async function deleteCrmContact(id: string): Promise<void> {
  const { error } = await supabase.from('crm_contacts').delete().eq('id', id);
  if (error) throw error;
}

export async function archiveCrmContactFromQueue(id: string, archivedBy: string): Promise<CrmContact> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('crm_contacts')
    .update({
      crm_archived: true,
      archived_at: now,
      archived_by: archivedBy,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return toContact(data as CrmContactRow);
}

export async function archiveCrmContactsFromQueue(ids: string[], archivedBy: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('crm_contacts')
    .update({
      crm_archived: true,
      archived_at: now,
      archived_by: archivedBy,
    })
    .in('id', ids)
    .eq('crm_archived', false)
    .select('id');
  if (error) throw error;
  return (data ?? []).map((row) => String((row as { id: string }).id));
}
