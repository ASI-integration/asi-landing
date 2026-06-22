import { supabase } from '@/lib/supabase';
import { createOpsTaskFromAutopilotEscalation } from '@/lib/ops-board/integrations';
import type { CommunicationAutopilotV1Result } from './communication-autopilot-v1';

type EventInput = {
  contactId: string | null;
  eventType: string;
  messageText: string;
  propertyId?: string | null;
  metadata: Record<string, unknown>;
};

function nowIso(): string {
  return new Date().toISOString();
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
  const chatId = String(params.telegramChatId).trim();
  const { data } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

async function ensureGuestContact(input: {
  contactId?: string | null;
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  communicationStatus: string;
  status: string;
  nextAction: string;
}): Promise<string | null> {
  const existing = await findContactId(input);
  const now = nowIso();
  if (existing) {
    await supabase
      .from('crm_contacts')
      .update({
        communication_status: input.communicationStatus,
        status: input.status,
        next_action: input.nextAction,
        last_activity_at: now,
      })
      .eq('id', existing);
    return existing;
  }

  const { data, error } = await supabase
    .from('crm_contacts')
    .insert({
      name: 'Telegram guest',
      contact: String(input.telegramChatId),
      telegram_user_id: input.telegramUserId.trim() || null,
      telegram_chat_id: String(input.telegramChatId),
      role: 'guest',
      source: 'test',
      status: input.status,
      communication_status: input.communicationStatus,
      next_action: input.nextAction,
      last_activity_at: now,
      notes: input.propertyId ? `guest_autopilot property_id=${input.propertyId}` : 'guest_autopilot',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[communication-autopilot-crm] contact upsert failed', { error: error.message });
    return null;
  }
  return String((data as { id?: unknown }).id ?? '') || null;
}

async function insertCrmAutopilotEvent(input: EventInput): Promise<void> {
  if (!input.contactId) return;
  const { error } = await supabase.from('crm_events').insert({
    contact_id: input.contactId,
    event_type: input.eventType,
    message_text: input.messageText,
    property_id: input.propertyId ?? null,
    metadata: input.metadata,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[communication-autopilot-crm] event insert failed', {
      eventType: input.eventType,
      error: error.message,
    });
  }
}

async function updateContactForAutopilot(
  contactId: string | null,
  patch: {
    communication_status?: string;
    status?: string;
    next_action?: string;
    last_activity_at?: string;
  },
): Promise<void> {
  if (!contactId) return;
  const { error } = await supabase.from('crm_contacts').update(patch).eq('id', contactId);
  if (error) {
    console.error('[communication-autopilot-crm] contact update failed', { error: error.message });
  }
}

function baseMetadata(input: {
  result: CommunicationAutopilotV1Result;
  guestQuestion: string;
  replyText: string;
  role?: string | null;
  transport?: string | null;
}): Record<string, unknown> {
  return {
    source: 'communication_autopilot_v1',
    role: input.role ?? 'guest',
    transport: input.transport ?? 'telegram_text',
    intent: input.result.intent,
    topic: input.result.topic,
    needs_operator: input.result.needsOperator,
    conversation_status: input.result.resolved
      ? 'resolved'
      : input.result.needsOperator
        ? 'needs_operator'
        : 'clarification',
    guest_question: input.guestQuestion,
    reply_preview: input.replyText,
    safeGuestReply: input.replyText,
    original_message: input.guestQuestion,
    missing_fields: input.result.missingFields,
    escalation_reason: input.result.escalationReason ?? null,
    knowledge_source: input.result.knowledgeSource ?? null,
  };
}

export async function recordCommunicationAutopilotTurn(input: {
  contactId?: string | null;
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  guestQuestion: string;
  result: CommunicationAutopilotV1Result;
  role?: string | null;
  transport?: string | null;
}): Promise<{ contactId: string | null }> {
  const metadata = baseMetadata({
    result: input.result,
    guestQuestion: input.guestQuestion,
    replyText: input.result.replyText,
    role: input.role,
    transport: input.transport,
  });
  const now = nowIso();
  let contactId = input.contactId ?? null;

  if (input.result.action === 'auto_reply') {
    contactId = await ensureGuestContact({
      contactId,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      propertyId: input.propertyId,
      communicationStatus: 'replied',
      status: 'testing_communication',
      nextAction: 'Автопилот ответил гостю',
    });
    await insertCrmAutopilotEvent({
      contactId,
      eventType: 'autopilot_guest_reply',
      messageText: input.guestQuestion,
      propertyId: input.propertyId,
      metadata,
    });
    if (input.result.resolved) {
      await insertCrmAutopilotEvent({
        contactId,
        eventType: 'conversation_resolved',
        messageText: input.guestQuestion,
        propertyId: input.propertyId,
        metadata: {
          ...metadata,
          resolution: 'autopilot_answered',
        },
      });
    }
    await updateContactForAutopilot(contactId, {
      communication_status: 'replied',
      status: 'testing_communication',
      next_action: 'Автопилот ответил гостю',
      last_activity_at: now,
    });
    return { contactId };
  }

  if (input.result.action === 'clarification') {
    contactId = await ensureGuestContact({
      contactId,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      propertyId: input.propertyId,
      communicationStatus: 'waiting_reply',
      status: 'testing_communication',
      nextAction: 'Ожидается уточнение от владельца',
    });
    await insertCrmAutopilotEvent({
      contactId,
      eventType: 'autopilot_clarification_requested',
      messageText: input.guestQuestion,
      propertyId: input.propertyId,
      metadata,
    });
    await updateContactForAutopilot(contactId, {
      communication_status: 'waiting_reply',
      status: 'testing_communication',
      next_action: 'Ожидается уточнение от владельца',
      last_activity_at: now,
    });
    return { contactId };
  }

  contactId = await ensureGuestContact({
    contactId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    propertyId: input.propertyId,
    communicationStatus: 'needs_manual_reaction',
    status: 'needs_reaction',
    nextAction: 'Ответить гостю',
  });
  await insertCrmAutopilotEvent({
    contactId,
    eventType: 'autopilot_operator_handoff',
    messageText: input.guestQuestion,
    propertyId: input.propertyId,
    metadata,
  });
  await insertCrmAutopilotEvent({
    contactId,
    eventType: 'operator_followup_required',
    messageText: input.guestQuestion,
    propertyId: input.propertyId,
    metadata: {
      ...metadata,
      internal_detail: input.result.escalationReason ?? 'operator_required',
    },
  });
  await updateContactForAutopilot(contactId, {
    communication_status: 'needs_manual_reaction',
    status: 'needs_reaction',
    next_action: 'Ответить гостю',
    last_activity_at: now,
  });
  await createOpsTaskFromAutopilotEscalation({
    contactId,
    propertyId: input.propertyId,
    guestName: 'Гость',
    escalationReason: input.result.escalationReason ?? input.result.intent,
    guestQuestion: input.guestQuestion,
  });
  return { contactId };
}
