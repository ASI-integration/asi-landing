import type { CommunicationChannel } from './types';

export type CommunicationChannelReadiness = 'active' | 'foundation' | 'planned';

export type CommunicationChannelFoundation = {
  channel: Extract<CommunicationChannel, 'telegram' | 'email' | 'phone'>;
  labelRu: string;
  modeRu: string;
  dashboardBadgeRu: string;
  readiness: CommunicationChannelReadiness;
  provider: string;
  providerStatus: 'connected' | 'foundation' | 'not_connected';
  summaryRu: string;
  pointsRu: string[];
  countLabelRu: string;
};

export const COMMUNICATION_CHANNEL_FOUNDATION: readonly CommunicationChannelFoundation[] = [
  {
    channel: 'telegram',
    labelRu: 'Telegram',
    modeRu: 'Сообщения',
    dashboardBadgeRu: 'Основной канал сейчас',
    readiness: 'active',
    provider: 'telegram',
    providerStatus: 'connected',
    summaryRu: 'Рабочий канал для сообщений гостей, срочного доступа и передачи оператору.',
    pointsRu: ['сообщения гостей', 'роль и сессия', 'объект и бронь', 'передача оператору'],
    countLabelRu: 'диалогов',
  },
  {
    channel: 'email',
    labelRu: 'Email',
    modeRu: 'Письма гостей',
    dashboardBadgeRu: 'Фундамент / полуавто',
    readiness: 'foundation',
    provider: 'email',
    providerStatus: 'foundation',
    summaryRu: 'Базовый контур для заявок гостей с ручной или полуавто обработкой.',
    pointsRu: ['заявки гостей', 'контекст брони', 'контекст объекта', 'без полного автопилота'],
    countLabelRu: 'диалогов',
  },
  {
    channel: 'phone',
    labelRu: 'Телефон',
    modeRu: 'Голосовые звонки',
    dashboardBadgeRu: 'Следующий этап: подключение телефонии',
    readiness: 'planned',
    provider: 'phone_telephony_placeholder',
    providerStatus: 'not_connected',
    summaryRu: 'Голосовые звонки показаны как следующий этап. Реальная телефония пока не подключена.',
    pointsRu: ['будущий входящий звонок', 'срочный доступ', 'текст звонка в задачу', 'передача оператору'],
    countLabelRu: 'звонков',
  },
] as const;

export function getCommunicationChannelFoundation(
  channel: string,
): CommunicationChannelFoundation | undefined {
  return COMMUNICATION_CHANNEL_FOUNDATION.find((item) => item.channel === channel);
}
