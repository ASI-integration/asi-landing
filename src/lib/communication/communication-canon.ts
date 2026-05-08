import type { CommunicationChannel, Lang } from './types';
import {
  getTelegramCommunicationCanon,
  type TelegramOperationalScenarioFamily,
} from './telegram-communication-canon';

export * from './telegram-communication-canon';

export type CanonicalGuestCommunicationChannel = Extract<CommunicationChannel, 'telegram' | 'email' | 'vk'>;

export function isCanonicalGuestCommunicationChannel(
  channel: CommunicationChannel,
): channel is CanonicalGuestCommunicationChannel {
  return channel === 'telegram' || channel === 'email' || channel === 'vk';
}

export function getCommunicationCanon(): ReturnType<typeof getTelegramCommunicationCanon> {
  return getTelegramCommunicationCanon();
}

export function canonicalUrgentAccessEscalationText(params: {
  channel: CommunicationChannel;
  lang: Lang;
  scenarioFamily?: TelegramOperationalScenarioFamily | null;
  category?: string | null;
  action?: string | null;
}): string | null {
  const isAccess =
    params.scenarioFamily === 'ACCESS_KEY_ISSUE' ||
    params.category === 'access_issue';
  const isEscalation = params.action === 'escalate' || params.action === 'escalate_urgent';
  if (!isAccess || !isEscalation) return null;
  if (params.lang === 'ru') {
    return 'Срочно передаю оператору, чтобы помочь с доступом.';
  }
  if (params.lang === 'en') {
    return 'I’m urgently passing this to an operator so they can help with access.';
  }
  return null;
}
