'use client';

import { useCallback, useEffect, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { BookingLifecycleOrchestratorSnapshot } from '@/lib/booking-ops/lifecycle-orchestrator-types';

type Response = { ok: boolean; message?: string; orchestration?: BookingLifecycleOrchestratorSnapshot };

const STAGE_LABELS: Record<string, string> = {
  booking_received: 'Бронь получена', guest_intake: 'Данные гостя', legal_preparation: 'Документы и обязательства',
  physical_preparation: 'Подготовка объекта', final_readiness_review: 'Финальная проверка',
  checkin_release_ready: 'Можно готовить инструкции', checkin_release_draft_prepared: 'Черновик инструкций готов',
  in_stay: 'Проживание', checkout_pending: 'Ожидается выезд', completed: 'Завершено', cancelled: 'Отменено', blocked: 'Заблокировано',
};
const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начато', active: 'В работе', waiting_guest: 'Ждём гостя', waiting_operator: 'Нужен оператор',
  waiting_worker: 'Ждём исполнителя', ready_for_review: 'Готово к проверке', blocked: 'Заблокировано',
  overdue: 'Просрочено', completed: 'Завершено', cancelled: 'Отменено',
};
const SLA_LABELS: Record<string, string> = {
  on_track: 'В срок', warning: 'Срок приближается', overdue: 'Есть просрочка', satisfied: 'Все сроки закрыты', cancelled: 'Отменено',
};
const SEVERITY_LABELS: Record<string, string> = { info: 'Обычно', warning: 'Внимание', urgent: 'Срочно', critical: 'Критично' };
const ITEM_LABELS: Record<string, string> = {
  guest_intake: 'Данные гостя', legal_readiness: 'Документы, договор, депозит и МВД', cleaning: 'Уборка',
  linen: 'Бельё', maintenance: 'Ремонт', final_readiness: 'Финальная готовность',
};
const ITEM_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидается', satisfied: 'Выполнено', overdue: 'Просрочено', escalated: 'Черновик эскалации готов',
  cancelled: 'Отменено', waived: 'Срок снят вручную',
};
const EVENT_LABELS: Record<string, string> = {
  orchestrator_started: 'Запущена проверка брони', orchestrator_completed: 'Проверка завершена',
  guest_intake_session_ensured: 'Подготовлен сбор данных гостя', reminder_draft_created: 'Подготовлен черновик напоминания',
  operator_escalation_created: 'Подготовлен черновик для оператора', stage_changed: 'Изменён этап брони',
  checkin_release_blocked: 'Инструкции пока заблокированы', checkin_release_draft_prepared: 'Подготовлен финальный черновик инструкций',
  noop_idempotent_run: 'Повторная проверка: новых действий нет', manual_override_applied: 'Зафиксировано ручное изменение',
};
const BLOCKER_LABELS: Record<string, string> = {
  guest_intake_incomplete: 'Данные гостя не заполнены полностью.', guest_required_fields_missing: 'Не хватает обязательных данных гостя.',
  availability: 'Не завершена проверка доступности.', documents: 'Документы гостя не проверены.', contract: 'Договор не готов.',
  deposit: 'Депозит не подтверждён.', mvd: 'Действия по МВД не завершены.', legal_flow: 'Юридическая проверка заблокирована.',
  cleaning_not_verified: 'Уборка не проверена.', linen_not_verified: 'Бельё не проверено.', critical_supplies_missing: 'Не подтверждены обязательные расходники.',
  blocking_maintenance_open: 'Есть незакрытая критичная неисправность.', final_readiness_not_approved: 'Финальная готовность объекта не подтверждена.',
};

function when(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU');
}

