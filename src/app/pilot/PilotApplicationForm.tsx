'use client';

import { useEffect, useState } from 'react';
import { PilotSuccessActions } from '@/components/PilotSuccessActions';
import { computePilotOnboardingProgress, rememberPilotContactId } from '@/lib/crm/pilot-onboarding';
import {
  PILOT_ACTIVE_BOOKINGS_LABELS,
  PILOT_ACTIVE_BOOKINGS_OPTIONS,
  PILOT_CHANNEL_MANAGER_LABELS,
  PILOT_CHANNEL_MANAGER_OPTIONS,
  PILOT_FEEDBACK_LABELS,
  PILOT_FEEDBACK_OPTIONS,
  PILOT_PLATFORM_LABELS,
  PILOT_PLATFORM_OPTIONS,
  PILOT_ROLE_LABELS,
  PILOT_ROLE_OPTIONS,
  PILOT_TEST_FOCUS_LABELS,
  PILOT_TEST_FOCUS_OPTIONS,
  type PilotActiveBookingsOption,
  type PilotChannelManagerOption,
  type PilotFeedbackOption,
  type PilotPlatformOption,
  type PilotRoleOption,
  type PilotTestFocusOption,
} from '@/lib/crm/pilot-options';

type SubmitState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'done'; contactId: string }
  | { status: 'error'; message: string };

const roles: PilotRoleOption[] = [...PILOT_ROLE_OPTIONS];
const channelManagers: PilotChannelManagerOption[] = [...PILOT_CHANNEL_MANAGER_OPTIONS];
const platforms: PilotPlatformOption[] = [...PILOT_PLATFORM_OPTIONS];
const activeBookings: PilotActiveBookingsOption[] = [...PILOT_ACTIVE_BOOKINGS_OPTIONS];
const testFocuses: PilotTestFocusOption[] = [...PILOT_TEST_FOCUS_OPTIONS];
const feedbackOptions: PilotFeedbackOption[] = [...PILOT_FEEDBACK_OPTIONS];

const PILOT_FORM_DRAFT_STORAGE_KEY = 'asi:pilot-application:draft:v1';

export type PilotApplicationDraft = {
  name: string;
  telegramContact: string;
  role: PilotRoleOption;
  city: string;
  propertyCount: string;
  channelManager: PilotChannelManagerOption;
  selectedPlatforms: PilotPlatformOption[];
  hasActiveBookings: PilotActiveBookingsOption;
  testFocus: PilotTestFocusOption;
  feedbackReady: PilotFeedbackOption;
};

const DEFAULT_PILOT_APPLICATION_DRAFT: PilotApplicationDraft = {
  name: '',
  telegramContact: '',
  role: 'owner',
  city: '',
  propertyCount: '1',
  channelManager: 'none',
  selectedPlatforms: [],
  hasActiveBookings: 'yes',
  testFocus: 'communications',
  feedbackReady: 'yes',
};

export function normalizePropertyCountInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return String(Math.min(500, Number(digits)));
}

function optionFromList<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback;
}

export function selectAllPilotPlatforms(): PilotPlatformOption[] {
  return [...platforms];
}

