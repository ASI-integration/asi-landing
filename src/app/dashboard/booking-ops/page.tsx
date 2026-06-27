'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import { readResponseJson } from '@/lib/safeResponseJson';
import {
  BOOKING_OPS_CHECKIN_READINESS_STATUS_LABELS_RU,
  BOOKING_OPS_CHECKIN_READINESS_STATUSES,
  BOOKING_OPS_CONTRACT_STATUS_LABELS_RU,
  BOOKING_OPS_CONTRACT_STATUSES,
  BOOKING_OPS_DEPOSIT_STATUS_LABELS_RU,
  BOOKING_OPS_DEPOSIT_STATUSES,
  BOOKING_OPS_DOCUMENTS_STATUS_LABELS_RU,
  BOOKING_OPS_DOCUMENTS_STATUSES,
  BOOKING_OPS_MVD_STATUS_LABELS_RU,
  BOOKING_OPS_MVD_STATUSES,
  BOOKING_OPS_NEXT_ACTION_LABELS_RU,
  BOOKING_OPS_STATUS_LABELS_RU,
  BOOKING_OPS_STATUSES,
  type BookingOpsCheckinReadinessStatus,
  type BookingOpsContractStatus,
  type BookingOpsDepositStatus,
  type BookingOpsDocumentsStatus,
  type BookingOpsMvdStatus,
  type BookingOpsRecord,
  type BookingOpsStatus,
} from '@/lib/booking-ops/types';

type ListResponse = {
  ok: boolean;
  message?: string;
  records: BookingOpsRecord[];
  isOpsAdmin?: boolean;
  refreshedAt?: string;
};

type SaveResponse = {
  ok: boolean;
  message?: string;
  record?: BookingOpsRecord;
};

const AUTOMATION_TONE: Record<string, string> = {
  action_required: 'border-amber-200 bg-amber-50 text-amber-900',
  waiting: 'border-sky-200 bg-sky-50 text-sky-900',
  needs_operator_attention: 'border-rose-200 bg-rose-50 text-rose-900',
  blocked: 'border-red-300 bg-red-50 text-red-900',
  manual_override: 'border-violet-200 bg-violet-50 text-violet-900',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  paused: 'border-slate-200 bg-slate-50 text-slate-700',
  automatic_action_available: 'border-indigo-200 bg-indigo-50 text-indigo-900',
};

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

type EditDraft = {
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  guestTelegram: string;
  propertyId: string;
  propertyLabel: string;
  otaSource: string;
  checkInAt: string;
  checkOutAt: string;
  opsStatus: BookingOpsStatus;
  documentsStatus: BookingOpsDocumentsStatus;
  contractStatus: BookingOpsContractStatus;
  depositStatus: BookingOpsDepositStatus;
  mvdStatus: BookingOpsMvdStatus;
  checkinReadinessStatus: BookingOpsCheckinReadinessStatus;
  isBlocked: boolean;
  blockerReason: string;
  manualNextAction: string;
  notes: string;
};

function draftFromRecord(record: BookingOpsRecord): EditDraft {
  return {
    guestName: record.guestName ?? '',
    guestPhone: record.guestPhone ?? '',
    guestEmail: record.guestEmail ?? '',
    guestTelegram: record.guestTelegram ?? '',
    propertyId: record.propertyId ?? '',
    propertyLabel: record.propertyLabel ?? '',
    otaSource: record.otaSource ?? '',
    checkInAt: formatDateInput(record.checkInAt),
    checkOutAt: formatDateInput(record.checkOutAt),
    opsStatus: record.opsStatus,
    documentsStatus: record.documentsStatus,
    contractStatus: record.contractStatus,
    depositStatus: record.depositStatus,
    mvdStatus: record.mvdStatus,
    checkinReadinessStatus: record.checkinReadinessStatus,
    isBlocked: record.isBlocked,
    blockerReason: record.blockerReason ?? '',
    manualNextAction: record.manualNextAction ?? '',
    notes: record.notes ?? '',
  };
}

