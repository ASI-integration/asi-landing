import { missingDataActionsForFields } from '@/lib/crm/automation-loop';
import {
  normalizeGuestTestIntent,
  reconcileGuestTestResultLoop,
} from '@/lib/crm/guest-test-result-loop';
import {
  recordCrmCommunicationEvent,
  updateCrmContact,
} from '@/lib/crm/repository';
import { OPERATOR_REPLY_MAX_LENGTH } from '@/lib/crm/operator-reply-contract';
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
      intent: normalizeGuestTestIntent(input.intent),
      question_type: input.intent,
      reply_preview: input.replyText,
      missing_fields: input.missingFields ?? [],
      missing_data_actions: missingDataActionsForFields(input.missingFields ?? [], input.propertyId),
    },
  });

  await reconcileGuestTestResultLoop({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    propertyId: input.propertyId,
    contactId: input.contactId,
  }).catch((error) => {
    console.error('[operator-followup] guest test reconcile failed', {
      error: error instanceof Error ? error.message : String(error),
    });
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
      eventType: 'guest_test_missing_data',
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
  return sendOperatorReplyToTelegram(input);
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
  await recordCrmCommunicationEvent({
    contactId: input.contactId ?? undefined,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    eventType: 'guest_concierge_answered',
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
      question: input.guestQuestion,
      question_type: input.intent,
      outcome: 'answered_by_concierge_autopilot',
      property_id: input.propertyId ?? null,
      telegram_chat_id: input.telegramChatId,
      reply_preview: input.replyText,
      timestamp: nowIso(),
      source: 'guest_test',
    },
  });
}

type ActiveCrmEscalationRow = {
  id: string;
  event_type: string;
  message_text: string | null;
  property_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function parseTelegramChatId(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const chatId = Number(value);
  return Number.isFinite(chatId) ? chatId : null;
}

function hasAsiFeedbackBotToken(): boolean {
  return Boolean(process.env.ASI_FEEDBACK_BOT_TOKEN?.trim());
}

function chooseRelatedEscalation(
  rows: ActiveCrmEscalationRow[],
  relatedEscalationId?: string | null,
): ActiveCrmEscalationRow | null {
  const id = relatedEscalationId?.trim();
  if (id) return rows.find((row) => row.id === id) ?? null;
  return rows.find((row) => row.event_type === 'operator_followup_required') ?? rows[0] ?? null;
}

function composeOperatorReplyForGuest(replyText: string, relatedQuestion?: string | null): string {
  const question = relatedQuestion?.trim();
  if (question) {
    return `Вы спрашивали: «${question}»

Ответ: ${replyText}`;
  }

  return `Уточнили по вашему вопросу:

${replyText}`;
}

export async function sendOperatorReplyToTelegram(input: {
  contactId?: string | null;
  telegramChatId?: string | number | null;
  replyText: string;
  operatorId?: string | null;
  relatedEscalationId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const contactId = input.contactId?.trim() ?? '';
  const replyText = input.replyText.trim();
  if (!contactId && input.telegramChatId == null) return { ok: false, error: 'invalid_input' };
  if (!replyText) return { ok: false, error: 'empty_reply' };
  if (replyText.length > OPERATOR_REPLY_MAX_LENGTH) return { ok: false, error: 'reply_too_long' };
  if (!hasAsiFeedbackBotToken()) return { ok: false, error: 'bot_token_missing' };

  try {
    const contactQuery = supabase
      .from('crm_contacts')
      .select('id, telegram_chat_id, telegram_user_id, property_id, name');
    const { data, error } = contactId
      ? await contactQuery.eq('id', contactId).maybeSingle()
      : await contactQuery.eq('telegram_chat_id', String(input.telegramChatId)).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: 'contact_not_found' };

    const resolvedContactId = contactId || (data as { id?: string | null }).id?.trim() || '';
    if (!resolvedContactId) return { ok: false, error: 'contact_not_found' };

    const chatId = parseTelegramChatId(input.telegramChatId)
      ?? parseTelegramChatId((data as { telegram_chat_id?: string | null }).telegram_chat_id);
    if (chatId == null) return { ok: false, error: 'telegram_chat_missing' };

    const { data: activeRows, error: activeError } = await supabase
      .from('crm_events')
      .select('id, event_type, message_text, property_id, metadata, created_at')
      .eq('contact_id', resolvedContactId)
      .in('event_type', ['escalation', 'missing_data', 'guest_test_missing_data', 'operator_followup_required'])
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (activeError) throw activeError;

    const activeEscalations = (activeRows ?? []) as ActiveCrmEscalationRow[];
    const relatedEscalation = chooseRelatedEscalation(activeEscalations, input.relatedEscalationId);
    const guestReplyText = composeOperatorReplyForGuest(replyText, relatedEscalation?.message_text);

    const sent = await replyToTelegram(
      chatId,
      guestReplyText,
      { handler: 'crm/operator_reply_sent' },
      getAsiFeedbackTelegramSendOptions(),
    );
    if (!sent) return { ok: false, error: 'send_failed' };

    const now = nowIso();
    await supabase.from('crm_events').insert({
      contact_id: resolvedContactId,
      event_type: 'operator_reply_sent',
      message_text: replyText,
      property_id: (data as { property_id?: string | null }).property_id ?? null,
      metadata: {
        operator_id: input.operatorId ?? null,
        related_question: relatedEscalation?.message_text ?? null,
        related_escalation_id: relatedEscalation?.id ?? input.relatedEscalationId ?? null,
        related_event_type: relatedEscalation?.event_type ?? null,
        timestamp: now,
        channel: 'telegram',
        telegram_chat_id: chatId,
        source: 'crm_dashboard',
      },
      created_at: now,
    });

    if (relatedEscalation) {
      const { error: ackError } = await supabase
        .from('crm_events')
        .update({ acknowledged_at: now })
        .eq('id', relatedEscalation.id);
      if (ackError) {
        console.error('[operator-followup] acknowledge failed', { error: ackError.message });
      }
    }

    const remainingActive = activeEscalations.filter((row) => row.id !== relatedEscalation?.id);
    const hasOtherOperatorFollowup = remainingActive.some((row) => row.event_type === 'operator_followup_required');

    await updateCrmContact(resolvedContactId, remainingActive.length > 0
      ? {
          status: 'needs_reaction',
          nextAction: hasOtherOperatorFollowup ? 'Ответить гостю' : 'Разобрать эскалацию',
          awaitingReply: hasOtherOperatorFollowup,
        }
      : {
          status: 'testing_communication',
          nextAction: 'Продолжить тест гостя',
          awaitingReply: false,
        });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[operator-followup] send failed', { error: message });
    return { ok: false, error: message };
  }
}
