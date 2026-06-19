import { supabase } from '@/lib/supabase';
import { missingDataActionsForFields } from './automation-loop';
import type { GuestTestQuestionOutcome } from './types';

type ContactPatch = {
  status?: string;
  communication_status?: string;
  next_action?: string;
  last_activity_at?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTelegramChatId(value: number | string): string {
  return String(value).trim();
}

async function findContactId(params: {
  contactId?: string | null;
  telegramUserId: string;
  telegramChatId: number;
}): Promise<string | null> {
  if (params.contactId?.trim()) return params.contactId.trim();

  const userId = params.telegramUserId.trim();
  if (userId) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('telegram_user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const id = (data as { id?: string } | null)?.id;
    if (id) return id;
  }

  const chatId = normalizeTelegramChatId(params.telegramChatId);
  const { data } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

async function ensureContact(input: {
  contactId?: string | null;
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  status: string;
  nextAction: string;
  communicationStatus?: string;
}): Promise<string | null> {
  const existing = await findContactId(input);
  const now = nowIso();
  if (existing) {
    await updateContact(existing, {
      status: input.status,
      communication_status: input.communicationStatus,
      next_action: input.nextAction,
      last_activity_at: now,
    });
    return existing;
  }

  const { data, error } = await supabase
    .from('crm_contacts')
    .insert({
      name: 'Telegram guest',
      contact: normalizeTelegramChatId(input.telegramChatId),
      telegram_user_id: input.telegramUserId.trim() || null,
      telegram_chat_id: normalizeTelegramChatId(input.telegramChatId),
      role: 'guest',
      source: 'test',
      status: input.status,
      communication_status: input.communicationStatus ?? 'replied',
      next_action: input.nextAction,
      last_activity_at: now,
      notes: input.propertyId ? `guest_test property_id=${input.propertyId}` : 'guest_test',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[operator-followup] contact upsert failed', { error: error.message });
    return null;
  }
  return String((data as { id?: unknown }).id ?? '') || null;
}

async function updateContact(contactId: string, patch: ContactPatch): Promise<void> {
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  if (Object.keys(cleanPatch).length === 0) return;
  const { error } = await supabase.from('crm_contacts').update(cleanPatch).eq('id', contactId);
  if (error) console.error('[operator-followup] contact update failed', { error: error.message });
}

async function insertEvent(input: {
  contactId: string | null;
  eventType: string;
  messageText: string;
  propertyId?: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (!input.contactId) return;
  const { error } = await supabase.from('crm_events').insert({
    contact_id: input.contactId,
    event_type: input.eventType,
    message_text: input.messageText,
    property_id: input.propertyId ?? null,
    metadata: input.metadata,
    created_at: nowIso(),
  });
  if (error) console.error('[operator-followup] crm event insert failed', { eventType: input.eventType, error: error.message });
}

export async function recordGuestTestQuestionOutcome(input: {
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  questionText: string;
  replyText: string;
  outcome: GuestTestQuestionOutcome;
  intent: string;
  missingFields?: string[];
  contactId?: string | null;
}): Promise<{ contactId: string | null }> {
  const contactId = await ensureContact({
    contactId: input.contactId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    propertyId: input.propertyId,
    status: input.outcome === 'missing_data' ? 'needs_reaction' : 'testing_communication',
    communicationStatus: input.outcome === 'missing_data' ? 'needs_manual_reaction' : 'replied',
    nextAction: input.outcome === 'missing_data' ? 'Заполнить данные объекта' : 'Пройти guest_test и проверить ответы ASI',
  });

  await insertEvent({
    contactId,
    eventType: 'guest_test_question',
    messageText: input.questionText,
    propertyId: input.propertyId,
    metadata: {
      outcome: input.outcome,
      intent: input.intent,
      question_type: input.intent,
      reply_preview: input.replyText,
      missing_fields: input.missingFields ?? [],
      missing_data_actions: missingDataActionsForFields(input.missingFields ?? [], input.propertyId),
      source: 'guest_test',
    },
  });
  return { contactId };
}

export async function createGuestConciergeAnsweredEvent(input: {
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  guestQuestion: string;
  replyText: string;
  contactId?: string | null;
  intent: string;
}): Promise<void> {
  const contactId = await ensureContact({
    contactId: input.contactId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    propertyId: input.propertyId,
    status: 'testing_communication',
    communicationStatus: 'replied',
    nextAction: 'Пройти guest_test и проверить ответы ASI',
  });
  await insertEvent({
    contactId,
    eventType: 'guest_concierge_answered',
    messageText: input.guestQuestion,
    propertyId: input.propertyId,
    metadata: {
      question_type: input.intent,
      outcome: 'answered_by_concierge_autopilot',
      telegram_chat_id: input.telegramChatId,
      reply_preview: input.replyText,
      source: 'guest_test',
    },
  });
}

export async function createGuestTestMissingDataEvent(input: {
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  guestQuestion: string;
  missingFields: string[];
  contactId?: string | null;
  intent?: string | null;
  internalDetail?: string | null;
}): Promise<{ ok: boolean; contactId?: string | null }> {
  const actions = missingDataActionsForFields(input.missingFields, input.propertyId);
  const firstAction = actions[0];
  const contactId = await ensureContact({
    contactId: input.contactId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    propertyId: input.propertyId,
    status: 'needs_reaction',
    communicationStatus: 'needs_manual_reaction',
    nextAction: firstAction ? `Заполнить: ${firstAction.label}` : 'Заполнить данные объекта',
  });
  await insertEvent({
    contactId,
    eventType: 'missing_data',
    messageText: input.guestQuestion,
    propertyId: input.propertyId,
    metadata: {
      intent: input.intent ?? null,
      missing_fields: input.missingFields,
      missing_data_actions: actions,
      internal_detail: input.internalDetail ?? null,
      source: 'guest_test',
    },
  });
  return { ok: Boolean(contactId), contactId };
}

export async function createOperatorFollowupRequired(input: {
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  guestQuestion: string;
  contactId?: string | null;
  updateId?: number;
  intent?: string | null;
  internalDetail?: string | null;
  lookupData?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; contactId?: string | null; error?: string }> {
  const contactId = await ensureContact({
    contactId: input.contactId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    propertyId: input.propertyId,
    status: 'needs_reaction',
    communicationStatus: 'needs_manual_reaction',
    nextAction: 'Ответить гостю',
  });
  await insertEvent({
    contactId,
    eventType: 'operator_followup_required',
    messageText: input.guestQuestion,
    propertyId: input.propertyId,
    metadata: {
      intent: input.intent ?? null,
      telegram_chat_id: input.telegramChatId,
      telegram_user_id: input.telegramUserId,
      update_id: input.updateId ?? null,
      internal_detail: input.internalDetail ?? null,
      lookup_data: input.lookupData ?? null,
      source: 'guest_test',
    },
  });
  return { ok: Boolean(contactId), contactId };
}
