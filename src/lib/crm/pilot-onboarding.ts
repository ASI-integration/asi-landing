import { getAsiFeedbackBotUsername } from '@/config/publicTelegram';
import type { CrmContactViewModel, CrmEventViewModel, CrmPilotApplicationSummary, CrmStatus } from './types';

export type PilotOnboardingStepId =
  | 'application_submitted'
  | 'pilot_selected'
  | 'object_created'
  | 'object_filled'
  | 'guest_test_started';

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
