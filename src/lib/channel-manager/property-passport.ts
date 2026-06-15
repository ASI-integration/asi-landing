import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import {
  SETUP_CHANNEL_CATALOG,
  SETUP_CHANNEL_STATUS_LABELS,
  isSetupAddressComplete,
  isSetupBasicComplete,
  isSetupChannelsSelected,
  isSetupCheckInComplete,
  isSetupDescriptionComplete,
  isSetupPricingComplete,
  isSetupRulesComplete,
  isSetupWifiComplete,
  type PropertySetupData,
} from '@/lib/property-setup/setup-data';

export type PassportReadinessId =
  | 'photos'
  | 'basic'
  | 'address'
  | 'description'
  | 'rules'
  | 'checkin'
  | 'wifi'
  | 'pricing'
  | 'channels';

export interface PassportReadinessItem {
  id: PassportReadinessId;
  label: string;
  done: boolean;
  hint: string;
  actionHref: string;
  actionLabel: string;
}

export interface PassportChannel {
  code: string;
  label: string;
  statusLabel: string;
}

export interface PropertyPassportModel {
  propertyId: string;
  title: string;
  location: string;
  description: string;
  rules: string;
  checkInOut: string;
  wifi: string;
  pricing: string;
  selectedChannels: PassportChannel[];
  coverPhoto: PropertyMedia | null;
  thumbnailPhotos: PropertyMedia[];
  readinessItems: PassportReadinessItem[];
  completedCount: number;
  totalCount: number;
  isReady: boolean;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.map(clean).find(Boolean) ?? '';
}

function joinFilled(parts: string[], separator = ' · '): string {
  return parts.map(clean).filter(Boolean).join(separator);
}

function line(label: string, value: string | null | undefined): string | null {
  const cleaned = clean(value);
  return cleaned ? `${label}: ${cleaned}` : null;
}

function fallback(value: string, emptyText: string): string {
  return value || emptyText;
}

function setupHref(propertyId: string, step: string): string {
  return `/dashboard/properties/${propertyId}/setup?step=${step}`;
}

