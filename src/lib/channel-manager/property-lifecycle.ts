import type { OpsProperty, PropertyMasterCard } from '@/lib/ops-foundation/types';
import {
  isSetupChannelsSelected,
  isSetupCheckInComplete,
  isSetupDescriptionComplete,
  isSetupPricingComplete,
  isSetupRulesComplete,
  isSetupUnitsComplete,
  isSetupWifiComplete,
  type PropertySetupData,
} from '@/lib/property-setup/setup-data';
import type { ChannelManagerChannel } from './types';

export type ChannelManagerPropertyStatus =
  | 'draft'
  | 'info_required'
  | 'photos_required'
  | 'ready_for_mapping'
  | 'channels_pending'
  | 'shadow_mode'
  | 'ready_for_activation'
  | 'active'
  | 'attention_required';

export type PreparationStepId =
  | 'basic_info'
  | 'address'
  | 'units'
  | 'photos'
  | 'description'
  | 'house_rules'
  | 'check_in_out'
  | 'wifi_instructions'
  | 'pricing'
  | 'channels'
  | 'readiness_check';

export interface PreparationStep {
  id: PreparationStepId;
  title: string;
  description: string;
  done: boolean;
  actionHref?: string;
  actionLabel?: string;
}

export interface PropertyReadinessInput {
  property: OpsProperty | null;
  masterCard: PropertyMasterCard | null;
  mediaCount: number;
  channels: ChannelManagerChannel[];
  conflictCount: number;
  discrepancyCount: number;
  setupProfile?: PropertySetupData | null;
}

/** Шаги мастера данных объекта для каналов (/dashboard/properties/[id]/setup). */
export const PREPARATION_STEP_ANCHORS: Record<PreparationStepId, string> = {
  basic_info: 'basic',
  address: 'address',
  units: 'units',
  photos: 'photos',
  description: 'description',
  house_rules: 'rules',
  check_in_out: 'checkin',
  wifi_instructions: 'wifi',
  pricing: 'pricing',
  channels: 'channels',
  readiness_check: 'readiness',
};

export interface PropertyReadiness {
  status: ChannelManagerPropertyStatus;
  statusLabel: string;
  statusMessage: string;
  steps: PreparationStep[];
  completedStepCount: number;
  totalStepCount: number;
}

