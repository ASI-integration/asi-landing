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

const fieldClass =
  'mt-2 w-full border border-asi-border bg-asi-paper px-4 py-3.5 text-sm font-sans text-asi-navy rounded-sm outline-none transition focus:border-asi-gold focus:ring-1 focus:ring-asi-gold/40';

export function EarlyAccessObjectForm({
  submitLabel = 'Подключить объект бесплатно',
}: {
  /** Homepage and early-access share one submit implementation; label can vary by surface. */
  submitLabel?: string;
} = {}) {
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
      <form
        onSubmit={handleSubmit}
        className="grid gap-6 border border-asi-border bg-asi-paper p-6 sm:p-8"
      >
        <label className="block">
          <span className="block text-sm font-sans font-semibold text-asi-navy">Ваше имя</span>
          <input
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            required
            autoComplete="name"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className="block text-sm font-sans font-semibold text-asi-navy">
            Телефон или Telegram (@username)
          </span>
          <input
            value={form.contact}
            onChange={(event) => updateField('contact', event.target.value)}
            required
            autoComplete="tel"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className="block text-sm font-sans font-semibold text-asi-navy">
            Количество объектов в управлении
          </span>
          <select
            value={form.objectsCount}
            onChange={(event) => updateField('objectsCount', event.target.value)}
            required
            className={fieldClass}
          >
            <option value="">Выберите количество</option>
            {objectCountOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="border-y border-asi-border">
          <legend className="mb-3 text-sm font-sans font-semibold text-asi-navy">
            Условия участия
          </legend>
          <div className="grid gap-0">
          {communityOptions.map((option) => {
            const selected = form.communityStatus === option.value;
            return (
              <label
                key={option.value}
                className={`flex gap-3 border-t border-asi-border px-1 py-4 text-sm leading-6 text-asi-navy/75 cursor-pointer transition-colors ${
                  selected ? 'text-asi-navy' : 'hover:text-asi-navy'
                }`}
              >
                <input
                  type="radio"
                  name="communityStatus"
                  value={option.value}
                  checked={selected}
                  onChange={() => updateField('communityStatus', option.value)}
                  className="mt-1 h-4 w-4 accent-asi-navy"
                />
                <span className={selected ? 'font-medium text-asi-navy' : undefined}>
                  {option.label}
                </span>
              </label>
            );
          })}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-12 items-center justify-center gap-2 px-7 py-3.5 bg-asi-navy text-asi-ivory text-sm font-sans font-semibold tracking-wide rounded-sm border border-asi-navy hover:bg-asi-navy-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asi-gold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Отправляем...' : submitLabel}
        </button>
      </form>

      {status ? (
        <div
          className="mt-5 border border-asi-border bg-asi-ivory px-4 py-3 text-sm font-sans text-asi-navy leading-relaxed"
          aria-live="polite"
          role="status"
        >
          {status}
        </div>
      ) : null}
    </div>
  );
}
