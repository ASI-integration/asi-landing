import { supabase } from '@/lib/supabase';
import { normalizeCrmContactRow } from './view-model';
import type { CrmContactRow, CrmContactViewModel, CrmRole } from './types';
import {
  PILOT_ACTIVE_BOOKINGS_LABELS,
  PILOT_ACTIVE_BOOKINGS_OPTIONS,
  PILOT_CHANNEL_MANAGER_LABELS,
  PILOT_CHANNEL_MANAGER_OPTIONS,
  PILOT_FEEDBACK_LABELS,
  PILOT_FEEDBACK_OPTIONS,
  PILOT_PLATFORM_LABELS,
  PILOT_PLATFORM_OPTIONS,
  PILOT_ROLE_LABELS,
  PILOT_ROLE_OPTIONS,
  PILOT_TEST_FOCUS_LABELS,
  PILOT_TEST_FOCUS_OPTIONS,
  type PilotActiveBookingsOption,
  type PilotChannelManagerOption,
  type PilotFeedbackOption,
  type PilotPlatformOption,
  type PilotRoleOption,
  type PilotTestFocusOption,
} from './pilot-options';

const CONTACT_SELECT =
  'id, name, role, source, contact, telegram_user_id, telegram_username, telegram_chat_id, status, property_id, property_count, notes, next_action, next_action_due_at, last_message, last_activity_at, lead_id, awaiting_reply, created_at, updated_at';

const EVENT_SELECT =
  'id, contact_id, event_type, message_text, property_id, metadata, acknowledged_at, created_at';

export type PilotApplicationInput = {
  name: string;
  telegramContact?: string | null;
  role: PilotRoleOption;
  city: string;
  propertyCount: number;
  channelManager: PilotChannelManagerOption;
  platforms: PilotPlatformOption[];
  hasActiveBookings: PilotActiveBookingsOption;
  testFocus: PilotTestFocusOption;
  feedbackReady: PilotFeedbackOption;
};

