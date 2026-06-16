'use client';

import { useState } from 'react';
import {
  PILOT_ACTIVE_BOOKINGS_LABELS,
  PILOT_CHANNEL_MANAGER_LABELS,
  PILOT_FEEDBACK_LABELS,
  PILOT_PLATFORM_LABELS,
  PILOT_ROLE_LABELS,
  PILOT_TEST_FOCUS_LABELS,
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
  | { status: 'done'; nextAction: string }
  | { status: 'error'; message: string };

const roles: PilotRoleOption[] = ['owner', 'manager', 'other'];
const channelManagers: PilotChannelManagerOption[] = ['bnovo', 'realtycalendar', 'other', 'none'];
const platforms: PilotPlatformOption[] = [
  'sutochno',
  'avito',
  'ostrovok',
  'yandex_travel',
  'cian',
  'hotels_101',
  'otello',
  'other',
];
const activeBookings: PilotActiveBookingsOption[] = ['yes', 'no', 'soon'];
const testFocuses: PilotTestFocusOption[] = ['communications', 'object_setup', 'channels', 'full_cycle'];
const feedbackOptions: PilotFeedbackOption[] = ['yes', 'no', 'unsure'];

export function PilotApplicationForm() {
  const [name, setName] = useState('');
  const [telegramContact, setTelegramContact] = useState('');
  const [role, setRole] = useState<PilotRoleOption>('owner');
  const [city, setCity] = useState('');
  const [propertyCount, setPropertyCount] = useState(1);
  const [channelManager, setChannelManager] = useState<PilotChannelManagerOption>('none');
  const [selectedPlatforms, setSelectedPlatforms] = useState<PilotPlatformOption[]>([]);
  const [hasActiveBookings, setHasActiveBookings] = useState<PilotActiveBookingsOption>('yes');
  const [testFocus, setTestFocus] = useState<PilotTestFocusOption>('communications');
  const [feedbackReady, setFeedbackReady] = useState<PilotFeedbackOption>('yes');
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });

  function togglePlatform(platform: PilotPlatformOption) {
    setSelectedPlatforms((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState({ status: 'saving' });
    try {
      const res = await fetch('/api/pilot-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          telegramContact,
          role,
          city,
          propertyCount,
          channelManager,
          platforms: selectedPlatforms,
          hasActiveBookings,
          testFocus,
          feedbackReady,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; nextAction?: string };
      if (!res.ok || !json.ok) {
        setSubmitState({ status: 'error', message: json.error ?? 'Не удалось отправить заявку.' });
        return;
      }
      setSubmitState({ status: 'done', nextAction: json.nextAction ?? 'Оценить кандидата в пилот' });
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
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Telegram</span>
          <input
            value={telegramContact}
            onChange={(event) => setTelegramContact(event.target.value)}
            placeholder="@username или ссылка на профиль"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Роль</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as PilotRoleOption)}
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
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Количество объектов</span>
          <input
            value={propertyCount}
            onChange={(event) => setPropertyCount(Number(event.target.value))}
            type="number"
            min={0}
            max={500}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Текущий менеджер каналов</span>
          <select
            value={channelManager}
            onChange={(event) => setChannelManager(event.target.value as PilotChannelManagerOption)}
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
        <div className="grid gap-2 sm:grid-cols-2">
          {platforms.map((item) => (
            <label key={item} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={selectedPlatforms.includes(item)}
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
            value={hasActiveBookings}
            onChange={(event) => setHasActiveBookings(event.target.value as PilotActiveBookingsOption)}
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
            value={testFocus}
            onChange={(event) => setTestFocus(event.target.value as PilotTestFocusOption)}
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
            value={feedbackReady}
            onChange={(event) => setFeedbackReady(event.target.value as PilotFeedbackOption)}
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
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Заявка сохранена. Следующий шаг в CRM: {submitState.nextAction}
        </div>
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
