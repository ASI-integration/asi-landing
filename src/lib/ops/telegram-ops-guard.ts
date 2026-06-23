/**
 * Блокирует прямое создание OPS-задач из Telegram.
 * Для пилота OPS создаётся только через communication escalation → syncAutoOpsTasks.
 */
export function isTelegramDirectOpsBlocked(): boolean {
  return process.env.TELEGRAM_OPS_ESCALATION_ONLY === '1';
}

export function shouldCreateTelegramOpsTaskDirectly(): boolean {
  return !isTelegramDirectOpsBlocked();
}