export const channelManagerPropertyStatusLabels: Record<ChannelManagerPropertyStatus, string> = {
  draft: 'Черновик',
  info_required: 'Нужна информация',
  photos_required: 'Нужны фото',
  ready_for_mapping: 'Готов к сопоставлению',
  channels_pending: 'Подключение каналов',
  shadow_mode: 'Теневой режим',
  ready_for_activation: 'Готов к запуску',
  active: 'Работает',
  attention_required: 'Нужно ваше действие',
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function isApiLikeChannel(channel: ChannelManagerChannel): boolean {
  return channel.integrationType === 'api' || channel.integrationType === 'partner_channel_manager_api';
}

export function buildPreparationSteps(input: PropertyReadinessInput): PreparationStep[] {
  const propertyId = input.property?.id;
  const setup = input.setupProfile ?? null;
  const setupBase = propertyId ? `/dashboard/properties/${propertyId}/setup` : null;
  const hrefFor = (id: PreparationStepId): string =>
    setupBase ? `${setupBase}?step=${PREPARATION_STEP_ANCHORS[id]}` : '/dashboard/properties';

  const basicInfoDone =
    Boolean(input.property?.title?.trim()) || Boolean(setup && hasText(setup.basic.title));
  const addressDone =
    (hasText(input.property?.address) && hasText(input.property?.city)) ||
    Boolean(setup && hasText(setup.address.line) && hasText(setup.basic.city));
  const unitsDone = setup ? isSetupUnitsComplete(setup) : Boolean(input.property);
  const photosDone = input.mediaCount > 0;
  const descriptionDone =
    hasText(input.masterCard?.shortDescription) ||
    hasText(input.masterCard?.fullDescription) ||
    Boolean(setup && isSetupDescriptionComplete(setup));
  const houseRulesDone =
    hasText(input.masterCard?.houseRules) || Boolean(setup && isSetupRulesComplete(setup));
  const checkInOutDone =
    (hasText(input.masterCard?.checkInInstructions) && hasText(input.masterCard?.checkOutInstructions)) ||
    Boolean(setup && isSetupCheckInComplete(setup));
  const wifiDone =
    hasText(input.masterCard?.wifiName) ||
    hasText(input.masterCard?.checkInInstructions) ||
    hasText(input.masterCard?.parkingInfo) ||
    Boolean(setup && isSetupWifiComplete(setup));
  // Цены и каналы — подготовительные данные владельца, без реального подключения OTA.
  const pricingDone = Boolean(setup && isSetupPricingComplete(setup));
  const channelsDone = Boolean(setup && isSetupChannelsSelected(setup));
  const readinessCheckDone =
    basicInfoDone &&
    addressDone &&
    photosDone &&
    descriptionDone &&
    houseRulesDone &&
    checkInOutDone &&
    wifiDone &&
    pricingDone &&
    channelsDone;

  return [
    {
      id: 'basic_info',
      title: 'Основная информация об объекте',
      description: 'Название, город и базовые параметры размещения.',
      done: basicInfoDone,
      actionHref: hrefFor('basic_info'),
      actionLabel: basicInfoDone ? 'Изменить' : 'Заполнить',
    },
    {
      id: 'address',
      title: 'Адрес',
      description: 'Точный адрес нужен для карточек каналов и инструкций гостю.',
      done: addressDone,
      actionHref: hrefFor('address'),
      actionLabel: addressDone ? 'Изменить' : 'Указать адрес',
    },
    {
      id: 'units',
      title: 'Категории и номера',
      description: 'Опишите юниты и категории — ASI соберёт структуру объекта.',
      done: unitsDone,
      actionHref: hrefFor('units'),
      actionLabel: 'Открыть',
    },
    {
      id: 'photos',
      title: 'Фото',
      description: 'Загрузите фото для карточек на площадках.',
      done: photosDone,
      actionHref: hrefFor('photos'),
      actionLabel: photosDone ? 'Изменить' : 'Добавить фото',
    },
    {
      id: 'description',
      title: 'Описание',
      description: 'Краткое и полное описание для гостей и каналов продаж.',
      done: descriptionDone,
      actionHref: hrefFor('description'),
      actionLabel: descriptionDone ? 'Изменить' : 'Заполнить описание',
    },
    {
      id: 'house_rules',
      title: 'Правила проживания',
      description: 'Тихий час, курение, животные и другие правила.',
      done: houseRulesDone,
      actionHref: hrefFor('house_rules'),
      actionLabel: houseRulesDone ? 'Изменить' : 'Добавить правила',
    },
    {
      id: 'check_in_out',
      title: 'Заезд и выезд',
      description: 'Время и инструкции по заселению и выезду.',
      done: checkInOutDone,
      actionHref: hrefFor('check_in_out'),
      actionLabel: checkInOutDone ? 'Изменить' : 'Указать время',
    },
    {
      id: 'wifi_instructions',
      title: 'Wi‑Fi и инструкции',
      description: 'Сеть, пароль, доступ в объект и бытовые детали для гостя.',
      done: wifiDone,
      actionHref: hrefFor('wifi_instructions'),
      actionLabel: wifiDone ? 'Изменить' : 'Добавить инструкции',
    },
    {
      id: 'pricing',
      title: 'Цены и базовый тариф',
      description: 'Базовая цена за ночь и условия — ASI подготовит тарифы для каналов.',
      done: pricingDone,
      actionHref: hrefFor('pricing'),
      actionLabel: pricingDone ? 'Изменить' : 'Указать цены',
    },
    {
      id: 'channels',
      title: 'Каналы для подключения',
      description: 'Выберите площадки и подготовьте доступы — без включения реальных продаж.',
      done: channelsDone,
      actionHref: hrefFor('channels'),
      actionLabel: channelsDone ? 'Изменить' : 'Выбрать каналы',
    },
    {
      id: 'readiness_check',
      title: 'Проверка готовности',
      description: 'Финальная проверка перед теневым режимом и запуском.',
      done: readinessCheckDone,
      actionHref: hrefFor('readiness_check'),
      actionLabel: 'Проверить',
    },
  ];
}

export function computePropertyReadiness(input: PropertyReadinessInput): PropertyReadiness {
  const steps = buildPreparationSteps(input);
  const completedStepCount = steps.filter((step) => step.done).length;
  const totalStepCount = steps.length;

  if (input.conflictCount > 0 || input.discrepancyCount > 0) {
    return {
      status: 'attention_required',
      statusLabel: channelManagerPropertyStatusLabels.attention_required,
      statusMessage:
        'ASI обнаружил конфликт или расхождение. Проверьте предупреждения — ручное вмешательство нужно только здесь.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  const apiChannels = input.channels.filter(isApiLikeChannel);
  const hasActiveSell = apiChannels.some(
    (channel) => channel.syncMode === 'active' && channel.isAutoSellEnabled,
  );
  const hasShadow = apiChannels.some((channel) => channel.syncMode === 'shadow');
  const hasConnectedChannel = apiChannels.some(
    (channel) => channel.syncMode !== 'disabled' && channel.status !== 'planned',
  );
  const needsCredentials = apiChannels.some(
    (channel) => channel.status === 'ready_for_credentials' || channel.status === 'planned',
  );

  if (!input.property) {
    return {
      status: 'draft',
      statusLabel: channelManagerPropertyStatusLabels.draft,
      statusMessage: 'Сначала создайте объект — ASI подготовит его для каналов продаж.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  if (!steps.find((step) => step.id === 'basic_info')?.done || !steps.find((step) => step.id === 'address')?.done) {
    return {
      status: 'info_required',
      statusLabel: channelManagerPropertyStatusLabels.info_required,
      statusMessage: 'Заполните основную информацию и адрес — ASI соберёт карточку объекта.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  if (!steps.find((step) => step.id === 'photos')?.done) {
    return {
      status: 'photos_required',
      statusLabel: channelManagerPropertyStatusLabels.photos_required,
      statusMessage: 'Добавьте фото объекта — без них каналы не примут карточку.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  if (completedStepCount < totalStepCount - 1) {
    return {
      status: 'ready_for_mapping',
      statusLabel: channelManagerPropertyStatusLabels.ready_for_mapping,
      statusMessage: 'ASI структурирует данные объекта и готовит сопоставление с каналами.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  if (needsCredentials || !hasConnectedChannel) {
    return {
      status: 'channels_pending',
      statusLabel: channelManagerPropertyStatusLabels.channels_pending,
      statusMessage: 'Объект подключается: передайте доступы к каналам, ASI завершит настройку.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  if (hasActiveSell) {
    return {
      status: 'active',
      statusLabel: channelManagerPropertyStatusLabels.active,
      statusMessage: 'Каналы работают. ASI синхронизирует доступность и принимает брони автоматически.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  if (hasShadow) {
    return {
      status: 'shadow_mode',
      statusLabel: channelManagerPropertyStatusLabels.shadow_mode,
      statusMessage:
        'Теневой режим: ASI сверяет данные с каналами, но не меняет продажи на площадках.',
      steps,
      completedStepCount,
      totalStepCount,
    };
  }

  return {
    status: 'ready_for_activation',
    statusLabel: channelManagerPropertyStatusLabels.ready_for_activation,
    statusMessage: 'Объект готов к запуску. ASI может включить синхронизацию после финальной проверки.',
    steps,
    completedStepCount,
    totalStepCount,
  };
}
