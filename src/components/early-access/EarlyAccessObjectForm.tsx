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
    label: 'Я участник сообщества Ярослава Стригунова или Анатолия Брагина. Зафиксировать стартовую цену на 1 год.',
  },
  {
    value: 'standard_terms',
    label: 'Я не состою в сообществах. Хочу участвовать на стандартных условиях.',
  },
  {
    value: 'community_info',
    label: 'Я хочу узнать, как вступить в сообщество и получить скидку на год.',
  },
];

function communityLabel(value: CommunityStatus): string {
  return communityOptions.find((item) => item.value === value)?.label ?? communityOptions[0].label;
}

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
      `Условия участия: ${communityLabel(form.communityStatus)}`,
    ].join('\n');

    try {
      const res = await fetch('/api/early-access/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: 'Заявка раннего доступа',
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
      setStatus('Заявка отправлена. Мы свяжемся с вами и поможем подключить сервис.');
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
          <span className="block text-sm font-semibold text-[var(--t-text)]">Сколько объектов в управлении?</span>
          <select
            value={form.objectsCount}
            onChange={(event) => updateField('objectsCount', event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm text-[var(--t-text)] outline-none transition focus:border-[var(--t-accent)] focus:ring-2 focus:ring-[color:var(--t-accent)]/20"
          >
            <option value="">Выберите количество объектов</option>
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
          {saving ? 'Отправляем...' : 'Отправить заявку и запустить автопилот'}
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
