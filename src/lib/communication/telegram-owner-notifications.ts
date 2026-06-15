import { auditLog } from '@/lib/communication/audit';
import { saveCommunicationAutopilotDecision } from '@/lib/communication/persistence';
import { AuditEventType } from '@/lib/communication/types';
import { recordCrmEventFromOwnerNotification } from '@/lib/crm/repository';
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
  updateId?: number;
  confidence?: number;
  bookingId?: string | null;
  crmAllowCreateContact?: boolean;
  crmSource?: 'telegram' | 'test';
  crmRole?: 'guest' | 'owner' | 'lead';
};

export type TelegramOwnerNotificationResult = {
  sentToTelegram: boolean;
  persisted: boolean;
  skippedReason?: 'guest_chat_is_owner_chat' | 'owner_chat_not_configured';
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

export function resolveOwnerNotifyChatIds(): string[] {
  const ids = new Set<string>();
  const primary = getOwnerNotifyChatId();
  if (primary) ids.add(primary);

  const ownerChatIds = process.env.TELEGRAM_OWNER_CHAT_IDS?.trim();
  if (ownerChatIds) {
    for (const value of ownerChatIds.split(/[,;\s]+/)) {
      const trimmed = value.trim();
      if (trimmed) ids.add(trimmed);
    }
  }

  return [...ids];
}

export function isGuestChatSameAsOwnerNotify(guestChatId: number): boolean {
  const guestChat = String(guestChatId);
  return resolveOwnerNotifyChatIds().some((ownerChatId) => ownerChatId === guestChat);
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

export function formatTelegramOwnerNotification(input: TelegramOwnerNotificationInput): string {
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

function storedDecisionForType(type: TelegramOwnerNotificationType): 'auto_reply' | 'escalation' | 'blocked' {
  if (type === 'auto_reply_sent') return 'auto_reply';
  if (type === 'blocked') return 'blocked';
  return 'escalation';
}

async function persistOwnerNotification(input: TelegramOwnerNotificationInput): Promise<boolean> {
  try {
    await saveCommunicationAutopilotDecision({
      chat_id: input.guestChatId,
      update_id: input.updateId,
      channel: 'telegram',
      intent: input.intent ?? 'unknown',
      decision: storedDecisionForType(input.type),
      confidence: input.confidence,
      reason: input.escalationReason ?? input.type,
      property_id: input.propertyId ?? null,
      booking_id: input.bookingId ?? null,
      missing_context: input.missingFields ?? [],
      reply_preview: input.replyText ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

async function persistCrmOwnerNotification(input: TelegramOwnerNotificationInput): Promise<void> {
  try {
    await recordCrmEventFromOwnerNotification({
      type: input.type,
      guestChatId: input.guestChatId,
      guestName: input.guestName,
      guestUsername: input.guestUsername,
      messageText: input.messageText,
      replyText: input.replyText,
      propertyId: input.propertyId,
      intent: input.intent,
      escalationReason: input.escalationReason,
      missingFields: input.missingFields,
      allowCreateContact: input.crmAllowCreateContact ?? false,
      source: input.crmSource,
      role: input.crmRole,
    });
  } catch (error) {
    console.error('[crm] owner notification event failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function notifyTelegramOwner(
  input: TelegramOwnerNotificationInput,
): Promise<TelegramOwnerNotificationResult> {
  const ownerChatIds = resolveOwnerNotifyChatIds();
  const guestMatchesOwner = isGuestChatSameAsOwnerNotify(input.guestChatId);

  if (guestMatchesOwner || ownerChatIds.length === 0) {
    const skippedReason = ownerChatIds.length === 0 ? 'owner_chat_not_configured' : 'guest_chat_is_owner_chat';
    const persisted = await persistOwnerNotification(input);
    void persistCrmOwnerNotification(input);
    auditLog({
      type: AuditEventType.EscalationCreated,
      chat_id: input.guestChatId,
      update_id: input.updateId,
      detail: `owner_notification_skipped=${skippedReason} notification_type=${input.type} intent=${input.intent ?? 'unknown'}`,
    });
    return { sentToTelegram: false, persisted, skippedReason };
  }

  const ownerChatId = ownerChatIds[0];
  if (String(input.guestChatId) === ownerChatId) {
    const persisted = await persistOwnerNotification(input);
    void persistCrmOwnerNotification(input);
    return { sentToTelegram: false, persisted, skippedReason: 'guest_chat_is_owner_chat' };
  }

  await sendTelegramMessageToChat(
    ownerChatId,
    formatTelegramOwnerNotification(input),
    getAsiFeedbackTelegramSendOptions(),
  );
  const persisted = await persistOwnerNotification(input);
  void persistCrmOwnerNotification(input);
  return { sentToTelegram: true, persisted };
}