function BookingOpsPageInner() {
  const [records, setRecords] = useState<BookingOpsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [isOpsAdmin, setIsOpsAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<EditDraft>({
    guestName: '',
    guestPhone: '',
    guestEmail: '',
    guestTelegram: '',
    propertyId: '',
    propertyLabel: '',
    otaSource: 'manual',
    checkInAt: '',
    checkOutAt: '',
    opsStatus: 'created',
    documentsStatus: 'not_started',
    contractStatus: 'not_started',
    depositStatus: 'not_started',
    mvdStatus: 'not_required',
    checkinReadinessStatus: 'not_started',
    isBlocked: false,
    blockerReason: '',
    manualNextAction: '',
    notes: '',
  });

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/booking-ops', { credentials: 'include' });
      const payload = await readResponseJson<ListResponse>(res, { ok: false, records: [] });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить операционные брони.');
        return;
      }
      setRecords(payload.records);
      setIsOpsAdmin(Boolean(payload.isOpsAdmin));
      if (selectedId) {
        const fresh = payload.records.find((record) => record.id === selectedId);
        if (fresh) setDraft(draftFromRecord(fresh));
      }
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  function selectRecord(record: BookingOpsRecord) {
    setSelectedId(record.id);
    setDraft(draftFromRecord(record));
    setMessage('');
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!isOpsAdmin || !selectedId || !draft) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestName: draft.guestName,
          guestPhone: draft.guestPhone,
          guestEmail: draft.guestEmail,
          guestTelegram: draft.guestTelegram,
          propertyId: draft.propertyId,
          propertyLabel: draft.propertyLabel,
          otaSource: draft.otaSource,
          checkInAt: draft.checkInAt || null,
          checkOutAt: draft.checkOutAt || null,
          opsStatus: draft.opsStatus,
          documentsStatus: draft.documentsStatus,
          contractStatus: draft.contractStatus,
          depositStatus: draft.depositStatus,
          mvdStatus: draft.mvdStatus,
          checkinReadinessStatus: draft.checkinReadinessStatus,
          isBlocked: draft.isBlocked,
          blockerReason: draft.blockerReason,
          manualNextAction: draft.manualNextAction,
          notes: draft.notes,
        }),
      });
      const payload = await readResponseJson<SaveResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.record) {
        setMessage(payload.message || 'Не удалось сохранить изменения.');
        return;
      }
      setRecords((prev) => prev.map((item) => (item.id === payload.record!.id ? payload.record! : item)));
      setDraft(draftFromRecord(payload.record));
      setMessage('Изменения сохранены.');
    } finally {
      setSaving(false);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!isOpsAdmin) return;
    setCreating(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/booking-ops', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestName: createDraft.guestName,
          guestPhone: createDraft.guestPhone,
          guestEmail: createDraft.guestEmail,
          guestTelegram: createDraft.guestTelegram,
          propertyId: createDraft.propertyId,
          propertyLabel: createDraft.propertyLabel,
          otaSource: createDraft.otaSource,
          checkInAt: createDraft.checkInAt || null,
          checkOutAt: createDraft.checkOutAt || null,
          opsStatus: createDraft.opsStatus,
          documentsStatus: createDraft.documentsStatus,
          contractStatus: createDraft.contractStatus,
          depositStatus: createDraft.depositStatus,
          mvdStatus: createDraft.mvdStatus,
          checkinReadinessStatus: createDraft.checkinReadinessStatus,
          notes: createDraft.notes,
        }),
      });
      const payload = await readResponseJson<SaveResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.record) {
        setMessage(payload.message || 'Не удалось создать запись.');
        return;
      }
      setRecords((prev) => [payload.record!, ...prev]);
      setShowCreate(false);
      selectRecord(payload.record);
      setMessage('Операционная запись создана.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Операции по броням</h1>
          <p className="mt-2 text-lg text-slate-500 leading-relaxed">
            Документы, договор, депозит, МВД и готовность к заезду — ручной контур с подсказкой следующего шага.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Обновить
          </button>
          {isOpsAdmin ? (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {showCreate ? 'Скрыть форму' : 'Добавить запись'}
            </button>
          ) : null}
        </div>
      </header>

      {message ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      {showCreate && isOpsAdmin ? (
        <form onSubmit={onCreate} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Новая операционная запись</h2>
          <RecordFields draft={createDraft} onChange={setCreateDraft} />
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {creating ? 'Создание…' : 'Создать'}
          </button>
        </form>
      ) : null}

      {loading ? (
        <p className="text-slate-500">Загрузка…</p>
      ) : records.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-5 text-slate-600">
          Пока нет операционных записей по броням.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Гость</th>
                  <th className="px-4 py-3 font-medium">Заезд</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">След. шаг</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const nextAction = record.automation?.nextAction;
                  const isSelected = record.id === selectedId;
                  return (
                    <tr
                      key={record.id}
                      className={`border-t border-slate-100 cursor-pointer ${isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                      onClick={() => selectRecord(record)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{record.guestName || '—'}</div>
                        <div className="text-slate-500">{record.propertyLabel || record.propertyId || '—'}</div>
                        {record.bookingId ? (
                          <div className="mt-1 text-xs text-emerald-700">Из брони · {record.bookingId}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{formatWhen(record.checkInAt)}</td>
                      <td className="px-4 py-3">{BOOKING_OPS_STATUS_LABELS_RU[record.opsStatus]}</td>
                      <td className="px-4 py-3">
                        {nextAction ? BOOKING_OPS_NEXT_ACTION_LABELS_RU[nextAction] : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedRecord && draft && isOpsAdmin ? (
            <form onSubmit={onSave} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Редактирование</h2>
                  {selectedRecord.bookingId ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Создано из брони · ID: {selectedRecord.bookingId}
                      {selectedRecord.otaSource ? ` · ${selectedRecord.otaSource}` : ''}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">Обновлено: {formatWhen(selectedRecord.updatedAt)}</span>
              </div>

              {selectedRecord.automation ? (
                <div
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    AUTOMATION_TONE[selectedRecord.automation.automationState] ?? AUTOMATION_TONE.action_required
                  }`}
                >
                  <p className="font-medium">
                    Следующее действие:{' '}
                    {BOOKING_OPS_NEXT_ACTION_LABELS_RU[selectedRecord.automation.nextAction]}
                  </p>
                  <p className="mt-1">{selectedRecord.automation.reason}</p>
                  {selectedRecord.automation.blockers.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 space-y-1">
                      {selectedRecord.automation.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <RecordFields draft={draft} onChange={setDraft} />

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.isBlocked}
                  onChange={(event) => setDraft({ ...draft, isBlocked: event.target.checked })}
                />
                Заблокировано
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Причина блокировки</span>
                <input
                  value={draft.blockerReason}
                  onChange={(event) => setDraft({ ...draft, blockerReason: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Ручной следующий шаг</span>
                <input
                  value={draft.manualNextAction}
                  onChange={(event) => setDraft({ ...draft, manualNextAction: event.target.value })}
                  placeholder="Оставьте пустым для автоматической подсказки"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Заметки</span>
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </form>
          ) : selectedRecord ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Выберите запись для просмотра. Редактирование доступно администратору OPS.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Выберите запись в списке слева.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecordFields({
  draft,
  onChange,
}: {
  draft: EditDraft;
  onChange: (value: EditDraft) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Имя гостя</span>
        <input
          required
          value={draft.guestName}
          onChange={(event) => onChange({ ...draft, guestName: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Телефон</span>
        <input
          value={draft.guestPhone}
          onChange={(event) => onChange({ ...draft, guestPhone: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Email</span>
        <input
          value={draft.guestEmail}
          onChange={(event) => onChange({ ...draft, guestEmail: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Telegram</span>
        <input
          value={draft.guestTelegram}
          onChange={(event) => onChange({ ...draft, guestTelegram: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Объект (ID)</span>
        <input
          value={draft.propertyId}
          onChange={(event) => onChange({ ...draft, propertyId: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Объект (название)</span>
        <input
          value={draft.propertyLabel}
          onChange={(event) => onChange({ ...draft, propertyLabel: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Источник / OTA</span>
        <input
          value={draft.otaSource}
          onChange={(event) => onChange({ ...draft, otaSource: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Статус контура</span>
        <select
          value={draft.opsStatus}
          onChange={(event) => onChange({ ...draft, opsStatus: event.target.value as BookingOpsStatus })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        >
          {BOOKING_OPS_STATUSES.map((item) => (
            <option key={item} value={item}>
              {BOOKING_OPS_STATUS_LABELS_RU[item]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Заезд</span>
        <input
          type="date"
          value={draft.checkInAt}
          onChange={(event) => onChange({ ...draft, checkInAt: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Выезд</span>
        <input
          type="date"
          value={draft.checkOutAt}
          onChange={(event) => onChange({ ...draft, checkOutAt: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <StatusSelect
        label="Документы"
        value={draft.documentsStatus}
        options={BOOKING_OPS_DOCUMENTS_STATUSES}
        labels={BOOKING_OPS_DOCUMENTS_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, documentsStatus: value })}
      />
      <StatusSelect
        label="Договор"
        value={draft.contractStatus}
        options={BOOKING_OPS_CONTRACT_STATUSES}
        labels={BOOKING_OPS_CONTRACT_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, contractStatus: value })}
      />
      <StatusSelect
        label="Депозит"
        value={draft.depositStatus}
        options={BOOKING_OPS_DEPOSIT_STATUSES}
        labels={BOOKING_OPS_DEPOSIT_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, depositStatus: value })}
      />
      <StatusSelect
        label="МВД"
        value={draft.mvdStatus}
        options={BOOKING_OPS_MVD_STATUSES}
        labels={BOOKING_OPS_MVD_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, mvdStatus: value })}
      />
      <StatusSelect
        label="Готовность к заезду"
        value={draft.checkinReadinessStatus}
        options={BOOKING_OPS_CHECKIN_READINESS_STATUSES}
        labels={BOOKING_OPS_CHECKIN_READINESS_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, checkinReadinessStatus: value })}
      />
    </div>
  );
}

function StatusSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      >
        {options.map((item) => (
          <option key={item} value={item}>
            {labels[item]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function BookingOpsPage() {
  return (
    <CrmAccessGuard>
      <BookingOpsPageInner />
    </CrmAccessGuard>
  );
}
