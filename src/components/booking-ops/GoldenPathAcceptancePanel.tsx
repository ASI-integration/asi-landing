'use client';

import { useState } from 'react';

type Report = { overall: 'PASS' | 'FAIL' | 'PLANNED'; dryRun: boolean; finalReservationStatus: string; finalLifecycleStage: string | null; realMessagesSent: number; externalCalls: number; blockers: string[]; steps: Array<{ key: string; status: string; detail: string }> };

export function GoldenPathAcceptancePanel({ bookingId }: { bookingId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(confirm: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/booking-ops-golden-path-acceptance', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookingOpsRecordId: bookingId, dryRun: !confirm, confirm }) });
      const payload = await response.json() as { report?: Report; message?: string };
      if (!payload.report) throw new Error(payload.message ?? 'Не удалось выполнить проверку.');
      setReport(payload.report);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось выполнить проверку.'); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold text-violet-950">Проверка полного пути тестовой брони</h3><p className="mt-1 text-sm text-violet-800">Только для тестовой брони. Сообщения и внешние сервисы отключены.</p></div>
      <div className="flex gap-2"><button disabled={busy} onClick={() => void run(false)} className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm text-violet-900">Показать план</button><button disabled={busy} onClick={() => { if (window.confirm('Запустить полный путь только для отмеченной тестовой брони?')) void run(true); }} className="rounded-lg bg-violet-700 px-3 py-2 text-sm text-white">Запустить с подтверждением</button></div>
    </div>
    {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    {report ? <div className="mt-4 space-y-3 text-sm"><div className="flex flex-wrap gap-3"><strong className={report.overall === 'FAIL' ? 'text-red-700' : report.overall === 'PASS' ? 'text-emerald-700' : 'text-violet-800'}>{report.overall}</strong><span>Статус: {report.finalReservationStatus}</span><span>Этап: {report.finalLifecycleStage ?? 'не начат'}</span><span>Отправлено сообщений: {report.realMessagesSent}</span><span>Внешних вызовов: {report.externalCalls}</span></div>{report.blockers.length ? <p className="text-amber-800">Нужно проверить: {report.blockers.join(', ')}</p> : null}<ol className="max-h-72 space-y-1 overflow-auto">{report.steps.map((step) => <li key={step.key} className="rounded bg-white px-3 py-2"><span className="mr-2 font-semibold">{step.status}</span>{step.detail}</li>)}</ol></div> : null}
  </section>;
}
