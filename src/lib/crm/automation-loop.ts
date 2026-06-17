import { buildPropertyPassportModel } from '@/lib/channel-manager/property-passport';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import {
  buildGuestTestDeepLink,
  computeObjectGuestReadiness,
  type GuestReadinessItem,
} from '@/lib/property-setup/object-guest-readiness';
import { normalizeSetupData, setupDataFromExisting, type PropertySetupData } from '@/lib/property-setup/setup-data';
import type { CrmRole, CrmStatus } from './types';

export type CrmMissingDataAction = {
  field: string;
  label: string;
  setupStep: string;
  setupHref: string | null;
};

export type CrmPropertyReadinessItem = {
  id: string;
  label: string;
  done: boolean;
  hint: string;
  actionHref: string;
  actionLabel: string;
};

export type CrmPropertyAutomationSummary = {
  id: string;
  title: string;
  location: string;
  readinessCompleted: number;
  readinessTotal: number;
  isPassportReady: boolean;
  isOperationallyReady: boolean;
  setupHref: string;
  channelManagerHref: string;
  guestTestHref: string;
  readinessItems: CrmPropertyReadinessItem[];
  missingOperationalItems: CrmPropertyReadinessItem[];
};

export type CrmAutomationSuggestion = {
  effectiveStatus: CrmStatus;
  suggestedNextAction: string;
  nextActionHref: string | null;
  nextActionIsSuggested: boolean;
};

const FIELD_TO_SETUP_STEP: Array<{
  tokens: string[];
  label: string;
  setupStep: string;
}> = [
  {
    tokens: ['photo', 'photos', 'media', 'image'],
    label: 'Фото объекта',
    setupStep: 'photos',
  },
  {
    tokens: ['address', 'object.address', 'property.address', 'location'],
    label: 'Адрес объекта',
    setupStep: 'address',
  },
  {
    tokens: ['direction', 'directions', 'directionstext', 'access', 'accessnote'],
    label: 'Инструкции по заезду',
    setupStep: 'checkin',
  },
  {
    tokens: ['checkin', 'check_in', 'checkininstructions', 'check_in_instructions'],
    label: 'Инструкции по заезду',
    setupStep: 'checkin',
  },
  {
    tokens: ['wifipassword', 'wifi_password', 'password'],
    label: 'Пароль Wi-Fi',
    setupStep: 'wifi',
  },
  {
    tokens: ['wifi', 'wi-fi', 'wifiname', 'wifi_name'],
    label: 'Название Wi-Fi',
    setupStep: 'wifi',
  },
  {
    tokens: ['rules', 'house_rules', 'houserules'],
    label: 'Правила проживания',
    setupStep: 'rules',
  },
  {
    tokens: ['name', 'title', 'object.name', 'property.name'],
    label: 'Название объекта',
    setupStep: 'basic',
  },
];

function setupHref(propertyId: string | null | undefined, step: string): string | null {
  return propertyId ? `/dashboard/properties/${propertyId}/setup?step=${step}` : null;
}

function guestTestHref(propertyId: string): string {
  return buildGuestTestDeepLink(propertyId);
}

function normalizeFieldToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

function findMissingFieldDescriptor(field: string) {
  const normalized = normalizeFieldToken(field);
  return FIELD_TO_SETUP_STEP.find((item) => item.tokens.some((token) => normalized.includes(token)));
}

