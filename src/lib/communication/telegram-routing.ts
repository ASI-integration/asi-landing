import { normalizeAsiFeedbackLeadSource, type AsiFeedbackLeadSource } from '@/config/publicTelegram';
import { decideCommunicationAutopilotResponseWithLlmRouter } from '@/lib/communication/autopilot';
import type { CommunicationAutopilotContext } from '@/lib/communication/autopilot';
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
import { notifyTelegramOwner } from '@/lib/communication/telegram-owner-notifications';
import {
  getTelegramRoutingSession,
  patchTelegramRoutingSession,
  resolveTelegramCommunicationMode,
  type TelegramCommunicationMode,
  type TelegramRoutingRole,
} from '@/lib/communication/telegram-routing-session';
import { replyToTelegram, answerTelegramCallbackQuery, type TelegramSendOptions } from '@/lib/telegram';
import { supabase } from '@/lib/supabase';
import { MessageCategory, ProcessOutcome, type ProcessResult, type TelegramUpdate } from './types';

const START_RE = /^\/start(?:@\w+)?(?:\s+(.+))?$/i;
const SUPPORT_COMMAND_RE = /^\/support(?:@\w+)?$/i;
const GUEST_TEST_COMMAND_RE = /^\/guest_test(?:@\w+)?(?:\s+(.+))?$/i;
const ROUTING_CALLBACK_PREFIX = 'tr';

const ROLE_SELECTION_REPLY =
  'Здравствуйте! Подскажите, пожалуйста, кто вы — так я смогу ответить правильно:';

const GUEST_WELCOME_REPLY =
  'Понял, вы гость по бронированию. Напишите вопрос по объекту — отвечу по паспорту, если вопрос безопасный. Если бронь ещё не привязана, укажите номер бронирования или телефон из брони.';

const OWNER_WELCOME_REPLY =
  'Понял, вы владелец или управляющий. Я буду присылать только уведомления и эскалации по гостям. Если нужна помощь команды ASI — напишите вопрос одним сообщением.';

const GUEST_TEST_WELCOME_REPLY =
  'Тестовый режим гостя включён. Можно проверить автопилот: адрес, заезд, Wi‑Fi, правила. Напишите вопрос по объекту.';

const MANUAL_SAVED_REPLY = 'Сообщение сохранено. Оператор ответит вручную.';
const DRAFT_PREPARED_REPLY =
  'Подготовили черновик ответа. Оператор проверит и отправит гостю, если всё верно.';

type ParsedRoutingCallback =
  | { kind: 'role'; role: Exclude<TelegramRoutingRole, 'unknown'> }
  | { kind: 'guest_test'; propertyId: string | null };

type TelegramRoutingUser = TelegramLeadUser;

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
): Promise<{ role: TelegramRoutingRole; reason: string }> {
  const session = getTelegramRoutingSession(user.chat_id);
  if (session?.testGuest) return { role: 'guest', reason: 'session:guest_test' };
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
): Promise<ProcessResult> {
  patchTelegramRoutingSession(user.chat_id, {
    role: 'unknown',
    leadSource: leadSource ?? undefined,
  });
  await replyToTelegram(user.chat_id, ROLE_SELECTION_REPLY, {
    handler: 'telegram_routing/role_selection',
    update_id: updateId,
  }, { ...getAsiFeedbackTelegramSendOptions(), replyMarkup: roleSelectionKeyboard() });

  return {
    outcome: ProcessOutcome.Replied,
    update_id: updateId,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply: ROLE_SELECTION_REPLY,
  };
}

async function activateGuestTestMode(
  user: TelegramRoutingUser,
  update: TelegramUpdate,
  propertyId: string | null,
): Promise<ProcessResult> {
  const resolvedPropertyId = propertyId || defaultGuestTestPropertyId();
  patchTelegramRoutingSession(user.chat_id, {
    role: 'guest',
    selectedRole: 'guest',
    testGuest: true,
    testPropertyId: resolvedPropertyId,
    communicationMode: 'autopilot',
  });

  await replyToTelegram(user.chat_id, GUEST_TEST_WELCOME_REPLY, {
    handler: 'telegram_routing/guest_test',
    update_id: update.update_id,
  }, getAsiFeedbackTelegramSendOptions());

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
  const leadSource = normalizeAsiFeedbackLeadSource(session?.leadSource ?? 'unknown');

  patchTelegramRoutingSession(user.chat_id, {
    role,
    selectedRole: role,
  });

  if (role === 'guest') {
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
    await replyToTelegram(user.chat_id, OWNER_WELCOME_REPLY, {
      handler: 'telegram_routing/role_owner',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: OWNER_WELCOME_REPLY,
    };
  }

  if (role === 'lead') {
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

async function processGuestAutopilotMessage(
  update: TelegramUpdate,
  user: TelegramRoutingUser,
  messageText: string,
): Promise<ProcessResult> {
  const session = getTelegramRoutingSession(user.chat_id);
  const mode: TelegramCommunicationMode = resolveTelegramCommunicationMode(session);
  const context = await buildGuestAutopilotContext(user, messageText);
  const decision = await decideCommunicationAutopilotResponseWithLlmRouter({
    channel: 'telegram',
    messageText,
    context,
  });

  const notificationType = classifyOwnerNotificationType(decision);

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

  const guestReply = decision.replyText?.trim();
  if (!guestReply) {
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
    });
    const fallback = 'Сейчас не вижу точные данные по этому вопросу. Передаю оператору.';
    await replyToTelegram(user.chat_id, fallback, {
      handler: 'telegram_routing/guest_missing_data',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.GuestMessage,
      reply: fallback,
    };
  }

  await notifyTelegramOwner({
    type: notificationType,
    guestChatId: user.chat_id,
    guestName: user.first_name,
    guestUsername: user.telegram_username,
    messageText,
    replyText: guestReply,
    propertyId: context.object?.id ?? session?.testPropertyId ?? null,
    propertyName: context.object?.name ?? null,
    intent: decision.metadata.intent,
    escalationReason: decision.escalationReason ?? undefined,
    missingFields: decision.metadata.missingContext,
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
  await notifyTelegramOwner({
    type: 'escalation_created',
    guestChatId: user.chat_id,
    guestName: user.first_name,
    guestUsername: user.telegram_username,
    messageText,
    escalationReason: 'owner_message',
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

export async function processTelegramRoutingUpdate(update: TelegramUpdate): Promise<ProcessResult | null> {
  const user = getTelegramRoutingUser(update);
  if (!user) return null;

  const message = extractMessage(update);
  const text = (message?.text ?? message?.caption ?? '').trim();
  const routingCallback = parseRoutingCallbackData(update.callback_query?.data);

  if (routingCallback?.kind === 'role') {
    return handleRoleSelectionCallback(update, user, routingCallback.role);
  }

  if (SUPPORT_COMMAND_RE.test(text)) {
    return beginTelegramSupportFromRouting(update, user);
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

    const leadSource = parseAsiFeedbackStartSource(text) ?? 'unknown';
    return sendRoleSelection(user, update.update_id, leadSource);
  }

  const resolved = await resolveTelegramRoutingRole(user);

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
