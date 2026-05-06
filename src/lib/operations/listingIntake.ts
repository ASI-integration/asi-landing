import type {
  ChannelListingMetadata,
  ChannelManagerDistributionTarget,
  ListingIntakeDraftInput,
  ListingIntakeValidationResult,
  ListingMediaAsset,
  MaintenanceContact,
  PropertyListingIntake,
} from './types';

const defaultDistributionTargets: ChannelManagerDistributionTarget[] = [
  {
    id: 'target-avito',
    channelId: 'avito',
    channelNameRu: 'Авито',
    syncStatus: 'ready',
    connected: true,
    nextActionRu: 'Поставить карточку в очередь публикации',
    syncedFieldsRu: [],
    pendingFieldsRu: ['Описание', 'Фото', 'Правила', 'Доступы'],
  },
  {
    id: 'target-ostrovok',
    channelId: 'ostrovok',
    channelNameRu: 'Островок',
    syncStatus: 'queued',
    connected: true,
    nextActionRu: 'Ожидает отправку package в демо-очереди',
    syncedFieldsRu: ['Название'],
    pendingFieldsRu: ['Фото', 'Удобства', 'Инструкции заезда'],
  },
  {
    id: 'target-yandex-travel',
    channelId: 'yandex_travel',
    channelNameRu: 'Яндекс Путешествия',
    syncStatus: 'ready',
    connected: true,
    nextActionRu: 'Готово к отправке после подтверждения оператора',
    syncedFieldsRu: [],
    pendingFieldsRu: ['Полная карточка объекта'],
  },
  {
    id: 'target-sutochno',
    channelId: 'sutochno',
    channelNameRu: 'Суточно',
    syncStatus: 'syncing',
    connected: true,
    nextActionRu: 'Демо-синхронизация полей карточки',
    syncedFieldsRu: ['Описание', 'Правила'],
    pendingFieldsRu: ['Фото', 'Контакты'],
  },
  {
    id: 'target-booking-ical',
    channelId: 'booking_ical',
    channelNameRu: 'Booking / iCal placeholder',
    syncStatus: 'draft',
    connected: false,
    nextActionRu: 'Позже подключить iCal availability bridge',
    syncedFieldsRu: [],
    pendingFieldsRu: ['Календарь доступности', 'ID внешнего листинга'],
  },
];

function cloneDistributionTargets() {
  return defaultDistributionTargets.map((target) => ({
    ...target,
    syncedFieldsRu: [...target.syncedFieldsRu],
    pendingFieldsRu: [...target.pendingFieldsRu],
  }));
}

function toMediaAssets(photoTitlesRu: string[] = []): ListingMediaAsset[] {
  return photoTitlesRu
    .filter((title) => title.trim().length > 0)
    .map((title, index) => ({
      id: `draft-photo-${index + 1}`,
      kind: 'photo',
      titleRu: title.trim(),
      url: `/operations/mock/draft-photo-${index + 1}.jpg`,
      altRu: `Демо-фото объекта: ${title.trim()}`,
      status: 'uploaded',
      distributionReady: true,
    }));
}

function toMaintenanceContact(input?: Partial<MaintenanceContact>): MaintenanceContact[] {
  if (!input || (!input.nameRu && !input.phoneRu && !input.roleRu)) return [];

  return [
    {
      id: input.id ?? 'draft-maintenance-contact',
      roleRu: input.roleRu ?? 'Домашний мастер',
      nameRu: input.nameRu ?? '',
      phoneRu: input.phoneRu ?? '',
      availabilityRu: input.availabilityRu ?? 'По заявке',
    },
  ];
}

function createChannelMetadata(propertyNameRu: string): ChannelListingMetadata[] {
  return defaultDistributionTargets.map((target) => ({
    channelId: target.channelId,
    titleRu: propertyNameRu || 'Новая карточка объекта',
    commissionRu: target.channelId === 'booking_ical' ? 'availability only' : 'по тарифу площадки',
    minStayNights: 1,
    instantBookEnabled: false,
  }));
}

export function validateListingIntakeDraft(listing: PropertyListingIntake): ListingIntakeValidationResult {
  const missingFieldsRu: string[] = [];

  if (!listing.propertyNameRu.trim()) missingFieldsRu.push('Название объекта');
  if (!listing.cityRu.trim()) missingFieldsRu.push('Город');
  if (!listing.addressRu.trim()) missingFieldsRu.push('Адрес');
  if (!listing.descriptionRu.trim()) missingFieldsRu.push('Описание');
  if (listing.amenitiesRu.length === 0) missingFieldsRu.push('Удобства');
  if (listing.houseRulesRu.length === 0) missingFieldsRu.push('Правила дома');
  if (listing.checkInInstructionsRu.length === 0) missingFieldsRu.push('Инструкции заезда');
  if (listing.checkOutInstructionsRu.length === 0) missingFieldsRu.push('Инструкции выезда');
  if (listing.accessInfoRu.length === 0) missingFieldsRu.push('Доступы и ключи');
  if (listing.cleaningRulesRu.length === 0) missingFieldsRu.push('Правила клининга');
  if (listing.maintenanceContacts.length === 0) missingFieldsRu.push('Контакт мастера');
  if (listing.maintenanceContacts.some((contact) => !contact.nameRu.trim() || !contact.phoneRu.trim())) {
    missingFieldsRu.push('Имя и телефон мастера');
  }
  if (!listing.media.some((asset) => asset.kind === 'photo' && asset.distributionReady)) {
    missingFieldsRu.push('Фото объекта');
  }

  return {
    isValid: missingFieldsRu.length === 0,
    missingFieldsRu,
  };
}

export function createListingIntakeDraft(input: ListingIntakeDraftInput = {}): PropertyListingIntake {
  const propertyNameRu = input.propertyNameRu ?? '';
  const draft: PropertyListingIntake = {
    id: input.id ?? 'listing-draft-demo',
    ownerNameRu: input.ownerNameRu ?? 'Демо-собственник',
    propertyNameRu,
    cityRu: input.cityRu ?? '',
    addressRu: input.addressRu ?? '',
    propertyTypeRu: input.propertyTypeRu ?? 'Квартира',
    capacityRu: input.capacityRu ?? '2 гостя',
    descriptionRu: input.descriptionRu ?? '',
    amenitiesRu: input.amenitiesRu ?? [],
    houseRulesRu: input.houseRulesRu ?? [],
    checkInInstructionsRu: input.checkInInstructionsRu ?? [],
    checkOutInstructionsRu: input.checkOutInstructionsRu ?? [],
    accessInfoRu: input.accessInfoRu ?? [],
    cleaningRulesRu: input.cleaningRulesRu ?? [],
    maintenanceContacts: toMaintenanceContact(input.maintenanceContact),
    media: toMediaAssets(input.photoTitlesRu),
    channelMetadata: createChannelMetadata(propertyNameRu),
    distributionTargets: cloneDistributionTargets(),
    intakeStatus: 'draft',
    auditEvents: [
      {
        id: 'draft-created',
        atRu: 'демо',
        actor: 'partner',
        titleRu: 'Создан intake draft',
        detailRu: 'Поля формы собраны в единую карточку объекта.',
        status: 'active',
      },
    ],
  };

  return {
    ...draft,
    intakeStatus: validateListingIntakeDraft(draft).isValid ? 'ready' : 'draft',
  };
}