export function missingDataActionsForFields(
  fields: string[],
  propertyId?: string | null,
): CrmMissingDataAction[] {
  const byKey = new Map<string, CrmMissingDataAction>();

  for (const rawField of fields) {
    const field = rawField.trim();
    if (!field) continue;

    const descriptor = findMissingFieldDescriptor(field);
    const setupStep = descriptor?.setupStep ?? 'basic';
    const label = descriptor?.label ?? field;
    const key = `${setupStep}:${label}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        field,
        label,
        setupStep,
        setupHref: setupHref(propertyId, setupStep),
      });
    }
  }

  return [...byKey.values()];
}

export function buildCrmPropertyAutomationSummary(input: {
  property: OpsProperty;
  masterCard: PropertyMasterCard | null;
  setup?: PropertySetupData | Record<string, unknown> | null;
  media: PropertyMedia[];
}): CrmPropertyAutomationSummary {
  const setup = input.setup
    ? normalizeSetupData(input.setup)
    : setupDataFromExisting(input.property, input.masterCard);
  const passport = buildPropertyPassportModel({
    property: input.property,
    masterCard: input.masterCard,
    setup,
    media: input.media,
  });
  const guestReadiness = computeObjectGuestReadiness({
    propertyId: input.property.id,
    property: input.property,
    masterCard: input.masterCard,
    setup,
    media: input.media,
  });
  const missingOperationalItems: CrmPropertyReadinessItem[] = guestReadiness.items
    .filter((item) => !item.done)
    .map((item) => mapGuestItemToCrmItem(item));
  const readinessItems: CrmPropertyReadinessItem[] = guestReadiness.items.map((item) =>
    mapGuestItemToCrmItem(item),
  );

  return {
    id: input.property.id,
    title: passport.title,
    location: passport.location,
    readinessCompleted: guestReadiness.completedCount,
    readinessTotal: guestReadiness.totalCount,
    isPassportReady: passport.isReady,
    isOperationallyReady: guestReadiness.isReady,
    setupHref: `/dashboard/properties/${input.property.id}/setup`,
    channelManagerHref: `/dashboard/channel-manager?property=${input.property.id}`,
    guestTestHref: guestTestHref(input.property.id),
    readinessItems,
    missingOperationalItems,
  };
}

function mapGuestItemToCrmItem(item: GuestReadinessItem): CrmPropertyReadinessItem {
  return {
    id: item.id as CrmPropertyReadinessItem['id'],
    label: item.label,
    done: item.done,
    hint: item.hint,
    actionHref: item.actionHref,
    actionLabel: item.actionLabel,
  };
}

function nextActionForMissingItem(item: CrmPropertyReadinessItem): { text: string; href: string | null } {
  if (item.id === 'photos') {
    return { text: 'Добавить фото объекта', href: item.actionHref };
  }
  if (item.id === 'address' || item.id === 'city') {
    return { text: 'Заполнить адрес и город', href: item.actionHref };
  }
  if (item.id === 'checkin') {
    return { text: 'Добавить инструкции по заезду', href: item.actionHref };
  }
  if (item.id === 'wifi') {
    return { text: 'Добавить данные Wi-Fi', href: item.actionHref };
  }
  if (item.id === 'rules') {
    return { text: 'Добавить правила проживания', href: item.actionHref };
  }
  if (item.id === 'description') {
    return { text: 'Добавить описание объекта', href: item.actionHref };
  }
  return { text: item.actionLabel, href: item.actionHref };
}

export function deriveCrmAutomationSuggestion(input: {
  role: CrmRole;
  status: CrmStatus;
  source: string;
  contact?: string | null;
  telegramDisplay?: string | null;
  propertyId: string | null;
  explicitNextAction: string;
  propertySummary?: CrmPropertyAutomationSummary | null;
  missingDataActions?: CrmMissingDataAction[];
  hasOpenReaction?: boolean;
}): CrmAutomationSuggestion {
  let effectiveStatus = input.status;
  const hasOpenReaction = Boolean(input.hasOpenReaction || input.missingDataActions?.length);

  if (hasOpenReaction) {
    effectiveStatus = 'needs_reaction';
  } else if (input.status === 'pilot_selected' && input.propertySummary?.isOperationallyReady) {
    effectiveStatus = 'object_filled';
  } else if (input.status === 'pilot_selected' && input.propertyId) {
    effectiveStatus = 'creating_object';
  } else if (input.status === 'pilot_candidate' || input.status === 'pilot_selected' || input.status === 'pilot_waitlist') {
    effectiveStatus = input.status;
  } else if (input.status === 'testing_communication' || input.source === 'test') {
    effectiveStatus = 'testing_communication';
  } else if (input.propertySummary?.isOperationallyReady) {
    effectiveStatus = 'object_filled';
  } else if (input.propertyId) {
    effectiveStatus = 'creating_object';
  } else if (input.role === 'owner' || input.role === 'manager') {
    effectiveStatus = 'qualified';
  } else if (input.role === 'lead') {
    effectiveStatus = 'new';
  }

  const explicit = input.explicitNextAction.trim();
  const stalePilotAction =
    input.status === 'pilot_selected' &&
    (explicit === 'Оценить кандидата в пилот' ||
      explicit === 'Уточнить Telegram для подключения' ||
      explicit === 'Уточнить наличие реального объекта' ||
      explicit === 'Выбрать в пилот и предложить создать объект');
  if (explicit && !stalePilotAction) {
    return {
      effectiveStatus,
      suggestedNextAction: explicit,
      nextActionHref: null,
      nextActionIsSuggested: false,
    };
  }

  if (input.status === 'pilot_waitlist') {
    return {
      effectiveStatus,
      suggestedNextAction: 'Вернуться к кандидату, когда появится место в пилоте',
      nextActionHref: null,
      nextActionIsSuggested: true,
    };
  }

  if (input.status === 'pilot_candidate' && !input.telegramDisplay && !input.contact?.trim()) {
    return {
      effectiveStatus,
      suggestedNextAction: 'Уточнить Telegram для подключения',
      nextActionHref: null,
      nextActionIsSuggested: true,
    };
  }

  if (input.status === 'pilot_candidate' && (input.role === 'owner' || input.role === 'manager') && !input.propertyId) {
    return {
      effectiveStatus,
      suggestedNextAction: 'Выбрать в пилот и предложить создать объект',
      nextActionHref: null,
      nextActionIsSuggested: true,
    };
  }

  if (input.status === 'pilot_candidate') {
    return {
      effectiveStatus,
      suggestedNextAction: 'Оценить кандидата в пилот',
      nextActionHref: null,
      nextActionIsSuggested: true,
    };
  }

  if (input.status === 'pilot_selected' && !input.propertyId) {
    return {
      effectiveStatus,
      suggestedNextAction: 'Предложить создать объект',
      nextActionHref: '/dashboard/properties',
      nextActionIsSuggested: true,
    };
  }

  const firstMissingDataAction = input.missingDataActions?.[0];
  if (firstMissingDataAction) {
    return {
      effectiveStatus,
      suggestedNextAction: `Заполнить: ${firstMissingDataAction.label}`,
      nextActionHref: firstMissingDataAction.setupHref,
      nextActionIsSuggested: true,
    };
  }

  if (input.role === 'lead') {
    return {
      effectiveStatus,
      suggestedNextAction: 'Уточнить количество объектов и формат работы',
      nextActionHref: null,
      nextActionIsSuggested: true,
    };
  }

  if ((input.role === 'owner' || input.role === 'manager') && !input.propertyId) {
    return {
      effectiveStatus,
      suggestedNextAction: 'Создать или выбрать объект',
      nextActionHref: '/dashboard/properties',
      nextActionIsSuggested: true,
    };
  }

  const firstMissingOperationalItem = input.propertySummary?.missingOperationalItems[0];
  if (firstMissingOperationalItem) {
    const next = nextActionForMissingItem(firstMissingOperationalItem);
    return {
      effectiveStatus,
      suggestedNextAction: next.text,
      nextActionHref: next.href,
      nextActionIsSuggested: true,
    };
  }

  if (input.propertySummary?.isOperationallyReady) {
    return {
      effectiveStatus,
      suggestedNextAction: 'Запустить тест гостя',
      nextActionHref: input.propertySummary.guestTestHref,
      nextActionIsSuggested: true,
    };
  }

  if (input.status === 'testing_communication' || input.source === 'test' || input.role === 'guest') {
    return {
      effectiveStatus,
      suggestedNextAction: 'Запустить тест гостя и проверить ответы ASI',
      nextActionHref: input.propertySummary?.guestTestHref ?? null,
      nextActionIsSuggested: true,
    };
  }

  return {
    effectiveStatus,
    suggestedNextAction: 'Указать следующий шаг',
    nextActionHref: null,
    nextActionIsSuggested: true,
  };
}
