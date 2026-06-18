import { toAppAbsoluteUrl } from '@/lib/app-url';
import { normalizeAsiFeedbackLeadSource, type AsiFeedbackLeadSource } from '@/config/publicTelegram';
import { decideCommunicationAutopilotResponseWithLlmRouter } from '@/lib/communication/autopilot';
import type { CommunicationAutopilotContext } from '@/lib/communication/autopilot';
import {
  attachTelegramToPilotContact,
  recordCrmCommunicationEvent,
  upsertCrmContactFromTelegram,
} from '@/lib/crm/repository';
import { loadObjectGuestReadiness } from '@/lib/crm/property-readiness-sync';
import {
  dispatchGuestTestToChat,
  GUEST_TEST_WELCOME_REPLY,
  tryLinkTelegramToPropertyOwner,
} from '@/lib/crm/guest-test-flow';
import { formatGuestReadinessBlockersRu } from '@/lib/property-setup/object-guest-readiness';
import {
  buildPilotPropertiesRedirect,
  parsePilotTelegramStartPayload,
} from '@/lib/crm/pilot-onboarding';
import {
  beginTelegramLeadIntakeFromRouting,
  beginTelegramSupportFromRouting,
  parseAsiFeedbackStartSource,
  type TelegramLeadUser,
} from '@/lib/communication/telegram-lead-intake';
import {
  bookingObjectContextToAutopilotFields,
  lookup_booking_by_telegram,
  lookup_property_by_booking,
  resolveTelegramGuestBookingObjectContext,
} from '@/lib/communication/telegram-booking-object-memory';
import { sanitizeGuestFacingReply, guestReplyContainsForbiddenInternalTokens } from '@/lib/communication/guest-facing-ru';
import { polishGuestReplyWithLlm } from '@/lib/communication/guest-reply-llm-polish';
import {
  clearTelegramRoutingSession,
  getTelegramRoutingSession,
  patchTelegramRoutingSession,
  resolveTelegramCommunicationMode,
  type TelegramCommunicationMode,
  type TelegramRoutingRole,
} from '@/lib/communication/telegram-routing-session';
import {
  answerGuestTestQuestion,
  OPERATOR_HANDOFF_FAILED_REPLY,
} from '@/lib/communication/guest-test-answers';
import {
  applyMemoryToRoutingSession,
  clearTelegramIdentityGuestTest,
  ensureTelegramIdentityWithCrm,
  hydrateTelegramRoutingSessionFromMemory,
  isGuestTestMemoryActive,
  loadTelegramConversationMemory,
  patchTelegramIdentityMemory,
  routingRoleToMemoryRole,
  type TelegramConversationMemory,
} from '@/lib/communication/telegram-identity-memory';
import {
  createGuestTestMissingDataEvent,
  createOperatorFollowupRequired,
  recordGuestTestQuestionOutcome,
} from '@/lib/crm/operator-followup';
import { emergencyTestReply, resolveTelegramEmergencyProtocol } from '@/lib/communication/telegram-emergency-protocol';
import { notifyTelegramOwner } from '@/lib/communication/telegram-owner-notifications';
import type { TelegramOwnerNotificationInput } from '@/lib/communication/telegram-owner-notifications';
import type { CrmContactViewModel } from '@/lib/crm/types';
import { replyToTelegram, answerTelegramCallbackQuery, type TelegramSendOptions } from '@/lib/telegram';
import { supabase } from '@/lib/supabase';
import {
  logTelegramWebhookHandlerError,
  sendTelegramWebhookFallbackReply,
} from '@/lib/communication/telegram-webhook-fallback';
import { isAsiFeedbackRoutingUpdate, TELEGRAM_TECHNICAL_ERROR_REPLY } from '@/lib/communication/telegram-webhook-scope';
import { MessageCategory, ProcessOutcome, type ProcessResult, type TelegramUpdate } from './types';

const START_RE = /^\/start(?:@\w+)?(?:\s+(.+))?$/i;
const SUPPORT_COMMAND_RE = /^\/support(?:@\w+)?$/i;
const GUEST_TEST_COMMAND_RE = /^\/guest_test(?:@\w+)?(?:\s+(.+))?$/i;
const RESET_TEST_STATE_COMMAND_RE = /^\/reset_test_state(?:@\w+)?$/i;
const DEBUG_MEMORY_COMMAND_RE = /^\/debug_memory(?:@\w+)?$/i;
const EMERGENCY_TEST_COMMAND_RE = /^\/emergency_test(?:@\w+)?(?:\s+(.+))?$/i;
const ROUTING_CALLBACK_PREFIX = 'tr';

const ROLE_SELECTION_REPLY =
  'Здравствуйте! Подскажите, пожалуйста, кто вы — так я смогу ответить правильно:';

const GUEST_WELCOME_REPLY =
  'Понял, вы гость по бронированию. Напишите вопрос по объекту — адрес, заезд, Wi‑Fi, правила. Если бронь ещё не привязана, укажите номер бронирования или телефон из брони.';

const MANUAL_SAVED_REPLY = 'Сообщение сохранено. Оператор ответит вручную.';
const DRAFT_PREPARED_REPLY =
  'Подготовили черновик ответа. Оператор проверит и отправит гостю, если всё верно.';
const MISSING_DATA_GUEST_FALLBACK =
  'Сейчас уточню этот вопрос у оператора и напишу вам здесь.';

const RESET_TEST_STATE_REPLY = 'Тестовое состояние сброшено. Отправьте /start, чтобы выбрать роль заново.';

function isTelegramInternalDebugMode(user: TelegramRoutingUser): boolean {
  if (process.env.TELEGRAM_DEBUG === '1' || process.env.COMM_PIPELINE_DEBUG === '1') return true;
  const testChatId = process.env.TELEGRAM_TEST_CHAT_ID?.trim();
  if (testChatId && String(user.chat_id) === testChatId) return true;
  return process.env.NODE_ENV === 'test';
}

