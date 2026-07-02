'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';

type Props = {
  bookingId?: string | null;
  propertySetupId?: string | null;
  propertyId?: string | null;
  initialDateFrom?: string | null;
  initialDateTo?: string | null;
};

type AvailabilityStatus = {
  status: string;
  activeHolds: Array<Record<string, unknown>>;
  activeBlocks: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  lastCheck: Record<string, unknown> | null;
  blockers: string[];
  nextAction: string;
  horizon?: { next7Days: number; next14Days: number };
};

const STATUS_LABELS: Record<string, string> = {
  unchecked: 'Не проверено', no_conflict: 'Пересечений нет', possible_conflict: 'Возможен конфликт',
  confirmed_conflict: 'Конфликт подтверждён', missing_data: 'Не хватает данных', failed: 'Проверка не завершена',
};

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : '';
}

export function AvailabilityOverbookingPanel(props: Props) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tomorrow = useMemo(() => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10);
  }, []);
  const [dateFrom, setDateFrom] = useState(dateOnly(props.initialDateFrom) || today);
  const [dateTo, setDateTo] = useState(dateOnly(props.initialDateTo) || tomorrow);
  const [status, setStatus] = useState<AvailabilityStatus | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (props.initialDateFrom) setDateFrom(dateOnly(props.initialDateFrom)); }, [props.initialDateFrom]);
  useEffect(() => { if (props.initialDateTo) setDateTo(dateOnly(props.initialDateTo)); }, [props.initialDateTo]);

  const params = useCallback(() => {
    const query = new URLSearchParams();
    if (props.bookingId) query.set('booking_id', props.bookingId);
    if (props.propertySetupId) query.set('property_setup_id', props.propertySetupId);
    if (props.propertyId) query.set('property_id', props.propertyId);
    if (dateFrom) query.set('date_from', dateFrom);
    if (dateTo) query.set('date_to', dateTo);
    return query;
  }, [props.bookingId, props.propertyId, props.propertySetupId, dateFrom, dateTo]);

  const load = useCallback(async () => {
    if (!props.bookingId && !props.propertyId && !props.propertySetupId) { setStatus(null); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard/availability/status?${params()}`, { credentials: 'include' });
      const payload = await readResponseJson<{ ok: boolean; status?: AvailabilityStatus; message?: string }>(response, { ok: false });
      if (!response.ok || !payload.ok || !payload.status) setMessage(payload.message ?? 'Не удалось загрузить доступность.');
      else { setStatus(payload.status); setMessage(''); }
    } finally { setLoading(false); }
  }, [params, props.bookingId, props.propertyId, props.propertySetupId]);

  useEffect(() => { void load(); }, [load]);

  async function action(name: string, extra: Record<string, unknown> = {}) {
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/dashboard/availability/action', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: name, bookingId: props.bookingId, propertySetupId: props.propertySetupId,
          propertyId: props.propertyId, dateFrom, dateTo, ...extra,
        }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(response, { ok: false });
      setMessage(response.ok && payload.ok ? 'Действие выполнено.' : payload.message ?? 'Действие не выполнено.');
      if (response.ok && payload.ok) await load();
    } finally { setLoading(false); }
  }

  async function explain() {
    const query = new URLSearchParams();
    const checkId = status?.lastCheck?.id;
    if (checkId) query.set('check_id', String(checkId));
    else if (props.bookingId) query.set('booking_id', props.bookingId);
    else { setMessage('Сначала запустите проверку.'); return; }
    const response = await fetch(`/api/dashboard/availability/explain?${query}`, { credentials: 'include' });
    const payload = await readResponseJson<{ ok: boolean; explanation?: { safeSummary?: string; blockers?: string[] }; message?: string }>(response, { ok: false });
    setMessage(payload.explanation?.safeSummary ?? payload.message ?? 'Пояснение не найдено.');
  }

  const firstHold = status?.activeHolds[0];
  const firstBlock = status?.activeBlocks[0];
  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Доступность / овербукинг</h2>
          <p className="mt-1 text-sm text-slate-600">{STATUS_LABELS[status?.status ?? 'unchecked'] ?? status?.status ?? 'Не проверено'}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
          <span>Удержания: {status?.activeHolds.length ?? 0}</span><span>Закрытия: {status?.activeBlocks.length ?? 0}</span>
          <span>Конфликты: {status?.conflicts.length ?? 0}</span><span>Последняя проверка: {status?.lastCheck ? 'есть' : 'нет'}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">Заезд<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-slate-600">Выезд<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm" /></label>
        <button disabled={loading} onClick={() => void action('check_conflict')} className="rounded bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Проверить</button>
        <button disabled={loading} onClick={() => void action('create_hold')} className="rounded border border-slate-300 px-3 py-2 text-xs font-medium">Создать удержание</button>
        <button disabled={loading} onClick={() => void action('create_block', { reason: 'Закрыто оператором' })} className="rounded border border-slate-300 px-3 py-2 text-xs font-medium">Закрыть даты</button>
        <button disabled={loading} onClick={() => void action('expire_holds')} className="rounded border border-slate-300 px-3 py-2 text-xs font-medium">Очистить старые</button>
      </div>
      {(firstHold || firstBlock || props.bookingId) ? <div className="flex flex-wrap gap-2">
        {firstHold ? <button disabled={loading} onClick={() => void action('release_hold', { holdId: firstHold.id })} className="text-xs text-blue-700 hover:underline">Освободить удержание</button> : null}
        {firstHold && firstHold.conflict_status === 'no_conflict' ? <button disabled={loading} onClick={() => void action('confirm_hold', { holdId: firstHold.id })} className="text-xs text-blue-700 hover:underline">Подтвердить удержание</button> : null}
        {firstBlock ? <button disabled={loading} onClick={() => void action('release_block', { blockId: firstBlock.id })} className="text-xs text-blue-700 hover:underline">Снять закрытие</button> : null}
        {props.bookingId ? <button disabled={loading} onClick={() => void action('mark_needs_review')} className="text-xs text-amber-800 hover:underline">Отметить: нужна проверка</button> : null}
        <button disabled={loading} onClick={() => void explain()} className="text-xs text-blue-700 hover:underline">Показать пояснение</button>
        {status?.lastCheck ? <button disabled={loading} onClick={() => {
          const note = window.prompt('Заметка оператора');
          if (note) void action('add_note', { checkId: status.lastCheck?.id, note });
        }} className="text-xs text-blue-700 hover:underline">Добавить заметку</button> : null}
      </div> : null}
      <p className="text-sm text-slate-700">Следующее действие: {status?.nextAction ?? 'Укажите объект и даты.'}</p>
      {status?.blockers.length ? <p className="text-sm text-red-700">{status.blockers.join(' ')}</p> : null}
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer">Ближайшие 7/14 дней и пояснение</summary>
        <p className="mt-2">Активных диапазонов: на 7 дней — {status?.horizon?.next7Days ?? 0}, на 14 дней — {status?.horizon?.next14Days ?? 0}. Дата выезда предыдущего гостя не считается занятой ночью.</p>
      </details>
    </section>
  );
}