export function parsePilotApplicationDraft(rawValue: string | null): PilotApplicationDraft {
  if (!rawValue) return { ...DEFAULT_PILOT_APPLICATION_DRAFT };

  try {
    const value = JSON.parse(rawValue) as Partial<PilotApplicationDraft>;
    return {
      name: typeof value.name === 'string' ? value.name : DEFAULT_PILOT_APPLICATION_DRAFT.name,
      telegramContact:
        typeof value.telegramContact === 'string'
          ? value.telegramContact
          : DEFAULT_PILOT_APPLICATION_DRAFT.telegramContact,
      role: optionFromList(value.role, PILOT_ROLE_OPTIONS, DEFAULT_PILOT_APPLICATION_DRAFT.role),
      city: typeof value.city === 'string' ? value.city : DEFAULT_PILOT_APPLICATION_DRAFT.city,
      propertyCount:
        typeof value.propertyCount === 'string'
          ? normalizePropertyCountInput(value.propertyCount) || DEFAULT_PILOT_APPLICATION_DRAFT.propertyCount
          : DEFAULT_PILOT_APPLICATION_DRAFT.propertyCount,
      channelManager: optionFromList(
        value.channelManager,
        PILOT_CHANNEL_MANAGER_OPTIONS,
        DEFAULT_PILOT_APPLICATION_DRAFT.channelManager,
      ),
      selectedPlatforms: Array.isArray(value.selectedPlatforms)
        ? value.selectedPlatforms.filter((item): item is PilotPlatformOption =>
            PILOT_PLATFORM_OPTIONS.includes(item as PilotPlatformOption),
          )
        : DEFAULT_PILOT_APPLICATION_DRAFT.selectedPlatforms,
      hasActiveBookings: optionFromList(
        value.hasActiveBookings,
        PILOT_ACTIVE_BOOKINGS_OPTIONS,
        DEFAULT_PILOT_APPLICATION_DRAFT.hasActiveBookings,
      ),
      testFocus: optionFromList(value.testFocus, PILOT_TEST_FOCUS_OPTIONS, DEFAULT_PILOT_APPLICATION_DRAFT.testFocus),
      feedbackReady: optionFromList(
        value.feedbackReady,
        PILOT_FEEDBACK_OPTIONS,
        DEFAULT_PILOT_APPLICATION_DRAFT.feedbackReady,
      ),
    };
  } catch {
    return { ...DEFAULT_PILOT_APPLICATION_DRAFT };
  }
}