function logTelegramRoutingDebug(
  user: TelegramRoutingUser,
  handler: string,
  memory?: TelegramConversationMemory | null,
): void {
  const session = getTelegramRoutingSession(user.chat_id);
  console.info('[telegram-routing:context]', {
    handler,
    telegram_user_id: user.telegram_user_id,
    chat_id: user.chat_id,
    activeScenario: memory?.activeScenario ?? (session?.testGuest ? 'guest_test' : null),
    propertyId: memory?.propertyId ?? session?.testPropertyId ?? null,
    guestTestActive: memory?.guestTestActive ?? session?.testGuest ?? false,
    role: memory?.role ?? session?.role ?? 'unknown',
    session_test_guest: session?.testGuest ?? false,
  });
}

async function buildGuestTestResumeReply(propertyId: string): Promise<string> {
  const property = await lookup_property_by_booking({ booking: null, object_id: propertyId });
  const name = property?.object_name?.trim() || 'объекта';
  return `Тест гостя уже включён для объекта ${name}. Задайте вопрос по адресу, Wi‑Fi, заезду или правилам.`;
}

async function resumeActiveGuestTest(
  user: TelegramRoutingUser,
  updateId: number,
  memory: TelegramConversationMemory,
  handler = 'telegram_routing/guest_test_resume',
): Promise<ProcessResult> {
  applyMemoryToRoutingSession(user.chat_id, memory);
  const propertyId = memory.propertyId || defaultGuestTestPropertyId();
  const reply = await buildGuestTestResumeReply(propertyId);
  logTelegramRoutingDebug(user, handler, memory);
  await replyToTelegram(user.chat_id, reply, {
    handler,
    update_id: updateId,
  }, getAsiFeedbackTelegramSendOptions());
  return {
    outcome: ProcessOutcome.Replied,
    update_id: updateId,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply,
  };
}

type ParsedRoutingCallback =
  | { kind: 'role'; role: Exclude<TelegramRoutingRole, 'unknown'> }
  | { kind: 'guest_test'; propertyId: string | null };

type TelegramRoutingUser = TelegramLeadUser;

function crmNotifyOptionsForGuest(
  session: ReturnType<typeof getTelegramRoutingSession>,
): Pick<TelegramOwnerNotificationInput, 'crmAllowCreateContact' | 'crmSource' | 'crmRole'> {
  const testGuest = Boolean(session?.testGuest);
  return {
    crmAllowCreateContact: testGuest,
    crmSource: testGuest ? 'test' : 'telegram',
    crmRole: 'guest',
  };
}

async function persistRoutingIdentity(
  user: TelegramRoutingUser,
  patch?: {
    role?: TelegramRoutingRole;
    testGuest?: boolean;
    testPropertyId?: string | null;
    leadSource?: string;
    activeScenario?: 'owner_onboarding' | 'guest_test' | 'support' | 'emergency' | null;
  },
): Promise<TelegramConversationMemory | null> {
  const session = getTelegramRoutingSession(user.chat_id);
  const role = routingRoleToMemoryRole(
    patch?.role ?? session?.role ?? 'unknown',
    patch?.testGuest ?? session?.testGuest,
  );

  try {
    const memory = await patchTelegramIdentityMemory({
      telegramUserId: user.telegram_user_id,
      chatId: user.chat_id,
      telegramUsername: user.telegram_username,
      displayName: user.first_name,
      role,
      activeScenario:
        patch?.activeScenario ??
        (patch?.testGuest || session?.testGuest ? 'guest_test' : null),
      propertyId: patch?.testPropertyId ?? session?.testPropertyId ?? null,
      guestTestActive: patch?.testGuest ?? session?.testGuest ?? false,
      communicationMode: session?.communicationMode,
      leadSource: patch?.leadSource ?? session?.leadSource ?? null,
    });

    return memory;
  } catch (error) {
    console.error('[telegram-identity] persist routing failed', {
      error: error instanceof Error ? error.message : String(error),
      telegram_user_id: user.telegram_user_id,
    });
    return null;
  }
}

