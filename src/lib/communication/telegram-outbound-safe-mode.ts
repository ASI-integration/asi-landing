/** Default owner chat — never target with synthetic HTTP/live tests unless explicitly approved. */
export const DEFAULT_PROTECTED_TELEGRAM_CHAT_IDS = ['931919812'] as const;

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Process inbound normally but skip Telegram sendMessage (also honors legacy TELEGRAM_DRY_RUN=1). */
export function isTelegramOutboundDryRun(): boolean {
  return envTruthy('DRY_RUN_TELEGRAM_OUTBOUND') || envTruthy('TELEGRAM_DRY_RUN');
}

export function parseProtectedTelegramChatIds(): Set<string> {
  const raw = process.env.TELEGRAM_PROTECTED_CHAT_IDS?.trim();
  const ids = raw
    ? raw.split(/[,;\s]+/)
    : [...DEFAULT_PROTECTED_TELEGRAM_CHAT_IDS];
  return new Set(ids.map((s) => s.trim()).filter(Boolean));
}

export function isProtectedOwnerChatId(chatId: string | number | null | undefined): boolean {
  if (chatId === null || chatId === undefined) return false;
  const normalized = String(chatId).trim();
  return normalized.length > 0 && parseProtectedTelegramChatIds().has(normalized);
}

/** Explicit opt-in for synthetic tests against real owner chat (off by default). */
export function allowRealTelegramSyntheticTests(): boolean {
  return envTruthy('ALLOW_REAL_TELEGRAM_SYNTHETIC');
}

/** Dedicated acceptance-test chat; scripts must set this explicitly — never fall back to owner chat. */
export function getTelegramTestChatId(): string | null {
  const v = process.env.TELEGRAM_TEST_CHAT_ID?.trim();
  return v && v.length > 0 ? v : null;
}

export type TelegramOutboundSuppressOptions = {
  /** True for HTTP replay / script POSTs, false for real Telegram webhook traffic. */
  syntheticInbound?: boolean;
};

export function shouldSuppressTelegramOutbound(
  chatId: string | number | null | undefined,
  options?: TelegramOutboundSuppressOptions,
): boolean {
  if (isTelegramOutboundDryRun()) return true;
  if (
    options?.syntheticInbound &&
    isProtectedOwnerChatId(chatId) &&
    !allowRealTelegramSyntheticTests()
  ) {
    return true;
  }
  return false;
}