export function PilotApplicationForm() {
  const [draft, setDraft] = useState<PilotApplicationDraft>(DEFAULT_PILOT_APPLICATION_DRAFT);
  const [draftRestored, setDraftRestored] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });

  useEffect(() => {
    setDraft(parsePilotApplicationDraft(window.localStorage.getItem(PILOT_FORM_DRAFT_STORAGE_KEY)));
    setDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!draftRestored) return;
    window.localStorage.setItem(PILOT_FORM_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [draft, draftRestored]);

  function updateDraft<Field extends keyof PilotApplicationDraft>(field: Field, value: PilotApplicationDraft[Field]) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (submitState.status === 'done') setSubmitState({ status: 'idle' });
  }

  function togglePlatform(platform: PilotPlatformOption) {
    setDraft((current) => ({
      ...current,
      selectedPlatforms: current.selectedPlatforms.includes(platform)
        ? current.selectedPlatforms.filter((item) => item !== platform)
        : [...current.selectedPlatforms, platform],
    }));
    if (submitState.status === 'done') setSubmitState({ status: 'idle' });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState({ status: 'saving' });
    try {
      const res = await fetch('/api/pilot-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          telegramContact: draft.telegramContact,
          role: draft.role,
          city: draft.city,
          propertyCount: Number(draft.propertyCount || 0),
          channelManager: draft.channelManager,
          platforms: draft.selectedPlatforms,
          hasActiveBookings: draft.hasActiveBookings,
          testFocus: draft.testFocus,
          feedbackReady: draft.feedbackReady,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; contactId?: string };
      if (!res.ok || !json.ok || !json.contactId) {
        setSubmitState({ status: 'error', message: json.error ?? 'Не удалось отправить заявку.' });
        return;
      }
      rememberPilotContactId(json.contactId);
      setSubmitState({ status: 'done', contactId: json.contactId });
    } catch {
      setSubmitState({ status: 'error', message: 'Ошибка сети. Попробуйте ещё раз.' });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Имя</span>
          <input
            value={draft.name}
            onChange={(event) => updateDraft('name', event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Telegram</span>
          <input
            value={draft.telegramContact}
            onChange={(event) => updateDraft('telegramContact', event.target.value)}
            placeholder="@username или ссылка на профиль"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Роль</span>
          <select
            value={draft.role}
            onChange={(event) => updateDraft('role', event.target.value as PilotRoleOption)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          >
            {roles.map((item) => (
              <option key={item} value={item}>{PILOT_ROLE_LABELS[item]}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Город</span>
          <input
            value={draft.city}
            onChange={(event) => updateDraft('city', event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Количество объектов</span>
          <input
            value={draft.propertyCount}
            onChange={(event) => updateDraft('propertyCount', normalizePropertyCountInput(event.target.value))}
            type="number"
            inputMode="numeric"
            min={0}
            max={500}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Текущий менеджер каналов</span>
          <select
            value={draft.channelManager}
            onChange={(event) => updateDraft('channelManager', event.target.value as PilotChannelManagerOption)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          >
            {channelManagers.map((item) => (
              <option key={item} value={item}>{PILOT_CHANNEL_MANAGER_LABELS[item]}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-700">Площадки</legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => updateDraft('selectedPlatforms', selectAllPilotPlatforms())}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Выбрать все площадки
          </button>
          <button
            type="button"
            onClick={() => updateDraft('selectedPlatforms', [])}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Снять выбор
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {platforms.map((item) => (
            <label key={item} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.selectedPlatforms.includes(item)}
                onChange={() => togglePlatform(item)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {PILOT_PLATFORM_LABELS[item]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Есть реальные брони сейчас?</span>
          <select
            value={draft.hasActiveBookings}
            onChange={(event) => updateDraft('hasActiveBookings', event.target.value as PilotActiveBookingsOption)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          >
            {activeBookings.map((item) => (
              <option key={item} value={item}>{PILOT_ACTIVE_BOOKINGS_LABELS[item]}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Что хотите протестировать?</span>
          <select
            value={draft.testFocus}
            onChange={(event) => updateDraft('testFocus', event.target.value as PilotTestFocusOption)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          >
            {testFocuses.map((item) => (
              <option key={item} value={item}>{PILOT_TEST_FOCUS_LABELS[item]}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Готовы дать обратную связь?</span>
          <select
            value={draft.feedbackReady}
            onChange={(event) => updateDraft('feedbackReady', event.target.value as PilotFeedbackOption)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          >
            {feedbackOptions.map((item) => (
              <option key={item} value={item}>{PILOT_FEEDBACK_LABELS[item]}</option>
            ))}
          </select>
        </label>
      </div>

      {submitState.status === 'error' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {submitState.message}
        </div>
      )}
      {submitState.status === 'done' && (
        <PilotSuccessActions
          contactId={submitState.contactId}
          progress={computePilotOnboardingProgress({
            source: 'pilot_form',
            status: 'pilot_candidate',
            propertyId: null,
            pilotApplication: {
              city: draft.city,
              propertyCount: Number(draft.propertyCount || 0) || null,
              channelManager: PILOT_CHANNEL_MANAGER_LABELS[draft.channelManager],
              platforms: draft.selectedPlatforms.map((item) => PILOT_PLATFORM_LABELS[item]),
              hasActiveBookings: PILOT_ACTIVE_BOOKINGS_LABELS[draft.hasActiveBookings],
              testFocus: PILOT_TEST_FOCUS_LABELS[draft.testFocus],
              feedbackReady: PILOT_FEEDBACK_LABELS[draft.feedbackReady],
              roleAnswer: PILOT_ROLE_LABELS[draft.role],
              telegramContact: draft.telegramContact || null,
              suggestedNextAction: 'Выбрать в пилот и предложить создать объект',
              submittedAt: new Date().toISOString(),
            },
            propertySummary: null,
            recentEvents: [
              {
                id: 'local',
                eventType: 'pilot_application_submitted' as const,
                messageText: null,
                propertyId: null,
                metadata: {},
                acknowledgedAt: null,
                createdAt: new Date().toISOString(),
                label: 'Заявка в пилот',
              },
            ],
          })!}
        />
      )}

      <button
        type="submit"
        disabled={submitState.status === 'saving'}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto"
      >
        {submitState.status === 'saving' ? 'Отправляем...' : 'Отправить заявку'}
      </button>
    </form>
  );
}