async function continueFromKnownIdentity(
  user: TelegramRoutingUser,
  updateId: number,
  memory: TelegramConversationMemory,
): Promise<ProcessResult | null> {
  applyMemoryToRoutingSession(user.chat_id, memory);

  if (isGuestTestMemoryActive(memory)) {
    return resumeActiveGuestTest(user, updateId, memory);
  }

  if (memory.role === 'owner' || memory.role === 'operator') {
    const contact = await syncCrmRoleSelection(user, 'owner', memory.propertyId);
    const reply = buildOwnerNextStepReply(contact);
    await replyToTelegram(user.chat_id, reply, {
      handler: 'telegram_routing/role_owner_resume',
      update_id: updateId,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: updateId,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply,
    };
  }

  if (memory.role === 'guest') {
    await replyToTelegram(user.chat_id, GUEST_WELCOME_REPLY, {
      handler: 'telegram_routing/role_guest_resume',
      update_id: updateId,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: updateId,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: GUEST_WELCOME_REPLY,
    };
  }

  if (memory.role === 'lead') {
    const leadSource = normalizeAsiFeedbackLeadSource(memory.leadSource ?? 'unknown');
    patchTelegramRoutingSession(user.chat_id, { role: 'lead', leadSource });
    return beginTelegramLeadIntakeFromRouting(
      { update_id: updateId, message: { chat: { id: user.chat_id }, text: '/start' } } as TelegramUpdate,
      user,
      leadSource,
    );
  }

  if (memory.role === 'support') {
    patchTelegramRoutingSession(user.chat_id, { role: 'support' });
    return beginTelegramSupportFromRouting(
      { update_id: updateId, message: { chat: { id: user.chat_id }, text: '/start' } } as TelegramUpdate,
      user,
    );
  }

  return null;
}

async function syncCrmRoleSelection(
  user: TelegramRoutingUser,
  role: Exclude<TelegramRoutingRole, 'unknown' | 'support'>,
  propertyId?: string | null,
): Promise<CrmContactViewModel | null> {
  try {
    const crmRole = role === 'owner' ? 'owner' : role;
    const contact = await upsertCrmContactFromTelegram({
      name: user.first_name,
      role: crmRole,
      source: 'telegram',
      telegramUserId: user.telegram_user_id,
      telegramUsername: user.telegram_username,
      telegramChatId: user.chat_id,
      status: role === 'lead' ? 'new' : role === 'guest' ? 'needs_clarification' : 'qualified',
      propertyId: propertyId ?? undefined,
    });
    await recordCrmCommunicationEvent({
      telegramUserId: user.telegram_user_id,
      telegramChatId: user.chat_id,
      eventType: role === 'owner'
        ? 'role_selected_owner'
        : role === 'lead'
          ? 'role_selected_lead'
          : 'role_selected_guest',
      propertyId: propertyId ?? undefined,
      metadata: {
        role,
        source: 'telegram_role_selection',
      },
    });
    const existing = await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null);
    const guestTestActive = isGuestTestMemoryActive(existing);
    void patchTelegramIdentityMemory({
      telegramUserId: user.telegram_user_id,
      chatId: user.chat_id,
      telegramUsername: user.telegram_username,
      displayName: user.first_name,
      role: guestTestActive ? 'tester' : routingRoleToMemoryRole(role),
      activeScenario: guestTestActive
        ? 'guest_test'
        : role === 'owner'
          ? 'owner_onboarding'
          : null,
      propertyId: guestTestActive ? existing?.propertyId ?? null : propertyId ?? null,
      guestTestActive: guestTestActive ? true : false,
      crmContactId: contact?.id ?? null,
    });
    return contact;
  } catch (error) {
    console.error('[crm] role selection sync failed', {
      error: error instanceof Error ? error.message : String(error),
      role,
      telegram_user_id: user.telegram_user_id,
    });
    return null;
  }
}

async function syncCrmGuestTest(user: TelegramRoutingUser, propertyId: string): Promise<void> {
  try {
    await upsertCrmContactFromTelegram({
      name: user.first_name,
      role: 'guest',
      source: 'test',
      telegramUserId: user.telegram_user_id,
      telegramUsername: user.telegram_username,
      telegramChatId: user.chat_id,
      propertyId,
      status: 'testing_communication',
    });
  } catch (error) {
    console.error('[crm] guest test sync failed', {
      error: error instanceof Error ? error.message : String(error),
      telegram_user_id: user.telegram_user_id,
    });
  }
}

function appHref(pathOrUrl: string): string {
  return toAppAbsoluteUrl(pathOrUrl);
}

function ownerCabinetUrl(contact: CrmContactViewModel | null): string {
  return appHref(buildPilotPropertiesRedirect(contact?.id));
}

function buildOwnerNextStepReply(contact: CrmContactViewModel | null): string {
  const base = 'Понял, вы владелец или управляющий.';
  const property = contact?.propertySummary ?? null;
  const cabinetUrl = ownerCabinetUrl(contact);

  if (contact?.status === 'pilot_waitlist' && !property) {
    return `Заявка в пилот принята. Сейчас вы в листе ожидания — команда ASI свяжется, когда появится место.\n${cabinetUrl}`;
  }

  if (contact?.status === 'pilot_candidate' && !property) {
    return `Заявка в пилот принята. Команда ASI рассматривает кандидатуру. После выбора создайте объект в личном кабинете.\n${cabinetUrl}`;
  }

  if (contact?.status === 'pilot_selected' && !property) {
    return `Вы выбраны в пилот ASI. Следующий шаг: создать первый объект в личном кабинете.\n${cabinetUrl}`;
  }

  if (!property) {
    return `${base}\n\nСледующий шаг: создайте объект в личном кабинете или выберите уже созданный.\n${cabinetUrl}`;
  }

  const firstMissing = property.missingOperationalItems[0];
  if (firstMissing) {
    return `${base}\n\nПродолжите заполнение объекта: ${firstMissing.label}.\n${appHref(firstMissing.actionHref)}`;
  }

  return `${base}\n\nОбъект готов. Запустите тест гостя в Telegram:\n${property.guestTestHref}`;
}

function getAsiFeedbackTelegramSendOptions(): TelegramSendOptions {
  return {
    botToken: process.env.ASI_FEEDBACK_BOT_TOKEN?.trim() || null,
    tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN',
  };
}

function extractMessage(update: TelegramUpdate) {
  return update.message ?? update.edited_message ?? null;
}

function getTelegramRoutingUser(update: TelegramUpdate): TelegramRoutingUser | null {
  const message = extractMessage(update) ?? update.callback_query?.message ?? null;
  const from = update.callback_query?.from ?? message?.from;
  const userId = from?.id ?? message?.chat?.id;
  const chatId = message?.chat?.id;
  if (!userId || !chatId) return null;

  return {
    telegram_user_id: String(userId),
    telegram_username: from?.username?.trim() || null,
    first_name: from?.first_name?.trim() || null,
    chat_id: chatId,
  };
}

function routingCallbackData(callback: ParsedRoutingCallback): string {
  if (callback.kind === 'role') return `${ROUTING_CALLBACK_PREFIX}:role:${callback.role}`;
  return `${ROUTING_CALLBACK_PREFIX}:guest_test:${callback.propertyId ?? 'default'}`;
}

function parseRoutingCallbackData(data: string | undefined): ParsedRoutingCallback | null {
  const parts = String(data ?? '').split(':');
  if (parts[0] !== ROUTING_CALLBACK_PREFIX) return null;
  if (parts[1] === 'role' && parts[2]) {
    const role = parts[2] as Exclude<TelegramRoutingRole, 'unknown'>;
    if (role === 'owner' || role === 'guest' || role === 'lead' || role === 'support') {
      return { kind: 'role', role };
    }
  }
  if (parts[1] === 'guest_test') {
    const propertyId = parts[2] && parts[2] !== 'default' ? parts[2] : null;
    return { kind: 'guest_test', propertyId };
  }
  return null;
}

function roleSelectionKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: 'Я гость по бронированию', callback_data: routingCallbackData({ kind: 'role', role: 'guest' }) }],
      [{ text: 'Я владелец / управляющий объекта', callback_data: routingCallbackData({ kind: 'role', role: 'owner' }) }],
      [{ text: 'Хочу подключить ASI', callback_data: routingCallbackData({ kind: 'role', role: 'lead' }) }],
      [{ text: 'Нужна поддержка', callback_data: routingCallbackData({ kind: 'role', role: 'support' }) }],
    ],
  };
}

function parseGuestTestPayload(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === 'guest_test') return null;
  const match = lower.match(/^guest_test_(.+)$/);
  return match?.[1]?.trim() || null;
}

