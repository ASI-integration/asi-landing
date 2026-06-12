'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { PilotObjectSummary } from '@/lib/communication/pilot-object-intake';

type PilotReadiness = 'ready_to_start' | 'need_help_collecting' | 'want_to_discuss';

type FormState = {
  name: string;
  contact: string;
  objectsCount: string;
  pilotReadiness: PilotReadiness;
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
  pilotReadiness: 'ready_to_start',
};

const objectCountOptions = [
  '1 объект',
  '2-5 объектов',
  '6-10 объектов',
  '11-20 объектов',
  'Более 20 объектов',
];

const pilotReadinessOptions: Array<{ value: PilotReadiness; label: string }> = [
  {
    value: 'ready_to_start',
    label: 'Есть базовые данные объекта, можно начинать пилотное подключение',
  },
  {
    value: 'need_help_collecting',
    label: 'Нужно помочь собрать описание, правила, фото и условия заселения',
  },
  {
    value: 'want_to_discuss',
    label: 'Сначала хочу обсудить формат пилота',
  },
];

const pilotReadinessSubmissionLabels: Record<PilotReadiness, string> = {
  ready_to_start: 'Есть базовые данные объекта, можно начинать пилотное подключение.',
  need_help_collecting: 'Нужно помочь собрать описание, правила, фото и условия заселения.',
  want_to_discuss: 'Сначала хочет обсудить формат пилота.',
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
      `Готовность к пилоту: ${pilotReadinessSubmissionLabels[form.pilotReadiness]}`,
      'Для старта нужны: адрес или район, тип объекта, фото, описание, правила проживания, условия заселения, Wi-Fi, базовая цена и список площадок размещения.',
    ].join('\n');

    try {
      const res = await fetch('/api/early-access/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: 'Заявка на пилотное подключение',
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
      setStatus('Ошибка сети. Попробуйте ещё раз.');
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
          <legend className="text-sm font-semibold text-[var(--t-text)]">Готовность к подключению</legend>
          {pilotReadinessOptions.map((option) => (
            <label key={option.value} className="flex gap-3 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--t-text-2)]">
              <input
                type="radio"
                name="pilotReadiness"
                value={option.value}
                checked={form.pilotReadiness === option.value}
                onChange={() => updateField('pilotReadiness', option.value)}
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
