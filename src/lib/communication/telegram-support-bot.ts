import { TELEGRAM_CORE_BOT_HANDLE, TELEGRAM_SUPPORT_BOT_HANDLE } from '@/config/telegramBots';
import { buildAutoOpsDedupKey, createOpsOperatorTask } from '@/lib/ops-board/repository';
import { sendSupportBotReply, sendSupportBotTyping } from '@/lib/telegram';
import { supabase } from '@/lib/supabase';
import type { TelegramUpdate } from './types';

export type SupportBotIntent =
  | 'connect_property'
  | 'pricing_pilot'
  | 'about_asi'
  | 'needs_human'
  | 'unknown';

export type SupportBotProcessResult = {
  ok: boolean;
  outcome: 'replied' | 'ignored' | 'error';
  intent: SupportBotIntent | null;
  replyText: string | null;
  crmContactId: string | null;
  opsTaskId: string | null;
  dedupKey: string | null;
  chatId: number | null;
  messageText: string | null;
};

const SUPPORT_OPS_DEDUP_WINDOW_MS = 30 * 60 * 1000;
const SUPPORT_OPS_DESCRIPTION = 'Требуется ручная проверка обращения в поддержку';

function normalizeRu(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text: string, ...patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifySupportBotIntent(messageText: string): SupportBotIntent {
  const text = normalizeRu(messageText);
  if (!text) return 'unknown';

  if (
    has(
      text,
      /оператор/,
      /человек/,
      /поддержк/,
      /не\s+работает/,
      /ошибк/,
      /сломал/,
      /не\s+могу/,
      /помогите/,
      /нужна\s+помощь/,
    )
  ) {
    return 'needs_human';
  }

  if (
    has(
      text,
      /хочу\s+подключить\s+(квартир|объект)/,
      /подключить\s+объект/,
      /подключить\s+asi/,
      /как\s+начать/,
      /хочу\s+(в\s+)?пилот/,
      /интересует\s+пилот/,
      /подключ(ить|иться).*(квартир|объект|апартамент)/,
    )
  ) {
    return 'connect_property';
  }

  if (
    has(
      text,
      /сколько\s+стоит/,
      /\bцена\b/,
      /\bтариф/,
      /пилот\s+бесплатно/,
      /стоимость\s+подключения/,
    )
  ) {
    return 'pricing_pilot';
  }

  if (
    has(
      text,
      /что\s+такое\s+asi/,
      /что\s+вы\s+делаете/,
      /что\s+умеет\s+(система|asi)/,
      /чем\s+помогает/,
    )
  ) {
    return 'about_asi';
  }

  return 'unknown';
}

export function buildSupportBotReply(intent: SupportBotIntent): string {
  switch (intent) {
    case 'connect_property':
      return `Поняла. Чтобы подключить объект к ASI, начните с основного бота: @${TELEGRAM_CORE_BOT_HANDLE}. Он проведёт по шагам раннего доступа и подготовки объекта. Если что-то не получится, напишите сюда, я передам вопрос оператору.`;
    case 'pricing_pilot':
      return 'Сейчас ASI запускается через ограниченный пилот. На пилоте подключение может быть бесплатным для первых объектов, чтобы проверить систему на живом контуре. Итоговые тарифы будут зависеть от режима: ручной, полуавтоматический или автоматический.';
    case 'about_asi':
      return 'ASI — это автопилот для посуточной аренды. Система помогает вести объект, собирать данные, готовить публикацию, обрабатывать коммуникацию с гостями и создавать операционные задачи: заезды, выезды, уборки и ручные проверки.';
    case 'needs_human':
      return 'Поняла. Я передала обращение оператору. Он посмотрит ситуацию и вернётся с ответом.';
    case 'unknown':
    default:
      return 'Поняла сообщение, но мне нужно передать его оператору, чтобы не ответить неверно.';
  }
}

export function shouldCreateSupportOpsTask(intent: SupportBotIntent): boolean {
  return intent === 'needs_human' || intent === 'unknown';
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function buildSupportOpsDedupKey(chatId: number, messageText: string, now = Date.now()): string {
  const normalized = normalizeRu(messageText).slice(0, 160);
  const bucket = Math.floor(now / SUPPORT_OPS_DEDUP_WINDOW_MS);
  return buildAutoOpsDedupKey({
    source: 'telegram_support',
    sourceId: `${chatId}:${simpleHash(normalized)}:${bucket}`,
    taskType: 'support_review',
  });
}

function telegramUsernameFromUpdate(update: TelegramUpdate): string {
  const message = update.message ?? update.edited_message;
  const username = message?.from?.username;
  return typeof username === 'string' ? username.trim().replace(/^@/, '') : '';
}

function telegramUserIdFromUpdate(update: TelegramUpdate): string {
  const message = update.message ?? update.edited_message;
  const id = message?.from?.id;
  return typeof id === 'number' || typeof id === 'string' ? String(id).trim() : '';
}

function telegramChatIdFromUpdate(update: TelegramUpdate): string {
  const message = update.message ?? update.edited_message;
  const id = message?.chat?.id;
  return typeof id === 'number' || typeof id === 'string' ? String(id).trim() : '';
}

function telegramDisplayNameFromUpdate(update: TelegramUpdate): string {
  const message = update.message ?? update.edited_message;
  const firstName = typeof message?.from?.first_name === 'string' ? message.from.first_name.trim() : '';
  const username = telegramUsernameFromUpdate(update);
  return firstName || (username ? `@${username}` : 'Контакт из Telegram');
}

async function findCrmContactByTelegram(input: { username: string; userId: string; chatId: string }): Promise<{ id: string } | null> {
  try {
    if (input.userId) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('telegram_user_id', input.userId)
        .maybeSingle();
      if (!error && data) return { id: String((data as { id: unknown }).id) };
    }
    if (input.username) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('telegram_username', input.username)
        .maybeSingle();
      if (!error && data) return { id: String((data as { id: unknown }).id) };
    }
    if (input.chatId) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('telegram_chat_id', input.chatId)
        .maybeSingle();
      if (!error && data) return { id: String((data as { id: unknown }).id) };
    }
  } catch {
    return null;
  }
  return null;
}