function defaultGuestTestPropertyId(): string {
  return process.env.TELEGRAM_GUEST_TEST_PROPERTY_ID?.trim() || 'test-prop-tg-live';
}

function parseOwnerTelegramUserIds(): Set<string> {
  const raw =
    process.env.TELEGRAM_OWNER_USER_IDS?.trim() ||
    process.env.ASI_FEEDBACK_OWNER_TELEGRAM_USER_IDS?.trim() ||
    '';
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function parseOwnerTelegramChatIds(): Set<string> {
  const raw = process.env.TELEGRAM_OWNER_CHAT_IDS?.trim() || '';
  const ids = raw
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const adminChatId = process.env.ASI_FEEDBACK_ADMIN_CHAT_ID?.trim();
  if (adminChatId) ids.push(adminChatId);
  return new Set(ids);
}

async function isKnownGuestChat(chatId: number): Promise<boolean> {
  try {
    const booking = await lookup_booking_by_telegram({ telegram_chat_id: chatId });
    if (booking) return true;

    const { data, error } = await supabase
      .from('tg_guest_identities')
      .select('guest_id')
      .eq('telegram_chat_id', chatId)
      .limit(1);
    if (error) return false;
    return Boolean((data ?? [])[0]);
  } catch {
    return false;
  }
}

function isKnownOwner(user: TelegramRoutingUser): boolean {
  if (parseOwnerTelegramUserIds().has(user.telegram_user_id)) return true;
  if (parseOwnerTelegramChatIds().has(String(user.chat_id))) return true;
  return false;
}

export async function resolveTelegramRoutingRole(
  user: TelegramRoutingUser,
  memory?: TelegramConversationMemory | null,
): Promise<{ role: TelegramRoutingRole; reason: string }> {
  const session = getTelegramRoutingSession(user.chat_id);
  if (session?.testGuest) return { role: 'guest', reason: 'session:guest_test' };

  const resolvedMemory =
    memory ??
    (await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null));
  if (isGuestTestMemoryActive(resolvedMemory)) {
    if (resolvedMemory) applyMemoryToRoutingSession(user.chat_id, resolvedMemory);
    return { role: 'guest', reason: 'memory:guest_test' };
  }

  if (session?.role && session.role !== 'unknown') {
    return { role: session.role, reason: 'session:selected_role' };
  }
  if (isKnownOwner(user)) return { role: 'owner', reason: 'binding:owner' };
  if (await isKnownGuestChat(user.chat_id)) return { role: 'guest', reason: 'binding:guest' };
  return { role: 'unknown', reason: 'unbound_user' };
}

async function sendRoleSelection(
  user: TelegramRoutingUser,
  updateId: number,
  leadSource?: AsiFeedbackLeadSource,
  intro?: string,
): Promise<ProcessResult> {
  const memory = await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null);
  if (isGuestTestMemoryActive(memory)) {
    return resumeActiveGuestTest(user, updateId, memory!, 'telegram_routing/guest_test_block_role_selection');
  }

  patchTelegramRoutingSession(user.chat_id, {
    role: 'unknown',
    leadSource: leadSource ?? undefined,
  });
  void persistRoutingIdentity(user, { role: 'unknown', leadSource });
  logTelegramRoutingDebug(user, 'telegram_routing/role_selection', memory);
  const reply = intro?.trim() || ROLE_SELECTION_REPLY;
  await replyToTelegram(user.chat_id, reply, {
    handler: 'telegram_routing/role_selection',
    update_id: updateId,
  }, { ...getAsiFeedbackTelegramSendOptions(), replyMarkup: roleSelectionKeyboard() });

  return {
    outcome: ProcessOutcome.Replied,
    update_id: updateId,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply,
  };
}

async function handlePilotApplicationStart(
  user: TelegramRoutingUser,
  updateId: number,
  contactId: string,
): Promise<ProcessResult> {
  try {
    await attachTelegramToPilotContact({
      contactId,
      telegramUserId: user.telegram_user_id,
      telegramUsername: user.telegram_username,
      telegramChatId: user.chat_id,
      name: user.first_name,
    });
  } catch (error) {
    console.error('[crm] pilot telegram link failed', {
      error: error instanceof Error ? error.message : String(error),
      contactId,
      telegram_user_id: user.telegram_user_id,
    });
  }

  return sendRoleSelection(
    user,
    updateId,
    'site',
    'Заявка в пилот ASI принята. Подскажите, кто вы — так я подскажу следующий шаг:',
  );
}

async function activateGuestTestMode(
  user: TelegramRoutingUser,
  update: TelegramUpdate,
  propertyId: string | null,
): Promise<ProcessResult> {
  const explicitPropertyId = propertyId?.trim() || null;

  if (explicitPropertyId) {
    const loaded = await loadObjectGuestReadiness(explicitPropertyId);
    if (!loaded.found) {
      const reply =
        'Объект не найден. Проверьте ссылку из личного кабинета или создайте объект заново.';
      await replyToTelegram(user.chat_id, reply, {
        handler: 'telegram_routing/guest_test_not_found',
        update_id: update.update_id,
      }, getAsiFeedbackTelegramSendOptions());
      return {
        outcome: ProcessOutcome.Replied,
        update_id: update.update_id,
        chat_id: user.chat_id,
        category: MessageCategory.Start,
        reply,
      };
    }

    if (loaded.readiness && !loaded.readiness.isReady) {
      const reply = formatGuestReadinessBlockersRu(loaded.readiness);
      await replyToTelegram(user.chat_id, reply, {
        handler: 'telegram_routing/guest_test_not_ready',
        update_id: update.update_id,
      }, getAsiFeedbackTelegramSendOptions());
      return {
        outcome: ProcessOutcome.Replied,
        update_id: update.update_id,
        chat_id: user.chat_id,
        category: MessageCategory.Start,
        reply,
      };
    }
  }

  const resolvedPropertyId = explicitPropertyId || defaultGuestTestPropertyId();

  if (explicitPropertyId) {
    try {
      await tryLinkTelegramToPropertyOwner({
        propertyId: explicitPropertyId,
        telegramUserId: user.telegram_user_id,
        telegramUsername: user.telegram_username,
        telegramChatId: user.chat_id,
        name: user.first_name,
      });
    } catch (error) {
      console.error('[crm] guest test owner telegram link failed', {
        error: error instanceof Error ? error.message : String(error),
        propertyId: explicitPropertyId,
        telegram_user_id: user.telegram_user_id,
      });
    }
  }

  await dispatchGuestTestToChat({
    chatId: user.chat_id,
    telegramUserId: user.telegram_user_id,
    telegramUsername: user.telegram_username,
    firstName: user.first_name,
    propertyId: resolvedPropertyId,
    source: explicitPropertyId ? 'telegram_start' : 'telegram_command',
  });

  await persistRoutingIdentity(user, {
    role: 'guest',
    testGuest: true,
    testPropertyId: resolvedPropertyId,
    activeScenario: 'guest_test',
  });

  const savedMemory = await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null);
  logTelegramRoutingDebug(user, 'telegram_routing/guest_test_activated', savedMemory);

  await ensureTelegramIdentityWithCrm({
    telegramUserId: user.telegram_user_id,
    chatId: user.chat_id,
    telegramUsername: user.telegram_username,
    displayName: user.first_name,
    role: 'tester',
    source: 'test',
    propertyId: resolvedPropertyId,
    status: 'testing_communication',
  });

  void syncCrmGuestTest(user, resolvedPropertyId);

  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply: GUEST_TEST_WELCOME_REPLY,
  };
}