export type NormalizedPilotApplication = PilotApplicationInput & {
  crmRole: CrmRole;
  telegramUsername: string | null;
  suggestedNextAction: string;
  notes: string;
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function oneOf<T extends readonly string[]>(value: unknown, options: T, fallback: T[number]): T[number] {
  const text = clean(value);
  return options.includes(text) ? (text as T[number]) : fallback;
}

function normalizeTelegramUsername(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  const direct = text.match(/^@?([a-z0-9_]{5,32})$/i)?.[1];
  if (direct) return direct;
  const fromLink = text.match(/(?:t\.me|telegram\.me)\/([a-z0-9_]{5,32})/i)?.[1];
  return fromLink ?? null;
}

function crmRoleForPilot(role: PilotRoleOption): CrmRole {
  if (role === 'owner') return 'owner';
  if (role === 'manager') return 'manager';
  return 'lead';
}

export function isPilotCandidateFit(input: Pick<PilotApplicationInput, 'role' | 'propertyCount' | 'feedbackReady'>): boolean {
  return (input.role === 'owner' || input.role === 'manager') && input.propertyCount > 0 && input.feedbackReady === 'yes';
}

export function resolvePilotNextAction(input: Pick<PilotApplicationInput, 'telegramContact' | 'role' | 'propertyCount' | 'feedbackReady'>): string {
  if (!clean(input.telegramContact)) return 'Уточнить Telegram для подключения';
  if (input.propertyCount <= 0) return 'Уточнить наличие реального объекта';
  if (isPilotCandidateFit(input)) return 'Выбрать в пилот и предложить создать объект';
  return 'Оценить кандидата в пилот';
}

export function normalizePilotApplication(input: Record<string, unknown>): NormalizedPilotApplication {
  const name = clean(input.name);
  const city = clean(input.city);
  const telegramContact = clean(input.telegramContact || input.telegram) || null;
  const propertyCountRaw = Number(input.propertyCount);
  const propertyCount = Number.isFinite(propertyCountRaw)
    ? Math.max(0, Math.min(500, Math.trunc(propertyCountRaw)))
    : 0;
  const role = oneOf(input.role, PILOT_ROLE_OPTIONS, 'other');
  const channelManager = oneOf(input.channelManager, PILOT_CHANNEL_MANAGER_OPTIONS, 'none');
  const platformsRaw = Array.isArray(input.platforms) ? input.platforms : [];
  const platforms = platformsRaw
    .map((item) => oneOf(item, PILOT_PLATFORM_OPTIONS, 'other'))
    .filter((item, index, list) => list.indexOf(item) === index);
  const hasActiveBookings = oneOf(input.hasActiveBookings, PILOT_ACTIVE_BOOKINGS_OPTIONS, 'no');
  const testFocus = oneOf(input.testFocus, PILOT_TEST_FOCUS_OPTIONS, 'communications');
  const feedbackReady = oneOf(input.feedbackReady, PILOT_FEEDBACK_OPTIONS, 'unsure');

  const normalized: PilotApplicationInput = {
    name,
    telegramContact,
    role,
    city,
    propertyCount,
    channelManager,
    platforms,
    hasActiveBookings,
    testFocus,
    feedbackReady,
  };
  const suggestedNextAction = resolvePilotNextAction(normalized);
  const platformLabels = platforms.length
    ? platforms.map((item) => PILOT_PLATFORM_LABELS[item]).join(', ')
    : 'Не указаны';
  const notes = [
    'Заявка в закрытый пилот ASI.',
    `Роль: ${PILOT_ROLE_LABELS[role]}`,
    `Город: ${city || 'не указан'}`,
    `Количество объектов: ${propertyCount}`,
    `Менеджер каналов: ${PILOT_CHANNEL_MANAGER_LABELS[channelManager]}`,
    `Площадки: ${platformLabels}`,
    `Реальные брони сейчас: ${PILOT_ACTIVE_BOOKINGS_LABELS[hasActiveBookings]}`,
    `Хочет протестировать: ${PILOT_TEST_FOCUS_LABELS[testFocus]}`,
    `Готовность дать обратную связь: ${PILOT_FEEDBACK_LABELS[feedbackReady]}`,
  ].join('\n');

  return {
    ...normalized,
    crmRole: crmRoleForPilot(role),
    telegramUsername: normalizeTelegramUsername(telegramContact),
    suggestedNextAction,
    notes,
  };
}

export function pilotApplicationMetadata(input: NormalizedPilotApplication): Record<string, unknown> {
  return {
    source: 'pilot_form',
    role_answer: input.role,
    role_label: PILOT_ROLE_LABELS[input.role],
    telegram_contact: input.telegramContact,
    city: input.city,
    property_count: input.propertyCount,
    channel_manager: input.channelManager,
    channel_manager_label: PILOT_CHANNEL_MANAGER_LABELS[input.channelManager],
    platforms: input.platforms,
    platform_labels: input.platforms.map((item) => PILOT_PLATFORM_LABELS[item]),
    has_active_bookings: input.hasActiveBookings,
    has_active_bookings_label: PILOT_ACTIVE_BOOKINGS_LABELS[input.hasActiveBookings],
    test_focus: input.testFocus,
    test_focus_label: PILOT_TEST_FOCUS_LABELS[input.testFocus],
    feedback_ready: input.feedbackReady,
    feedback_ready_label: PILOT_FEEDBACK_LABELS[input.feedbackReady],
    candidate_fit: isPilotCandidateFit(input),
    suggested_next_action: input.suggestedNextAction,
  };
}

async function findPilotContact(input: NormalizedPilotApplication): Promise<CrmContactRow | null> {
  if (input.telegramUsername) {
    const { data, error } = await supabase
      .from('crm_contacts')
      .select(CONTACT_SELECT)
      .eq('telegram_username', input.telegramUsername)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as CrmContactRow;
  }

  const contact = clean(input.telegramContact);
  if (contact) {
    const { data, error } = await supabase
      .from('crm_contacts')
      .select(CONTACT_SELECT)
      .eq('contact', contact)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as CrmContactRow;
  }

  return null;
}

async function normalizeWithEvents(contactId: string, row: CrmContactRow): Promise<CrmContactViewModel> {
  const { data: events, error } = await supabase
    .from('crm_events')
    .select(EVENT_SELECT)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return normalizeCrmContactRow(row, Array.isArray(events) ? events : [], null);
}

export async function upsertPilotApplication(input: NormalizedPilotApplication): Promise<CrmContactViewModel> {
  const now = new Date().toISOString();
  const existing = await findPilotContact(input);
  const metadata = pilotApplicationMetadata(input);

  const patch = {
    name: input.name || existing?.name || 'Без имени',
    role: input.crmRole,
    source: 'pilot_form',
    contact: input.telegramContact,
    telegram_username: input.telegramUsername,
    status: 'pilot_candidate',
    property_count: input.propertyCount,
    notes: input.notes,
    next_action: input.suggestedNextAction,
    last_message: 'Заявка в закрытый пилот ASI',
    last_activity_at: now,
    updated_at: now,
  };

  const rowResult = existing
    ? await supabase
        .from('crm_contacts')
        .update(patch)
        .eq('id', existing.id)
        .select(CONTACT_SELECT)
        .single()
    : await supabase
        .from('crm_contacts')
        .insert({ ...patch, created_at: now })
        .select(CONTACT_SELECT)
        .single();

  if (rowResult.error) throw rowResult.error;
  const row = rowResult.data as CrmContactRow;

  const { error: eventError } = await supabase.from('crm_events').insert({
    contact_id: row.id,
    event_type: 'pilot_application_submitted',
    message_text: input.notes,
    property_id: null,
    metadata,
    created_at: now,
  });
  if (eventError) throw eventError;

  return normalizeWithEvents(row.id, row);
}
