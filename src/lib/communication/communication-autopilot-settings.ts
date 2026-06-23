import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';

/** Режимы коммуникации на уровне объекта. */
export type CommunicationMode = 'off' | 'manual' | 'autopilot';

/** @deprecated Используйте CommunicationMode */
export type CommunicationAutopilotMode = 'enabled' | 'disabled' | 'manual';

export function normalizeCommunicationMode(value: unknown): CommunicationMode {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'enabled' || raw === 'autopilot') return 'autopilot';
  if (raw === 'manual') return 'manual';
  return 'off';
}

export function normalizeCommunicationAutopilotMode(
  value: unknown,
): CommunicationAutopilotMode {
  const mode = normalizeCommunicationMode(value);
  if (mode === 'autopilot') return 'enabled';
  if (mode === 'manual') return 'manual';
  return 'disabled';
}

export function communicationModeToStorage(mode: CommunicationMode): string {
  if (mode === 'autopilot') return 'enabled';
  if (mode === 'manual') return 'manual';
  return 'disabled';
}

export const COMMUNICATION_MODE_LABELS_RU: Record<CommunicationMode, string> = {
  off: 'Выключено',
  manual: 'Ручной контроль',
  autopilot: 'Автопилот с эскалациями',
};

export function isCommunicationKillSwitchActive(): boolean {
  if (process.env.COMMUNICATION_KILL_SWITCH === '1') return true;
  if (process.env.COMMUNICATION_AUTOPILOT_FORCE_DISABLED === '1') return true;
  return false;
}

export function getEffectiveCommunicationMode(
  property?: Pick<TelegramPropertyObjectV1, 'communication_autopilot'> | null,
): CommunicationMode {
  if (isCommunicationKillSwitchActive()) return 'off';
  if (process.env.COMMUNICATION_AUTOPILOT_FORCE_ENABLED === '1') return 'autopilot';
  return normalizeCommunicationMode(property?.communication_autopilot);
}

export function isCommunicationAutopilotEnabled(
  property?: Pick<TelegramPropertyObjectV1, 'communication_autopilot'> | null,
): boolean {
  return getEffectiveCommunicationMode(property) === 'autopilot';
}

export function canSendAutonomousGuestReply(
  property?: Pick<TelegramPropertyObjectV1, 'communication_autopilot'> | null,
): boolean {
  return getEffectiveCommunicationMode(property) === 'autopilot';
}

export function canClassifyInboundCommunication(
  property?: Pick<TelegramPropertyObjectV1, 'communication_autopilot'> | null,
): boolean {
  const mode = getEffectiveCommunicationMode(property);
  return mode === 'manual' || mode === 'autopilot';
}

export function shouldLogOnlyCommunication(
  property?: Pick<TelegramPropertyObjectV1, 'communication_autopilot'> | null,
): boolean {
  return getEffectiveCommunicationMode(property) === 'off';
}
