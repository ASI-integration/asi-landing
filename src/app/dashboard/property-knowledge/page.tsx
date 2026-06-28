'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { BookingOpsPropertyKnowledge } from '@/lib/booking-ops/types';
import {
  PROPERTY_KNOWLEDGE_INTAKE_FIELDS,
  SENSITIVE_INTAKE_FIELDS,
  type IntakeConfidence,
  type PropertyKnowledgeIntakeDraft,
  type PropertyKnowledgeIntakeField,
} from '@/lib/booking-ops/property-knowledge-intake';

type ApiResponse = {
  ok: boolean;
  message?: string;
  records?: BookingOpsPropertyKnowledge[];
  record?: BookingOpsPropertyKnowledge;
  draft?: PropertyKnowledgeIntakeDraft;
  confidence?: Partial<Record<PropertyKnowledgeIntakeField, IntakeConfidence>>;
  warnings?: string[];
  notFound?: PropertyKnowledgeIntakeField[];
  changedFields?: PropertyKnowledgeIntakeField[];
  sensitiveConflicts?: PropertyKnowledgeIntakeField[];
};

type IntakePreview = Required<Pick<ApiResponse, 'draft' | 'confidence' | 'warnings' | 'notFound' | 'changedFields' | 'sensitiveConflicts'>>;

const FIELD_LABELS: Record<PropertyKnowledgeIntakeField, string> = {
  propertyLabel: 'Название объекта',
  address: 'Адрес',
  entranceInstructions: 'Как войти',
  floorApartment: 'Этаж / квартира',
  intercomCode: 'Код домофона или двери',
  keyPickupInstructions: 'Получение ключей / замок',
  wifiName: 'Название Wi-Fi',
  wifiPassword: 'Пароль Wi-Fi',
  parkingInstructions: 'Парковка',
  houseRules: 'Правила проживания',
  quietHours: 'Тихие часы',
  checkoutInstructions: 'Инструкции по выезду',
  emergencyInstructions: 'Экстренная связь',
  cleaningLinenNotes: 'Уборка и бельё',
  publicGuestNotes: 'Заметки для гостя',
  privateOperatorNotes: 'Внутренние заметки оператора',
};