export function LifecycleOrchestratorPanel({ bookingId, isOpsAdmin }: { bookingId: string; isOpsAdmin: boolean }) {
  const [snapshot, setSnapshot] = useState<BookingLifecycleOrchestratorSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard/booking-ops/lifecycle-orchestrator?bookingId=${encodeURIComponent(bookingId)}`, { credentials: 'include' });
      const payload = await readResponseJson<Response>(response, { ok: false });
      if (response.ok && payload.ok) setSnapshot(payload.orchestration ?? null);
      else setMessage(payload.message ?? 'Не удалось загрузить автопилот бронирования.');
    } finally { setLoading(false); }
  }, [bookingId]);

  useEffect(() => { void load(); }, [load]);

  async function run(nextAction: string, extra: Record<string, unknown> = {}) {
    setAction(nextAction); setMessage('');
    try {
      const response = await fetch('/api/dashboard/booking-ops/lifecycle-orchestrator', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId, action: nextAction, ...extra }),
      });
      const payload = await readResponseJson<Response>(response, { ok: false });
      if (!response.ok || !payload.ok || !payload.orchestration) setMessage(payload.message ?? 'Действие не выполнено.');
      else { setSnapshot(payload.orchestration); setMessage('Состояние брони обновлено. Внешняя отправка не выполнялась.'); }
    } finally { setAction(null); }
  }

  function escalate() {
    const reason = window.prompt('Причина эскалации оператору');
    if (reason?.trim()) void run('escalate', { reason });
  }

  function waive(itemId: string) {
    const reason = window.prompt('Почему срок можно снять');
    if (reason?.trim()) void run('manual_override', { overrideAction: 'waive_sla', slaItemId: itemId, reason });
  }

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 text-sm text-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-indigo-950">Автопилот бронирования</h3>
          <p className="mt-1 text-xs text-slate-600">Следит за этапами и сроками, готовит только черновики. Ничего не отправляет автоматически.</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-indigo-900">{loading ? 'Загрузка…' : SLA_LABELS[snapshot?.state.slaStatus ?? 'on_track']}</span>
      </div>
      {message ? <p className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs">{message}</p> : null}
      {snapshot ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-indigo-100 bg-white p-3"><p className="text-xs text-slate-500">Этап</p><p className="mt-1 font-medium">{STAGE_LABELS[snapshot.state.currentStage]}</p></div>
            <div className="rounded border border-indigo-100 bg-white p-3"><p className="text-xs text-slate-500">Состояние</p><p className="mt-1 font-medium">{STATUS_LABELS[snapshot.state.status]}</p></div>
            <div className="rounded border border-indigo-100 bg-white p-3"><p className="text-xs text-slate-500">Важность</p><p className="mt-1 font-medium">{SEVERITY_LABELS[snapshot.state.severity]}</p></div>
          </div>
          <div className="mt-3 rounded border border-indigo-100 bg-white p-3">
            <p className="text-xs text-slate-500">Следующее действие · до {when(snapshot.state.nextActionDueAt)}</p>
            <p className="mt-1 font-medium">{snapshot.state.nextAction ?? 'Обязательных действий нет.'}</p>
            {snapshot.state.blockers.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-800">{snapshot.state.blockers.map((blocker) => <li key={blocker}>{BLOCKER_LABELS[blocker] ?? 'Есть обязательный незакрытый этап.'}</li>)}</ul> : <p className="mt-2 text-xs text-emerald-700">Обязательные блокеры закрыты.</p>}
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.slaItems.map((item) => (
              <div key={item.id ?? `${item.stage}-${item.itemType}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-indigo-100 bg-white px-3 py-2 text-xs">
                <div><p className="font-medium">{ITEM_LABELS[item.itemType]}</p><p className="text-slate-500">{ITEM_STATUS_LABELS[item.status]} · срок {when(item.dueAt)}</p></div>
                {isOpsAdmin && item.id && ['pending', 'overdue', 'escalated'].includes(item.status) ? <button type="button" disabled={action !== null} onClick={() => waive(item.id!)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">Снять срок</button> : null}
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-indigo-100 bg-white p-3 text-xs"><p className="font-medium">Последняя проверка</p><p className="mt-1 text-slate-600">{when(snapshot.state.lastOrchestratedAt)}</p><p className="mt-1 text-slate-500">Новых задач: {snapshot.lastRun?.createdTasksCount ?? 0}; черновиков: {snapshot.lastRun?.createdDraftsCount ?? 0}; эскалаций: {snapshot.lastRun?.createdEscalationsCount ?? 0}</p></div>
            <div className="rounded border border-indigo-100 bg-white p-3 text-xs"><p className="font-medium">Последнее событие</p><p className="mt-1 text-slate-600">{snapshot.events[0] ? EVENT_LABELS[snapshot.events[0].eventType] ?? 'Состояние обновлено' : 'Событий пока нет'}</p><p className="mt-1 text-slate-500">Черновик инструкций: {snapshot.state.finalCheckinDraftId ? 'подготовлен' : snapshot.state.finalCheckinDraftAllowed ? 'можно подготовить' : 'пока заблокирован'}</p></div>
          </div>
          {isOpsAdmin ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={action !== null} onClick={() => void run('orchestrate')} className="rounded bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{action === 'orchestrate' ? 'Проверка…' : 'Запустить проверку'}</button><button type="button" disabled={action !== null} onClick={() => void run('prepare_next_draft')} className="rounded border border-indigo-300 bg-white px-3 py-1.5 text-xs text-indigo-900 disabled:opacity-50">Подготовить следующий черновик</button><button type="button" disabled={action !== null} onClick={escalate} className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-900 disabled:opacity-50">Черновик оператору</button></div> : null}
        </>
      ) : !loading ? <p className="mt-3 text-xs text-slate-500">Состояние пока не создано.</p> : null}
    </section>
  );
}
