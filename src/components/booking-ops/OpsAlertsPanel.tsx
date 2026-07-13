'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OperatorAlert } from '@/lib/booking-ops/operator-alerts';
import type { OperatorAlertAction, OperatorAlertControl } from '@/lib/booking-ops/operator-exception-actions';

type AlertView = OperatorAlert & { control: OperatorAlertControl; nextRetryAt: string | null };
type Response = { ok: boolean; message?: string; alerts?: Array<OperatorAlert & { control: OperatorAlertControl }>; alert?: OperatorAlert; actuallySent?: boolean };
type FormValues = { executor: string; missingDataReason: string; resolutionCategory: string; reason: string };
const emptyForm = (): FormValues => ({ executor: '', missingDataReason: 'guest_data', resolutionCategory: 'issue_fixed', reason: '' });
const severityLabel = { critical: 'Срочно', warning: 'Требует внимания', info: 'Информация' } as const;
const gateLabel: Record<string, string> = { cleaning: 'Уборка', linen: 'Бельё', inspection: 'Осмотр', maintenance: 'Обслуживание', readiness: 'Готовность', property_ready: 'Готовность', guest_data_completed: 'Данные гостя', documents_verified: 'Документы', contract_signed: 'Договор', deposit_received: 'Оплата', mvd_report_submitted: 'Отчётность', checkin_instructions_sent: 'Инструкции' };
const historyActionLabel: Record<string, string> = { acknowledge: 'Принято в работу', assign_executor: 'Назначен исполнитель', request_missing_data: 'Создан запрос данных', advance_work: 'Работа переведена дальше', resolve_alert: 'Уведомление закрыто' };

function view(alert: OperatorAlert & { control: OperatorAlertControl }): AlertView {
  return { ...alert, nextRetryAt: typeof alert.metadata.automationNextRetryAt === 'string' ? alert.metadata.automationNextRetryAt : null };
}

function timeLabel(alert: AlertView) {
  const target = alert.deadlineAt || alert.nextCheckInAt;
  if (!target) return 'срок не указан';
  const minutes = Math.round((new Date(target).getTime() - Date.now()) / 60_000);
  return minutes < 0 ? `просрочено на ${Math.abs(minutes)} мин.` : `осталось ${minutes} мин.`;
}

