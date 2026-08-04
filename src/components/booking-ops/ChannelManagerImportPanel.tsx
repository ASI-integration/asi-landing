'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';

type Connection = {
  id: string; propertySetupId: string | null; provider: string; status: string; accessStatus: string;
  safeAccessConfigured: boolean; lastImportAt: string | null; lastSuccessAt: string | null; failureReason: string | null;
  statusLabel?: string; realApiSyncEnabled?: boolean; manualSnapshotAvailable?: boolean;
  liveCoreEnabled?: boolean; incrementalSyncEnabled?: boolean;
};
type ImportedObject = { id: string; connection_id: string; match_status: string };
type ImportedBooking = { id: string; connection_id: string; match_status: string };
type CalendarRow = { id: string; connection_id: string; availability_status: string; price_amount: number | null };
type LiveCoreCounters = { imported: number; updated: number; cancelled: number; skipped: number; failed: number };
type LiveCoreStatus = {
  provider: string;
  connectionId: string;
  connectionState: string;
  lastSuccessfulSyncAt: string | null;
  latestRun: {
    id: string;
    status: string;
    importType: string;
    stage: string | null;
    counters: LiveCoreCounters | null;
    safeError: { stage: string; message: string } | null;
  } | null;
  counters: LiveCoreCounters | null;
  warning: string | null;
  blocker: string | null;
  liveCoreEnabled: boolean;
  incrementalSyncEnabled: boolean;
  realProviderApiEnabled: boolean;
};

const PROVIDERS = ['manual', 'bnovo', 'realtycalendar', 'travelline', 'other'] as const;
const PROVIDER_LABELS: Record<string, string> = { manual: 'Ручной снимок', bnovo: 'Bnovo', realtycalendar: 'RealtyCalendar', travelline: 'TravelLine', other: 'Другой' };
const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начато', provider_selected: 'Провайдер выбран', account_required: 'Нужен аккаунт провайдера',
  access_requested: 'Доступ запрошен', operator_review: 'Проверка оператором', manual_snapshot_available: 'Доступен импорт snapshot',
  pilot_activation_pending: 'Ожидает пилотной активации', connected_placeholder: 'Подготовка завершена — API ещё не активен',
  not_requested: 'Не запрошен', requested: 'Запрошен', access_received: 'Доступ получен', credential_ref_pending: 'Нужна безопасная ссылка',
  connected: 'Подключено', import_ready: 'Импорт готов', import_failed: 'Ошибка импорта', disconnected: 'Отключено', blocked: 'Заблокировано',
  unknown: 'Неизвестно', received: 'Получен', invalid: 'Недействителен', expired: 'Истёк',
  completed: 'Завершён', completed_with_warnings: 'Завершён с предупреждениями', failed: 'Ошибка', running: 'Выполняется',
};

