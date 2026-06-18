import { missingDataActionsForFields } from '@/lib/crm/automation-loop';
import {
  recordCrmCommunicationEvent,
  updateCrmContact,
} from '@/lib/crm/repository';
import type { GuestTestQuestionOutcome } from '@/lib/crm/types';
import { replyToTelegram, type TelegramSendOptions } from '@/lib/telegram';
import { supabase } from '@/lib/supabase';

function nowIso(): string {
  return new Date().toISOString();
}

function getAsiFeedbackTelegramSendOptions(): TelegramSendOptions {
  return {
    botToken: process.env.ASI_FEEDBACK_BOT_TOKEN?.trim() || null,
    tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN',
  };
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
}): Promise<void> {
  await recordCrmCommunicationEvent({
    contactId: input.contactId ?? undefined,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    eventType: 'guest_test_question',
    messageText: input.questionText,
    propertyId: input.propertyId ?? undefined,
    allowCreateContact: true,
    contactHints: {
      name: null,
      role: 'guest',
      source: 'test',
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      propertyId: input.propertyId ?? undefined,
      status: 'testing_communication',
    },
    metadata: {
      outcome: input.outcome,
      intent: input.intent,
      reply_preview: input.replyText,
      missing_fields: input.missingFields ?? [],
      missing_data_actions: missingDataActionsForFields(input.missingFields ?? [], input.propertyId),
    },
  });
}

export async function createOperatorFollowupRequired(input: {
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  guestQuestion: string;
  contactId?: string | null;
  updateId?: number;
  intent?: string | null;
}): Promise<{ ok: boolean; contactId?: string | null; error?: string }> {
  try {
    await recordCrmCommunicationEvent({
      contactId: input.contactId ?? undefined,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      eventType: 'operator_followup_required',
      messageText: input.guestQuestion,
      propertyId: input.propertyId ?? undefined,
      allowCreateContact: true,
      contactHints: {
        name: null,
        role: 'guest',
        source: 'test',
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        propertyId: input.propertyId ?? undefined,
        status: 'needs_reaction',
      },
      metadata: {
        intent: input.intent ?? null,
        telegram_chat_id: input.telegramChatId,
        telegram_user_id: input.telegramUserId,
        update_id: input.updateId ?? null,
      },
    });

    let contactId = input.contactId ?? null;
    if (!contactId) {
      const { data } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('telegram_user_id', input.telegramUserId.trim())
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      contactId = (data as { id?: string } | null)?.id ?? null;
    }

    if (contactId) {
      await updateCrmContact(contactId, {
        status: 'needs_reaction',
        nextAction: 'Ответить гостю',
        awaitingReply: true,
      });
    }

    return { ok: true, contactId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[operator-followup] create failed', { error: message });
    return { ok: false, error: message };
  }
}

export async function createGuestTestMissingDataEvent(input: {
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  guestQuestion: string;
  missingFields: string[];
  contactId?: string | null;
  intent?: string | null;
}): Promise<{ ok: boolean; contactId?: string | null }> {
  try {
    await recordCrmCommunicationEvent({
      contactId: input.contactId ?? undefined,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      eventType: 'missing_data',
      messageText: input.guestQuestion,
      propertyId: input.propertyId ?? undefined,
      allowCreateContact: true,
      contactHints: {
        name: null,
        role: 'guest',
        source: 'test',
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        propertyId: input.propertyId ?? undefined,
        status: 'testing_communication',
      },
      metadata: {
        intent: input.intent ?? null,
        missing_fields: input.missingFields,
        missing_data_actions: missingDataActionsForFields(input.missingFields, input.propertyId),
        source: 'guest_test',
      },
    });

    let contactId = input.contactId ?? null;
    if (!contactId) {
      const { data } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('telegram_user_id', input.telegramUserId.trim())
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      contactId = (data as { id?: string } | null)?.id ?? null;
    }

    if (contactId) {
      const firstAction = missingDataActionsForFields(input.missingFields, input.propertyId)[0];
      await updateCrmContact(contactId, {
        nextAction: firstAction ? `Заполнить: ${firstAction.label}` : 'Заполнить данные объекта',
        awaitingReply: false,
      });
    }

    return { ok: true, contactId };
  } catch (error) {
    console.error('[operator-followup] missing_data failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}

export async function sendOperatorFollowupToTelegram(input: {
  contactId: string;
  replyText: string;
  operatorId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const contactId = input.contactId.trim();
  const replyText = input.replyText.trim();
  if (!contactId || !replyText) return { ok: false, error: 'invalid_input' };

  try {
    const { data, error } = await supabase
      .from('crm_contacts')
      .select('telegram_chat_id, telegram_user_id, property_id, name')
      .eq('id', contactId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: 'contact_not_found' };

    const chatId = Number((data as { telegram_chat_id?: string | null }).telegram_chat_id);
    if (!Number.isFinite(chatId)) return { ok: false, error: 'telegram_chat_missing' };

    const sent = await replyToTelegram(
      chatId,
      replyText,
      { handler: 'crm/operator_followup_sent' },
      getAsiFeedbackTelegramSendOptions(),
    );
    if (!sent) return { ok: false, error: 'send_failed' };

    const now = nowIso();
    await supabase.from('crm_events').insert({
      contact_id: contactId,
      event_type: 'operator_followup_sent',
      message_text: replyText,
      property_id: (data as { property_id?: string | null }).property_id ?? null,
      metadata: {
        operator_id: input.operatorId ?? null,
        telegram_chat_id: chatId,
        source: 'crm_dashboard',
      },
      created_at: now,
    });

    await updateCrmContact(contactId, {
      status: 'testing_communication',
      nextAction: '',
      awaitingReply: false,
    });

    const { error: ackError } = await supabase
      .from('crm_events')
      .update({ acknowledged_at: now })
      .eq('contact_id', contactId)
      .eq('event_type', 'operator_followup_required')
      .is('acknowledged_at', null);
    if (ackError) {
      console.error('[operator-followup] acknowledge failed', { error: ackError.message });
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[operator-followup] send failed', { error: message });
    return { ok: false, error: message };
  }
}

export function extractGuestTestResults(
  events: Array<{ event_type: string; message_text: string | null; metadata: Record<string, unknown> | null; created_at: string }>,
): Array<{ question: string; outcome: string; intent: string; createdAt: string }> {
  return events
    .filter((event) => event.event_type === 'guest_test_question')
    .slice(0, 8)
    .map((event) => {
      const meta = event.metadata ?? {};
      return {
        question: event.message_text ?? '',
        outcome: String(meta.outcome ?? 'unknown'),
        intent: String(meta.intent ?? ''),
        createdAt: event.created_at,
      };
    });
}
