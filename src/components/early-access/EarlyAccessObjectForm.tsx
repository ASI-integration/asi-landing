'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';

type FormState = {
  name: string;
  contact: string;
  objectsCount: string;
  consent: boolean;
  website: string;
};

type SaveResponse = {
  ok?: boolean;
  message?: string;
};

const initialState: FormState = {
  name: '',
  contact: '',
  objectsCount: '',
  consent: false,
  website: '',
};

const objectCountOptions = [
  '1 объект',
  '2-5 объектов',
  '6-10 объектов',
  '11-20 объектов',
  'Более 20 объектов',
];

/** Neutral source marker for homepage compact mode — never a community membership claim. */
export const HOMEPAGE_LEAD_SOURCE_MARKER = 'Источник заявки: главная страница ASI.';

const fieldClass =
  'mt-2 w-full border border-asi-border bg-asi-paper px-4 py-3.5 text-sm font-sans text-asi-navy rounded-sm outline-none transition focus:border-asi-gold focus:ring-1 focus:ring-asi-gold/40';

export function EarlyAccessObjectForm({
  submitLabel = 'Подключить объект бесплатно',
  /** Compact homepage: name, contact, object count, CTA only — no community radios. */
  variant = 'full',
}: {
  submitLabel?: string;
  variant?: 'full' | 'compact';
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

    try {
      const referral = new URLSearchParams(window.location.search).get('ref') === 'strigunov'
        ? 'strigunov' : 'site';
      const res = await fetch('/api/early-access/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          contact: form.contact,
          objectsCount: form.objectsCount,
          referral,
          consent: form.consent,
          website: form.website,
        }),
      });
      const data = await readResponseJson<SaveResponse>(res, {});
      if (!res.ok || !data.ok) {
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
        data-form-variant={variant}
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

        <div className="absolute -left-[9999px]" aria-hidden="true">
          <label htmlFor="lead-website">Оставьте это поле пустым</label>
          <input
            id="lead-website"
            name="website"
            autoComplete="off"
            tabIndex={-1}
            value={form.website}
            onChange={(event) => updateField('website', event.target.value)}
          />
        </div>
        <label className="flex items-start gap-3 text-sm text-asi-navy/75 leading-relaxed">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-asi-navy"
            checked={form.consent}
            onChange={(event) => updateField('consent', event.target.checked)}
            required
          />
          <span>
            Согласен на обработку контактных данных для ответа по заявке согласно{' '}
            <a className="underline underline-offset-2" href="/ru/privacy" target="_blank" rel="noopener noreferrer">
              политике конфиденциальности
            </a>.
          </span>
        </label>
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
