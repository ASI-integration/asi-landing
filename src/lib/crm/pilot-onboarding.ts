import { getAsiFeedbackBotUsername } from '@/config/publicTelegram';
import { buildGuestTestDeepLink, buildGuestTestCommand } from '@/lib/property-setup/object-guest-readiness';
import type { CrmContactViewModel, CrmEventViewModel, CrmPilotApplicationSummary, CrmStatus } from './types';

export type PilotOnboardingStepId =
  | 'application_submitted'
  | 'pilot_selected'
  | 'object_created'
  | 'object_filled'
  | 'guest_test_started';

export type DashboardPilotStepId =
  | 'application_submitted'
  | 'cabinet_login'
  | 'object_created'
  | 'object_filled'
  | 'guest_test_telegram';

export type DashboardPilotStep = {
  id: DashboardPilotStepId;
  label: string;
  done: boolean;
  current: boolean;
};

export type DashboardPilotProgress = {
  steps: DashboardPilotStep[];
  currentStepId: DashboardPilotStepId | null;
  completedCount: number;
};

export const PILOT_CONNECT_COPY = {
  title: 'Войти в кабинет ASI',
  subtitle: 'После входа вы сможете создать объект и продолжить участие в закрытом пилоте ASI.',
  infoTitle: 'Пилотное подключение',
  infoBody:
    'Сначала создайте объект, затем заполните базовые данные и запустите тест гостя. Telegram-бот будет использоваться для связи, уведомлений и проверки сценариев.',
  signupCta: 'Создать аккаунт и продолжить',
  googleHint: 'После входа откроется раздел объектов для продолжения пилота.',
} as const;

const DASHBOARD_PILOT_STEP_LABELS: Record<DashboardPilotStepId, string> = {
  application_submitted: 'Заявка отправлена',
  cabinet_login: 'Вход в кабинет',
  object_created: 'Создание объекта',
  object_filled: 'Заполнение объекта',
  guest_test_telegram: 'Тест гостя в Telegram',
};

export type PilotOnboardingStep = {
  id: PilotOnboardingStepId;
  label: string;
  done: boolean;
  current: boolean;
};

export type PilotOnboardingProgress = {
  steps: PilotOnboardingStep[];
  currentStepId: PilotOnboardingStepId | null;
  completedCount: number;
};

const PILOT_ONBOARDING_STEP_LABELS: Record<PilotOnboardingStepId, string> = {
  application_submitted: 'Заявка отправлена',
  pilot_selected: 'Кандидат выбран в пилот',
  object_created: 'Объект создан',
  object_filled: 'Данные объекта заполнены',
  guest_test_started: 'Тест гостя запущен',
};

const PILOT_CONTACT_STORAGE_KEY = 'asi:pilot-application:contactId';

const PILOT_STATUSES: ReadonlySet<CrmStatus> = new Set([
  'pilot_candidate',
  'pilot_selected',
  'pilot_waitlist',
  'pilot_active',
  'creating_object',
  'object_filled',
  'testing_communication',
]);

export function isPilotRelatedContact(input: {
  source: string;
  status: CrmStatus;
  pilotApplication: CrmPilotApplicationSummary | null;
}): boolean {
  return (
    input.source === 'pilot_form' ||
    input.pilotApplication != null ||
    PILOT_STATUSES.has(input.status)
  );
}

function hasPilotSelected(input: {
  status: CrmStatus;
  recentEvents: CrmEventViewModel[];
}): boolean {
  return (
    input.status === 'pilot_selected' ||
    input.status === 'pilot_active' ||
    input.status === 'creating_object' ||
    input.status === 'object_filled' ||
    input.status === 'testing_communication' ||
    input.recentEvents.some((event) => event.eventType === 'pilot_selected')
  );
}