export function ChannelManagerImportPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [liveCoreByConnection, setLiveCoreByConnection] = useState<Record<string, LiveCoreStatus>>({});
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
      fetch('/api/dashboard/channel-manager/provider-onboarding', { credentials: 'include' }),
      fetch('/api/dashboard/channel-manager/imported-objects', { credentials: 'include' }),
      fetch('/api/dashboard/channel-manager/imported-bookings', { credentials: 'include' }),
      fetch('/api/dashboard/channel-manager/calendar', { credentials: 'include' }),
    ]);
    const [connectionPayload, objectPayload, bookingPayload, calendarPayload] = await Promise.all([
      readResponseJson<{ ok: boolean; connections?: Connection[]; liveCoreByConnection?: Record<string, LiveCoreStatus> }>(connectionsRes, { ok: false }),
      readResponseJson<{ ok: boolean; objects?: ImportedObject[] }>(objectsRes, { ok: false }),
      readResponseJson<{ ok: boolean; bookings?: ImportedBooking[] }>(bookingsRes, { ok: false }),
      readResponseJson<{ ok: boolean; calendar?: CalendarRow[] }>(calendarRes, { ok: false }),
    ]);
    if (connectionPayload.ok) {
      setConnections(connectionPayload.connections ?? []);
      setLiveCoreByConnection(connectionPayload.liveCoreByConnection ?? {});
      setSelectedId((current) => current || connectionPayload.connections?.[0]?.id || '');
    }
    if (objectPayload.ok) setObjects(objectPayload.objects ?? []);
    if (bookingPayload.ok) setBookings(bookingPayload.bookings ?? []);
    if (calendarPayload.ok) setCalendar(calendarPayload.calendar ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = connections.find((item) => item.id === selectedId) ?? connections[0] ?? null;
  const liveCore = selected ? liveCoreByConnection[selected.id] ?? null : null;
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
    await action('/api/dashboard/channel-manager/provider-onboarding/action', { action: 'upload_manual_snapshot', connectionId: selected?.id, snapshot });
  }

  async function runInitialSync() {
    let snapshot: unknown | undefined;
    try {
      const parsed = JSON.parse(snapshotText) as { objects?: unknown[]; bookings?: unknown[]; calendar?: unknown[]; pricing?: unknown[] };
      const hasRows = [parsed.objects, parsed.bookings, parsed.calendar, parsed.pricing].some((rows) => Array.isArray(rows) && rows.length > 0);
      snapshot = hasRows ? parsed : undefined;
    } catch {
      setMessage('Проверьте JSON: файл не читается.');
      return;
    }
    await action('/api/dashboard/channel-manager/import-runs', {
      action: 'run_initial_sync',
      connectionId: selected?.id,
      ...(snapshot ? { snapshot } : {}),
    });
  }

  const onboardingAction = (body: Record<string, unknown>) => action('/api/dashboard/channel-manager/provider-onboarding/action', body);
  const targetPropertySetupId = selected?.propertySetupId || propertySetupId;
  const liveCounters = liveCore?.counters ?? liveCore?.latestRun?.counters;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Менеджер каналов</h2>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">ASI уже подготовил объектный и операционный контур. Выберите менеджер каналов, через который будут подтягиваться объекты, брони, календарь и цены. В пилотной версии доступ фиксируется безопасно, данные можно загрузить snapshot-импортом, а API-синхронизация включается после настройки конкретного провайдера.</p>
        </div>
        {connections.length > 1 ? (
          <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            {connections.map((item) => <option key={item.id} value={item.id}>{PROVIDER_LABELS[item.provider] ?? item.provider} · {item.propertySetupId?.slice(0, 8)}</option>)}
          </select>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {PROVIDERS.filter((item) => item !== 'other').map((item) => {
          const existing = connections.find((connection) => connection.provider === item && (!targetPropertySetupId || connection.propertySetupId === targetPropertySetupId));
          const description = item === 'manual' ? 'Ручной импорт данных без подключения внешнего API.' : 'Подготовка безопасного подключения для пилота.';
          return (
            <div key={item} className={`rounded-xl border p-3 ${existing?.id === selected?.id ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-slate-900">{PROVIDER_LABELS[item]}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{existing?.statusLabel ?? STATUS_LABELS[existing?.status ?? 'not_started'] ?? 'Не начато'}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
              <p className="mt-2 text-xs font-medium text-slate-700">{item === 'manual' ? 'Импорт через snapshot' : 'API-синхронизация: готовится для пилота'}</p>
              <button
                disabled={busy || !targetPropertySetupId}
                onClick={() => existing ? setSelectedId(existing.id) : void onboardingAction({ action: 'select_provider', propertySetupId: targetPropertySetupId, provider: item })}
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-white disabled:opacity-50"
              >{existing ? 'Открыть' : 'Выбрать'}</button>
            </div>
          );
        })}
      </div>
      {!targetPropertySetupId ? <p className="mt-2 text-xs text-amber-700">Чтобы выбрать провайдера, укажите ID профиля объекта в дополнительных действиях.</p> : null}

      {selected ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Провайдер" value={PROVIDER_LABELS[selected.provider] ?? selected.provider} />
            <Stat label="Доступ / подключение" value={`${STATUS_LABELS[selected.accessStatus] ?? selected.accessStatus} / ${selected.statusLabel ?? STATUS_LABELS[selected.status] ?? selected.status}`} />
            <Stat label="Объекты" value={`${stats.objectRows.length} · сверено ${stats.objectRows.length - stats.objectUnmatched} · проверить ${stats.objectUnmatched}`} />
            <Stat label="Брони" value={`${stats.bookingRows.length} · сверено ${stats.bookingRows.length - stats.bookingUnmatched} · проверить ${stats.bookingUnmatched}`} />
            <Stat label="Календарь" value={stats.calendarRows.length ? `${stats.calendarRows.length} строк` : 'Нет снимка'} />
            <Stat label="Расхождения" value={String(stats.conflicts)} />
            <Stat label="Последний импорт" value={selected.lastImportAt ? new Date(selected.lastImportAt).toLocaleString('ru-RU') : 'Не запускался'} />
            <Stat label="Следующее действие" value={selected.status === 'blocked' ? 'Снять блокировку после проверки' : stats.conflicts ? 'Проверить расхождения' : selected.lastSuccessAt ? 'Готово к следующему этапу' : 'Загрузить ручной снимок'} />
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3" data-testid="channel-live-core-status">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-slate-900">Live Core — начальная синхронизация</h3>
                <p className="mt-1 text-xs text-slate-600">Одноразовый read-only sync через reference adapter. Incremental polling и реальные API провайдеров ещё не подключены.</p>
              </div>
              <button
                disabled={busy || selected.status === 'blocked'}
                onClick={() => void runInitialSync()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
              >Запустить initial sync</button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Провайдер" value={PROVIDER_LABELS[liveCore?.provider ?? selected.provider] ?? selected.provider} />
              <Stat label="Состояние подключения" value={STATUS_LABELS[liveCore?.connectionState ?? selected.status] ?? liveCore?.connectionState ?? selected.status} />
              <Stat label="Последний успешный sync" value={liveCore?.lastSuccessfulSyncAt ? new Date(liveCore.lastSuccessfulSyncAt).toLocaleString('ru-RU') : selected.lastSuccessAt ? new Date(selected.lastSuccessAt).toLocaleString('ru-RU') : 'Ещё не было'} />
              <Stat label="Последний запуск" value={liveCore?.latestRun ? `${STATUS_LABELS[liveCore.latestRun.status] ?? liveCore.latestRun.status}${liveCore.latestRun.stage ? ` · ${liveCore.latestRun.stage}` : ''}` : 'Нет запусков'} />
              <Stat label="Импортировано / обновлено" value={`${liveCounters?.imported ?? 0} / ${liveCounters?.updated ?? 0}`} />
              <Stat label="Отменено / ошибки" value={`${liveCounters?.cancelled ?? 0} / ${liveCounters?.failed ?? 0}`} />
              <Stat label="Предупреждение" value={liveCore?.warning ?? 'Нет'} />
              <Stat label="Блокер" value={liveCore?.blocker ?? 'Нет'} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void onboardingAction({ action: 'request_access', connectionId: selected.id })} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Запросить доступ</button>
            <button disabled={busy} onClick={() => { const safeAccessRef = window.prompt('Укажите только безопасную ссылку, например vault:cm/object-1. Не вставляйте пароль или API-токен.'); if (safeAccessRef) void onboardingAction({ action: 'mark_access_received', connectionId: selected.id, safeAccessRef }); }} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Отметить доступ полученным</button>
            <button disabled={busy} onClick={() => void onboardingAction({ action: 'run_reconciliation', connectionId: selected.id })} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Запустить сверку</button>
            <button disabled={busy} onClick={() => void onboardingAction({ action: 'mark_pilot_activation_pending', connectionId: selected.id })} className="rounded-lg border border-blue-300 px-3 py-1.5 text-blue-800 hover:bg-blue-50 disabled:opacity-50">Готово к пилотному подключению</button>
          </div>
          <p className="mt-2 text-xs text-amber-700">Не вставляйте пароль или API-токен сюда. Передайте доступ через согласованный безопасный канал.</p>
        </>
      ) : <p className="mt-3 text-slate-500">Подключений пока нет.</p>}

      <details className="mt-4 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer font-medium text-slate-700">Дополнительные действия</summary>
        <div className="mt-3 space-y-3">
          {!selected ? (
            <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
              <input value={propertySetupId} onChange={(event) => setPropertySetupId(event.target.value)} placeholder="ID профиля объекта" className="rounded-lg border border-slate-300 px-3 py-2" />
              <select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)} className="rounded-lg border border-slate-300 px-3 py-2">{PROVIDERS.map((item) => <option key={item} value={item}>{PROVIDER_LABELS[item]}</option>)}</select>
              <button disabled={busy || !propertySetupId} onClick={() => void onboardingAction({ action: 'select_provider', propertySetupId, provider })} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50">Выбрать</button>
            </div>
          ) : (
            <>
              <textarea value={snapshotText} onChange={(event) => setSnapshotText(event.target.value)} rows={8} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" aria-label="Ручной снимок JSON" />
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => void uploadSnapshot()} className="rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-50">Загрузить snapshot</button>
                <button disabled={busy} onClick={() => void runInitialSync()} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50">Запустить initial sync</button>
                <button disabled={busy} onClick={() => void onboardingAction({ action: 'request_account_creation', connectionId: selected.id })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Нужен аккаунт провайдера</button>
                <button disabled={busy} onClick={() => void onboardingAction({ action: 'mark_account_created', connectionId: selected.id })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Аккаунт создан</button>
                <button disabled={busy} onClick={() => void onboardingAction({ action: 'mark_operator_review', connectionId: selected.id })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Передать на проверку</button>
                <button disabled={busy} onClick={() => void onboardingAction({ action: 'mark_import_ready', connectionId: selected.id })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Готово к импорту</button>
                <button disabled={busy} onClick={() => void onboardingAction({ action: 'mark_connected_placeholder', connectionId: selected.id })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Подготовка завершена</button>
                <button disabled={busy} onClick={() => { const note = window.prompt('Заметка без паролей и токенов'); if (note) void onboardingAction({ action: 'add_note', connectionId: selected.id, note }); }} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Добавить заметку</button>
                <button disabled={busy} onClick={() => { const reason = window.prompt('Причина блокировки'); if (reason) void onboardingAction({ action: 'block_connection', connectionId: selected.id, reason }); }} className="rounded-lg border border-red-200 px-3 py-2 text-red-700 disabled:opacity-50">Заблокировать</button>
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
