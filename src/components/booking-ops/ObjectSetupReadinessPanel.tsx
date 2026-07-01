'use client';

import { useCallback, useEffect, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import { labelMissingField } from '@/lib/booking-ops/owner-object-setup-display';

type PropertySetupRow = {
  id: string;
  title: string | null;
  status: string;
  readinessScore: number;
  photosStatus: string;
  rulesStatus: string;
  pricingStatus: string;
  wifiStatus: string;
  channelAccessStatus: string;
  missingFields: string[];
  metadata: { channel_handoff_status?: string | null };
};

type ListResponse = {
  ok: boolean;
  records?: PropertySetupRow[];
};

export function ObjectSetupReadinessPanel() {
  const [records, setRecords] = useState<PropertySetupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/property-setup/list?limit=10', { credentials: 'include' });
      const payload = await readResponseJson<ListResponse>(res, { ok: false, records: [] });
      if (payload.ok && payload.records) setRecords(payload.records);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Загрузка готовности объектов…
      </section>
    );
  }

  if (records.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Нет активных профилей настройки объектов.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Готовность настройки объектов</h2>
      <p className="mt-1 text-xs text-slate-500">Компактный статус сбора данных владельцами.</p>
      <div className="mt-3 divide-y divide-slate-100">
        {records.map((row) => {
          const expanded = expandedId === row.id;
          const handoff = row.metadata?.channel_handoff_status ?? null;
          return (
            <div key={row.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-slate-900">{row.title ?? 'Без названия'}</div>
                  <div className="text-xs text-slate-500">
                    {row.status} · {row.readinessScore}%
                    {handoff ? ` · ${handoff}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-blue-700 underline"
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                >
                  {expanded ? 'Свернуть' : 'Детали'}
                </button>
              </div>
              {expanded ? (
                <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                  <span>Фото: {row.photosStatus}</span>
                  <span>Правила: {row.rulesStatus}</span>
                  <span>Цена: {row.pricingStatus}</span>
                  <span>Wi-Fi: {row.wifiStatus}</span>
                  <span>Доступ МК: {row.channelAccessStatus}</span>
                  <span>
                    Не хватает:{' '}
                    {row.missingFields.length
                      ? row.missingFields.map(labelMissingField).join(', ')
                      : 'ничего'}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