export function computePilotOnboardingProgress(input: {
  source: string;
  status: CrmStatus;
  propertyId: string | null;
  pilotApplication: CrmPilotApplicationSummary | null;
  propertySummary: CrmContactViewModel['propertySummary'];
  recentEvents: CrmEventViewModel[];
}): PilotOnboardingProgress | null {
  if (!isPilotRelatedContact(input)) return null;

  const applicationSubmitted =
    input.pilotApplication != null ||
    input.source === 'pilot_form' ||
    input.recentEvents.some((event) => event.eventType === 'pilot_application_submitted');

  const pilotSelected = hasPilotSelected(input);
  const objectCreated = Boolean(input.propertyId);
  const objectFilled = Boolean(input.propertySummary?.isOperationallyReady);
  const guestTestStarted = input.recentEvents.some((event) => event.eventType === 'guest_test_started');

  const doneFlags: Record<PilotOnboardingStepId, boolean> = {
    application_submitted: applicationSubmitted,
    pilot_selected: pilotSelected,
    object_created: objectCreated,
    object_filled: objectFilled,
    guest_test_started: guestTestStarted,
  };

  const stepOrder: PilotOnboardingStepId[] = [
    'application_submitted',
    'pilot_selected',
    'object_created',
    'object_filled',
    'guest_test_started',
  ];

  const currentStepId = stepOrder.find((id) => !doneFlags[id]) ?? stepOrder[stepOrder.length - 1];
  const steps = stepOrder.map((id) => ({
    id,
    label: PILOT_ONBOARDING_STEP_LABELS[id],
    done: doneFlags[id],
    current: id === currentStepId && !doneFlags[id],
  }));

  return {
    steps,
    currentStepId: steps.every((step) => step.done) ? null : currentStepId,
    completedCount: steps.filter((step) => step.done).length,
  };
}

export function buildPilotTelegramStartPayload(contactId: string): string {
  return `pilot_${contactId.trim()}`;
}

