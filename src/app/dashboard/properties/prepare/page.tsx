'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { PilotReadinessCheck, PilotReadinessResult } from '@/lib/pilot-readiness/types';

type ReadinessResponse = {
  ok: boolean;
  message?: string;
  results: PilotReadinessResult[];
  isOpsAdmin?: boolean;
};

type SaveBlock = 'basics' | 'access' | 'channels' | 'communication';

function PrepareWizardInner() {
  const searchParams = useSearchParams();
  const initialPropertyId = searchParams.get('propertyId') ?? '';

  const [results, setResults] = useState<PilotReadinessResult[]>([]);
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isOpsAdmin, setIsOpsAdmin] = useState(false);

  const [objectName, setObjectName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [wifiName, setWifiName] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [accessNotes, setAccessNotes] = useState('');
  const [bookingChannels, setBookingChannels] = useState('');
  const [photosDeferred, setPhotosDeferred] = useState(false);
  const [communicationMode, setCommunicationMode] = useState('manual');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/pilot-readiness', { credentials: 'include' });
      const payload = await readResponseJson<ReadinessResponse>(res, { ok: false, results: [] });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить объекты.');
        return;
      }
      setResults(payload.results);
      setIsOpsAdmin(Boolean(payload.isOpsAdmin));
      if (!propertyId && payload.results[0]) {
        setPropertyId(payload.results[0].propertyId);
      }
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => results.find((item) => item.propertyId === propertyId) ?? null,
    [results, propertyId],
  );

  const missingChecks = useMemo(
    () => selected?.checks.filter((check) => !check.ok) ?? [],
    [selected],
  );

  function needsBlock(checks: PilotReadinessCheck[], ids: string[]): boolean {
    return checks.some((check) => ids.includes(check.id));
  }

  const showBasics = needsBlock(missingChecks, ['name', 'address', 'description', 'rules', 'checkin_checkout']);
  const showAccess = needsBlock(missingChecks, ['wifi_access', 'photos']);
  const showChannels = needsBlock(missingChecks, ['channels']);
  const showCommunication = needsBlock(missingChecks, ['communication_mode']);

  async function saveBlock(block: SaveBlock) {
    if (!propertyId || !isOpsAdmin) return;
    setSaving(true);
    setMessage('');
    try {
      const body: Record<string, unknown> = { propertyId };
      if (block === 'basics') {
        body.objectName = objectName;
        body.address = address;
        body.description = description;
        body.rules = rules;
        body.checkInTime = checkInTime;
        body.checkOutTime = checkOutTime;
      }
      if (block === 'access') {
        body.wifiName = wifiName;
        body.wifiPassword = wifiPassword;
        body.accessNotes = accessNotes;
        body.photosDeferred = photosDeferred;
      }
      if (block === 'channels') {
        body.bookingChannels = bookingChannels;
      }
      if (block === 'communication') {
        body.communicationMode = communicationMode;
      }

      const res = await fetch('/api/dashboard/pilot-readiness', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string; result?: PilotReadinessResult }>(
        res,
        { ok: false },
      );
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось сохранить данные.');
        return;
      }
      setMessage('Сохранено. Готовность и OPS-задачи обновлены.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    if (!isOpsAdmin || !objectName.trim()) return;
    const draftId = `pilot_${Date.now().toString(36)}`;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/pilot-readiness', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId: draftId, objectName }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(res, { ok: false });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось создать черновик.');
        return;
      }
      setPropertyId(draftId);
      setMessage('Черновик создан.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!isOpsAdmin && !loading) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 text-amber-800">
        Мастер подготовки доступен только администратору OPS.
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <Link href="/dashboard/properties" className="text-sm text-slate-500 hover:text-slate-700">
          ← К списку объектов
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">Подготовить объект к пилоту</h1>
        <p className="mt-2 text-slate-500">
          Система подтягивает данные из паспорта объекта и показывает только недостающие блоки.
        </p>
      </header>

      {message ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <p className="text-slate-500">Загрузка…</p>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Объект</span>
              <select
                value={propertyId}
                onChange={(event) => setPropertyId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Создать новый черновик</option>
                {results.map((item) => (
                  <option key={item.propertyId} value={item.propertyId}>
                    {item.objectLabel || item.propertyId}
                  </option>
                ))}
              </select>
            </label>

            {!propertyId ? (
              <form onSubmit={createDraft} className="space-y-3">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Название нового объекта</span>
                  <input
                    required
                    value={objectName}
                    onChange={(event) => setObjectName(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Создать черновик
                </button>
              </form>
            ) : null}
          </section>

          {selected ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-slate-900">
                  {selected.objectLabel || selected.propertyId}
                </h2>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    selected.ready
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {selected.ready ? 'Готов к пилоту' : 'Не готов'}
                </span>
              </div>
              {!selected.ready && missingChecks.length > 0 ? (
                <p className="mt-3 text-sm text-slate-600">
                  Не хватает: {missingChecks.map((check) => check.labelRu).join(', ')}
                </p>
              ) : null}
            </section>
          ) : null}

          {propertyId && showBasics ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <h3 className="font-semibold text-slate-900">Основные данные</h3>
              <input value={objectName} onChange={(e) => setObjectName(e.target.value)} placeholder="Название" className="w-full rounded-lg border px-3 py-2" />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Адрес" className="w-full rounded-lg border px-3 py-2" />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание" rows={2} className="w-full rounded-lg border px-3 py-2" />
              <textarea value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Правила" rows={2} className="w-full rounded-lg border px-3 py-2" />
              <div className="grid gap-3 md:grid-cols-2">
                <input value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} placeholder="Заезд (15:00)" className="rounded-lg border px-3 py-2" />
                <input value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} placeholder="Выезд (12:00)" className="rounded-lg border px-3 py-2" />
              </div>
              <button type="button" disabled={saving} onClick={() => void saveBlock('basics')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white">
                Сохранить блок
              </button>
            </section>
          ) : null}

          {propertyId && showAccess ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <h3 className="font-semibold text-slate-900">Доступ и фото</h3>
              <input value={wifiName} onChange={(e) => setWifiName(e.target.value)} placeholder="Wi‑Fi" className="w-full rounded-lg border px-3 py-2" />
              <input value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} placeholder="Пароль Wi‑Fi" className="w-full rounded-lg border px-3 py-2" />
              <textarea value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="Инструкции доступа" rows={2} className="w-full rounded-lg border px-3 py-2" />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={photosDeferred} onChange={(e) => setPhotosDeferred(e.target.checked)} />
                Фото добавим позже
              </label>
              <button type="button" disabled={saving} onClick={() => void saveBlock('access')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white">
                Сохранить блок
              </button>
            </section>
          ) : null}

          {propertyId && showChannels ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <h3 className="font-semibold text-slate-900">Каналы бронирования</h3>
              <input value={bookingChannels} onChange={(e) => setBookingChannels(e.target.value)} placeholder="Авито, Суточно, вручную" className="w-full rounded-lg border px-3 py-2" />
              <button type="button" disabled={saving} onClick={() => void saveBlock('channels')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white">
                Сохранить блок
              </button>
            </section>
          ) : null}

          {propertyId && showCommunication ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <h3 className="font-semibold text-slate-900">Коммуникация</h3>
              <select value={communicationMode} onChange={(e) => setCommunicationMode(e.target.value)} className="w-full rounded-lg border px-3 py-2">
                <option value="off">Выключено</option>
                <option value="manual">Ручной режим</option>
                <option value="autopilot">Автопилот</option>
              </select>
              <button type="button" disabled={saving} onClick={() => void saveBlock('communication')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white">
                Сохранить блок
              </button>
            </section>
          ) : null}

          {selected?.ready ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-5 text-emerald-900">
              Объект готов к пилоту. Можно подключать брони и коммуникацию.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function PrepareWizardPage() {
  return (
    <CrmAccessGuard>
      <PrepareWizardInner />
    </CrmAccessGuard>
  );
}
