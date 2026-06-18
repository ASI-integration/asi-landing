import { patchTelegramRoutingSession } from '@/lib/communication/telegram-routing-session';
import { patchTelegramIdentityMemory } from '@/lib/communication/telegram-identity-memory';
import { getAsiFeedbackBotUsername } from '@/config/publicTelegram';
import {
  buildGuestTestCommand,
  buildGuestTestDeepLink,
} from '@/lib/property-setup/object-guest-readiness';
import { supabase } from '@/lib/supabase';
import { replyToTelegram } from '@/lib/telegram';
import type { CrmContactRow } from './types';
import { recordCrmCommunicationEvent, updateCrmContact } from './repository';

const CONTACT_SELECT =
  'id, name, role, source, contact, telegram_user_id, telegram_username, telegram_chat_id, status, property_id, property_count, notes, next_action, next_action_due_at, last_message, last_activity_at, lead_id, awaiting_reply, created_at, updated_at';

export const GUEST_TEST_WELCOME_REPLY =
  'Тестовый режим гостя включён. Можно проверить автопилот: адрес, заезд, Wi‑Fi, правила. Напишите вопрос по объекту.';

export type GuestTestFlowState = {
  telegramLinked: boolean;
  guestTestDispatched: boolean;
  guestTestReadyRecorded: boolean;
  ownerContactId: string | null;
  telegramBotUrl: string;
};

export type GuestTestLaunchMode = 'dispatched' | 'deep_link';

export type LaunchGuestTestResult = {
  mode: GuestTestLaunchMode;
  deepLink: string;
  guestTestCommand: string;
  telegramBotUrl: string;
  guestTestFlow: GuestTestFlowState;
};

function chatIdNumber(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function listOwnerContactsForProperty(propertyId: string): Promise<CrmContactRow[]> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select(CONTACT_SELECT)
    .eq('property_id', propertyId.trim())
    .in('role', ['owner', 'manager']);

  if (error) throw error;
  return (data ?? []) as CrmContactRow[];
}

async function hasPropertyGuestTestEvent(
  propertyId: string,
  eventType: 'guest_test_ready' | 'guest_test_started',
): Promise<boolean> {
  const { data, error } = await supabase
    .from('crm_events')
    .select('id')
    .eq('property_id', propertyId.trim())
    .eq('event_type', eventType)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function loadGuestTestFlowState(propertyId: string): Promise<GuestTestFlowState> {
  const id = propertyId.trim();
  const contacts = await listOwnerContactsForProperty(id);
  const linkedContact = contacts.find((contact) => Boolean(contact.telegram_chat_id?.trim())) ?? null;
  const [guestTestDispatched, guestTestReadyRecorded] = await Promise.all([
    hasPropertyGuestTestEvent(id, 'guest_test_started'),
    hasPropertyGuestTestEvent(id, 'guest_test_ready'),
  ]);

  return {
    telegramLinked: Boolean(linkedContact),
    guestTestDispatched,
    guestTestReadyRecorded,
    ownerContactId: linkedContact?.id ?? contacts[0]?.id ?? null,
    telegramBotUrl: `https://t.me/${getAsiFeedbackBotUsername()}`,
  };
}

function getAsiFeedbackTelegramSendOptions() {
  return {
    botToken: process.env.ASI_FEEDBACK_BOT_TOKEN?.trim() || null,
    tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN',
  };
}

export async function dispatchGuestTestToChat(input: {
  chatId: number;
  telegramUserId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  propertyId: string;
  source: 'auto_ready' | 'telegram_start' | 'telegram_command' | 'dashboard_launch';
}): Promise<void> {
  const propertyId = input.propertyId.trim();
  patchTelegramRoutingSession(input.chatId, {
    role: 'guest',
    selectedRole: 'guest',
    testGuest: true,
    testPropertyId: propertyId,
    communicationMode: 'autopilot',
  });

  void patchTelegramIdentityMemory({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    telegramUsername: input.telegramUsername,
    displayName: input.firstName,
    role: 'tester',
    activeScenario: 'guest_test',
    propertyId,
    guestTestActive: true,
    communicationMode: 'autopilot',
  }).catch(() => undefined);

  await replyToTelegram(
    input.chatId,
    GUEST_TEST_WELCOME_REPLY,
    {
      handler: `guest_test_flow/${input.source}`,
    },
    getAsiFeedbackTelegramSendOptions(),
  );

  await recordCrmCommunicationEvent({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.chatId,
    eventType: 'guest_test_started',
    propertyId,
    metadata: {
      source: input.source,
      property_id: propertyId,
    },
  });
}

export async function tryLinkTelegramToPropertyOwner(input: {
  propertyId: string;
  telegramUserId: string;
  telegramUsername?: string | null;
  telegramChatId: number;
  name?: string | null;
}): Promise<CrmContactRow | null> {
  const propertyId = input.propertyId.trim();
  if (!propertyId) return null;

  const contacts = await listOwnerContactsForProperty(propertyId);
  if (contacts.length === 0) return null;

  const alreadyLinked = contacts.find(
    (contact) => contact.telegram_user_id?.trim() === input.telegramUserId.trim(),
  );
  if (alreadyLinked) return alreadyLinked;

  const unlinked = contacts.find((contact) => !contact.telegram_chat_id?.trim()) ?? contacts[0];
  if (!unlinked) return null;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    telegram_user_id: input.telegramUserId.trim(),
    telegram_chat_id: String(input.telegramChatId),
    updated_at: now,
    last_activity_at: now,
  };
  if (input.telegramUsername?.trim()) {
    patch.telegram_username = input.telegramUsername.replace(/^@+/, '');
  }
  if (input.name?.trim()) {
    patch.name = input.name.trim();
  }

  const { data, error } = await supabase
    .from('crm_contacts')
    .update(patch)
    .eq('id', unlinked.id)
    .select(CONTACT_SELECT)
    .single();

  if (error) throw error;
  return data as CrmContactRow;
}

