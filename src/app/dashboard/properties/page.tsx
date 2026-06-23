'use client';

import { useCallback, useEffect, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import { readResponseJson } from '@/lib/safeResponseJson';
import {
  COMMUNICATION_MODE_LABELS_RU,
  type CommunicationMode,
} from '@/lib/communication/communication-autopilot-settings';
import type { PilotReadinessResult } from '@/lib/pilot-readiness/types';

type ReadinessResponse = {
  ok: boolean;
  message?: string;
  results: PilotReadinessResult[];
  summary?: { total: number; ready: number; notReady: number };
  isOpsAdmin?: boolean;
};

const MODE_OPTIONS: CommunicationMode[] = ['off', 'manual', 'autopilot'];

function PropertiesPageInner() {
  const [results, setResults] = useState<PilotReadinessResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [isOpsAdmin, setIsOpsAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/pilot-readiness', { credentials: 'include' });
      const payload = await readResponseJson<ReadinessResponse>(res, { ok: false, results: [] });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить готовность объектов.');
        return;
      }
      setResults(payload.results);
      setIsOpsAdmin(Boolean(payload.isOpsAdmin));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncOps() {
    setSyncing(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/pilot-readiness', {
        method: 'PUT',
        credentials: 'include',
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(res, { ok: false });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось синхронизировать OPS-задачи.');
        return;
      }
      setMessage('OPS-задачи обновлены.');
      await load();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Объекты</h1>
          <p className="mt-2 text-lg text-slate-500 leading-relaxed">
            Чеклист готовности к пилоту. Недостающие данные создают OPS-задачи автоматически.
          </p>
        </div>
        {isOpsAdmin ? (
          <button
            type="button"
            onClick={() => void syncOps()}
            disabled={syncing}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {syncing ? 'Синхронизация…' : 'Обновить OPS-задачи'}
          </button>
        ) : null}
      </header>

      {message ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <p className="text-slate-500">Загрузка…</p>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5">
          <p className="text-base font-medium text-amber-800">Пилотные объекты пока не добавлены</p>
          <p className="mt-1 text-sm text-amber-700">
            Добавьте объект через ранний доступ или админский API, затем заполните паспорт объекта.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((item) => (
            <section key={item.propertyId} className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">
                    {item.objectLabel || item.propertyId}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">{item.propertyId}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    item.ready
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {item.ready ? 'Готов к пилоту' : 'Не готов'}
                </span>
              </div>
              <ul className="mt-5 space-y-2">
                {item.checks.map((check) => (
                  <li key={check.id} className="flex items-start gap-3 text-sm">
                    <span
                      className={`mt-0.5 inline-block h-2.5 w-2.5 rounded-full ${
                        check.ok ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <div>
                      <p className="font-medium text-slate-800">{check.labelRu}</p>
                      {check.detailRu ? (
                        <p className="text-slate-500">{check.detailRu}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Режимы коммуникации</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          {MODE_OPTIONS.map((mode) => (
            <li key={mode}>
              <span className="font-medium text-slate-800">{COMMUNICATION_MODE_LABELS_RU[mode]}</span>
              {mode === 'off' ? ' — бот не отвечает автоматически' : null}
              {mode === 'manual' ? ' — классификация и OPS без автоответов гостю' : null}
              {mode === 'autopilot' ? ' — безопасные ответы по паспорту, проблемы в эскалацию' : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function PropertiesPage() {
  return (
    <CrmAccessGuard>
      <PropertiesPageInner />
    </CrmAccessGuard>
  );
}
