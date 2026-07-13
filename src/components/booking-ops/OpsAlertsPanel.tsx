'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OperatorAlert } from '@/lib/booking-ops/operator-alerts';

type AlertView = OperatorAlert & { nextRetryAt: string | null };
type Response = { ok: boolean; message?: string; alerts?: OperatorAlert[]; alert?: OperatorAlert; approvedForQueue?: boolean; actuallySent?: boolean };
const severityLabel = { critical: 'Срочно', warning: 'Требует внимания', info: 'Информация' } as const;
const gateLabel: Record<string, string> = { cleaning: 'Уборка', linen: 'Бельё', inspection: 'Осмотр', maintenance: 'Обслуживание', readiness: 'Готовность', property_ready: 'Готовность' };

function view(alert: OperatorAlert): AlertView {
  return { ...alert, nextRetryAt: typeof alert.metadata.automationNextRetryAt === 'string' ? alert.metadata.automationNextRetryAt : null };
}

function timeLabel(alert: AlertView) {
  const target = alert.deadlineAt || alert.nextCheckInAt;
  if (!target) return 'срок не указан';
  const minutes = Math.round((new Date(target).getTime() - Date.now()) / 60_000);
  return minutes < 0 ? `просрочено на ${Math.abs(minutes)} мин.` : `осталось ${minutes} мин.`;
}

export function OpsAlertsPanel() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/dashboard/booking-ops/alerts?activeOnly=false', { credentials: 'include' });
      const body = await response.json() as Response;
      if (!response.ok || !body.ok) throw new Error(body.message || 'Не удалось загрузить исключения.');
      setAlerts((body.alerts ?? []).map(view));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить исключения.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => [
    { title: 'Срочно', items: alerts.filter((item) => item.status !== 'resolved' && item.severity === 'critical') },
    { title: 'Требует внимания', items: alerts.filter((item) => item.status !== 'resolved' && item.severity === 'warning') },
    { title: 'Информация', items: alerts.filter((item) => item.status !== 'resolved' && item.severity === 'info') },
    { title: 'Недавно решено', items: alerts.filter((item) => item.status === 'resolved').slice(0, 10) },
  ], [alerts]);

  async function perform(alert: AlertView, action: string) {
    const payload: Record<string, unknown> = { action };
    if (action === 'resolve_alert') {
      const reason = window.prompt('Укажите причину закрытия. Исключение появится снова, если проблема останется.');
      if (!reason) return;
      payload.reason = reason;
    }
    if (action === 'assign_cleaner') {
      const assignedToName = window.prompt('Укажите исполнителя уборки.');
      if (!assignedToName) return;
      payload.assignedToName = assignedToName;
    }
    setUpdating(alert.id); setError('');
    try {
      const response = await fetch(`/api/dashboard/booking-ops/alerts/${alert.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json() as Response;
      if (!response.ok || !body.ok) throw new Error(body.message || 'Не удалось выполнить действие.');
      if (body.approvedForQueue && !body.actuallySent) window.alert('Черновик разрешён для очереди, но ещё не отправлен.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось выполнить действие.'); }
    finally { setUpdating(null); }
  }

  function actions(alert: AlertView): Array<[string, string]> {
    if (alert.status === 'resolved') return [];
    const result: Array<[string, string]> = [['retry_automation', 'Повторить автоматизацию']];
    if (alert.metadata.referenceId && ['policy_review_required', 'approval_required'].includes(alert.alertCode)) result.push(['approve_prepared_communication', 'Разрешить для очереди']);
    if (alert.alertCode === 'no_eligible_cleaner' || alert.sourceGate === 'cleaning') result.push(['assign_cleaner', 'Назначить исполнителя']);
    if (alert.alertCode === 'physical_readiness_approval_required') result.push(['approve_property_readiness', 'Подтвердить готовность']);
    result.push(['resolve_alert', 'Закрыть исключение']);
    return result;
  }

  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="ops-alerts-title">
    <div className="flex items-center justify-between gap-3"><div><h2 id="ops-alerts-title" className="text-lg font-semibold text-slate-900">Исключения автоматизации</h2><p className="mt-1 text-sm text-slate-500">Здесь появляются только ситуации, где автоматизация не может безопасно продолжить.</p></div><button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Обновить</button></div>
    {loading ? <p className="mt-4 text-sm text-slate-500">Загрузка…</p> : error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : alerts.length === 0 ? <p className="mt-4 text-sm text-slate-500">Активных исключений нет.</p> : <div className="mt-4 grid gap-4 lg:grid-cols-2">{groups.map((group) => <div key={group.title}><h3 className="text-sm font-semibold text-slate-700">{group.title} · {group.items.length}</h3><div className="mt-2 space-y-2">{group.items.length === 0 ? <p className="text-sm text-slate-400">Нет исключений</p> : group.items.map((alert) => <article key={alert.id} className={`rounded-lg border p-3 ${alert.severity === 'critical' ? 'border-red-200 bg-red-50' : alert.status === 'resolved' ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">{severityLabel[alert.severity]}</span><span>{gateLabel[alert.sourceGate] ?? alert.sourceGate}</span><span>{alert.status === 'acknowledged' ? 'Подтверждено' : alert.status === 'resolved' ? 'Решено' : 'Открыто'}</span></div><p className="mt-1 font-medium text-slate-900">{alert.title}</p><p className="mt-1 text-sm text-slate-700">{alert.description}</p><p className="mt-1 text-sm text-slate-600">Что сделать: {alert.recommendedAction}</p>{alert.nextRetryAt ? <p className="mt-1 text-xs text-slate-500">Следующая попытка: {new Date(alert.nextRetryAt).toLocaleString('ru-RU')}</p> : null}<p className="mt-1 text-xs text-slate-500">Объект: {alert.propertyId} · {timeLabel(alert)}</p><div className="mt-2 flex flex-wrap gap-3 text-sm"><a className="text-blue-700 underline" href={`/dashboard/booking-ops?bookingId=${encodeURIComponent(alert.bookingId)}`}>Открыть бронь</a>{alert.status === 'open' ? <button disabled={updating === alert.id} type="button" onClick={() => void perform(alert, 'acknowledge')} className="text-slate-700 underline disabled:opacity-50">Подтвердить</button> : null}{actions(alert).map(([action, label]) => <button key={action} disabled={updating === alert.id} type="button" onClick={() => void perform(alert, action)} className="text-slate-700 underline disabled:opacity-50">{label}</button>)}</div></article>)}</div></div>)}</div>}
  </section>;
}
