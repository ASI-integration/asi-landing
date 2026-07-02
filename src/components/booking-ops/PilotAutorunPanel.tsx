'use client';

import { useCallback, useEffect, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { PilotAutorunScopeType, PilotAutorunStatus } from '@/lib/booking-ops/pilot-autorun-orchestrator';

type ApiPayload = { ok: boolean; message?: string; result?: PilotAutorunStatus; status?: PilotAutorunStatus | null; explanation?: string };

const STATUS_LABELS: Record<string, string> = {
  queued: 'В очереди', running: 'Выполняется', completed: 'Завершён',
  completed_with_warnings: 'Завершён с предупреждениями', blocked: 'Заблокирован',
  failed: 'Ошибка', dry_run: 'Пробный запуск',
};

const SCOPE_LABELS: Record<PilotAutorunScopeType, string> = {
  lead: 'ID заявки', property_setup: 'ID профиля объекта', booking: 'ID операционной брони', batch: 'Пакет',
};

export function PilotAutorunPanel({ scope, initialRef = '' }: { scope: PilotAutorunScopeType; initialRef?: string }) {
  const [ref, setRef] = useState(initialRef);
  const [status, setStatus] = useState<PilotAutorunStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (initialRef) setRef(initialRef); }, [initialRef]);

  const loadStatus = useCallback(async () => {
    if (!ref.trim()) return;
    const res = await fetch(`/api/dashboard/pilot-autorun/status?scope=${scope}&ref=${encodeURIComponent(ref.trim())}`, { credentials: 'include' });
    const payload = await readResponseJson<ApiPayload>(res, { ok: false });
    if (payload.ok) setStatus(payload.status ?? null);
  }, [ref, scope]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function run(dryRun: boolean, forceRecompute = false) {
    if (!ref.trim()) { setMessage(`Укажите ${SCOPE_LABELS[scope].toLowerCase()}.`); return; }
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/dashboard/pilot-autorun/run', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, ref: ref.trim(), dryRun, forceRecompute, allowSafeCommunicationQueue: true }),
      });
      const payload = await readResponseJson<ApiPayload>(res, { ok: false });
      if (!payload.ok) { setMessage(payload.message ?? 'Не удалось выполнить автозапуск.'); return; }
      setStatus(payload.result ?? null); setMessage(dryRun ? 'Пробный запуск завершён без рабочих изменений.' : 'Автозапуск завершён.');
    } finally { setBusy(false); }
  }

  async function createFallback() {
    if (!ref.trim()) { setMessage(`Укажите ${SCOPE_LABELS[scope].toLowerCase()}.`); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/pilot-autorun/run', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, ref: ref.trim(), action: 'fallback', reason: 'Требуется ручная проверка оператора.' }),
      });
      const payload = await readResponseJson<ApiPayload>(res, { ok: false });
      if (!payload.ok) { setMessage(payload.message ?? 'Не удалось создать ручной шаг.'); return; }
      setStatus(payload.result ?? null); setMessage('Ручной шаг создан.');
    } finally { setBusy(false); }
  }

  async function explain() {
    if (!ref.trim()) return;
    const res = await fetch(`/api/dashboard/pilot-autorun/explain?scope=${scope}&ref=${encodeURIComponent(ref.trim())}`, { credentials: 'include' });
    const payload = await readResponseJson<ApiPayload>(res, { ok: false });
    setMessage(payload.explanation ?? payload.message ?? 'Объяснение пока недоступно.');
  }

  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Автозапуск пилота</h2>
          <p className="mt-1 text-xs text-slate-500">Без внешних вызовов, публикации и автоматической отправки сообщений.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {status ? STATUS_LABELS[status.status] ?? status.status : 'Ещё не запускался'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input aria-label={SCOPE_LABELS[scope]} value={ref} onChange={(event) => setRef(event.target.value)} placeholder={SCOPE_LABELS[scope]}
          className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button disabled={busy} onClick={() => void run(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50">Пробный запуск</button>
        <button disabled={busy} onClick={() => void run(false)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Запустить сейчас</button>
      </div>
      {status ? (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><span className="text-slate-500">Выполнено:</span> {status.stepsCompleted.length}</div>
          <div><span className="text-slate-500">Блокеров:</span> {status.blockers.length}</div>
          <div><span className="text-slate-500">Последний запуск:</span> {status.finishedAt ? new Date(status.finishedAt).toLocaleString('ru-RU') : '—'}</div>
          <div className="sm:col-span-3"><span className="text-slate-500">Следующий шаг:</span> {status.nextRequiredActions[0] ?? 'Дополнительных действий нет.'}</div>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}
      <details className="mt-3 border-t border-slate-100 pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Дополнительные действия</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => void run(true, true)} className="rounded-lg border border-slate-300 px-3 py-1.5">Пересчитать блокеры</button>
          <button disabled={busy} onClick={() => void createFallback()} className="rounded-lg border border-slate-300 px-3 py-1.5">Создать ручной шаг</button>
          <button disabled={busy} onClick={() => void explain()} className="rounded-lg border border-slate-300 px-3 py-1.5">Показать объяснение</button>
        </div>
        {status?.blockers.length ? <p className="mt-3 text-amber-800">{status.blockers.join(' ')}</p> : null}
        {status?.warnings.length ? <p className="mt-2 text-rose-700">{status.warnings.join(' ')}</p> : null}
      </details>
    </section>
  );
}