async function handleRoleSelectionCallback(
  update: TelegramUpdate,
  user: TelegramRoutingUser,
  role: Exclude<TelegramRoutingRole, 'unknown'>,
): Promise<ProcessResult> {
  if (update.callback_query?.id) {
    await answerTelegramCallbackQuery(update.callback_query.id, {
      text: 'Принято',
      ...getAsiFeedbackTelegramSendOptions(),
    });
  }

  const session = getTelegramRoutingSession(user.chat_id);
  const memory = await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null);
  if (role === 'guest' && (session?.testGuest || isGuestTestMemoryActive(memory))) {
    const activeMemory = memory && isGuestTestMemoryActive(memory)
      ? memory
      : {
          telegramUserId: user.telegram_user_id,
          chatId: user.chat_id,
          telegramUsername: user.telegram_username,
          displayName: user.first_name,
          crmContactId: memory?.crmContactId ?? null,
          role: 'tester' as const,
          activeScenario: 'guest_test' as const,
          propertyId: session?.testPropertyId ?? memory?.propertyId ?? null,
          guestTestActive: true,
          communicationMode: session?.communicationMode ?? 'autopilot',
          leadSource: memory?.leadSource ?? null,
          metadata: memory?.metadata ?? {},
          lastSeenAt: memory?.lastSeenAt ?? new Date().toISOString(),
          updatedAt: memory?.updatedAt ?? new Date().toISOString(),
        };
    if (activeMemory.propertyId) {
      return resumeActiveGuestTest(
        user,
        update.update_id,
        activeMemory,
        'telegram_routing/guest_test_preserve_on_role_guest',
      );
    }
  }

  const leadSource = normalizeAsiFeedbackLeadSource(session?.leadSource ?? 'unknown');

  patchTelegramRoutingSession(user.chat_id, {
    role,
    selectedRole: role,
  });
  void persistRoutingIdentity(user, {
    role,
    activeScenario: role === 'owner' ? 'owner_onboarding' : role === 'support' ? 'support' : null,
  });

  if (role === 'guest') {
    void syncCrmRoleSelection(user, 'guest');
    await replyToTelegram(user.chat_id, GUEST_WELCOME_REPLY, {
      handler: 'telegram_routing/role_guest',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: GUEST_WELCOME_REPLY,
    };
  }

  if (role === 'owner') {
    const contact = await syncCrmRoleSelection(user, 'owner');
    const reply = buildOwnerNextStepReply(contact);
    await replyToTelegram(user.chat_id, reply, {
      handler: 'telegram_routing/role_owner',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply,
    };
  }

  if (role === 'lead') {
    void syncCrmRoleSelection(user, 'lead');
    return beginTelegramLeadIntakeFromRouting(update, user, leadSource);
  }

  return beginTelegramSupportFromRouting(update, user);
}

async function buildGuestAutopilotContext(
  user: TelegramRoutingUser,
  messageText: string,
): Promise<CommunicationAutopilotContext> {
  const session = getTelegramRoutingSession(user.chat_id);

  if (session?.testGuest) {
    const propertyId = session.testPropertyId || defaultGuestTestPropertyId();
    const property = await lookup_property_by_booking({ booking: null, object_id: propertyId });
    return {
      session: {
        id: String(user.chat_id),
        guestName: user.first_name ?? 'Тестовый гость',
        language: 'ru',
      },
      booking: {
        id: 'GUEST-TEST',
        checkInTime: '15:00',
        checkoutTime: property?.checkout_time ?? '12:00',
        verified: true,
      },
      bookingVerified: true,
      propertyResolved: Boolean(property),
      object: property
        ? {
            id: property.object_id,
            name: property.object_name ?? undefined,
            address: property.address ?? undefined,
            directionsText: property.directions_text ?? undefined,
            parkingText: property.parking_text ?? undefined,
            accessInstructions: property.check_in_text ?? property.directions_text ?? undefined,
            wifiName: property.wifi_name ?? undefined,
            wifiPassword: property.wifi_password ?? undefined,
            houseRules: property.house_rules_text ?? undefined,
            earlyCheckinPolicy: property.early_checkin_policy ?? undefined,
            lateCheckoutPolicy: property.late_checkout_policy ?? undefined,
            knowledgeStatus: property.knowledge_status,
          }
        : undefined,
    };
  }

  const bookingObjectCtx = await resolveTelegramGuestBookingObjectContext({
    telegram_chat_id: user.chat_id,
    text: messageText,
  });
  const fields = bookingObjectContextToAutopilotFields(bookingObjectCtx);
  return {
    session: {
      id: String(user.chat_id),
      guestName: fields.session?.guestName,
      language: 'ru',
    },
    booking: fields.booking,
    object: fields.object,
    bookingVerified: fields.bookingVerified,
    propertyResolved: fields.propertyResolved,
  };
}

function classifyOwnerNotificationType(decision: Awaited<ReturnType<typeof decideCommunicationAutopilotResponseWithLlmRouter>>) {
  const scenario = decision.escalationReason ?? decision.metadata.intent;
  if (scenario === 'prompt_injection') return 'blocked' as const;
  if (decision.metadata.missingContext?.length) return 'missing_data' as const;
  if (decision.action === 'escalate') return 'escalation_created' as const;
  if (decision.action === 'auto_reply') return 'auto_reply_sent' as const;
  return 'escalation_created' as const;
}

function resolveGuestFacingReply(
  rawReply: string | null | undefined,
  options?: { allowOperatorDeferral?: boolean },
): string {
  const sanitized = sanitizeGuestFacingReply(rawReply)?.trim();
  if (sanitized && !guestReplyContainsForbiddenInternalTokens(sanitized)) {
    return sanitized;
  }
  if (options?.allowOperatorDeferral === false) {
    return OPERATOR_HANDOFF_FAILED_REPLY;
  }
  return MISSING_DATA_GUEST_FALLBACK;
}

async function processGuestTestDeterministicMessage(
  update: TelegramUpdate,
  user: TelegramRoutingUser,
  messageText: string,
): Promise<ProcessResult> {
  const session = getTelegramRoutingSession(user.chat_id);
  const memory = await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null);
  const propertyId =
    session?.testPropertyId ?? memory?.propertyId ?? defaultGuestTestPropertyId();
  logTelegramRoutingDebug(user, 'telegram_routing/guest_test_question', memory);
  const property = await lookup_property_by_booking({ booking: null, object_id: propertyId });
  const contactId = memory?.crmContactId ?? null;

  const answer = answerGuestTestQuestion({
    messageText,
    property,
    propertyId,
  });

  let guestReply = answer.reply;

  if (answer.outcome === 'operator_followup_required') {
    const created = await createOperatorFollowupRequired({
      telegramUserId: user.telegram_user_id,
      telegramChatId: user.chat_id,
      propertyId,
      guestQuestion: messageText,
      contactId,
      updateId: update.update_id,
      intent: answer.intent,
    });
    guestReply = created.ok ? answer.reply : OPERATOR_HANDOFF_FAILED_REPLY;
  } else if (answer.outcome === 'missing_data') {
    await createGuestTestMissingDataEvent({
      telegramUserId: user.telegram_user_id,
      telegramChatId: user.chat_id,
      propertyId,
      guestQuestion: messageText,
      missingFields: answer.missingFields,
      contactId,
      intent: answer.intent,
    });
  }

  await recordGuestTestQuestionOutcome({
    telegramUserId: user.telegram_user_id,
    telegramChatId: user.chat_id,
    propertyId,
    questionText: messageText,
    replyText: guestReply,
    outcome: answer.outcome,
    intent: answer.intent,
    missingFields: answer.missingFields,
    contactId,
  });

  await replyToTelegram(user.chat_id, guestReply, {
    handler: `telegram_routing/guest_test/${answer.outcome}`,
    update_id: update.update_id,
  }, getAsiFeedbackTelegramSendOptions());

  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.GuestMessage,
    reply: guestReply,
  };
}

