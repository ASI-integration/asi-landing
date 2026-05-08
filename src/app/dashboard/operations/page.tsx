'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDemoOperationsState, operationsStageLabels, operationsStageOrder } from '@/lib/operations/demo-data';
import {
  activeChecklistStage as getActiveChecklistStage,
  applyOperationsAction,
  getChecklistForStage,
  loadOperationsState,
  nextWorkflowStage,
  saveOperationsState,
  type OperationsAction,
} from '@/lib/operations/service';
import type {
  OperationsAuditEvent,
  OperationsAutomationMode,
  OperationsChecklistStage,
  OperationsChecklistStatus,
  OperationsIssue,
  OperationsIssueStatus,
  OperationsIssueType,
  OperationsIssueUrgency,
  OperationsItem,
  OperationsSourceChannel,
  OperationsState,
  OperationsWorkflowStage,
} from '@/lib/operations/types';

const automationLabels: Record<OperationsAutomationMode, string> = {
  manual: 'Ручной',
  semi_auto: 'Полуавто',
  full_auto: 'Авто',
};

const issueTypeLabels: Record<OperationsIssueType, string> = {
  booking_context: 'Контекст бронирования',
  guest_support: 'Поддержка гостя',
  property_context: 'Контекст объекта',
  payment_review: 'Проверка оплаты',
  maintenance_review: 'Операционная проверка',
  communication: 'Коммуникация',
  other: 'Другое',
};

const issueStatusLabels: Record<OperationsIssueStatus, string> = {
  open: 'Открыт',
  in_progress: 'В работе',
  resolved: 'Закрыт',
};

const issueUrgencyLabels: Record<OperationsIssueUrgency, string> = {
  normal: 'Обычная',
  urgent: 'Срочная',
};

const checklistStageLabels: Record<OperationsChecklistStage, string> = {
  pre_checkin: 'До заезда',
  checkin: 'Заезд',
  in_stay: 'Проживание',
  checkout: 'Выезд',
  review_followup: 'Follow-up',
};

const checklistStageOrder: OperationsChecklistStage[] = ['pre_checkin', 'checkin', 'in_stay', 'checkout', 'review_followup'];