const SENSITIVE_FIELDS = new Set<PropertyKnowledgeIntakeField>(SENSITIVE_INTAKE_FIELDS);

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
  const [rawText, setRawText] = useState('');
  const [intakePropertyId, setIntakePropertyId] = useState('');
  const [intakePropertyLabel, setIntakePropertyLabel] = useState('');
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [approvedFields, setApprovedFields] = useState<PropertyKnowledgeIntakeField[]>([]);
  const [confirmedSensitiveFields, setConfirmedSensitiveFields] = useState<PropertyKnowledgeIntakeField[]>([]);
  const [parsing, setParsing] = useState(false);
  const [savingIntake, setSavingIntake] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);

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

  function selectRecord(record?: BookingOpsPropertyKnowledge) {
    setDraft(toDraft(record));
    setIntakePropertyId(record?.propertyId ?? '');
    setIntakePropertyLabel(record?.propertyLabel ?? '');
    setPreview(null);
    setMessage('');
  }

  async function parseIntake(event: FormEvent) {
    event.preventDefault();
    setParsing(true);
    setMessage('');
    setPreview(null);
    try {
      const response = await fetch('/api/dashboard/property-knowledge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'parse_intake',
          propertyId: intakePropertyId,
          propertyLabel: intakePropertyLabel,
          rawText,
        }),
      });
      const result = await readResponseJson<ApiResponse>(response, { ok: false });
      if (!response.ok || !result.ok || !result.draft) {
        setMessage(result.message || 'Не удалось распознать текст.');
        return;
      }
      const nextPreview: IntakePreview = {
        draft: result.draft,
        confidence: result.confidence ?? {},
        warnings: result.warnings ?? [],
        notFound: result.notFound ?? [],
        changedFields: result.changedFields ?? [],
        sensitiveConflicts: result.sensitiveConflicts ?? [],
      };
      setPreview(nextPreview);
      setApprovedFields(PROPERTY_KNOWLEDGE_INTAKE_FIELDS.filter((field) => Boolean(nextPreview.draft[field])));
      setConfirmedSensitiveFields([]);
      setShowSensitive(false);
    } finally {
      setParsing(false);
    }
  }

  function toggleField(field: PropertyKnowledgeIntakeField, enabled: boolean) {
    setApprovedFields((current) => enabled ? [...new Set([...current, field])] : current.filter((item) => item !== field));
    if (!enabled) setConfirmedSensitiveFields((current) => current.filter((item) => item !== field));
  }

  function setPreviewField(field: PropertyKnowledgeIntakeField, value: string) {
    setPreview((current) => current ? { ...current, draft: { ...current.draft, [field]: value } } : current);
  }

  async function saveIntake() {
    if (!preview) return;
    setSavingIntake(true);
    setMessage('');
    try {
      const response = await fetch('/api/dashboard/property-knowledge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save_intake',
          propertyId: intakePropertyId,
          draft: preview.draft,
          approvedFields,
          confirmedSensitiveFields,
        }),
      });
      const result = await readResponseJson<ApiResponse>(response, { ok: false });
      if (!response.ok || !result.ok || !result.record) {
        if (result.sensitiveConflicts?.length) {
          setPreview((current) => current ? { ...current, sensitiveConflicts: result.sensitiveConflicts ?? [] } : current);
        }
        setMessage(result.message || 'Не удалось сохранить подтверждённые поля.');
        return;
      }
      setDraft(toDraft(result.record));
      setIntakePropertyLabel(result.record.propertyLabel ?? '');
      setPreview(null);
      setRawText('');
      await load();
      setMessage(`Сохранено полей: ${result.changedFields?.length ?? 0}.`);
    } finally {
      setSavingIntake(false);
    }
  }

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

      <form onSubmit={parseIntake} className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">Загрузить данные из текста</h2>
          <p className="mt-1 text-sm text-slate-600">Текст распознаётся только для предварительного просмотра и не сохраняется. Перед записью можно отключить или исправить любое поле.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="ID объекта" value={intakePropertyId} onChange={setIntakePropertyId} required />
          <Field label="Название объекта" value={intakePropertyLabel} onChange={setIntakePropertyLabel} />
          <div className="md:col-span-2">
            <Field label="Исходные инструкции" value={rawText} onChange={setRawText} rows={10} required />
          </div>
        </div>
        <button type="submit" disabled={parsing} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {parsing ? 'Распознаём…' : 'Распознать и проверить'}
        </button>

        {preview ? (
          <div className="space-y-4 border-t border-blue-200 pt-4">
            <div>
              <h3 className="font-medium text-slate-900">Предварительный просмотр</h3>
              <p className="text-sm text-slate-600">Сохранятся только отмеченные непустые поля.</p>
            </div>
            <button type="button" className="text-left text-sm text-blue-700 hover:underline" onClick={() => setShowSensitive((current) => !current)}>
              {showSensitive ? 'Скрыть коды и пароль' : 'Показать коды и пароль'}
            </button>
            {preview.warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}
            <div className="space-y-3">
              {PROPERTY_KNOWLEDGE_INTAKE_FIELDS.filter((field) => preview.draft[field]).map((field) => {
                const isSensitiveConflict = preview.sensitiveConflicts.includes(field);
                const approved = approvedFields.includes(field);
                return (
                  <div key={field} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <input type="checkbox" checked={approved} onChange={(event) => toggleField(field, event.target.checked)} />
                        {FIELD_LABELS[field]}
                      </label>
                      <span className="text-xs text-slate-500">
                        {isSensitiveConflict
                          ? 'Нужно подтвердить замену'
                          : preview.changedFields.includes(field)
                            ? 'Будет изменено'
                            : 'Без изменений'}
                        {' · '}
                        {preview.confidence[field] === 'high' ? 'найдено по подписи' : 'проверьте распознавание'}
                      </span>
                    </div>
                    {SENSITIVE_FIELDS.has(field) ? (
                      <input
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type={showSensitive ? 'text' : 'password'}
                        autoComplete="off"
                        value={preview.draft[field] ?? ''}
                        onChange={(event) => setPreviewField(field, event.target.value)}
                      />
                    ) : (
                      <textarea
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        rows={field === 'address' || field === 'propertyLabel' ? 1 : 2}
                        value={preview.draft[field] ?? ''}
                        onChange={(event) => setPreviewField(field, event.target.value)}
                      />
                    )}
                    {isSensitiveConflict ? (
                      <label className="mt-2 flex items-start gap-2 text-sm text-amber-800">
                        <input
                          className="mt-1"
                          type="checkbox"
                          checked={confirmedSensitiveFields.includes(field)}
                          disabled={!approved}
                          onChange={(event) => setConfirmedSensitiveFields((current) => event.target.checked
                            ? [...new Set([...current, field])]
                            : current.filter((item) => item !== field))}
                        />
                        Заменить уже сохранённое защищённое значение
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {preview.notFound.length > 0 ? (
              <p className="text-sm text-slate-600">Не найдено: {preview.notFound.map((field) => FIELD_LABELS[field]).join(', ')}.</p>
            ) : null}
            <button type="button" disabled={savingIntake || approvedFields.length === 0} onClick={() => void saveIntake()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {savingIntake ? 'Сохранение…' : 'Сохранить отмеченные поля'}
            </button>
          </div>
        ) : null}
      </form>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Объекты</h2>
            <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => selectRecord()}>
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
                onClick={() => selectRecord(record)}
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
