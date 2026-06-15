import { sendTelegramMessageToChat, type TelegramSendOptions } from '@/lib/telegram';

export type TelegramOwnerNotificationType =
  | 'auto_reply_sent'
  | 'escalation_created'
  | 'blocked'
  | 'missing_data';

export type TelegramOwnerNotificationInput = {
  type: TelegramOwnerNotificationType;
  guestChatId: number;
  guestName?: string | null;
  guestUsername?: string | null;
  messageText: string;
  replyText?: string | null;
  propertyId?: string | null;
  propertyName?: string | null;
  intent?: string | null;
  escalationReason?: string | null;
  missingFields?: string[];
};

const TYPE_LABELS: Record<TelegramOwnerNotificationType, string> = {
  auto_reply_sent: 'ASI ответила гостю автоматически',
  escalation_created: 'Нужен оператор',
  blocked: 'Заблокированная попытка',
  missing_data: 'Не хватает данных объекта',
};

function getOwnerNotifyChatId(): string | null {
  return (
    process.env.TELEGRAM_OWNER_NOTIFY_CHAT_ID?.trim() ||
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID?.trim() ||
    null
  );
}

function getAsiFeedbackTelegramSendOptions(): TelegramSendOptions {
  return {
    botToken: process.env.ASI_FEEDBACK_BOT_TOKEN?.trim() || null,
    tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN',
  };
}

function guestLabel(input: TelegramOwnerNotificationInput): string {
  const username = input.guestUsername ? `@${input.guestUsername}` : null;
  const name = input.guestName?.trim() || null;
  if (name && username) return `${name} (${username})`;
  return name || username || `chat ${input.guestChatId}`;
}

function formatNotification(input: TelegramOwnerNotificationInput): string {
  const lines = [
    TYPE_LABELS[input.type],
    `Гость: ${guestLabel(input)}`,
    `Чат: ${input.guestChatId}`,
  ];

  if (input.propertyName || input.propertyId) {
    lines.push(`Объект: ${input.propertyName ?? input.propertyId}`);
  }
  if (input.intent) lines.push(`Намерение: ${input.intent}`);
  if (input.escalationReason) lines.push(`Причина: ${input.escalationReason}`);
  if (input.missingFields?.length) {
    lines.push(`Не хватает: ${input.missingFields.join(', ')}`);
  }

  lines.push('', 'Сообщение гостя:', input.messageText.trim());

  if (input.replyText?.trim()) {
    lines.push('', 'Ответ ASI:', input.replyText.trim());
  }

  return lines.join('\n');
}

export async function notifyTelegramOwner(input: TelegramOwnerNotificationInput): Promise<void> {
  const chatId = getOwnerNotifyChatId();
  if (!chatId) {
    console.warn('[telegram-routing] owner notify chat id is not configured');
    return;
  }

  await sendTelegramMessageToChat(chatId, formatNotification(input), getAsiFeedbackTelegramSendOptions());
}
