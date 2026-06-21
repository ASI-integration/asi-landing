import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';

export type CommunicationAutopilotMode = 'enabled' | 'disabled';

export function normalizeCommunicationAutopilotMode(
  value: unknown,
): CommunicationAutopilotMode {
  return String(value ?? '').trim().toLowerCase() === 'enabled' ? 'enabled' : 'disabled';
}

export function isCommunicationAutopilotEnabled(
  property?: Pick<TelegramPropertyObjectV1, 'communication_autopilot'> | null,
): boolean {
  if (process.env.COMMUNICATION_AUTOPILOT_FORCE_ENABLED === '1') return true;
  return normalizeCommunicationAutopilotMode(property?.communication_autopilot) === 'enabled';
}
