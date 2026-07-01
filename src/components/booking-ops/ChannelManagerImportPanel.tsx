'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';

type Connection = {
  id: string; propertySetupId: string | null; provider: string; status: string; accessStatus: string;
  safeAccessConfigured: boolean; lastImportAt: string | null; lastSuccessAt: string | null; failureReason: string | null;
};
type ImportedObject = { id: string; connection_id: string; match_status: string };
type ImportedBooking = { id: string; connection_id: string; match_status: string };
type CalendarRow = { id: string; connection_id: string; availability_status: string; price_amount: number | null };

const PROVIDERS = ['manual', 'bnovo', 'realtycalendar', 'travelline', 'other'] as const;
const PROVIDER_LABELS: Record<string, string> = { manual: 'Ручной снимок', bnovo: 'Bnovo', realtycalendar: 'RealtyCalendar', travelline: 'TravelLine', other: 'Другой' };
const STATUS_LABELS: Record<string, string> = {
  not_requested: 'Не запрошен', requested: 'Запрошен', access_received: 'Доступ получен', credential_ref_pending: 'Нужна безопасная ссылка',
  connected: 'Подключено', import_ready: 'Импорт готов', import_failed: 'Ошибка импорта', disconnected: 'Отключено', blocked: 'Заблокировано',
  unknown: 'Неизвестно', received: 'Получен', invalid: 'Недействителен', expired: 'Истёк',
};

