import { getAsiFeedbackBotUsername } from '@/config/publicTelegram';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import {
  isSetupAddressComplete,
  isSetupCheckInComplete,
  isSetupDescriptionComplete,
  isSetupRulesComplete,
  isSetupWifiComplete,
  normalizeSetupData,
  setupDataFromExisting,
  type PropertySetupData,
} from './setup-data';

export type GuestReadinessItemId =
  | 'city'
  | 'address'
  | 'photos'
  | 'wifi'
  | 'checkin'
  | 'rules'
  | 'description';

export type GuestReadinessSetupStep =
  | 'basic'
  | 'address'
  | 'photos'
  | 'wifi'
  | 'checkin'
  | 'rules'
  | 'description';

export interface GuestReadinessItem {
  id: GuestReadinessItemId;
  label: string;
  done: boolean;
  hint: string;
  setupStep: GuestReadinessSetupStep;
  actionHref: string;
  actionLabel: string;
}

export interface ObjectGuestReadiness {
  propertyId: string;
  items: GuestReadinessItem[];
  completedCount: number;
  totalCount: number;
  isReady: boolean;
  nextItem: GuestReadinessItem | null;
  guestTestDeepLink: string;
  guestTestCommand: string;
  statusMessage: string;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function setupHref(propertyId: string, step: GuestReadinessSetupStep): string {
  return `/dashboard/properties/${propertyId}/setup?step=${step}`;
}

export function buildGuestTestDeepLink(propertyId: string): string {
  const username = getAsiFeedbackBotUsername();
  return `https://t.me/${username}?start=${encodeURIComponent(`guest_test_${propertyId.trim()}`)}`;
}

export function buildGuestTestCommand(propertyId: string): string {
  return `/guest_test ${propertyId.trim()}`;
}

function isCityComplete(setup: PropertySetupData, property: OpsProperty | null): boolean {
  return hasText(setup.basic.city) || hasText(property?.city);
}

function isAddressLineComplete(setup: PropertySetupData, property: OpsProperty | null): boolean {
  return hasText(setup.address.line) || hasText(property?.address);
}

function isCheckInInstructionsComplete(setup: PropertySetupData, masterCard: PropertyMasterCard | null): boolean {
  return (
    hasText(setup.checkInOut.checkInInstructions) ||
    hasText(masterCard?.checkInInstructions) ||
    isSetupCheckInComplete(setup)
  );
}

export function computeObjectGuestReadiness(input: {
  propertyId: string;
  property?: OpsProperty | null;
  masterCard?: PropertyMasterCard | null;
  setup?: PropertySetupData | Record<string, unknown> | null;
  media?: PropertyMedia[];
  mediaCount?: number;
}): ObjectGuestReadiness {
  const propertyId = input.propertyId.trim();
  const property = input.property ?? null;
  const masterCard = input.masterCard ?? null;
  const setup = input.setup
    ? normalizeSetupData(input.setup)
    : setupDataFromExisting(property, masterCard);
  const activeMedia = (input.media ?? []).filter((item) => item.status !== 'deleted');
  const mediaCount = input.mediaCount ?? activeMedia.length;

  const cityDone = isCityComplete(setup, property);
  const addressDone = isAddressLineComplete(setup, property);
  const photosDone = mediaCount > 0;
  const wifiDone = isSetupWifiComplete(setup) || hasText(masterCard?.wifiName);
  const checkinDone = isCheckInInstructionsComplete(setup, masterCard);
  const rulesDone = isSetupRulesComplete(setup) || hasText(masterCard?.houseRules);
  const descriptionDone =
    isSetupDescriptionComplete(setup) ||
    hasText(masterCard?.fullDescription) ||
    hasText(masterCard?.shortDescription);

  const items: GuestReadinessItem[] = [
    {
      id: 'city',
      label: 'Город',
      done: cityDone,
      hint: 'Укажите город объекта.',
      setupStep: 'basic',
      actionHref: setupHref(propertyId, 'basic'),
      actionLabel: cityDone ? 'Открыть' : 'Указать город',
    },
    {
      id: 'address',
      label: 'Адрес',
      done: addressDone,
      hint: 'Добавьте точный адрес или понятную локацию.',
      setupStep: 'address',
      actionHref: setupHref(propertyId, 'address'),
      actionLabel: addressDone ? 'Открыть' : 'Указать адрес',
    },
    {
      id: 'photos',
      label: 'Фото',
      done: photosDone,
      hint: 'Добавьте хотя бы одно фото объекта.',
      setupStep: 'photos',
      actionHref: setupHref(propertyId, 'photos'),
      actionLabel: photosDone ? 'Открыть фото' : 'Добавить фото',
    },
    {
      id: 'wifi',
      label: 'Wi-Fi',
      done: wifiDone,
      hint: 'Укажите сеть Wi-Fi или инструкции по доступу.',
      setupStep: 'wifi',
      actionHref: setupHref(propertyId, 'wifi'),
      actionLabel: wifiDone ? 'Открыть Wi-Fi' : 'Добавить Wi-Fi',
    },
    {
      id: 'checkin',
      label: 'Инструкции заезда',
      done: checkinDone,
      hint: 'Опишите, как гость попадает в объект.',
      setupStep: 'checkin',
      actionHref: setupHref(propertyId, 'checkin'),
      actionLabel: checkinDone ? 'Открыть заезд' : 'Добавить инструкции',
    },
    {
      id: 'rules',
      label: 'Правила проживания',
      done: rulesDone,
      hint: 'Заполните основные правила: курение, животные, тихие часы.',
      setupStep: 'rules',
      actionHref: setupHref(propertyId, 'rules'),
      actionLabel: rulesDone ? 'Открыть правила' : 'Добавить правила',
    },
    {
      id: 'description',
      label: 'Описание',
      done: descriptionDone,
      hint: 'Добавьте краткое описание объекта для гостя.',
      setupStep: 'description',
      actionHref: setupHref(propertyId, 'description'),
      actionLabel: descriptionDone ? 'Открыть описание' : 'Добавить описание',
    },
  ];

  const completedCount = items.filter((item) => item.done).length;
  const nextItem = items.find((item) => !item.done) ?? null;
  const isReady = completedCount === items.length;

  const statusMessage = isReady
    ? 'Объект готов к тесту гостя. Можно запустить проверку в Telegram.'
    : nextItem
      ? `Следующий шаг: ${nextItem.label.toLowerCase()}.`
      : 'Заполните данные объекта для теста гостя.';

  return {
    propertyId,
    items,
    completedCount,
    totalCount: items.length,
    isReady,
    nextItem,
    guestTestDeepLink: buildGuestTestDeepLink(propertyId),
    guestTestCommand: buildGuestTestCommand(propertyId),
    statusMessage,
  };
}

export function guestReadinessMissingFieldTokens(items: GuestReadinessItem[]): string[] {
  return items.filter((item) => !item.done).map((item) => item.id);
}

export function formatGuestReadinessBlockersRu(readiness: ObjectGuestReadiness): string {
  const missing = readiness.items.filter((item) => !item.done);
  if (missing.length === 0) return '';
  const labels = missing.map((item) => item.label.toLowerCase()).join(', ');
  return `Для теста гостя не хватает: ${labels}. Заполните данные в личном кабинете: /dashboard/properties/${readiness.propertyId}/setup`;
}
