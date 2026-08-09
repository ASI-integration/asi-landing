import type { InboundMessageEnvelope } from './types';

function normalized(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedRole(value: unknown): string {
  return normalized(value).toLowerCase().replace(/^@+/, '');
}

export function isConfiguredTelegramTestGuestChat(
  envelope: InboundMessageEnvelope,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (envelope.channel !== 'telegram') return false;
  const chatId = normalized(envelope.chatId ?? envelope.metadata?.telegram_chat_id);
  if (!chatId) return false;
  return [env.TELEGRAM_AUTOPILOT_TEST_CHAT_ID, env.TELEGRAM_TEST_CHAT_ID]
    .map(normalized)
    .filter(Boolean)
    .includes(chatId);
}

export function isTelegramTestGuestIdentity(envelope: InboundMessageEnvelope): boolean {
  const metadata = envelope.metadata ?? {};
  return (
    normalized(envelope.messageText).startsWith('/guest_test') ||
    metadata.guestTestMode === true ||
    metadata.guest_test_mode === true ||
    normalizedRole(metadata.senderIdentity ?? metadata.sender_identity) === 'test_guest' ||
    isConfiguredTelegramTestGuestChat(envelope)
  );
}