export function ChannelManagerImportPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [objects, setObjects] = useState<ImportedObject[]>([]);
  const [bookings, setBookings] = useState<ImportedBooking[]>([]);
  const [calendar, setCalendar] = useState<CalendarRow[]>([]);
  const [propertySetupId, setPropertySetupId] = useState('');
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('manual');
  const [selectedId, setSelectedId] = useState('');
  const [snapshotText, setSnapshotText] = useState('{\n  "objects": [],\n  "bookings": [],\n  "calendar": [],\n  "pricing": []\n}');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [connectionsRes, objectsRes, bookingsRes, calendarRes] = await Promise.all([
      fetch('/api/dashboard/channel-manager/connections', { credentials: 'include' }),
      fetch('/api/dashboard/channel-manager/imported-objects', { credentials: 'include' }),
      fetch('/api/dashboard/channel-manager/imported-bookings', { credentials: 'include' }),
      fetch('/api/dashboard/channel-manager/calendar', { credentials: 'include' }),
    ]);
    const [connectionPayload, objectPayload, bookingPayload, calendarPayload] = await Promise.all([
      readResponseJson<{ ok: boolean; connections?: Connection[] }>(connectionsRes, { ok: false }),
      readResponseJson<{ ok: boolean; objects?: ImportedObject[] }>(objectsRes, { ok: false }),
      readResponseJson<{ ok: boolean; bookings?: ImportedBooking[] }>(bookingsRes, { ok: false }),
      readResponseJson<{ ok: boolean; calendar?: CalendarRow[] }>(calendarRes, { ok: false }),
    ]);
    if (connectionPayload.ok) {
      setConnections(connectionPayload.connections ?? []);
      setSelectedId((current) => current || connectionPayload.connections?.[0]?.id || '');
    }
    if (objectPayload.ok) setObjects(objectPayload.objects ?? []);
    if (bookingPayload.ok) setBookings(bookingPayload.bookings ?? []);
    if (calendarPayload.ok) setCalendar(calendarPayload.calendar ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = connections.find((item) => item.id === selectedId) ?? connections[0] ?? null;
  const stats = useMemo(() => {
    const objectRows = objects.filter((item) => item.connection_id === selected?.id);
    const bookingRows = bookings.filter((item) => item.connection_id === selected?.id);
    const calendarRows = calendar.filter((item) => item.connection_id === selected?.id);
    const objectUnmatched = objectRows.filter((item) => ['unmatched', 'possible_match'].includes(item.match_status)).length;
    const bookingUnmatched = bookingRows.filter((item) => ['unmatched', 'possible_duplicate'].includes(item.match_status)).length;
    const missingPrices = calendarRows.filter((item) => item.price_amount === null).length;
    return {
      objectRows, bookingRows, calendarRows, objectUnmatched, bookingUnmatched,
      conflicts: objectUnmatched + bookingUnmatched + missingPrices,
    };
  }, [bookings, calendar, objects, selected?.id]);

  async function action(path: string, body: Record<string, unknown>) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(response, { ok: false });
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Действие не выполнено.');
      setMessage('Готово. Данные обновлены.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Действие не выполнено.'); }
    finally { setBusy(false); }
  }

  async function uploadSnapshot() {
    let snapshot: unknown;
    try { snapshot = JSON.parse(snapshotText); } catch { setMessage('Проверьте JSON: файл не читается.'); return; }
    await action('/api/dashboard/channel-manager/import-runs/action', { action: 'upload_manual_snapshot', connectionId: selected?.id, snapshot });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">МК / OTA импорт</h2>
          <p className="mt-1 text-xs text-slate-500">Без публикации в каналы. Реальные API пока не подключены; работает безопасный ручной снимок.</p>
        </div>
        {connections.length > 1 ? (
          <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            {connections.map((item) => <option key={item.id} value={item.id}>{PROVIDER_LABELS[item.provider] ?? item.provider} · {item.propertySetupId?.slice(0, 8)}</option>)}
          </select>
        ) : null}
      </div>

      {selected ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Провайдер" value={PROVIDER_LABELS[selected.provider] ?? selected.provider} />
            <Stat label="Доступ / подключение" value={`${STATUS_LABELS[selected.accessStatus] ?? selected.accessStatus} / ${STATUS_LABELS[selected.status] ?? selected.status}`} />
            <Stat label="Объекты" value={`${stats.objectRows.length} · сверено ${stats.objectRows.length - stats.objectUnmatched} · проверить ${stats.objectUnmatched}`} />
            <Stat label="Брони" value={`${stats.bookingRows.length} · сверено ${stats.bookingRows.length - stats.bookingUnmatched} · проверить ${stats.bookingUnmatched}`} />
            <Stat label="Календарь" value={stats.calendarRows.length ? `${stats.calendarRows.length} строк` : 'Нет снимка'} />
            <Stat label="Расхождения" value={String(stats.conflicts)} />
            <Stat label="Последний импорт" value={selected.lastImportAt ? new Date(selected.lastImportAt).toLocaleString('ru-RU') : 'Не запускался'} />
            <Stat label="Следующее действие" value={selected.status === 'blocked' ? 'Снять блокировку после проверки' : stats.conflicts ? 'Проверить расхождения' : selected.lastSuccessAt ? 'Готово к следующему этапу' : 'Загрузить ручной снимок'} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void action('/api/dashboard/channel-manager/connections/action', { action: 'request_access', propertySetupId: selected.propertySetupId, provider: selected.provider })} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Запросить доступ</button>
            <button disabled={busy} onClick={() => { const safeAccessRef = window.prompt('Безопасная ссылка на доступ (например, vault:cm/object-1)'); if (safeAccessRef) void action('/api/dashboard/channel-manager/connections/action', { action: 'mark_access_received', connectionId: selected.id, safeAccessRef }); }} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Доступ получен</button>
            <button disabled={busy} onClick={() => void action('/api/dashboard/channel-manager/import-runs/action', { action: 'run_dry_import', connectionId: selected.id, importType: 'manual_snapshot' })} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Проверочный запуск</button>
            <button disabled={busy} onClick={() => void action('/api/dashboard/channel-manager/reconcile', { action: 'reconcile_objects', connectionId: selected.id }).then(() => action('/api/dashboard/channel-manager/reconcile', { action: 'reconcile_bookings', connectionId: selected.id }))} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Сверить</button>
          </div>
        </>
      ) : <p className="mt-3 text-slate-500">Подключений пока нет.</p>}

      <details className="mt-4 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer font-medium text-slate-700">Дополнительные действия</summary>
        <div className="mt-3 space-y-3">
          {!selected ? (
            <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
              <input value={propertySetupId} onChange={(event) => setPropertySetupId(event.target.value)} placeholder="ID профиля объекта" className="rounded-lg border border-slate-300 px-3 py-2" />
              <select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)} className="rounded-lg border border-slate-300 px-3 py-2">{PROVIDERS.map((item) => <option key={item} value={item}>{PROVIDER_LABELS[item]}</option>)}</select>
              <button disabled={busy || !propertySetupId} onClick={() => void action('/api/dashboard/channel-manager/connections/action', { action: 'initialize_connection', propertySetupId, provider })} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50">Создать</button>
            </div>
          ) : (
            <>
              <textarea value={snapshotText} onChange={(event) => setSnapshotText(event.target.value)} rows={8} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" aria-label="Ручной снимок JSON" />
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => void uploadSnapshot()} className="rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-50">Загрузить снимок</button>
                <button disabled={busy} onClick={() => { const reason = window.prompt('Причина блокировки'); if (reason) void action('/api/dashboard/channel-manager/connections/action', { action: 'block_connection', connectionId: selected.id, reason }); }} className="rounded-lg border border-red-200 px-3 py-2 text-red-700 disabled:opacity-50">Заблокировать</button>
              </div>
              {stats.bookingRows.filter((item) => item.match_status === 'unmatched').slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span>Бронь {item.id.slice(0, 8)} требует решения</span>
                  <button disabled={busy} onClick={() => void action('/api/dashboard/channel-manager/reconcile', { action: 'create_booking_from_imported', importedBookingId: item.id })} className="text-blue-700 hover:underline">Создать в Booking Ops</button>
                </div>
              ))}
            </>
          )}
        </div>
      </details>
      {message ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-slate-700">{message}</p> : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-800">{value}</p></div>;
}
