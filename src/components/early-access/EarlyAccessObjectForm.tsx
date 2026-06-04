'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { PilotObjectSummary } from '@/lib/communication/pilot-object-intake';

type FormState = {
  city: string;
  objectName: string;
  addressOrArea: string;
  wifiName: string;
  wifiPassword: string;
  accessInstructions: string;
  trashBinsLocation: string;
  parkingText: string;
  checkoutTime: string;
  houseRules: string;
  additionalFeatures: string;
  ownerContact: string;
};

type SaveResponse = {
  ok?: boolean;
  message?: string;
  object?: PilotObjectSummary;
};

const initialState: FormState = {
  city: '',
  objectName: '',
  addressOrArea: '',
  wifiName: '',
  wifiPassword: '',
  accessInstructions: '',
  trashBinsLocation: '',
  parkingText: '',
  checkoutTime: '',
  houseRules: '',
  additionalFeatures: '',
  ownerContact: '',
};

const fields: Array<{
  name: keyof FormState;
  label: string;
  hint: string;
  multiline?: boolean;
  required?: boolean;
}> = [
  { name: 'city', label: 'Город', hint: 'Например: Санкт-Петербург', required: true },
  { name: 'objectName', label: 'Название объекта или условное название', hint: 'Например: Студия у метро', required: true },
  { name: 'addressOrArea', label: 'Адрес или район/ориентир', hint: 'Можно указать точный адрес или ориентир' },
  { name: 'wifiName', label: 'Wi‑Fi: название сети', hint: 'Название сети для гостя' },
  { name: 'wifiPassword', label: 'Wi‑Fi: пароль', hint: 'Пароль будет храниться как чувствительное поле' },
  { name: 'accessInstructions', label: 'Как попасть в объект / инструкция доступа', hint: 'Подъезд, этаж, ключи, код, домофон', multiline: true },
  { name: 'trashBinsLocation', label: 'Где выбрасывать мусор', hint: 'Контейнеры, двор, график, важные ограничения', multiline: true },
  { name: 'parkingText', label: 'Есть ли парковка', hint: 'Где парковаться, платно или бесплатно', multiline: true },
  { name: 'checkoutTime', label: 'Время выезда', hint: 'Например: до 12:00' },
  { name: 'houseRules', label: 'Правила проживания', hint: 'Тишина, курение, гости, животные', multiline: true },
  { name: 'additionalFeatures', label: 'Дополнительные особенности объекта', hint: 'Лифт, шлагбаум, бойлер, детская кроватка, нюансы', multiline: true },
  { name: 'ownerContact', label: 'Контакт владельца/управляющего', hint: 'Телефон, Telegram или email', required: true },
];

function summaryItems(object: PilotObjectSummary): Array<[string, string]> {
  const items: Array<[string, string]> = [
    ['Город', object.city],
    ['Объект', object.objectName],
    ['Адрес или ориентир', object.addressOrArea],
    ['Wi‑Fi', object.wifiName],
    ['Доступ', object.accessInstructions],
    ['Мусор', object.trashBinsLocation],
    ['Парковка', object.parkingText],
    ['Выезд', object.checkoutTime],
    ['Правила', object.houseRules],
    ['Особенности', object.additionalFeatures],
    ['Контакт', object.ownerContact],
  ];
  return items.filter(([, value]) => value.trim().length > 0);
}

export function EarlyAccessObjectForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [savedObject, setSavedObject] = useState<PilotObjectSummary | null>(null);

  const updateField = (name: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch('/api/early-access/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await readResponseJson<SaveResponse>(res, {});
      if (!res.ok || !data.object) {
        setStatus(data.message || 'Не удалось сохранить анкету.');
        return;
      }
      setSavedObject(data.object);
      setStatus(data.message || 'Анкета сохранена.');
    } catch {
      setStatus('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckSaved = async () => {
    if (!savedObject?.objectId) return;
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch(`/api/early-access/objects?objectId=${encodeURIComponent(savedObject.objectId)}`);
      const data = await readResponseJson<SaveResponse>(res, {});
      if (!res.ok || !data.object) {
        setStatus(data.message || 'Не удалось загрузить объект.');
        return;
      }
      setSavedObject(data.object);
      setStatus('Объект загружен для проверки.');
    } catch {
      setStatus('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="pilot-form" className="scroll-mt-24">
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map((field) => (
            <label key={field.name} className={field.multiline ? 'md:col-span-2' : undefined}>
              <span className="block text-sm font-semibold text-[var(--t-text)]">
                {field.label}
                {field.required ? <span className="text-red-600"> *</span> : null}
              </span>
              {field.multiline ? (
                <textarea
                  value={form[field.name]}
                  onChange={(event) => updateField(field.name, event.target.value)}
                  required={field.required}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm text-[var(--t-text)] outline-none transition focus:border-[var(--t-accent)] focus:ring-2 focus:ring-[color:var(--t-accent)]/20"
                  placeholder={field.hint}
                />
              ) : (
                <input
                  value={form[field.name]}
                  onChange={(event) => updateField(field.name, event.target.value)}
                  required={field.required}
                  className="mt-1 w-full rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm text-[var(--t-text)] outline-none transition focus:border-[var(--t-accent)] focus:ring-2 focus:ring-[color:var(--t-accent)]/20"
                  placeholder={field.hint}
                />
              )}
              <span className="mt-1 block text-xs leading-5 text-[var(--t-muted)]">{field.hint}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--t-accent)] px-6 py-3 text-sm font-bold text-white transition hover:bg-[var(--t-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Сохраняем…' : 'Оставить заявку на пилот'}
          </button>
          {savedObject ? (
            <button
              type="button"
              onClick={handleCheckSaved}
              disabled={saving}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--t-border)] px-6 py-3 text-sm font-semibold text-[var(--t-text)] transition hover:bg-[var(--t-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Проверить сохранённый объект
            </button>
          ) : null}
        </div>
      </form>

      {status ? (
        <div className="mt-5 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-3 text-sm font-medium text-[var(--t-text)]" aria-live="polite">
          {status}
        </div>
      ) : null}

      {savedObject ? (
        <section className="mt-6 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
          <p className="text-sm font-bold text-[var(--t-text)]">Сохранённый объект</p>
          <p className="mt-1 text-xs text-[var(--t-muted)]">ID: {savedObject.objectId}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {summaryItems(savedObject).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-[var(--t-surface-2)] p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--t-muted)]">{label}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--t-text)]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
