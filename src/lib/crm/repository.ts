import { supabase } from '@/lib/supabase';
import { demoCrmContacts } from './demo-data';
import { NormalizedCrmContactInput } from './normalize';
import { CrmContact, CrmSource, CrmStatus } from './types';

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
};

export type CrmContactFilters = {
  status?: CrmStatus | 'all';
  source?: CrmSource | 'all';
  search?: string;
};

const STATUS_FILTER_VALUES: Partial<Record<CrmStatus, string[]>> = {
  new_lead: ['new_lead', 'new', 'pilot_candidate'],
  contact: ['contact', 'qualified', 'needs_reaction'],
  waiting_object_data: ['waiting_object_data', 'needs_clarification'],
  access_received: ['access_received', 'object_filled'],
  test_object_selected: ['test_object_selected', 'pilot_selected'],
  object_setup: ['object_setup', 'creating_object'],
  ready_for_test: ['ready_for_test', 'testing_communication'],
  pilot: ['pilot', 'pilot_active'],
  paused: ['paused', 'pilot_waitlist'],
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
    new: 'new_lead',
    needs_clarification: 'waiting_object_data',
    qualified: 'contact',
    creating_object: 'object_setup',
    object_filled: 'access_received',
    testing_communication: 'ready_for_test',
    needs_reaction: 'contact',
    pilot_active: 'pilot',
    pilot_candidate: 'new_lead',
    pilot_selected: 'test_object_selected',
    pilot_waitlist: 'paused',
    not_fit: 'not_relevant',
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

function toContact(row: CrmContactRow): CrmContact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? row.contact ?? '',
    telegramUsername: row.telegram_username ?? '',
    email: row.email,
    role: toRole(row.role),
    source: toSource(row.source),
    objectsCount: row.property_count ?? 0,
    city: row.city ?? '',
    note: row.notes ?? '',
    status: toStatus(row.status),
    communicationStatus: toCommunicationStatus(row),
    lastContactAt: row.last_activity_at,
    nextStep: row.next_action ?? '',
    nextActionAt: row.next_action_due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    status: input.status,
    communication_status: input.communicationStatus,
    last_activity_at: input.lastContactAt,
    next_action: input.nextStep || '',
    next_action_due_at: input.nextActionAt,
  };
}

function demoContacts(filters: CrmContactFilters): CrmContact[] {
  const search = filters.search?.trim().toLowerCase() ?? '';
  return demoCrmContacts.filter((contact) => {
    if (filters.status && filters.status !== 'all' && contact.status !== filters.status) return false;
    if (filters.source && filters.source !== 'all' && contact.source !== filters.source) return false;
    if (!search) return true;
    const haystack = [contact.name, contact.phone, contact.telegramUsername].join(' ').toLowerCase();
    return haystack.includes(search);
  });
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

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => toContact(row as CrmContactRow));
  } catch (error) {
    if (shouldUseDemoFallback(error)) return demoContacts(filters);
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
    status: 'new_lead',
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
