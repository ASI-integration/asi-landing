'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { BookingOpsPropertyKnowledge } from '@/lib/booking-ops/types';

type ApiResponse = {
  ok: boolean;
  message?: string;
  records?: BookingOpsPropertyKnowledge[];
  record?: BookingOpsPropertyKnowledge;
};

type Draft = Record<keyof BookingOpsPropertyKnowledge, string>;

const EMPTY_DRAFT: Draft = {
  propertyId: '',
  propertyLabel: '',
  address: '',
  entranceInstructions: '',
  floorApartment: '',
  intercomCode: '',
  keyPickupInstructions: '',
  wifiName: '',
  wifiPassword: '',
  parkingInstructions: '',
  houseRules: '',
  quietHours: '',
  checkoutInstructions: '',
  emergencyInstructions: '',
  cleaningLinenNotes: '',
  publicGuestNotes: '',
  privateOperatorNotes: '',
  updatedAt: '',
};

function toDraft(record?: BookingOpsPropertyKnowledge): Draft {
  if (!record) return { ...EMPTY_DRAFT };
  return Object.fromEntries(
    Object.keys(EMPTY_DRAFT).map((key) => [key, String(record[key as keyof BookingOpsPropertyKnowledge] ?? '')]),
  ) as Draft;
}

function Field({
  label,
  value,
  onChange,
  rows,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  type?: string;
  required?: boolean;
}) {
  const className = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';
  return (
    <label className="block text-sm font-medium text-slate-700">
      <span className="mb-1 block">{label}{required ? ' *' : ''}</span>
      {rows ? (
        <textarea className={className} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={className} type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function PropertyKnowledgePageInner() {
  const [records, setRecords] = useState<BookingOpsPropertyKnowledge[]>([]);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/dashboard/property-knowledge', { credentials: 'include' });
      const payload = await readResponseJson<ApiResponse>(response, { ok: false });
      if (!response.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить карточки объектов.');
        return;
      }
      setRecords(payload.records ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const { updatedAt: _updatedAt, ...payload } = draft;
      const response = await fetch('/api/dashboard/property-knowledge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await readResponseJson<ApiResponse>(response, { ok: false });
      if (!response.ok || !result.ok || !result.record) {
        setMessage(result.message || 'Не удалось сохранить карточку объекта.');
        return;
      }
      setMessage('Карточка объекта сохранена.');
      setDraft(toDraft(result.record));
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Данные объектов</h1>
        <p className="mt-1 text-sm text-slate-600">
          Внутренняя карточка для подготовки инструкций заезда. Ничего не отправляется гостям автоматически.
        </p>
      </div>

      {message ? <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">{message}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Объекты</h2>
            <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              Новая карточка
            </button>
          </div>
          {loading ? <p className="text-sm text-slate-500">Загрузка…</p> : null}
          {!loading && records.length === 0 ? <p className="text-sm text-slate-500">Карточек пока нет.</p> : null}
          <div className="space-y-2">
            {records.map((record) => (
              <button
                key={record.propertyId}
                type="button"
                onClick={() => { setDraft(toDraft(record)); setMessage(''); }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="block text-sm font-medium text-slate-900">{record.propertyLabel || record.propertyId}</span>
                <span className="block truncate text-xs text-slate-500">{record.address || 'Адрес не указан'}</span>
              </button>
            ))}
          </div>
        </section>

        <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Карточка объекта</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="ID объекта" value={draft.propertyId} onChange={set('propertyId')} required />
            <Field label="Название для отображения" value={draft.propertyLabel} onChange={set('propertyLabel')} />
            <div className="md:col-span-2"><Field label="Адрес" value={draft.address} onChange={set('address')} /></div>
            <div className="md:col-span-2"><Field label="Как войти" value={draft.entranceInstructions} onChange={set('entranceInstructions')} rows={3} /></div>
            <Field label="Этаж / квартира" value={draft.floorApartment} onChange={set('floorApartment')} />
            <Field label="Код домофона" value={draft.intercomCode} onChange={set('intercomCode')} type="password" />
            <div className="md:col-span-2"><Field label="Получение ключей / замок" value={draft.keyPickupInstructions} onChange={set('keyPickupInstructions')} rows={3} /></div>
            <Field label="Название Wi-Fi" value={draft.wifiName} onChange={set('wifiName')} />
            <Field label="Пароль Wi-Fi" value={draft.wifiPassword} onChange={set('wifiPassword')} type="password" />
            <div className="md:col-span-2"><Field label="Парковка" value={draft.parkingInstructions} onChange={set('parkingInstructions')} rows={3} /></div>
            <div className="md:col-span-2"><Field label="Правила проживания" value={draft.houseRules} onChange={set('houseRules')} rows={3} /></div>
            <Field label="Тихие часы" value={draft.quietHours} onChange={set('quietHours')} />
            <div className="md:col-span-2"><Field label="Инструкции по выезду" value={draft.checkoutInstructions} onChange={set('checkoutInstructions')} rows={3} /></div>
            <div className="md:col-span-2"><Field label="Экстренная связь" value={draft.emergencyInstructions} onChange={set('emergencyInstructions')} rows={3} /></div>
            <div className="md:col-span-2"><Field label="Заметки для гостя" value={draft.publicGuestNotes} onChange={set('publicGuestNotes')} rows={3} /></div>
            <div className="md:col-span-2"><Field label="Уборка и бельё — только для оператора" value={draft.cleaningLinenNotes} onChange={set('cleaningLinenNotes')} rows={3} /></div>
            <div className="md:col-span-2"><Field label="Внутренние заметки оператора" value={draft.privateOperatorNotes} onChange={set('privateOperatorNotes')} rows={4} /></div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PropertyKnowledgePage() {
  return <CrmAccessGuard><PropertyKnowledgePageInner /></CrmAccessGuard>;
}