function ActionForm(props: {
  alert: AlertView;
  action: OperatorAlertAction;
  values: FormValues;
  disabled: boolean;
  onChange: (values: FormValues) => void;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const { alert, action, values } = props;
  if (action === 'assign_executor') {
    const cleaning = alert.control.linkedObject?.kind === 'cleaning';
    return <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
      <label className="block text-xs text-slate-600">{cleaning ? 'Имя, телефон или Telegram исполнителя' : 'ID исполнителя'}
        <input autoFocus value={values.executor} onChange={(event) => props.onChange({ ...values, executor: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <div className="mt-2 flex gap-2"><button type="button" disabled={props.disabled || !values.executor.trim()} onClick={() => props.onSubmit(cleaning ? { assignedToName: values.executor } : { executorId: values.executor })} className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">Назначить</button><button type="button" onClick={props.onCancel} className="text-sm text-slate-600 underline">Отмена</button></div>
    </div>;
  }
  if (action === 'request_missing_data') return <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
    <label className="block text-xs text-slate-600">Каких данных не хватает
      <select value={values.missingDataReason} onChange={(event) => props.onChange({ ...values, missingDataReason: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
        <option value="guest_data">Данные гостя</option><option value="guest_documents">Документы гостя</option><option value="legal_confirmation">Подтверждение договора</option><option value="payment">Оплата или депозит</option><option value="compliance">Данные для отчётности</option><option value="arrival">Время прибытия</option><option value="communication">Данные для связи</option>
      </select>
    </label>
    <p className="mt-1 text-xs text-slate-500">Будет создан только черновик. Сообщение не отправится автоматически.</p>
    <div className="mt-2 flex gap-2"><button type="button" disabled={props.disabled} onClick={() => props.onSubmit({ missingDataReason: values.missingDataReason })} className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">Создать черновик</button><button type="button" onClick={props.onCancel} className="text-sm text-slate-600 underline">Отмена</button></div>
  </div>;
  return <div className="mt-2 rounded-lg border border-red-200 bg-white p-3">
    <label className="block text-xs text-slate-600">Категория
      <select value={values.resolutionCategory} onChange={(event) => props.onChange({ ...values, resolutionCategory: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
        <option value="issue_fixed">Проблема исправлена</option><option value="duplicate_alert">Повторное уведомление</option><option value="false_positive">Ошибочное уведомление</option><option value="no_longer_applicable">Больше не актуально</option><option value="manually_overridden">Решение оператора</option>
      </select>
    </label>
    <label className="mt-2 block text-xs text-slate-600">Причина закрытия
      <textarea value={values.reason} onChange={(event) => props.onChange({ ...values, reason: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" rows={2} />
    </label>
    <p className="mt-1 text-xs text-slate-500">Закрытие не меняет состояние брони или задачи. Если проблема останется, уведомление появится снова.</p>
    <div className="mt-2 flex gap-2"><button type="button" disabled={props.disabled || !values.reason.trim()} onClick={() => { if (window.confirm('Закрыть уведомление с указанной причиной?')) props.onSubmit({ resolutionCategory: values.resolutionCategory, reason: values.reason }); }} className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">Закрыть</button><button type="button" onClick={props.onCancel} className="text-sm text-slate-600 underline">Отмена</button></div>
  </div>;
}

export function OpsAlertsPanel() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<{ alertId: string; action: OperatorAlertAction } | null>(null);
  const [forms, setForms] = useState<Record<string, FormValues>>({});
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/dashboard/booking-ops/alerts?activeOnly=false', { credentials: 'include' });
      const body = await response.json() as Response;
      if (!response.ok || !body.ok) throw new Error(body.message || 'Не удалось загрузить уведомления.');
      setAlerts((body.alerts ?? []).map(view));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить уведомления.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => [
    { title: 'Срочно', items: alerts.filter((item) => item.status !== 'resolved' && item.severity === 'critical') },
    { title: 'Требует внимания', items: alerts.filter((item) => item.status !== 'resolved' && item.severity === 'warning') },
    { title: 'Информация', items: alerts.filter((item) => item.status !== 'resolved' && item.severity === 'info') },
    { title: 'Недавно решено', items: alerts.filter((item) => item.status === 'resolved').slice(0, 10) },
  ], [alerts]);

  async function perform(alert: AlertView, action: OperatorAlertAction, extra: Record<string, unknown> = {}) {
    const idempotencyKey = `${alert.id}:${action}:${JSON.stringify(extra)}`;
    setUpdating(alert.id); setError('');
    try {
      const response = await fetch(`/api/dashboard/booking-ops/alerts/${alert.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, idempotencyKey, ...extra }) });
      const body = await response.json() as Response;
      if (!response.ok || !body.ok) throw new Error(body.message || 'Не удалось выполнить действие.');
      if (action === 'request_missing_data' && body.actuallySent === false) window.alert('Черновик создан. Сообщение не отправлено.');
      setOpenForm(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось выполнить действие.'); }
    finally { setUpdating(null); }
  }

  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="ops-alerts-title">
    <div className="flex items-center justify-between gap-3"><div><h2 id="ops-alerts-title" className="text-lg font-semibold text-slate-900">Уведомления оператора</h2><p className="mt-1 text-sm text-slate-500">Действия меняют связанную задачу или создают безопасный черновик. Само уведомление не хранит рабочее состояние.</p></div><button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Обновить</button></div>
    {loading ? <p className="mt-4 text-sm text-slate-500">Загрузка…</p> : error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : alerts.length === 0 ? <p className="mt-4 text-sm text-slate-500">Уведомлений нет.</p> : <div className="mt-4 grid gap-4 lg:grid-cols-2">{groups.map((group) => <div key={group.title}><h3 className="text-sm font-semibold text-slate-700">{group.title} · {group.items.length}</h3><div className="mt-2 space-y-2">{group.items.length === 0 ? <p className="text-sm text-slate-400">Нет уведомлений</p> : group.items.map((alert) => {
      const values = forms[alert.id] ?? emptyForm();
      return <article key={alert.id} className={`rounded-lg border p-3 ${alert.severity === 'critical' ? 'border-red-200 bg-red-50' : alert.status === 'resolved' ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">{severityLabel[alert.severity]}</span><span>{gateLabel[alert.sourceGate] ?? alert.sourceGate}</span><span>{alert.status === 'acknowledged' ? 'В работе' : alert.status === 'resolved' ? 'Решено' : 'Открыто'}</span></div>
        <p className="mt-1 font-medium text-slate-900">{alert.title}</p><p className="mt-1 text-sm text-slate-700">{alert.description}</p><p className="mt-1 text-sm text-slate-600">Что сделать: {alert.recommendedAction}</p>
        <p className="mt-1 text-xs text-slate-500">Бронь: {alert.bookingId} · Объект: {alert.propertyId} · {timeLabel(alert)}</p>
        {alert.control.linkedObject ? <p className="mt-1 text-xs text-slate-500">Связано: {alert.control.linkedObject.kind === 'cleaning' ? 'уборка' : 'задача'} · {alert.control.linkedObject.status}</p> : null}
        <div className="mt-2 flex flex-wrap gap-3 text-sm">{alert.control.navigation.map((item) => <a key={`${item.kind}:${item.href}`} className="text-blue-700 underline" href={item.href}>{item.label}</a>)}</div>
        <div className="mt-2 space-y-1">{alert.control.actions.map((option) => <div key={option.action}>
          <button disabled={updating === alert.id || !option.enabled} type="button" title={option.disabledReason ?? undefined} onClick={() => option.input === 'none' ? void perform(alert, option.action) : setOpenForm({ alertId: alert.id, action: option.action })} className="text-sm text-slate-700 underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">{option.label}</button>
          {!option.enabled && option.disabledReason ? <span className="ml-2 text-xs text-slate-500">{option.disabledReason}</span> : null}
          {openForm?.alertId === alert.id && openForm.action === option.action && option.input !== 'none' ? <ActionForm alert={alert} action={option.action} values={values} disabled={updating === alert.id} onChange={(next) => setForms((current) => ({ ...current, [alert.id]: next }))} onCancel={() => setOpenForm(null)} onSubmit={(payload) => void perform(alert, option.action, payload)} /> : null}
        </div>)}</div>
        {alert.control.recentHistory.length ? <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Последние действия</summary><ul className="mt-1 space-y-1">{alert.control.recentHistory.map((item) => <li key={item.id}>{new Date(item.createdAt).toLocaleString('ru-RU')} · {historyActionLabel[item.action] ?? item.action}{item.reason ? ` · ${item.reason}` : ''}</li>)}</ul></details> : null}
      </article>;
    })}</div></div>)}</div>}
  </section>;
}
