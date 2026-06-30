'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { PilotObjectSummary } from '@/lib/communication/pilot-object-intake';

type CommunityStatus = 'community_member' | 'standard_terms' | 'community_info';

type FormState = {
  name: string;
  contact: string;
  objectsCount: string;
  communityStatus: CommunityStatus;
};

type SaveResponse = {
  ok?: boolean;
  message?: string;
  object?: PilotObjectSummary;
};

const initialState: FormState = {
  name: '',
  contact: '',
  objectsCount: '',
  communityStatus: 'community_member',
};

const objectCountOptions = [
  '1 объект',
  '2-5 объектов',
  '6-10 объектов',
  '11-20 объектов',
  'Более 20 объектов',
];

const communityOptions: Array<{ value: CommunityStatus; label: string }> = [
  {
    value: 'community_member',
    label: 'Участник группы Ярослава Стригунова',
  },
  {
    value: 'standard_terms',
    label: 'Участник группы Анатолия Брагина',
  },
  {
    value: 'community_info',
    label: 'Другая рекомендация или источник',
  },
];

const communitySubmissionLabels: Record<CommunityStatus, string> = {
  community_member: 'Участник группы Ярослава Стригунова.',
  standard_terms: 'Участник группы Анатолия Брагина.',
  community_info: 'Другая рекомендация или источник.',
};

export function EarlyAccessObjectForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const updateField = <K extends keyof FormState>(name: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setStatus('');

    const details = [
      `Количество объектов: ${form.objectsCount}`,
      `Условия участия: ${communitySubmissionLabels[form.communityStatus]}`,
    ].join('\n');

    try {
      const res = await fetch('/api/early-access/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: 'Заявка пилота ASI',
          objectName: form.name,
          addressOrArea: '',
          wifiName: '',
          wifiPassword: '',
          accessInstructions: '',
          trashBinsLocation: '',
          parkingText: '',
          checkoutTime: '',
          houseRules: '',
          additionalFeatures: details,
          ownerContact: form.contact,
        }),
      });
      const data = await readResponseJson<SaveResponse>(res, {});
      if (!res.ok || !data.object) {
        setStatus(data.message || 'Не удалось отправить заявку.');
        return;
      }
      setStatus('Заявка отправлена. Свяжемся с вами в ближайшее время.');
      setForm(initialState);
    } catch {
      setStatus('Ошибка сети. Попробуйте еще раз.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="pilot-form" className="scroll-mt-24">
      <form onSubmit={handleSubmit} className="grid gap-5 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
        <label>
          <span className="block text-sm font-semibold text-[var(--t-text)]">Ваше имя</span>
          <input
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm text-[var(--t-text)] outline-none transition focus:border-[var(--t-accent)] focus:ring-2 focus:ring-[color:var(--t-accent)]/20"
          />
        </label>

        <label>
          <span className="block text-sm font-semibold text-[var(--t-text)]">Телефон / Telegram</span>
          <input
            value={form.contact}
            onChange={(event) => updateField('contact', event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm text-[var(--t-text)] outline-none transition focus:border-[var(--t-accent)] focus:ring-2 focus:ring-[color:var(--t-accent)]/20"
          />
        </label>

        <label>
          <span className="block text-sm font-semibold text-[var(--t-text)]">Сколько у вас объектов?</span>
          <select
            value={form.objectsCount}
            onChange={(event) => updateField('objectsCount', event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm text-[var(--t-text)] outline-none transition focus:border-[var(--t-accent)] focus:ring-2 focus:ring-[color:var(--t-accent)]/20"
          >
            <option value="">Выберите количество</option>
            {objectCountOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold text-[var(--t-text)]">Условия участия</legend>
          {communityOptions.map((option) => (
            <label key={option.value} className="flex gap-3 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--t-text-2)]">
              <input
                type="radio"
                name="communityStatus"
                value={option.value}
                checked={form.communityStatus === option.value}
                onChange={() => updateField('communityStatus', option.value)}
                className="mt-1 h-4 w-4"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--t-accent)] px-6 py-3 text-sm font-bold text-white transition hover:bg-[var(--t-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Отправляем...' : 'Отправить заявку'}
        </button>
      </form>

      {status ? (
        <div className="mt-5 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm font-medium text-[var(--t-text)]" aria-live="polite">
          {status}
        </div>
      ) : null}
    </div>
  );
}