function todayKey(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value?: string): string {
  if (!value) return 'не задано';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(source: OperationsSourceChannel): string {
  if (source === 'telegram') return 'Telegram';
  if (source === 'telegram_voice') return 'Telegram Voice';
  if (source === 'whatsapp_voice') return 'WhatsApp Voice';
  if (source === 'email') return 'Email';
  if (source === 'phone') return 'Телефон';
  if (source === 'vk') return 'VK';
  if (source === 'max') return 'MAX';
  if (source === 'direct') return 'Прямой контакт';
  if (source === 'manual') return 'Ручной ввод';
  if (source === 'demo') return 'Демо';
  return source;
}

function stageTone(stage: OperationsWorkflowStage): string {
  if (stage === 'needs_operator') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (stage === 'checkin') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (stage === 'in_stay') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (stage === 'checkout') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function automationTone(mode: OperationsAutomationMode): string {
  if (mode === 'full_auto') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (mode === 'semi_auto') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function issueStatusTone(status: OperationsIssueStatus | 'none'): string {
  if (status === 'open') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'in_progress') return 'border-blue-200 bg-blue-50 text-blue-800';
  if (status === 'resolved') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function checklistClass(status: OperationsChecklistStatus): string {
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'blocked') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 'not_applicable') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function itemDateMarker(item: OperationsItem, today: string): { label: string; tone: 'warn' | 'urgent' | 'normal' } | null {
  const checkIn = item.bookingDates.checkIn;
  const checkOut = item.bookingDates.checkOut;
  const beforeStay = item.stage === 'new_inquiry' || item.stage === 'booking_intake' || item.stage === 'pre_checkin' || item.stage === 'checkin';
  const beforeCheckout = item.stage !== 'review_followup' && item.stage !== 'needs_operator';

  if (checkIn === today && beforeStay) return { label: 'заезд сегодня', tone: 'normal' };
  if (checkOut === today && beforeCheckout) return { label: 'выезд сегодня', tone: 'warn' };
  if (checkIn && checkIn < today && beforeStay) return { label: 'заезд просрочен', tone: 'urgent' };
  if (checkOut && checkOut < today && beforeCheckout) return { label: 'выезд просрочен', tone: 'urgent' };
  return null;
}

function activeIssuesForItem(issues: OperationsIssue[], itemId: string): OperationsIssue[] {
  return issues.filter((issue) => issue.operationItemId === itemId && issue.status !== 'resolved');
}

function overviewAutomationDistribution(items: OperationsItem[]): string {
  const manual = items.filter((item) => item.automationMode === 'manual').length;
  const semi = items.filter((item) => item.automationMode === 'semi_auto').length;
  const full = items.filter((item) => item.automationMode === 'full_auto').length;
  return `${manual}/${semi}/${full}`;
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'secondary',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger' | 'success';
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
      : tone === 'danger'
        ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
        : tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function OverviewCard({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function BookingCard({
  item,
  issues,
  selected,
  today,
  onSelect,
  onMoveNext,
}: {
  item: OperationsItem;
  issues: OperationsIssue[];
  selected: boolean;
  today: string;
  onSelect: () => void;
  onMoveNext: () => void;
}) {
  const marker = itemDateMarker(item, today);
  const activeIssues = activeIssuesForItem(issues, item.id);
  const urgent = activeIssues.some((issue) => issue.urgency === 'urgent') || item.escalationStatus === 'pending_operator';
  const nextStage = nextWorkflowStage(item.stage);

  return (
    <article
      className={`rounded-lg border bg-white p-3 shadow-sm transition ${
        selected ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200'
      } ${urgent ? 'border-l-4 border-l-rose-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{item.guest.name}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{item.objectLabel}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${automationTone(item.automationMode)}`}>
          {automationLabels[item.automationMode]}
        </span>
      </div>

      <div className="mt-3 space-y-1 text-xs text-slate-600">
        <p>
          {formatDate(item.bookingDates.checkIn)} - {formatDate(item.bookingDates.checkOut)}
          {item.bookingDates.nights ? ` · ${item.bookingDates.nights} ноч.` : null}
        </p>
        <p>Источник: {sourceLabel(item.sourceChannel)}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {marker ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              marker.tone === 'urgent'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : marker.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-700'
            }`}
          >
            {marker.label}
          </span>
        ) : null}
        {activeIssues.length > 0 ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {activeIssues.length} вопрос
          </span>
        ) : null}
        {urgent ? (
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
            срочно
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Детали
        </button>
        <button
          type="button"
          onClick={onMoveNext}
          disabled={!nextStage}
          className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          След. стадия
        </button>
      </div>
    </article>
  );
}

function buildTimeline(item: OperationsItem, issues: OperationsIssue[]): OperationsAuditEvent[] {
  const issueEvents = issues
    .filter((issue) => issue.operationItemId === item.id)
    .flatMap((issue) =>
      issue.auditEvents.map((event) => ({
        ...event,
        id: `${issue.id}-${event.id}`,
        detail: event.detail ? `${issue.title}: ${event.detail}` : issue.title,
      })),
    );

  return [...item.auditEvents, ...issueEvents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export default function OperationsPage() {
  const [state, setState] = useState<OperationsState>(() => createDemoOperationsState());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backendNotice, setBackendNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [issueTitle, setIssueTitle] = useState('Операционный вопрос');
  const [issueType, setIssueType] = useState<OperationsIssueType>('guest_support');
  const [issueUrgency, setIssueUrgency] = useState<OperationsIssueUrgency>('normal');
  const [issueNote, setIssueNote] = useState('');
  const [checklistStage, setChecklistStage] = useState<OperationsChecklistStage>('pre_checkin');

  const loadOperations = useCallback(async (preferredSelectedId?: string | null) => {
    setLoading(true);
    setBackendNotice(null);
    try {
      const res = await fetch('/api/operations/items', { cache: 'no-store' });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        state?: OperationsState;
        error?: string;
        detail?: string;
      };

      if (res.ok && payload.ok && payload.state) {
        setState(payload.state);
        setSelectedId((prev) => {
          const preferred = preferredSelectedId ?? prev;
          if (preferred && payload.state?.items.some((item) => item.id === preferred)) return preferred;
          return payload.state?.items[0]?.id ?? null;
        });
        return;
      }

      if (res.status === 401) {
        setBackendNotice('Требуется авторизация. Dashboard guard перенаправит на вход.');
        return;
      }

      const fallback = loadOperationsState();
      setState(fallback);
      setSelectedId((prev) => {
        const preferred = preferredSelectedId ?? prev;
        if (preferred && fallback.items.some((item) => item.id === preferred)) return preferred;
        return fallback.items[3]?.id ?? fallback.items[0]?.id ?? null;
      });
      setBackendNotice(
        `Backend operations недоступен (${payload.error ?? res.status}). Показан явный demo/dev fallback; данные не смешиваются с backend.`,
      );
    } catch (err) {
      const fallback = loadOperationsState();
      setState(fallback);
      setSelectedId((prev) => {
        const preferred = preferredSelectedId ?? prev;
        if (preferred && fallback.items.some((item) => item.id === preferred)) return preferred;
        return fallback.items[3]?.id ?? fallback.items[0]?.id ?? null;
      });
      setBackendNotice(
        `Backend operations недоступен (${err instanceof Error ? err.message : 'network error'}). Показан явный demo/dev fallback.`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  const selected = state.items.find((item) => item.id === selectedId) ?? state.items[0] ?? null;
  const today = useMemo(() => todayKey(), []);

  useEffect(() => {
    if (!selected) return;
    setChecklistStage(getActiveChecklistStage(selected.stage));
  }, [selected]);

  const metrics = useMemo(() => {
    const openIssues = state.issues.filter((issue) => issue.status !== 'resolved');
    const urgentEscalations = state.items.filter((item) => item.escalationStatus === 'pending_operator' || item.escalationStatus === 'in_review')
      .length;
    const urgentIssues = openIssues.filter((issue) => issue.urgency === 'urgent').length;

    return {
      activeOperations: state.items.filter((item) => item.stage !== 'review_followup' || item.issueStatus !== 'resolved').length,
      checkinsToday: state.items.filter((item) => item.bookingDates.checkIn === today).length,
      checkoutsToday: state.items.filter((item) => item.bookingDates.checkOut === today).length,
      openIssues: openIssues.length,
      urgentEscalations: urgentEscalations + urgentIssues,
      automationDistribution: overviewAutomationDistribution(state.items),
    };
  }, [state, today]);

  const selectedIssues = selected ? state.issues.filter((issue) => issue.operationItemId === selected.id) : [];
  const selectedActiveIssues = selected ? activeIssuesForItem(state.issues, selected.id) : [];
  const selectedTimeline = selected ? buildTimeline(selected, state.issues) : [];
  const selectedChecklist = selected ? getChecklistForStage(selected, checklistStage) : [];
  const nextStage = selected ? nextWorkflowStage(selected.stage) : null;
  const storageLabel =
    state.storageMode === 'backend'
      ? 'backend Supabase'
      : state.storageMode === 'local_storage'
        ? 'demo localStorage fallback'
        : 'demo seed fallback';

  async function runBackendAction(action: OperationsAction): Promise<void> {
    if (action.type === 'add_note') {
      const res = await fetch(`/api/operations/items/${action.itemId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: action.body }),
      });
      if (!res.ok) throw new Error('note_add_failed');
      return;
    }

    if (action.type === 'create_issue') {
      const res = await fetch(`/api/operations/items/${action.itemId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: action.title,
          issueType: action.issueType,
          urgency: action.urgency,
          note: action.note,
        }),
      });
      if (!res.ok) throw new Error('issue_create_failed');
      return;
    }

    if (action.type === 'close_issue') {
      const issueId = action.issueId ?? selectedActiveIssues[0]?.id;
      if (!issueId) throw new Error('active_issue_not_found');
      const res = await fetch(`/api/operations/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      });
      if (!res.ok) throw new Error('issue_close_failed');
      return;
    }

    const body =
      action.type === 'set_checklist_item_status'
        ? {
            action: 'update_checklist_item',
            checklistStage: action.checklistStage,
            checklistItemId: action.checklistItemId,
            status: action.status,
          }
        : { action: action.type };

    const res = await fetch(`/api/operations/items/${action.itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('operation_action_failed');
  }

  async function commit(action: Parameters<typeof applyOperationsAction>[1], successMessage: string): Promise<void> {
    setActionBusy(true);
    setMessage(null);
    try {
      if (state.storageMode === 'backend') {
        await runBackendAction(action);
        await loadOperations(action.itemId);
      } else {
        setState((prev) => {
          const next = applyOperationsAction(prev, action);
          saveOperationsState(next);
          return next;
        });
      }
      setMessage(successMessage);
    } catch (err) {
      setMessage(err instanceof Error ? `Действие не выполнено: ${err.message}` : 'Действие не выполнено.');
    } finally {
      setActionBusy(false);
    }
  }

  function createIssue(): void {
    if (!selected) return;
    void commit(
      {
        type: 'create_issue',
        itemId: selected.id,
        title: issueTitle,
        issueType,
        urgency: issueUrgency,
        note: issueNote,
      },
      'Вопрос создан и добавлен в журнал операции.',
    );
    setIssueTitle('Операционный вопрос');
    setIssueUrgency('normal');
    setIssueNote('');
  }

  function addNote(): void {
    if (!selected || !noteDraft.trim()) return;
    void commit({ type: 'add_note', itemId: selected.id, body: noteDraft }, 'Заметка добавлена.');
    setNoteDraft('');
  }

  if (!selected) {
    return (
      <div className="space-y-3">
        {backendNotice ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{backendNotice}</div>
        ) : null}
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {loading ? 'Загрузка операций...' : 'Операционные элементы не найдены.'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1500px] space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Операции</h1>
            <p className="mt-1 text-sm text-slate-600">
              Ручной и полуавтоматический слой жизненного цикла гостя: запрос, прием бронирования, заезд, проживание,
              выезд, follow-up и эскалации.
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
            Хранилище: {storageLabel}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Загрузка операций...</div>
      ) : null}

      {backendNotice ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{backendNotice}</div>
      ) : null}

      {actionBusy ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">Сохранение действия...</div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <OverviewCard label="Активные операции" value={metrics.activeOperations} hint="В работе или с открытым контекстом" />
        <OverviewCard label="Заезды сегодня" value={metrics.checkinsToday} hint={`Дата: ${formatDate(today)}`} />
        <OverviewCard label="Выезды сегодня" value={metrics.checkoutsToday} hint="По датам бронирования" />
        <OverviewCard label="Открытые вопросы" value={metrics.openIssues} hint="Open / in progress" />
        <OverviewCard label="Срочные эскалации" value={metrics.urgentEscalations} hint="Оператор или срочный вопрос" />
        <OverviewCard label="Режимы" value={metrics.automationDistribution} hint="Ручной / полуавто / авто" />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Режим автоматизации</h2>
            <p className="mt-1 text-sm text-slate-500">
              Режим хранится на уровне операции. Интеграции PMS, OTA и channel manager здесь не подключаются.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['manual', 'semi_auto', 'full_auto'] as OperationsAutomationMode[]).map((mode) => (
              <span key={mode} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${automationTone(mode)}`}>
                {automationLabels[mode]}
              </span>
            ))}
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-3">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Workflow board</h2>
              <p className="text-sm text-slate-500">Стадии от лида до follow-up с отдельной колонкой эскалаций.</p>
            </div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="grid min-w-[1280px] grid-cols-8 gap-3">
              {operationsStageOrder.map((stage) => {
                const columnItems = state.items.filter((item) => item.stage === stage);
                return (
                  <section key={stage} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div className={`mb-2 rounded-md border px-2 py-2 text-xs font-semibold ${stageTone(stage)}`}>
                      {operationsStageLabels[stage]}
                      <span className="ml-2 text-slate-500">{columnItems.length}</span>
                    </div>
                    <div className="space-y-2">
                      {columnItems.length > 0 ? (
                        columnItems.map((item) => (
                          <BookingCard
                            key={item.id}
                            item={item}
                            issues={state.issues}
                            selected={selected.id === item.id}
                            today={today}
                            onSelect={() => setSelectedId(item.id)}
                            onMoveNext={() =>
                              commit({ type: 'move_next_stage', itemId: item.id }, 'Операция переведена на следующую стадию.')
                            }
                          />
                        ))
                      ) : (
                        <div className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-400">
                          Нет операций
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Выбрана операция</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{selected.guest.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{selected.id}</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${stageTone(selected.stage)}`}>
              {operationsStageLabels[selected.stage]}
            </span>
          </div>

          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <span className="text-slate-500">Объект:</span> {selected.objectLabel}
            </div>
            <div>
              <span className="text-slate-500">Источник:</span> {sourceLabel(selected.sourceChannel)}
            </div>
            <div>
              <span className="text-slate-500">Даты:</span> {formatDate(selected.bookingDates.checkIn)} -{' '}
              {formatDate(selected.bookingDates.checkOut)}
            </div>
            <div>
              <span className="text-slate-500">Режим:</span> {automationLabels[selected.automationMode]}
            </div>
            <div>
              <span className="text-slate-500">Вопросы:</span>{' '}
              <span className={`rounded border px-1.5 py-0.5 text-xs ${issueStatusTone(selected.issueStatus)}`}>
                {selected.issueStatus === 'none' ? 'нет' : issueStatusLabels[selected.issueStatus]}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Эскалация:</span> {selected.escalationStatus.replace(/_/g, ' ')}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Коммуникационный контекст</h3>
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              <p>Review ID: {selected.communicationReviewId ?? 'не привязан'}</p>
              <p>Session ID: {selected.communicationSessionId ?? 'не привязана'}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={
                  selected.communicationReviewId
                    ? `/dashboard/communication?reviewId=${encodeURIComponent(selected.communicationReviewId)}`
                    : '/dashboard/communication'
                }
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
              >
                Открыть коммуникации
              </Link>
              <ActionButton
                onClick={() => commit({ type: 'escalate_operator', itemId: selected.id }, 'Операция передана оператору.')}
                tone="danger"
              >
                Эскалировать оператору
              </ActionButton>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Основные действия</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <ActionButton
                onClick={() => commit({ type: 'move_next_stage', itemId: selected.id }, 'Операция переведена на следующую стадию.')}
                disabled={!nextStage}
                tone="primary"
              >
                Следующая стадия{nextStage ? `: ${operationsStageLabels[nextStage]}` : ''}
              </ActionButton>
              <ActionButton
                onClick={() => commit({ type: 'mark_checkin_ready', itemId: selected.id }, 'Готовность к заезду отмечена.')}
                disabled={selected.stage === 'in_stay' || selected.stage === 'checkout' || selected.stage === 'review_followup'}
                tone="success"
              >
                Заезд готов
              </ActionButton>
              <ActionButton
                onClick={() => commit({ type: 'mark_guest_checked_in', itemId: selected.id }, 'Гость отмечен как заехавший.')}
                disabled={selected.stage === 'review_followup'}
                tone="success"
              >
                Гость заехал
              </ActionButton>
              <ActionButton
                onClick={() => commit({ type: 'mark_checked_out', itemId: selected.id }, 'Выезд отмечен завершенным.')}
                disabled={selected.stage === 'new_inquiry' || selected.stage === 'booking_intake'}
                tone="success"
              >
                Выезд завершен
              </ActionButton>
              <ActionButton onClick={createIssue} tone="danger">
                Создать вопрос
              </ActionButton>
              <ActionButton
                onClick={() => commit({ type: 'close_issue', itemId: selected.id }, 'Активный вопрос закрыт.')}
                disabled={selectedActiveIssues.length === 0}
              >
                Закрыть вопрос
              </ActionButton>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Новый вопрос</h3>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium text-slate-600">
                Название
                <input
                  value={issueTitle}
                  onChange={(event) => setIssueTitle(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  Тип
                  <select
                    value={issueType}
                    onChange={(event) => setIssueType(event.target.value as OperationsIssueType)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                  >
                    {(Object.keys(issueTypeLabels) as OperationsIssueType[]).map((type) => (
                      <option key={type} value={type}>
                        {issueTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Срочность
                  <select
                    value={issueUrgency}
                    onChange={(event) => setIssueUrgency(event.target.value as OperationsIssueUrgency)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                  >
                    {(Object.keys(issueUrgencyLabels) as OperationsIssueUrgency[]).map((urgency) => (
                      <option key={urgency} value={urgency}>
                        {issueUrgencyLabels[urgency]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium text-slate-600">
                Заметка к вопросу
                <textarea
                  value={issueNote}
                  onChange={(event) => setIssueNote(event.target.value)}
                  className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Коротко опишите, что должен проверить менеджер"
                />
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Чек-листы по стадиям</h3>
              <span className="text-xs text-slate-500">Активно: {checklistStageLabels[getActiveChecklistStage(selected.stage)]}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {checklistStageOrder.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setChecklistStage(stage)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    checklistStage === stage
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {checklistStageLabels[stage]}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {selectedChecklist.map((item) => {
                const done = item.status === 'done';
                return (
                  <div key={item.id} className={`rounded-md border px-3 py-2 text-sm ${checklistClass(item.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.label}</div>
                        {item.note ? <div className="mt-0.5 text-xs opacity-80">{item.note}</div> : null}
                        <div className="mt-1 text-xs opacity-80">
                          {done && item.completedAt ? `Выполнено: ${formatDateTime(item.completedAt)}` : item.status.replace(/_/g, ' ')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          commit(
                            {
                              type: 'set_checklist_item_status',
                              itemId: selected.id,
                              checklistStage,
                              checklistItemId: item.id,
                              status: done ? 'pending' : 'done',
                            },
                            done ? 'Пункт чек-листа возвращен в ожидание.' : 'Пункт чек-листа выполнен.',
                          )
                        }
                        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {done ? 'Вернуть' : 'Готово'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Вопросы</h3>
            <div className="mt-2 space-y-2">
              {selectedIssues.length > 0 ? (
                selectedIssues.map((issue) => (
                  <div key={issue.id} className={`rounded-md border px-3 py-2 text-sm ${issueStatusTone(issue.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{issue.title}</div>
                        <div className="mt-1 text-xs">
                          {issueTypeLabels[issue.type]} · {issueUrgencyLabels[issue.urgency]} · {issueStatusLabels[issue.status]}
                        </div>
                        {issue.communicationReviewId ? (
                          <div className="mt-1 text-xs">Review ID: {issue.communicationReviewId}</div>
                        ) : null}
                      </div>
                      {issue.status !== 'resolved' ? (
                        <button
                          type="button"
                          onClick={() =>
                            commit({ type: 'close_issue', itemId: selected.id, issueId: issue.id }, 'Вопрос закрыт.')
                          }
                          className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Закрыть
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  Вопросов по операции нет.
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Заметки</h3>
            <div className="mt-2 space-y-2">
              {selected.notes.map((entry) => (
                <div key={entry.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <div>{entry.body}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(entry.createdAt)}</div>
                </div>
              ))}
            </div>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              Новая заметка
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Добавьте внутреннюю заметку"
              />
            </label>
            <div className="mt-2">
              <ActionButton onClick={addNote} disabled={!noteDraft.trim()}>
                Добавить заметку
              </ActionButton>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Audit timeline</h3>
            <ol className="mt-2 space-y-2">
              {selectedTimeline.map((event) => (
                <li
                  key={event.id}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    event.tone === 'warn'
                      ? 'border-amber-200 bg-amber-50'
                      : event.tone === 'success'
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="font-medium text-slate-800">{event.label}</div>
                  {event.detail ? <div className="mt-0.5 text-slate-600">{event.detail}</div> : null}
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.createdAt)}</div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </section>
    </div>
  );
}