function crmNotesForIntent(intent: SupportBotIntent, messageText: string): string {
  const preview = messageText.trim().slice(0, 240);
  switch (intent) {
    case 'connect_property':
      return `Обращение в @${TELEGRAM_SUPPORT_BOT_HANDLE}: хочет подключить объект. ${preview}`;
    case 'pricing_pilot':
      return `Обращение в @${TELEGRAM_SUPPORT_BOT_HANDLE}: вопрос о стоимости/пилоте. ${preview}`;
    case 'about_asi':
      return `Обращение в @${TELEGRAM_SUPPORT_BOT_HANDLE}: вопрос о возможностях ASI. ${preview}`;
    case 'needs_human':
      return `Обращение в @${TELEGRAM_SUPPORT_BOT_HANDLE}: нужен оператор. ${preview}`;
    case 'unknown':
    default:
      return `Обращение в @${TELEGRAM_SUPPORT_BOT_HANDLE}: требует ручной проверки. ${preview}`;
  }
}

function crmNextActionForIntent(intent: SupportBotIntent): string {
  switch (intent) {
    case 'connect_property':
      return 'Направить в @ASI_core_bot для подключения объекта.';
    case 'pricing_pilot':
      return 'Ответить на вопрос о пилоте и тарифах.';
    case 'about_asi':
      return 'Ответить на вопрос о возможностях ASI.';
    case 'needs_human':
    case 'unknown':
    default:
      return 'Проверить обращение и ответить в Telegram.';
  }
}

async function upsertSupportCrmLead(input: {
  update: TelegramUpdate;
  intent: SupportBotIntent;
  messageText: string;
}): Promise<string | null> {
  const username = telegramUsernameFromUpdate(input.update);
  const userId = telegramUserIdFromUpdate(input.update);
  const chatId = telegramChatIdFromUpdate(input.update);
  const contactKey = username || (userId ? `tg:${userId}` : chatId ? `tg-chat:${chatId}` : '');
  if (!contactKey) return null;

  const now = new Date().toISOString();
  const notes = crmNotesForIntent(input.intent, input.messageText);
  const nextAction = crmNextActionForIntent(input.intent);
  const existing = await findCrmContactByTelegram({ username, userId, chatId });
  const operatorNeeded = shouldCreateSupportOpsTask(input.intent);
  const interestContext = input.intent === 'connect_property' ? 'asi_connection' : 'support';

  if (existing?.id) {
    try {
      const { data, error } = await supabase
        .from('crm_contacts')
        .update({
          role: 'unknown',
          source: 'telegram',
          interest_context: interestContext,
          status: operatorNeeded ? 'operator_needed' : 'new',
          responsible_name: process.env.ASI_OPERATOR_NAME?.trim() || 'Николай',
          responsible_telegram: process.env.ASI_OPERATOR_TELEGRAM?.trim() || '@ASI_Support_Bot',
          responsible_phone: process.env.ASI_OPERATOR_PHONE?.trim() || '+79217926627',
          telegram_user_id: userId || null,
          telegram_chat_id: chatId || null,
          last_message: input.messageText.trim().slice(0, 600),
          last_reason: operatorNeeded ? 'обращение в поддержку требует оператора' : 'обращение в поддержку ASI',
          last_activity_at: now,
          communication_status: operatorNeeded ? 'needs_manual_reaction' : 'wrote_first',
          notes,
          next_action: nextAction,
        })
        .eq('id', existing.id)
        .select('id')
        .single();
      if (error || !data) return existing.id;
      return String((data as { id: unknown }).id);
    } catch {
      return existing.id;
    }
  }

  try {
    const { data, error } = await supabase
      .from('crm_contacts')
      .insert({
        name: telegramDisplayNameFromUpdate(input.update),
        phone: null,
        contact: contactKey,
        telegram_username: username || null,
        telegram_user_id: userId || null,
        telegram_chat_id: chatId || null,
        email: null,
        role: 'unknown',
        source: 'telegram',
        interest_context: interestContext,
        property_count: 0,
        city: null,
        notes,
        status: operatorNeeded ? 'operator_needed' : 'new',
        communication_status: operatorNeeded ? 'needs_manual_reaction' : 'wrote_first',
        responsible_name: process.env.ASI_OPERATOR_NAME?.trim() || 'Николай',
        responsible_telegram: process.env.ASI_OPERATOR_TELEGRAM?.trim() || '@ASI_Support_Bot',
        responsible_phone: process.env.ASI_OPERATOR_PHONE?.trim() || '+79217926627',
        last_message: input.messageText.trim().slice(0, 600),
        last_reason: operatorNeeded ? 'обращение в поддержку требует оператора' : 'обращение в поддержку ASI',
        last_activity_at: now,
        next_action: nextAction,
        next_action_due_at: null,
      })
      .select('id')
      .single();
    if (error || !data) return null;
    return String((data as { id: unknown }).id);
  } catch {
    return null;
  }
}