function buildRules(setup: PropertySetupData, masterCard: PropertyMasterCard | null): string {
  const setupRules = [
    line('Курение', setup.rules.smoking),
    line('Животные', setup.rules.pets),
    line('Вечеринки', setup.rules.parties),
    line('Дети', setup.rules.children),
    line('Депозит', setup.rules.deposit || masterCard?.depositInfo),
    line('Документы', setup.rules.documents),
    line('Тихие часы', setup.rules.quietHours),
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');

  return setupRules || clean(masterCard?.houseRules);
}

function buildCheckInOut(setup: PropertySetupData, masterCard: PropertyMasterCard | null): string {
  return [
    line('Заезд', setup.checkInOut.checkInTime),
    line('Выезд', setup.checkInOut.checkOutTime),
    line('Инструкция заезда', setup.checkInOut.checkInInstructions || masterCard?.checkInInstructions),
    line('Инструкция выезда', setup.checkInOut.checkOutInstructions || masterCard?.checkOutInstructions),
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

function buildWifi(setup: PropertySetupData, masterCard: PropertyMasterCard | null): string {
  const passwordFilled = Boolean(clean(setup.wifi.wifiPassword || masterCard?.wifiPassword));
  return [
    line('Сеть', setup.wifi.wifiName || masterCard?.wifiName),
    passwordFilled ? 'Пароль: заполнен' : null,
    line('Как попасть в объект', setup.wifi.entryInstructions),
    line('Ключи и код', setup.wifi.keysInfo),
    line('Бытовые инструкции', setup.wifi.householdInstructions),
    line('Парковка', masterCard?.parkingInfo),
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

function buildPricing(setup: PropertySetupData, masterCard: PropertyMasterCard | null): string {
  return [
    line('Базовая цена за ночь', setup.pricing.basePricePerNight ? `${setup.pricing.basePricePerNight} ₽` : ''),
    line('Минимум ночей', setup.pricing.minNights),
    line('Доплата за гостя', setup.pricing.extraGuestFee ? `${setup.pricing.extraGuestFee} ₽` : ''),
    line('Уборка', setup.pricing.cleaningFee ? `${setup.pricing.cleaningFee} ₽` : ''),
    line('Депозит', setup.pricing.deposit ? `${setup.pricing.deposit} ₽` : masterCard?.depositInfo),
    line('Доплаты', masterCard?.extraFeesInfo),
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

function buildSelectedChannels(setup: PropertySetupData): PassportChannel[] {
  return setup.channels
    .filter((channel) => channel.status !== 'not_connected')
    .map((selection) => {
      const channel = SETUP_CHANNEL_CATALOG.find((item) => item.code === selection.code);
      return {
        code: selection.code,
        label: channel?.label ?? selection.code,
        statusLabel: SETUP_CHANNEL_STATUS_LABELS[selection.status],
      };
    });
}

export function buildPropertyPassportModel({
  property,
  masterCard,
  setup,
  media,
}: {
  property: OpsProperty;
  masterCard: PropertyMasterCard | null;
  setup: PropertySetupData;
  media: PropertyMedia[];
}): PropertyPassportModel {
  const activeMedia = media
    .filter((item) => item.status !== 'deleted')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const coverPhoto = activeMedia.find((item) => item.isCover) ?? activeMedia[0] ?? null;
  const thumbnailPhotos = coverPhoto ? activeMedia.filter((item) => item.id !== coverPhoto.id) : activeMedia;
  const selectedChannels = buildSelectedChannels(setup);

  const title = firstText(setup.basic.title, masterCard?.publicTitle, property.title);
  const location = joinFilled([
    firstText(setup.basic.city, property.city),
    firstText(setup.address.line, property.address),
    setup.address.district,
  ]);
  const description = firstText(
    setup.description.full,
    masterCard?.fullDescription,
    setup.description.shortForOta,
    setup.basic.shortSummary,
    masterCard?.shortDescription,
  );
  const rules = buildRules(setup, masterCard);
  const checkInOut = buildCheckInOut(setup, masterCard);
  const wifi = buildWifi(setup, masterCard);
  const pricing = buildPricing(setup, masterCard);

  const readinessItems: PassportReadinessItem[] = [
    {
      id: 'photos',
      label: 'Фото объекта',
      done: activeMedia.length > 0,
      hint: 'Добавьте главное фото и остальные снимки объекта.',
      actionHref: setupHref(property.id, 'photos'),
      actionLabel: activeMedia.length > 0 ? 'Открыть фото' : 'Добавить фото',
    },
    {
      id: 'basic',
      label: 'Название и город',
      done: isSetupBasicComplete(setup),
      hint: 'Укажите название объекта и город.',
      actionHref: setupHref(property.id, 'basic'),
      actionLabel: isSetupBasicComplete(setup) ? 'Открыть данные' : 'Заполнить',
    },
    {
      id: 'address',
      label: 'Адрес',
      done: isSetupAddressComplete(setup),
      hint: 'Добавьте точный адрес или понятную локацию.',
      actionHref: setupHref(property.id, 'address'),
      actionLabel: isSetupAddressComplete(setup) ? 'Открыть адрес' : 'Указать адрес',
    },
    {
      id: 'description',
      label: 'Описание',
      done: isSetupDescriptionComplete(setup),
      hint: 'Добавьте описание, которое можно использовать в карточках каналов.',
      actionHref: setupHref(property.id, 'description'),
      actionLabel: isSetupDescriptionComplete(setup) ? 'Открыть описание' : 'Заполнить описание',
    },
    {
      id: 'rules',
      label: 'Правила',
      done: isSetupRulesComplete(setup),
      hint: 'Заполните правила проживания: курение, животные, депозит и тихие часы.',
      actionHref: setupHref(property.id, 'rules'),
      actionLabel: isSetupRulesComplete(setup) ? 'Открыть правила' : 'Добавить правила',
    },
    {
      id: 'checkin',
      label: 'Заезд и выезд',
      done: isSetupCheckInComplete(setup),
      hint: 'Укажите время заезда, выезда и инструкции для гостя.',
      actionHref: setupHref(property.id, 'checkin'),
      actionLabel: isSetupCheckInComplete(setup) ? 'Открыть заезд' : 'Указать время',
    },
    {
      id: 'wifi',
      label: 'Wi-Fi и инструкции',
      done: isSetupWifiComplete(setup),
      hint: 'Добавьте сеть Wi-Fi, доступ в объект или бытовые инструкции.',
      actionHref: setupHref(property.id, 'wifi'),
      actionLabel: isSetupWifiComplete(setup) ? 'Открыть Wi-Fi' : 'Добавить Wi-Fi',
    },
    {
      id: 'pricing',
      label: 'Цены',
      done: isSetupPricingComplete(setup),
      hint: 'Укажите базовую цену за ночь и основные доплаты.',
      actionHref: setupHref(property.id, 'pricing'),
      actionLabel: isSetupPricingComplete(setup) ? 'Открыть цены' : 'Указать цены',
    },
    {
      id: 'channels',
      label: 'Каналы',
      done: isSetupChannelsSelected(setup),
      hint: 'Выберите каналы, для которых нужно подготовить карточку.',
      actionHref: setupHref(property.id, 'channels'),
      actionLabel: isSetupChannelsSelected(setup) ? 'Открыть каналы' : 'Выбрать каналы',
    },
  ];

  const completedCount = readinessItems.filter((item) => item.done).length;

  return {
    propertyId: property.id,
    title: fallback(title, 'Название не указано'),
    location: fallback(location, 'Локация не указана'),
    description: fallback(description, 'Описание пока не заполнено.'),
    rules: fallback(rules, 'Правила пока не заполнены.'),
    checkInOut: fallback(checkInOut, 'Заезд и выезд пока не заполнены.'),
    wifi: fallback(wifi, 'Wi-Fi и инструкции пока не заполнены.'),
    pricing: fallback(pricing, 'Цены пока не указаны.'),
    selectedChannels,
    coverPhoto,
    thumbnailPhotos,
    readinessItems,
    completedCount,
    totalCount: readinessItems.length,
    isReady: completedCount === readinessItems.length,
  };
}