async function processEmergencyProtocolMessage(
  update: TelegramUpdate,
  user: TelegramRoutingUser,
  messageText: string,
  context: CommunicationAutopilotContext,
): Promise<ProcessResult | null> {
  const emergency = resolveTelegramEmergencyProtocol(messageText);
  if (!emergency) return null;

  const session = getTelegramRoutingSession(user.chat_id);
  const propertyId = context.object?.id ?? session?.testPropertyId ?? null;
  const propertyName = context.object?.name ?? null;
  const bookingId = context.booking?.id ?? null;
  const crmOptions = crmNotifyOptionsForGuest(session);

  if (emergency.isExplicitTestProbe) {
    try {
      await recordCrmCommunicationEvent({
        telegramUserId: user.telegram_user_id,
        telegramChatId: user.chat_id,
        eventType: 'note',
        messageText,
        propertyId,
        metadata: {
          protocol: 'emergency_distress_v0',
          emergency_kind: emergency.kind,
          test_probe: true,
          real_escalation_created: false,
        },
        allowCreateContact: crmOptions.crmAllowCreateContact,
        contactHints: crmOptions.crmAllowCreateContact
          ? {
              name: user.first_name,
              role: 'guest',
              source: crmOptions.crmSource ?? 'test',
              telegramUserId: user.telegram_user_id,
              telegramUsername: user.telegram_username,
              telegramChatId: user.chat_id,
              propertyId,
              status: 'testing_communication',
            }
          : undefined,
      });
    } catch (error) {
      console.error('[crm] emergency test note failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const reply = emergencyTestReply();
    await replyToTelegram(user.chat_id, reply, {
      handler: 'telegram_routing/emergency_test_probe',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.GuestMessage,
      reply,
    };
  }

  await notifyTelegramOwner({
    type: 'escalation_created',
    guestChatId: user.chat_id,
    guestName: user.first_name,
    guestUsername: user.telegram_username,
    messageText,
    replyText: emergency.replyText,
    propertyId,
    propertyName,
    intent: 'emergency_distress',
    escalationReason: `emergency_${emergency.kind}`,
    missingFields: [],
    updateId: update.update_id,
    confidence: 1,
    bookingId,
    severity: emergency.severity,
    ...crmOptions,
  });

  await replyToTelegram(user.chat_id, emergency.replyText, {
    handler: `telegram_routing/emergency/${emergency.kind}`,
    update_id: update.update_id,
  }, getAsiFeedbackTelegramSendOptions());

  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.GuestMessage,
    reply: emergency.replyText,
  };
}

async function processGuestAutopilotMessage(
  update: TelegramUpdate,
  user: TelegramRoutingUser,
  messageText: string,
): Promise<ProcessResult> {
  const session = getTelegramRoutingSession(user.chat_id);
  if (session?.testGuest) {
    const context = await buildGuestAutopilotContext(user, messageText);
    const emergencyResult = await processEmergencyProtocolMessage(update, user, messageText, context);
    if (emergencyResult) return emergencyResult;
    return processGuestTestDeterministicMessage(update, user, messageText);
  }

  const mode: TelegramCommunicationMode = resolveTelegramCommunicationMode(session);
  const context = await buildGuestAutopilotContext(user, messageText);
  const emergencyResult = await processEmergencyProtocolMessage(update, user, messageText, context);
  if (emergencyResult) return emergencyResult;

  const decision = await decideCommunicationAutopilotResponseWithLlmRouter({
    channel: 'telegram',
    messageText,
    context,
  });

  const notificationType = classifyOwnerNotificationType(decision);
  const crmOptions = crmNotifyOptionsForGuest(session);

  if (mode === 'manual') {
    await notifyTelegramOwner({
      type: 'escalation_created',
      guestChatId: user.chat_id,
      guestName: user.first_name,
      guestUsername: user.telegram_username,
      messageText,
      propertyId: context.object?.id ?? session?.testPropertyId ?? null,
      propertyName: context.object?.name ?? null,
      intent: decision.metadata.intent,
      escalationReason: 'manual_mode',
      updateId: update.update_id,
      confidence: decision.confidence,
      bookingId: context.booking?.id ?? null,
      ...crmOptions,
    });
    await replyToTelegram(user.chat_id, MANUAL_SAVED_REPLY, {
      handler: 'telegram_routing/guest_manual',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.GuestMessage,
      reply: MANUAL_SAVED_REPLY,
    };
  }

  if (mode === 'draft') {
    await notifyTelegramOwner({
      type: notificationType === 'blocked' ? 'blocked' : 'escalation_created',
      guestChatId: user.chat_id,
      guestName: user.first_name,
      guestUsername: user.telegram_username,
      messageText,
      replyText: decision.replyText,
      propertyId: context.object?.id ?? session?.testPropertyId ?? null,
      propertyName: context.object?.name ?? null,
      intent: decision.metadata.intent,
      escalationReason: decision.escalationReason ?? 'draft_mode',
      missingFields: decision.metadata.missingContext,
      updateId: update.update_id,
      confidence: decision.confidence,
      bookingId: context.booking?.id ?? null,
      ...crmOptions,
    });
    await replyToTelegram(user.chat_id, DRAFT_PREPARED_REPLY, {
      handler: 'telegram_routing/guest_draft',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.GuestMessage,
      reply: DRAFT_PREPARED_REPLY,
    };
  }

  const polishedReplyText = decision.replyText?.trim()
    ? await polishGuestReplyWithLlm({
        draftReply: decision.replyText,
        scenario: decision.metadata.passportScenario ?? decision.metadata.intent,
      })
    : decision.replyText;
  const guestReply = resolveGuestFacingReply(polishedReplyText);
  if (!polishedReplyText?.trim()) {
    await notifyTelegramOwner({
      type: 'missing_data',
      guestChatId: user.chat_id,
      guestName: user.first_name,
      guestUsername: user.telegram_username,
      messageText,
      propertyId: context.object?.id ?? session?.testPropertyId ?? null,
      propertyName: context.object?.name ?? null,
      intent: decision.metadata.intent,
      missingFields: decision.metadata.missingContext,
      updateId: update.update_id,
      confidence: decision.confidence,
      bookingId: context.booking?.id ?? null,
      ...crmOptions,
    });
    await replyToTelegram(user.chat_id, guestReply, {
      handler: 'telegram_routing/guest_missing_data',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.GuestMessage,
      reply: guestReply,
    };
  }

  await notifyTelegramOwner({
    type: notificationType,
    guestChatId: user.chat_id,
    guestName: user.first_name,
    guestUsername: user.telegram_username,
    messageText,
    replyText: decision.replyText,
    propertyId: context.object?.id ?? session?.testPropertyId ?? null,
    propertyName: context.object?.name ?? null,
    intent: decision.metadata.intent,
    escalationReason: decision.escalationReason ?? undefined,
    missingFields: decision.metadata.missingContext,
    updateId: update.update_id,
    confidence: decision.confidence,
    bookingId: context.booking?.id ?? null,
    ...crmOptions,
  });

  await replyToTelegram(user.chat_id, guestReply, {
    handler: `telegram_routing/guest_autopilot/${decision.action}`,
    update_id: update.update_id,
  }, getAsiFeedbackTelegramSendOptions());

  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.GuestMessage,
    reply: guestReply,
  };
}

async function processOwnerMessage(
  update: TelegramUpdate,
  user: TelegramRoutingUser,
  messageText: string,
): Promise<ProcessResult> {
  void upsertCrmContactFromTelegram({
    name: user.first_name,
    role: 'owner',
    source: 'telegram',
    telegramUserId: user.telegram_user_id,
    telegramUsername: user.telegram_username,
    telegramChatId: user.chat_id,
    lastMessage: messageText,
    status: 'qualified',
  }).catch(() => undefined);

  void recordCrmCommunicationEvent({
    telegramUserId: user.telegram_user_id,
    telegramChatId: user.chat_id,
    eventType: 'message_inbound',
    messageText,
    allowCreateContact: false,
  }).catch(() => undefined);

  await notifyTelegramOwner({
    type: 'escalation_created',
    guestChatId: user.chat_id,
    guestName: user.first_name,
    guestUsername: user.telegram_username,
    messageText,
    escalationReason: 'owner_message',
    updateId: update.update_id,
    crmAllowCreateContact: false,
    crmRole: 'owner',
    crmSource: 'telegram',
  });

  const reply = 'Принял сообщение. Команда ASI увидит его в уведомлениях.';
  await replyToTelegram(user.chat_id, reply, {
    handler: 'telegram_routing/owner_message',
    update_id: update.update_id,
  }, getAsiFeedbackTelegramSendOptions());

  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.GuestMessage,
    reply,
  };
}

export function buildGuestTestDeepLink(propertyId?: string | null): string {
  const username = process.env.NEXT_PUBLIC_ASI_FEEDBACK_BOT_USERNAME?.trim()?.replace(/^@+/, '') || 'ASI_Global_Bot';
  const payload = propertyId?.trim() ? `guest_test_${propertyId.trim()}` : 'guest_test';
  return `https://t.me/${username}?start=${encodeURIComponent(payload)}`;
}

async function processTelegramRoutingUpdateImpl(update: TelegramUpdate, user: TelegramRoutingUser): Promise<ProcessResult | null> {
  try {
    await hydrateTelegramRoutingSessionFromMemory({
      telegramUserId: user.telegram_user_id,
      chatId: user.chat_id,
    });
  } catch (error) {
    console.error('[telegram-routing] memory hydrate failed; continuing without DB memory', {
      error: error instanceof Error ? error.message : String(error),
      telegram_user_id: user.telegram_user_id,
      chat_id: user.chat_id,
    });
  }

  const hydratedMemory = await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null);
  logTelegramRoutingDebug(user, 'telegram_routing/inbound', hydratedMemory);

  const message = extractMessage(update);
  const text = (message?.text ?? message?.caption ?? '').trim();
  const routingCallback = parseRoutingCallbackData(update.callback_query?.data);

  if (routingCallback?.kind === 'role') {
    return handleRoleSelectionCallback(update, user, routingCallback.role);
  }

  if (SUPPORT_COMMAND_RE.test(text)) {
    return beginTelegramSupportFromRouting(update, user);
  }

  if (DEBUG_MEMORY_COMMAND_RE.test(text)) {
    if (!isTelegramInternalDebugMode(user)) {
      return null;
    }
    const memory = await loadTelegramConversationMemory(user.telegram_user_id).catch(() => null);
    const session = getTelegramRoutingSession(user.chat_id);
    const reply = [
      'debug memory',
      `scenario: ${memory?.activeScenario ?? (session?.testGuest ? 'guest_test' : 'none')}`,
      `propertyId: ${memory?.propertyId ?? session?.testPropertyId ?? 'none'}`,
      `role: ${memory?.role ?? session?.role ?? 'unknown'}`,
      `guestTestActive: ${memory?.guestTestActive ?? session?.testGuest ?? false}`,
    ].join('\n');
    logTelegramRoutingDebug(user, 'telegram_routing/debug_memory', memory);
    await replyToTelegram(user.chat_id, reply, {
      handler: 'telegram_routing/debug_memory',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply,
    };
  }

  if (RESET_TEST_STATE_COMMAND_RE.test(text)) {
    clearTelegramRoutingSession(user.chat_id);
    await clearTelegramIdentityGuestTest({
      telegramUserId: user.telegram_user_id,
      chatId: user.chat_id,
    });
    await replyToTelegram(user.chat_id, RESET_TEST_STATE_REPLY, {
      handler: 'telegram_routing/reset_test_state',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: RESET_TEST_STATE_REPLY,
    };
  }

  if (EMERGENCY_TEST_COMMAND_RE.test(text)) {
    const reply = emergencyTestReply();
    try {
      await recordCrmCommunicationEvent({
        telegramUserId: user.telegram_user_id,
        telegramChatId: user.chat_id,
        eventType: 'note',
        messageText: text,
        metadata: {
          protocol: 'emergency_distress_v0',
          command: 'emergency_test',
          test_probe: true,
          real_escalation_created: false,
        },
      });
    } catch (error) {
      console.error('[crm] emergency test command note failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await replyToTelegram(user.chat_id, reply, {
      handler: 'telegram_routing/emergency_test',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply,
    };
  }

  const guestTestCommand = text.match(GUEST_TEST_COMMAND_RE);
  if (guestTestCommand) {
    const propertyId = guestTestCommand[1]?.trim() || null;
    return activateGuestTestMode(user, update, propertyId);
  }

  const startMatch = text.match(START_RE);
  if (startMatch) {
    const startPayload = startMatch[1]?.trim() ?? '';
    const lowerPayload = startPayload.toLowerCase();
    if (lowerPayload === 'guest_test' || lowerPayload.startsWith('guest_test_')) {
      return activateGuestTestMode(user, update, parseGuestTestPayload(startPayload));
    }

    const pilotContactId = parsePilotTelegramStartPayload(startPayload);
    if (pilotContactId) {
      return handlePilotApplicationStart(user, update.update_id, pilotContactId);
    }

    const leadSource = parseAsiFeedbackStartSource(text) ?? 'unknown';
    const memory = hydratedMemory ?? (await loadTelegramConversationMemory(user.telegram_user_id));
    if (!startPayload && isGuestTestMemoryActive(memory)) {
      return resumeActiveGuestTest(user, update.update_id, memory!);
    }
    if (memory && !startPayload && memory.role !== 'unknown') {
      const continued = await continueFromKnownIdentity(user, update.update_id, memory);
      if (continued) return continued;
    }
    return sendRoleSelection(user, update.update_id, leadSource);
  }

  const resolved = await resolveTelegramRoutingRole(user, hydratedMemory);
  logTelegramRoutingDebug(user, `telegram_routing/resolve/${resolved.reason}`, hydratedMemory);

  if (resolved.role === 'unknown') {
    if (!text && !update.callback_query) return null;
    return sendRoleSelection(user, update.update_id);
  }

  if (resolved.role === 'guest') {
    if (!text) return null;
    return processGuestAutopilotMessage(update, user, text);
  }

  if (resolved.role === 'owner') {
    if (!text) return null;
    return processOwnerMessage(update, user, text);
  }

  return null;
}

export async function processTelegramRoutingUpdate(update: TelegramUpdate): Promise<ProcessResult | null> {
  const user = getTelegramRoutingUser(update);
  if (!user) return null;

  try {
    return await processTelegramRoutingUpdateImpl(update, user);
  } catch (error) {
    logTelegramWebhookHandlerError(error, {
      handler: 'telegram_routing/uncaught',
      update_id: update.update_id,
      telegram_user_id: user.telegram_user_id,
      chat_id: user.chat_id,
      telegram_event_type: update.callback_query
        ? 'callback_query'
        : update.message
          ? 'message'
          : 'unknown',
    });

    if (!isAsiFeedbackRoutingUpdate(update)) {
      throw error;
    }

    await sendTelegramWebhookFallbackReply({
      chatId: user.chat_id,
      updateId: update.update_id,
      handler: 'telegram_routing/fallback_reply',
      sendOptions: getAsiFeedbackTelegramSendOptions(),
    });

    return {
      outcome: ProcessOutcome.Error,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: TELEGRAM_TECHNICAL_ERROR_REPLY,
    };
  }
}
