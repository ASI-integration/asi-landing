export const TELEGRAM_OPS_ACCEPTANCE_PREFIX = 'ASI_TG_OPS_ACCEPTANCE_';
export const TELEGRAM_OPS_ACCEPTANCE_ESCALATE_MARKER = 'ASI_TG_OPS_ACCEPTANCE_ESCALATE';

/** Reserved synthetic chat for internal acceptance — never a real Telegram user chat. */
export const TELEGRAM_OPS_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT = 990_001_337;

export function getTelegramOpsAcceptanceSyntheticChatId(): number {
  const raw = process.env.TELEGRAM_OPS_ACCEPTANCE_SYNTHETIC_CHAT_ID?.trim();
  if (!raw) return TELEGRAM_OPS_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : TELEGRAM_OPS_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT;
}

export const TELEGRAM_OPS_ACCEPTANCE_MESSAGE_SUFFIX =
  'У гостя проблема, срочно нужен оператор';

export function buildTelegramOpsAcceptanceMessage(runId: string): string {
  return `${TELEGRAM_OPS_ACCEPTANCE_PREFIX}${runId} ${TELEGRAM_OPS_ACCEPTANCE_ESCALATE_MARKER} ${TELEGRAM_OPS_ACCEPTANCE_MESSAGE_SUFFIX}`;
}

export function isTelegramOpsAcceptanceEscalationRequest(input: {
  channel: string;
  chatId: string | number;
  messageText: string;
}): boolean {
  if (input.channel !== 'telegram') return false;
  if (String(input.chatId) !== String(getTelegramOpsAcceptanceSyntheticChatId())) return false;
  const text = String(input.messageText ?? '').trim();
  if (!text.includes(TELEGRAM_OPS_ACCEPTANCE_PREFIX)) return false;
  return text.includes(TELEGRAM_OPS_ACCEPTANCE_ESCALATE_MARKER);
}
