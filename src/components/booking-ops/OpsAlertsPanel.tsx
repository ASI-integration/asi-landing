'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Alert = { id: string; booking_id: string; property_id: string; alert_code: string; source_gate: string; severity: 'info' | 'warning' | 'critical'; status: 'open' | 'acknowledged' | 'resolved'; title: string; next_check_in_at: string | null; deadline_at: string | null; resolved_at: string | null };
type Response = { ok: boolean; message?: string; alerts?: Alert[]; alert?: Alert };

const gateLabel: Record<string, string> = { cleaning: 'Уборка', linen: 'Бельё', inspection: 'Осмотр', maintenance: 'Обслуживание', readiness: 'Готовность' };
const severityLabel = { critical: 'Срочно', warning: 'Требует внимания', info: 'Информация' } as const;

function timeLabel(alert: Alert) {
  const target = alert.deadline_at || alert.next_check_in_at;
  if (!target) return 'Срок не указан';
  const minutes = Math.round((new Date(target).getTime() - Date.now()) / 60_000);
  if (minutes < 0) return `Просрочено на ${Math.abs(minutes)} мин.`;
  return `Осталось ${minutes} мин.`;
}

export function OpsAlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/dashboard/booking-ops/alerts?activeOnly=false', { credentials: 'include' });
      const body = await response.json() as Response;
      if (!response.ok || !body.ok) throw new Error(body.message || 'Не удалось загрузить уведомления.');
      setAlerts(body.alerts ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить уведомления.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => [
    { title: 'Срочно', items: alerts.filter((a) => a.status !== 'resolved' && a.severity === 'critical') },
    { title: 'Требует внимания', items: alerts.filter((a) => a.status !== 'resolved' && a.severity === 'warning') },
    { title: 'Ближайшие сроки', items: alerts.filter((a) => a.status !== 'resolved' && a.severity === 'info') },
    { title: 'Недавно решено', items: alerts.filter((a) => a.status === 'resolved').slice(0, 10) },
  ], [alerts]);

  async function acknowledge(id: string) {
    setUpdating(id); setError('');
    try {
      const response = await fetch(`/api/dashboard/booking-ops/alerts/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'acknowledge' }) });
      const body = await response.json() as Response;
      if (!response.ok || !body.ok || !body.alert) throw new Error(body.message || 'Не удалось подтвердить уведомление.');
      setAlerts((current) => current.map((item) => item.id === id ? body.alert! : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось подтвердить уведомление.'); }
    finally { setUpdating(null); }
  }

  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="ops-alerts-title">
    <div className="flex items-center justify-between gap-3"><div><h2 id="ops-alerts-title" className="text-lg font-semibold text-slate-900">Операционные уведомления</h2><p className="mt-1 text-sm text-slate-500">Сроки подготовки объектов к ближайшим заездам.</p></div><button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Обновить</button></div>
    {loading ? <p className="mt-4 text-sm text-slate-500">Загрузка…</p> : error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : alerts.length === 0 ? <p className="mt-4 text-sm text-slate-500">Активных уведомлений нет.</p> : <div className="mt-4 grid gap-4 lg:grid-cols-2">{groups.map((group) => <div key={group.title}><h3 className="text-sm font-semibold text-slate-700">{group.title} · {group.items.length}</h3><div className="mt-2 space-y-2">{group.items.length === 0 ? <p className="text-sm text-slate-400">Нет уведомлений</p> : group.items.map((alert) => <article key={alert.id} className={`rounded-lg border p-3 ${alert.severity === 'critical' ? 'border-red-200 bg-red-50' : alert.status === 'resolved' ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">{severityLabel[alert.severity]}</span><span>{gateLabel[alert.source_gate] ?? alert.source_gate}</span><span>{alert.status === 'acknowledged' ? 'Подтверждено' : alert.status === 'resolved' ? 'Решено' : 'Открыто'}</span></div><p className="mt-1 font-medium text-slate-900">{alert.title}</p><p className="mt-1 text-sm text-slate-600">Объект: {alert.property_id} · {timeLabel(alert)}</p><p className="mt-1 text-xs text-slate-500">Заезд: {alert.next_check_in_at ? new Date(alert.next_check_in_at).toLocaleString('ru-RU') : 'не указан'} · срок: {alert.deadline_at ? new Date(alert.deadline_at).toLocaleString('ru-RU') : 'не указан'}</p><div className="mt-2 flex gap-3 text-sm"><a className="text-blue-700 underline" href={`/dashboard/booking-ops?bookingId=${encodeURIComponent(alert.booking_id)}`}>Открыть бронь</a>{alert.status === 'open' ? <button disabled={updating === alert.id} type="button" onClick={() => void acknowledge(alert.id)} className="text-slate-700 underline disabled:opacity-50">{updating === alert.id ? 'Подтверждаем…' : 'Подтвердить'}</button> : null}</div></article>)}</div></div>)}</div>}
  </section>;
}