async function createSupportOpsTask(input: {
  chatId: number;
  messageText: string;
  contactId: string | null;
  ownerName: string | null;
}): Promise<{ taskId: string | null; dedupKey: string }> {
  const dedupKey = buildSupportOpsDedupKey(input.chatId, input.messageText);
  const messagePreview = input.messageText.trim();
  const result = await createOpsOperatorTask({
    taskType: 'support_review',
    taskStatus: 'needs_operator',
    source: 'telegram_support',
    title: 'Проверить обращение в поддержку',
    description: SUPPORT_OPS_DESCRIPTION,
    contactId: input.contactId,
    ownerName: input.ownerName,
    lastEventText: messagePreview,
    dedupKey,
    metadata: {
      created_by_system: true,
      integration: 'support_bot',
      marker: dedupKey,
      message_text: messagePreview,
      support_bot: TELEGRAM_SUPPORT_BOT_HANDLE,
    },
    updateIfExists: {
      description: SUPPORT_OPS_DESCRIPTION,
      taskStatus: 'needs_operator',
      lastEventText: messagePreview,
    },
  });

  if (!result.ok || !result.task) {
    console.warn('[support-bot] failed to create support_review OPS task', {
      dedupKey,
      error: result.error ?? 'unknown',
    });
  }

  return {
    taskId: result.ok && result.task ? result.task.id : null,
    dedupKey,
  };
}

export async function processSupportBotUpdate(update: TelegramUpdate | null): Promise<SupportBotProcessResult> {
  const empty: SupportBotProcessResult = {
    ok: false,
    outcome: 'ignored',
    intent: null,
    replyText: null,
    crmContactId: null,
    opsTaskId: null,
    dedupKey: null,
    chatId: null,
    messageText: null,
  };

  if (!update) return empty;

  const message = update.edited_message ?? update.message;
  const chatId = message?.chat?.id;
  const messageText = String(message?.text ?? message?.caption ?? '').trim();

  if (typeof chatId !== 'number' || !messageText) {
    return empty;
  }

  const intent = classifySupportBotIntent(messageText);
  const replyText = buildSupportBotReply(intent);

  sendSupportBotTyping(chatId, update.update_id);

  const crmContactId = await upsertSupportCrmLead({ update, intent, messageText });

  let opsTaskId: string | null = null;
  let dedupKey: string | null = null;
  if (shouldCreateSupportOpsTask(intent)) {
    const ops = await createSupportOpsTask({
      chatId,
      messageText,
      contactId: crmContactId,
      ownerName: telegramDisplayNameFromUpdate(update),
    });
    opsTaskId = ops.taskId;
    dedupKey = ops.dedupKey;
  }

  const sent = await sendSupportBotReply(chatId, replyText, {
    handler: 'support_bot',
    update_id: update.update_id,
  });

  return {
    ok: sent,
    outcome: sent ? 'replied' : 'error',
    intent,
    replyText,
    crmContactId,
    opsTaskId,
    dedupKey,
    chatId,
    messageText,
  };
}