async function recordGuestTestReadyForContacts(propertyId: string, contacts: CrmContactRow[]): Promise<void> {
  const alreadyRecorded = await hasPropertyGuestTestEvent(propertyId, 'guest_test_ready');
  if (alreadyRecorded) return;

  for (const contact of contacts) {
    await recordCrmCommunicationEvent({
      contactId: contact.id,
      eventType: 'guest_test_ready',
      propertyId,
      metadata: {
        source: 'property_setup_ready',
      },
    });

    await updateCrmContact(contact.id, {
      status: 'object_filled',
      nextAction: 'Запустить тест гостя',
      awaitingReply: false,
    });
  }
}

export async function launchGuestTestForProperty(propertyId: string): Promise<LaunchGuestTestResult> {
  const id = propertyId.trim();
  const deepLink = buildGuestTestDeepLink(id);
  const guestTestCommand = buildGuestTestCommand(id);
  const state = await loadGuestTestFlowState(id);
  const contacts = await listOwnerContactsForProperty(id);

  if (contacts.length > 0) {
    await recordGuestTestReadyForContacts(id, contacts);
  }

  const linkedContact = contacts.find((contact) => chatIdNumber(contact.telegram_chat_id));
  const chatId = chatIdNumber(linkedContact?.telegram_chat_id);

  if (linkedContact && chatId != null && linkedContact.telegram_user_id?.trim()) {
    await dispatchGuestTestToChat({
      chatId,
      telegramUserId: linkedContact.telegram_user_id,
      telegramUsername: linkedContact.telegram_username,
      firstName: linkedContact.name,
      propertyId: id,
      source: 'dashboard_launch',
    });

    await updateCrmContact(linkedContact.id, {
      status: 'testing_communication',
      nextAction: 'Проверить результат теста гостя',
      awaitingReply: false,
    });

    return {
      mode: 'dispatched',
      deepLink,
      guestTestCommand,
      telegramBotUrl: state.telegramBotUrl,
      guestTestFlow: await loadGuestTestFlowState(id),
    };
  }

  return {
    mode: 'deep_link',
    deepLink,
    guestTestCommand,
    telegramBotUrl: state.telegramBotUrl,
    guestTestFlow: await loadGuestTestFlowState(id),
  };
}

export async function syncGuestTestOnPropertyReady(propertyId: string): Promise<GuestTestFlowState> {
  const id = propertyId.trim();
  const state = await loadGuestTestFlowState(id);
  const contacts = await listOwnerContactsForProperty(id);

  if (contacts.length === 0) {
    return state;
  }

  await recordGuestTestReadyForContacts(id, contacts);

  if (state.guestTestDispatched) {
    return loadGuestTestFlowState(id);
  }

  const linkedContact = contacts.find((contact) => chatIdNumber(contact.telegram_chat_id));
  const chatId = chatIdNumber(linkedContact?.telegram_chat_id);
  if (!linkedContact || chatId == null || !linkedContact.telegram_user_id?.trim()) {
    return loadGuestTestFlowState(id);
  }

  try {
    await dispatchGuestTestToChat({
      chatId,
      telegramUserId: linkedContact.telegram_user_id,
      telegramUsername: linkedContact.telegram_username,
      firstName: linkedContact.name,
      propertyId: id,
      source: 'auto_ready',
    });

    await updateCrmContact(linkedContact.id, {
      status: 'testing_communication',
      nextAction: 'Проверить результат теста гостя',
      awaitingReply: false,
    });
  } catch (error) {
    console.error('[guest_test] auto dispatch failed', {
      error: error instanceof Error ? error.message : String(error),
      propertyId: id,
    });
  }

  return loadGuestTestFlowState(id);
}