export function parsePilotTelegramStartPayload(payload: string | null | undefined): string | null {
  const value = String(payload ?? '').trim();
  const match = value.match(/^pilot_([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

export function buildPilotApplicationTelegramLink(contactId: string): string {
  const username = getAsiFeedbackBotUsername();
  return `https://t.me/${username}?start=${encodeURIComponent(buildPilotTelegramStartPayload(contactId))}`;
}

export function buildPilotPropertiesRedirect(contactId?: string | null): string {
  const base = '/dashboard/properties';
  const id = contactId?.trim();
  if (!id) return base;
  return `${base}?crmContactId=${encodeURIComponent(id)}`;
}

export function buildPilotCabinetConnectHref(contactId?: string | null): string {
  return `/connect?redirect=${encodeURIComponent(buildPilotPropertiesRedirect(contactId))}`;
}

export function isPilotConnectRedirect(redirectPath: string | null | undefined): boolean {
  const value = String(redirectPath ?? '').trim();
  if (!value.startsWith('/dashboard/properties')) return false;
  return value === '/dashboard/properties' || value.startsWith('/dashboard/properties?');
}

export function pilotContactStorageKey(): string {
  return PILOT_CONTACT_STORAGE_KEY;
}

export function rememberPilotContactId(contactId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PILOT_CONTACT_STORAGE_KEY, contactId.trim());
  } catch {
    // ignore
  }
}

export function readStoredPilotContactId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PILOT_CONTACT_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function extractCrmContactIdFromPropertiesPath(path: string | null | undefined): string | null {
  const value = String(path ?? '').trim();
  if (!value.startsWith('/dashboard/properties')) return null;
  try {
    const url = new URL(value, 'https://asi.local');
    return url.searchParams.get('crmContactId')?.trim() || null;
  } catch {
    return null;
  }
}

export function shouldShowDashboardPilotBlock(
  input?: string | null | { crmContactId?: string | null; propertyId?: string | null },
): boolean {
  if (input && typeof input === 'object') {
    return Boolean(input.crmContactId?.trim() || input.propertyId?.trim());
  }
  return Boolean(String(input ?? '').trim());
}

function isPropertyGuestTestReady(property: {
  guestReadinessReady?: boolean;
  city?: string | null;
  address?: string | null;
}): boolean {
  return Boolean(property.guestReadinessReady);
}

export function computeDashboardPilotProgress(input: {
  crmContactId?: string | null;
  properties: Array<{
    id: string;
    city?: string | null;
    address?: string | null;
    guestReadinessReady?: boolean;
  }>;
  guestTestStarted?: boolean;
  propertyId?: string | null;
}): DashboardPilotProgress | null {
  if (!shouldShowDashboardPilotBlock({ crmContactId: input.crmContactId, propertyId: input.propertyId })) {
    return null;
  }

  const applicationSubmitted = true;
  const cabinetLogin = true;
  const objectCreated = input.properties.length > 0;
  const objectFilled = input.properties.some(isPropertyGuestTestReady);
  const guestTestStarted = Boolean(input.guestTestStarted);

  const doneFlags: Record<DashboardPilotStepId, boolean> = {
    application_submitted: applicationSubmitted,
    cabinet_login: cabinetLogin,
    object_created: objectCreated,
    object_filled: objectFilled,
    guest_test_telegram: guestTestStarted,
  };

  const stepOrder: DashboardPilotStepId[] = [
    'application_submitted',
    'cabinet_login',
    'object_created',
    'object_filled',
    'guest_test_telegram',
  ];

  const currentStepId = stepOrder.find((id) => !doneFlags[id]) ?? stepOrder[stepOrder.length - 1];
  const steps = stepOrder.map((id) => ({
    id,
    label: DASHBOARD_PILOT_STEP_LABELS[id],
    done: doneFlags[id],
    current: id === currentStepId && !doneFlags[id],
  }));

  return {
    steps,
    currentStepId: steps.every((step) => step.done) ? null : currentStepId,
    completedCount: steps.filter((step) => step.done).length,
  };
}

export type DashboardPilotNextAction = {
  href: string | null;
  label: string | null;
  guestTestCommand: string | null;
  guestTestDeepLink: string | null;
};

export function buildPilotGuestTestCommand(propertyId: string): string {
  return buildGuestTestCommand(propertyId);
}

export function buildPilotGuestTestDeepLink(propertyId: string): string {
  return buildGuestTestDeepLink(propertyId);
}

export function resolveDashboardPilotNextAction(
  properties: Array<{
    id: string;
    city?: string | null;
    address?: string | null;
    guestReadinessReady?: boolean;
  }>,
  options?: { propertyId?: string | null; onSetupPage?: boolean },
): DashboardPilotNextAction {
  const target =
    (options?.propertyId ? properties.find((item) => item.id === options.propertyId) : null) ??
    properties[0];

  if (!target?.id) {
    return { href: null, label: 'Создать объект', guestTestCommand: null, guestTestDeepLink: null };
  }

  const setupHref = `/dashboard/properties/${target.id}/setup`;
  if (!isPropertyGuestTestReady(target)) {
    return {
      href: setupHref,
      label: options?.onSetupPage ? 'Продолжить setup' : 'Заполнить данные объекта',
      guestTestCommand: null,
      guestTestDeepLink: null,
    };
  }

  return {
    href: null,
    label: null,
    guestTestCommand: buildPilotGuestTestCommand(target.id),
    guestTestDeepLink: buildPilotGuestTestDeepLink(target.id),
  };
}

/** @deprecated Use resolveDashboardPilotNextAction */
export function resolveDashboardPilotNextPropertyHref(
  properties: Array<{ id: string }>,
): string | null {
  return resolveDashboardPilotNextAction(properties).href;
}

export function buildPilotTelegramContinuation(contactId?: string | null): {
  href: string;
  hint: string | null;
} {
  const id = contactId?.trim();
  if (id) {
    return {
      href: buildPilotApplicationTelegramLink(id),
      hint: null,
    };
  }
  const username = getAsiFeedbackBotUsername();
  return {
    href: `https://t.me/${username}`,
    hint: 'Напишите /start и выберите роль владельца.',
  };
}
