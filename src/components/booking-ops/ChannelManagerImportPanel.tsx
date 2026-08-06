'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import { useSession } from '@/contexts/SessionContext';

type Connection = {
  id: string; propertySetupId: string | null; provider: string; status: string; accessStatus: string;
  safeAccessConfigured: boolean; lastImportAt: string | null; lastSuccessAt: string | null; failureReason: string | null;
  statusLabel?: string; realApiSyncEnabled?: boolean; manualSnapshotAvailable?: boolean;
  liveCoreEnabled?: boolean; incrementalSyncEnabled?: boolean;
};
type ImportedObject = { id: string; connection_id: string; match_status: string };
type ImportedBooking = { id: string; connection_id: string; match_status: string };
type CalendarRow = { id: string; connection_id: string; availability_status: string; price_amount: number | null };
type LiveCoreCounters = {
  imported: number;
  updated: number;
  cancelled: number;
  skipped: number;
  failed: number;
  created?: number;
  restored?: number;
  calendarDays?: number;
  prices?: number;
};
type LiveCoreStatus = {
  provider: string;
  connectionId: string;
  connectionState: string;
  lastSuccessfulSyncAt: string | null;
  lastSuccessfulInitialSyncAt?: string | null;
  lastSuccessfulIncrementalSyncAt?: string | null;
  latestRun: {
    id: string;
    status: string;
    importType: string;
    stage: string | null;
    counters: LiveCoreCounters | null;
    safeError: { stage: string; message: string } | null;
  } | null;
  latestIncrementalRun?: {
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
  retryable?: boolean;
  liveCoreEnabled: boolean;
  initialSyncEnabled?: boolean;
  incrementalSyncEnabled: boolean;
  realProviderApiEnabled: boolean;
  schemaReady?: boolean;
  cursorPresent?: boolean;
  cursorUpdatedAt?: string | null;
  cursorSourceRunId?: string | null;
  cursorCheckpointHash?: string | null;
};

type AcceptanceStepStatus = 'waiting' | 'running' | 'passed' | 'failed';
type AcceptanceEvidence = {
  acceptanceExecutionId?: string | null;
  schemaReady: boolean;
  ownerSetupId: string | null;
  propertySetupId: string | null;
  connectionId: string | null;
  firstRunId: string | null;
  secondRunId: string | null;
  bookingOpsRecordId: string | null;
  firstRunStatus: string | null;
  secondRunStatus: string | null;
  importedFirstRun: number | null;
  importedSecondRun: number | null;
  updatedFirstRun?: number | null;
  updatedSecondRun?: number | null;
  duplicateCount: number | null;
  recoveryRequired?: boolean | null;
  recoverySafeToCleanup?: boolean | null;
  recoveryBlockerCode?: string | null;
  recoveryBlockerSummary?: string | null;
  recoveryExpectedDeletionTotal?: number | null;
  calendarRowCount?: number | null;
  selfConflictCount?: number | null;
  passed: boolean;
  blocker: string | null;
  failedStep: string | null;
  steps: Array<{ key: string; label: string; status: AcceptanceStepStatus; detail: string | null }>;
};

type RecoveryPreview = {
  recoveryRequired: boolean;
  safeToCleanup: boolean;
  blockerCode: string;
  blockerSummary: string | null;
  mainRecord: { id: string; classification?: string | null } | null;
  countsByTable: Record<string, number>;
  expectedDeletionTotal: number;
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

const ACCEPTANCE_STEP_STATUS_RU: Record<AcceptanceStepStatus, string> = {
  waiting: 'ожидание',
  running: 'выполняется',
  passed: 'пройден',
  failed: 'ошибка',
};

export function ChannelManagerImportPanel() {
  const { session } = useSession();
  const isDevelopmentOwner = session?.isDevelopmentOwner === true;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [liveCoreByConnection, setLiveCoreByConnection] = useState<Record<string, LiveCoreStatus>>({});
  const [objects, setObjects] = useState<ImportedObject[]>([]);
  const [bookings, setBookings] = useState<ImportedBooking[]>([]);
  const [calendar, setCalendar] = useState<CalendarRow[]>([]);
  const [propertySetupId, setPropertySetupId] = useState('');
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('manual');
  const [selectedId, setSelectedId] = useState('');
  const [snapshotText, setSnapshotText] = useState('{\n  "objects": [],\n  "bookings": [],\n  "calendar": [],\n  "pricing": []\n}');
  const [incrementalDeltaText, setIncrementalDeltaText] = useState(
    '{\n  "bookings": [],\n  "calendar": [],\n  "pricing": [],\n  "currentCursor": null,\n  "nextCursor": { "stream": "incremental", "checkpoint": "cursor-1" },\n  "hasMore": false\n}',
  );
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [acceptanceBusy, setAcceptanceBusy] = useState(false);
  const [acceptanceEvidence, setAcceptanceEvidence] = useState<AcceptanceEvidence | null>(null);
  const [acceptanceSchemaReady, setAcceptanceSchemaReady] = useState<boolean | null>(null);
  const [acceptanceUnavailableReason, setAcceptanceUnavailableReason] = useState(
    'Тестовый контур Live Core ещё не подготовлен. Нажмите «Подготовить и запустить тест».',
  );
  const [acceptanceError, setAcceptanceError] = useState('');
  const [recoveryPreview, setRecoveryPreview] = useState<RecoveryPreview | null>(null);
  const [recoveryConfirmPhrase, setRecoveryConfirmPhrase] = useState('');
  const [recoveryCleanupMessage, setRecoveryCleanupMessage] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);

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

  const loadAcceptanceStatus = useCallback(async () => {
    if (!isDevelopmentOwner) return;
    const response = await fetch('/api/dashboard/channel-manager/live-core-acceptance', { credentials: 'include' });
    const payload = await readResponseJson<{
      ok: boolean;
      schemaReady?: boolean;
      unavailableReason?: string;
      message?: string;
      recovery?: RecoveryPreview;
    }>(response, { ok: false });
    if (!response.ok || !payload.ok) {
      setAcceptanceSchemaReady(false);
      setAcceptanceUnavailableReason(payload.message || 'Не удалось проверить готовность Live Core.');
      return;
    }
    setAcceptanceSchemaReady(payload.schemaReady === true);
    setAcceptanceUnavailableReason(
      payload.unavailableReason
        || (payload.schemaReady
          ? 'Тестовый контур Live Core ещё не подготовлен. Нажмите «Подготовить и запустить тест».'
          : 'Миграция Channel Manager Live Core ещё не применена.'),
    );
    if (payload.recovery) setRecoveryPreview(payload.recovery);
  }, [isDevelopmentOwner]);

  useEffect(() => { void loadAcceptanceStatus(); }, [loadAcceptanceStatus]);

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

  async function runIncrementalSync() {
    let delta: unknown;
    try {
      delta = JSON.parse(incrementalDeltaText);
    } catch {
      setMessage('Проверьте JSON delta: файл не читается.');
      return;
    }
    await action('/api/dashboard/channel-manager/import-runs', {
      action: 'run_incremental_sync',
      connectionId: selected?.id,
      delta,
    });
  }

  async function runAcceptanceHarness() {
    if (!isDevelopmentOwner) return;
    const harnessOwnedLeftover = recoveryPreview?.recoveryRequired === true
      && recoveryPreview.safeToCleanup === true
      && recoveryPreview.mainRecord?.classification === 'harness_owned';
    if (recoveryPreview?.recoveryRequired && !harnessOwnedLeftover) {
      setAcceptanceError('Сначала удалите синтетические тестовые артефакты или дождитесь чистого контура.');
      return;
    }
    setAcceptanceBusy(true);
    setAcceptanceError('');
    setAcceptanceEvidence(null);
    try {
      const response = await fetch('/api/dashboard/channel-manager/live-core-acceptance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      });
      const payload = await readResponseJson<{ ok: boolean; evidence?: AcceptanceEvidence; message?: string }>(response, { ok: false });
      if (!response.ok || !payload.ok || !payload.evidence) {
        throw new Error(payload.message || 'Не удалось выполнить проверку Live Core.');
      }
      setAcceptanceEvidence(payload.evidence);
      await Promise.all([load(), loadAcceptanceStatus()]);
    } catch (error) {
      setAcceptanceError(error instanceof Error ? error.message : 'Не удалось выполнить проверку Live Core.');
    } finally {
      setAcceptanceBusy(false);
    }
  }

  async function cleanupAcceptanceHarness() {
    if (!isDevelopmentOwner) return;
    if (!window.confirm('Удалить только тестовый контур Live Core Acceptance? Обычные данные пилота не будут затронуты.')) {
      return;
    }
    setAcceptanceBusy(true);
    setAcceptanceError('');
    try {
      const response = await fetch('/api/dashboard/channel-manager/live-core-acceptance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup', confirm: true }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(response, { ok: false });
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || 'Не удалось удалить тестовый контур.');
      }
      setAcceptanceEvidence(null);
      setMessage('Тестовый контур Live Core удалён.');
      await Promise.all([load(), loadAcceptanceStatus()]);
    } catch (error) {
      setAcceptanceError(error instanceof Error ? error.message : 'Не удалось удалить тестовый контур.');
    } finally {
      setAcceptanceBusy(false);
    }
  }

  async function previewRecoveryArtifacts() {
    if (!isDevelopmentOwner) return;
    setRecoveryBusy(true);
    setRecoveryCleanupMessage('');
    setAcceptanceError('');
    try {
      const response = await fetch('/api/dashboard/channel-manager/live-core-acceptance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'preview_recovery' }),
      });
      const payload = await readResponseJson<{
        ok: boolean;
        recovery?: RecoveryPreview;
        message?: string;
      }>(response, { ok: false });
      if (!response.ok || !payload.ok || !payload.recovery) {
        throw new Error(payload.message || 'Не удалось просмотреть очистку.');
      }
      setRecoveryPreview(payload.recovery);
      setRecoveryCleanupMessage(payload.message || 'Просмотр очистки выполнен.');
    } catch (error) {
      setAcceptanceError(error instanceof Error ? error.message : 'Не удалось просмотреть очистку.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function cleanupRecoveryArtifacts() {
    if (!isDevelopmentOwner) return;
    if (!recoveryConfirmPhrase.trim()) {
      setAcceptanceError('Введите фразу подтверждения для удаления синтетических артефактов.');
      return;
    }
    setRecoveryBusy(true);
    setRecoveryCleanupMessage('');
    setAcceptanceError('');
    try {
      const response = await fetch('/api/dashboard/channel-manager/live-core-acceptance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'cleanup_recovery',
          dryRun: false,
          confirm: true,
          confirmPhrase: recoveryConfirmPhrase.trim(),
          expectedBookingOpsRecordId: recoveryPreview?.mainRecord?.id ?? null,
        }),
      });
      const payload = await readResponseJson<{
        ok: boolean;
        recovery?: RecoveryPreview;
        message?: string;
      }>(response, { ok: false });
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || 'Не удалось удалить синтетические тестовые артефакты.');
      }
      if (payload.recovery) setRecoveryPreview(payload.recovery);
      setRecoveryCleanupMessage(payload.message || 'Синтетические тестовые артефакты удалены.');
      setRecoveryConfirmPhrase('');
      await Promise.all([load(), loadAcceptanceStatus()]);
    } catch (error) {
      setAcceptanceError(error instanceof Error ? error.message : 'Не удалось удалить синтетические тестовые артефакты.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  const onboardingAction = (body: Record<string, unknown>) => action('/api/dashboard/channel-manager/provider-onboarding/action', body);
  const targetPropertySetupId = selected?.propertySetupId || propertySetupId;
  const liveCounters = liveCore?.counters ?? liveCore?.latestRun?.counters;
  const initialSyncEnabled = liveCore?.initialSyncEnabled !== false && liveCore?.schemaReady !== false && selected?.status !== 'blocked';
  const incrementalSyncEnabled = liveCore?.incrementalSyncEnabled === true && selected?.status !== 'blocked';
  const incrementalBlocker = incrementalSyncEnabled
    ? null
    : (liveCore?.blocker
      ?? (!liveCore?.lastSuccessfulInitialSyncAt
        ? 'Сначала выполните успешный Initial Sync.'
        : 'Incremental sync пока недоступен.'));
  const recoveryRequired = recoveryPreview?.recoveryRequired === true
    || acceptanceEvidence?.recoveryRequired === true;
  const harnessOwnedLeftover = recoveryPreview?.recoveryRequired === true
    && recoveryPreview.safeToCleanup === true
    && recoveryPreview.mainRecord?.classification === 'harness_owned';
  const currentAcceptanceStage = acceptanceEvidence?.steps.find((step) => step.status === 'running')?.label
    ?? acceptanceEvidence?.steps.find((step) => step.status === 'failed')?.label
    ?? (acceptanceEvidence?.passed ? 'завершено' : 'не запускался');
  // Run is allowed on a clean contour, or when only harness-owned leftovers remain (self-heal inside harness).
  const acceptanceRunEnabled = !acceptanceBusy && !recoveryBusy && (!recoveryRequired || harnessOwnedLeftover);

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

      {isDevelopmentOwner ? (
        <div
          className="mt-4 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3"
          data-testid="channel-live-core-acceptance"
        >
          <div>
            <h3 className="font-medium text-slate-900">1. Обычный Initial Sync</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Обычная начальная синхронизация по выбранному подключению остаётся ниже в блоке «Live Core — начальная синхронизация».
              Этот раздел только для владельца и не заменяет рабочий импорт.
            </p>
          </div>

          <div className="border-t border-emerald-100 pt-3" data-testid="channel-live-core-acceptance-production">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-slate-900">2. Производственный acceptance</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Безопасный синтетический тест синхронизации для владельца. Не требует ручного ввода ID профиля объекта и не вызывает реальный API менеджера каналов.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!acceptanceRunEnabled}
                  onClick={() => void runAcceptanceHarness()}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-800 disabled:opacity-50"
                  data-testid="channel-live-core-acceptance-run"
                >
                  Запустить acceptance
                </button>
                <button
                  disabled={acceptanceBusy || recoveryBusy}
                  onClick={() => void cleanupAcceptanceHarness()}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  data-testid="channel-live-core-acceptance-cleanup"
                >
                  Удалить тестовый контур
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
              <p>
                <span className="font-medium">acceptanceExecutionId: </span>
                <span className="font-mono">{acceptanceEvidence?.acceptanceExecutionId ?? '—'}</span>
              </p>
              <p>
                <span className="font-medium">Текущий этап: </span>
                {currentAcceptanceStage}
              </p>
              <p>
                <span className="font-medium">Нужна очистка: </span>
                {recoveryRequired ? 'да' : 'нет'}
              </p>
              <p>
                <span className="font-medium">Готовность схемы: </span>
                {acceptanceEvidence?.schemaReady === true || acceptanceSchemaReady === true ? 'готова' : 'не готова'}
              </p>
              <p>
                <span className="font-medium">Результат: </span>
                {acceptanceEvidence
                  ? (acceptanceEvidence.passed ? 'PASS' : 'FAIL')
                  : '—'}
              </p>
              <p>
                <span className="font-medium">Импорт / дубли: </span>
                {acceptanceEvidence
                  ? `${acceptanceEvidence.importedFirstRun ?? '—'} / ${acceptanceEvidence.importedSecondRun ?? '—'} · дублей ${acceptanceEvidence.duplicateCount ?? '—'}`
                  : '—'}
              </p>
            </div>

            {!acceptanceEvidence || !acceptanceEvidence.passed ? (
              <p className="mt-2 text-xs text-slate-700">
                <span className="font-medium">Почему сейчас недоступен обычный Live Core: </span>
                {acceptanceEvidence?.blocker || acceptanceUnavailableReason}
              </p>
            ) : null}

            {acceptanceError ? <p className="mt-3 text-xs text-red-700">{acceptanceError}</p> : null}

            {acceptanceEvidence ? (
              <div className="mt-3 space-y-3" data-testid="channel-live-core-acceptance-result">
                <ol className="space-y-1">
                  {acceptanceEvidence.steps.map((step) => (
                    <li
                      key={step.key}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-700"
                      data-acceptance-step={step.key}
                      data-acceptance-status={step.status}
                    >
                      <span className="font-medium text-slate-900">{step.label}</span>
                      <span className={
                        step.status === 'passed' ? 'text-emerald-700'
                          : step.status === 'failed' ? 'text-red-700'
                            : step.status === 'running' ? 'text-amber-700'
                              : 'text-slate-500'
                      }
                      >
                        {ACCEPTANCE_STEP_STATUS_RU[step.status]}
                      </span>
                      {step.detail ? <span className="text-slate-500">{step.detail}</span> : null}
                    </li>
                  ))}
                </ol>

                {acceptanceEvidence.passed ? (
                  <p className="text-sm font-medium text-emerald-700" data-testid="channel-live-core-acceptance-passed">
                    Acceptance пройден (PASS)
                  </p>
                ) : (
                  <p className="text-sm font-medium text-red-700" data-testid="channel-live-core-acceptance-failed">
                    FAIL на шаге: {acceptanceEvidence.steps.find((step) => step.key === acceptanceEvidence.failedStep)?.label
                      ?? acceptanceEvidence.failedStep
                      ?? 'неизвестно'}
                    {acceptanceEvidence.blocker ? ` — ${acceptanceEvidence.blocker}` : ''}
                  </p>
                )}

                <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium text-slate-700">Технические детали</summary>
                  <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                    <div><dt className="text-slate-500">acceptanceExecutionId</dt><dd className="font-mono">{acceptanceEvidence.acceptanceExecutionId ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">ownerSetupId</dt><dd className="font-mono">{acceptanceEvidence.ownerSetupId ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">propertySetupId</dt><dd className="font-mono">{acceptanceEvidence.propertySetupId ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">connectionId</dt><dd className="font-mono">{acceptanceEvidence.connectionId ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">firstRunId</dt><dd className="font-mono">{acceptanceEvidence.firstRunId ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">secondRunId</dt><dd className="font-mono">{acceptanceEvidence.secondRunId ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">bookingOpsRecordId</dt><dd className="font-mono">{acceptanceEvidence.bookingOpsRecordId ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">importedFirstRun</dt><dd>{acceptanceEvidence.importedFirstRun ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">importedSecondRun</dt><dd>{acceptanceEvidence.importedSecondRun ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">updatedFirstRun</dt><dd>{acceptanceEvidence.updatedFirstRun ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">updatedSecondRun</dt><dd>{acceptanceEvidence.updatedSecondRun ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">duplicateCount</dt><dd>{acceptanceEvidence.duplicateCount ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">calendarRowCount</dt><dd>{acceptanceEvidence.calendarRowCount ?? '—'}</dd></div>
                    <div><dt className="text-slate-500">selfConflictCount</dt><dd>{acceptanceEvidence.selfConflictCount ?? '—'}</dd></div>
                  </dl>
                </details>
              </div>
            ) : null}
          </div>

          <div className="border-t border-emerald-100 pt-3" data-testid="channel-live-core-recovery">
            <h3 className="font-medium text-slate-900">3. Восстановление синтетических тестовых артефактов</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Удаляет только проверенные синтетические артефакты прошлого acceptance-прогона. Обычные данные пилота и сохранённый тестовый контур не затрагиваются.
            </p>

            <div
              className="mt-3 space-y-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-700"
              data-testid="channel-live-core-recovery-preview"
            >
              <p>
                <span className="font-medium">Нужна очистка: </span>
                {recoveryPreview ? (recoveryPreview.recoveryRequired ? 'да' : 'нет') : 'ещё не проверено'}
              </p>
              <p>
                <span className="font-medium">Безопасно удалить: </span>
                {recoveryPreview ? (recoveryPreview.safeToCleanup ? 'да' : 'нет') : '—'}
              </p>
              <p>
                <span className="font-medium">Основная запись: </span>
                <span className="font-mono">{recoveryPreview?.mainRecord?.id ?? '—'}</span>
              </p>
              <p>
                <span className="font-medium">Ожидается удалений: </span>
                {recoveryPreview?.expectedDeletionTotal ?? '—'}
              </p>
              {recoveryPreview?.blockerSummary ? (
                <p className="text-amber-800">
                  <span className="font-medium">Блокер: </span>
                  {recoveryPreview.blockerSummary}
                </p>
              ) : null}
              {recoveryPreview && Object.keys(recoveryPreview.countsByTable).length > 0 ? (
                <p>
                  <span className="font-medium">По таблицам: </span>
                  {Object.entries(recoveryPreview.countsByTable)
                    .map(([table, count]) => `${table}: ${count}`)
                    .join(', ')}
                </p>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <button
                disabled={acceptanceBusy || recoveryBusy}
                onClick={() => void previewRecoveryArtifacts()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                data-testid="channel-live-core-recovery-preview-btn"
              >
                Просмотреть очистку
              </button>
              <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-slate-600">
                Фраза подтверждения
                <input
                  value={recoveryConfirmPhrase}
                  onChange={(event) => setRecoveryConfirmPhrase(event.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
                  placeholder="CLEAN_SYNTHETIC_LIVE_CORE_ACCEPTANCE_V1"
                  data-testid="channel-live-core-recovery-confirm-phrase"
                  autoComplete="off"
                />
              </label>
              <button
                disabled={acceptanceBusy || recoveryBusy || !recoveryConfirmPhrase.trim()}
                onClick={() => void cleanupRecoveryArtifacts()}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                data-testid="channel-live-core-recovery-cleanup"
              >
                Удалить синтетические тестовые артефакты
              </button>
            </div>
            {recoveryCleanupMessage ? (
              <p className="mt-2 text-xs text-emerald-800" data-testid="channel-live-core-recovery-cleanup-result">
                {recoveryCleanupMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

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
                <p className="mt-1 text-xs text-slate-600">Одноразовый read-only sync через reference adapter. Реальные API провайдеров и исходящая запись в OTA ещё не подключены.</p>
              </div>
              <button
                disabled={busy || !initialSyncEnabled}
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

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3" data-testid="channel-live-incremental-sync">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-slate-900">Live Core — incremental sync</h3>
                <p className="mt-1 text-xs text-slate-600">Ручной нормализованный delta после успешного Initial Sync. Polling и webhooks не подключены.</p>
              </div>
              <button
                disabled={busy || !incrementalSyncEnabled}
                onClick={() => void runIncrementalSync()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
                title={incrementalBlocker ?? undefined}
              >Incremental sync</button>
            </div>
            {!incrementalSyncEnabled ? (
              <p className="mt-2 text-xs text-amber-700">{incrementalBlocker}</p>
            ) : null}
            <textarea
              value={incrementalDeltaText}
              onChange={(event) => setIncrementalDeltaText(event.target.value)}
              rows={6}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              aria-label="Incremental delta JSON"
              disabled={busy}
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Последний incremental" value={liveCore?.lastSuccessfulIncrementalSyncAt ? new Date(liveCore.lastSuccessfulIncrementalSyncAt).toLocaleString('ru-RU') : 'Ещё не было'} />
              <Stat label="Курсор" value={liveCore?.cursorPresent ? `есть · ${liveCore.cursorCheckpointHash ?? 'hash'}` : 'нет'} />
              <Stat label="Создано / восстановлено" value={`${liveCore?.latestIncrementalRun?.counters?.created ?? liveCounters?.created ?? 0} / ${liveCore?.latestIncrementalRun?.counters?.restored ?? liveCounters?.restored ?? 0}`} />
              <Stat label="Календарь / цены" value={`${liveCore?.latestIncrementalRun?.counters?.calendarDays ?? 0} / ${liveCore?.latestIncrementalRun?.counters?.prices ?? 0}`} />
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
                <button disabled={busy || !initialSyncEnabled} onClick={() => void runInitialSync()} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50">Запустить initial sync</button>
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
