'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { OnboardingData } from '@/lib/ops-v17/types';
import { OWNER_CHANGE_FIELDS } from '@/lib/ops-v17/change-policy';

type WorkspaceResponse = {
  ok?: boolean;
  message?: string;
  workspace?: { onboarding: { data: OnboardingData }; progress?: { percentage: number } } | null;
};

type EditableStep = 'business' | 'owner' | 'properties' | 'operations';
type ChangeReceipt = {
  id: string;
  section: string;
  status: 'applied_internal' | 'conflict';
  external_status: string;
  explanation: string;
  created_at: string;
};

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';
const labelClass = 'block text-sm font-medium text-slate-700';
const saveClass = 'rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

const sections: { key: EditableStep; title: string; lead: string }[] = [
  { key: 'business', title: 'Компания', lead: 'Данные для идентификации вашего рабочего пространства.' },
  { key: 'owner', title: 'Контакты', lead: 'К кому обращаться в ситуациях, требующих решения.' },
  { key: 'properties', title: 'Объекты', lead: 'Названия и адреса для подготовки подключения и сверки.' },
  { key: 'operations', title: 'Правила работы', lead: 'Время заезда, выезда и порядок уборки.' },
];

export default function DataAndChangesPage() {
  const [data, setData] = useState<OnboardingData>({});
  const [baseline, setBaseline] = useState<OnboardingData>({});
  const [history, setHistory] = useState<ChangeReceipt[]>([]);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<EditableStep>('business');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [mode, setMode] = useState<'initial' | 'updates'>('initial');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dashboard/ops-v17?view=intake', { credentials: 'include', cache: 'no-store' });
      const payload = await readResponseJson<WorkspaceResponse>(res, { ok: false });
      if (!res.ok || !payload.ok) throw new Error('Не удалось загрузить данные вашего рабочего пространства.');
      const next = payload.workspace?.onboarding?.data ?? {};
      setData(next);
      setBaseline(next);
      setLoaded(true);
      const hasKnownData = Boolean(next.business?.name || next.owner?.name || next.properties?.length || next.rentalConnection?.step);
      setMode(hasKnownData ? 'updates' : 'initial');
    } catch {
      setError('Не удалось загрузить данные. Сохранение недоступно; попробуйте обновить страницу.');
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/ops-v17/changes', { credentials: 'include', cache: 'no-store' });
      const payload = await readResponseJson<{ ok?: boolean; changes?: ChangeReceipt[] }>(response, { ok: false });
      if (!response.ok || !payload.ok || !Array.isArray(payload.changes)) throw new Error('history_unavailable');
      setHistory(payload.changes);
      setHistoryUnavailable(false);
    } catch {
      setHistoryUnavailable(true);
    }
  }, []);

  useEffect(() => { void load(); void loadHistory(); }, [load, loadHistory]);

  const current = useMemo(() => sections.find((s) => s.key === section)!, [section]);

  const setField = (step: EditableStep, key: string, value: string) => {
    setFeedback('');
    if (step === 'business') setData((p) => ({ ...p, business: { ...p.business, [key]: value } }));
    if (step === 'owner') setData((p) => ({ ...p, owner: { ...p.owner, [key]: value } }));
    if (step === 'operations') setData((p) => ({ ...p, operations: { ...p.operations, [key]: value } }));
  };

  const save = async () => {
    if (saving || loading || !loaded || section === 'properties') return;
    setSaving(true);
    setFeedback('');
    setError('');

    const fields = OWNER_CHANGE_FIELDS[section];
    const currentSection = (data[section] ?? {}) as Record<string, string | undefined>;
    const values = Object.fromEntries(fields.map((key) => [key, currentSection[key] ?? '']));
    const expected = baseline[section] ?? {};
    try {
      const response = await fetch('/api/dashboard/ops-v17/changes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), section, values, expected }),
      });
      const result = await readResponseJson<{
        ok?: boolean;
        message?: string;
        result?: { status?: string; externalStatus?: string; explanation?: string };
      }>(response, { ok: false });
      if (!response.ok || !result.ok || result.result?.status !== 'applied_internal') {
        if (response.status === 409) {
          setError(result.message || 'Обнаружены новые изменения. Проверьте актуальные данные перед повторным сохранением.');
          await load();
          await loadHistory();
          return;
        }
        throw new Error('save_failed');
      }
      setBaseline((previous) => ({
        ...previous,
        [section]: { ...(previous[section] ?? {}), ...values },
      }));
      setFeedback(result.result.explanation || 'Внутреннее изменение подтверждено.');
      await loadHistory();
    } catch {
      setError('Не удалось подтвердить применение. Проверьте историю перед повторным сохранением.');
      await loadHistory();
    } finally {
      setSaving(false);
    }
  };

  const field = (name: string, value: string, onChange: (value: string) => void, type: 'text' | 'email' | 'tel' | 'time' = 'text') => (
    <label className={labelClass} key={name}>
      {name}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className={inputClass} maxLength={300} autoComplete="off" />
    </label>
  );

  return (
    <main className="mx-auto max-w-5xl space-y-7">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Данные и изменения</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Введите сведения при подключении и возвращайтесь сюда, когда что-то изменится.
          ASI использует проверенные данные для настройки автоматической работы.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Тип ввода">
        <button type="button" aria-pressed={mode === 'initial'} onClick={() => setMode('initial')}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${mode === 'initial' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
          Первичное заполнение
        </button>
        <button type="button" aria-pressed={mode === 'updates'} onClick={() => setMode('updates')}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${mode === 'updates' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
          Изменить данные
        </button>
      </div>

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="text-base font-semibold text-slate-900">
          {mode === 'initial' ? 'Начните с подключения первого объекта' : 'Корректировки без перехода в ручное управление'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          {mode === 'initial'
            ? 'Для первого объекта используйте специальную анкету с правилами проживания, Wi-Fi, инструкциями доступа и источниками бронирований.'
            : 'Обновляйте справочные сведения ниже. Сохранение анкеты не меняет автоматически действующие календари, доступы, цены или сообщения гостям. Для таких изменений нужна проверка интеграции.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/dashboard/channel-connections?setup=1"
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            {mode === 'initial' ? 'Начать подключение объекта' : 'Проверить данные первого объекта'}
          </Link>
          <Link href="/dashboard/channel-connections" className="rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-blue-100">
            Каналы бронирования
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Анкета рабочего пространства</h2>
            <p className="mt-1 text-sm text-slate-600">Заполните только нужный раздел. Всё сохраняется в вашем аккаунте.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading || saving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-800 disabled:opacity-50">Перечитать данные</button>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Разделы анкеты">
          {sections.map((item) => (
            <button key={item.key} type="button" onClick={() => { setSection(item.key); setFeedback(''); setError(''); }}
              aria-current={section === item.key ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${section === item.key ? 'bg-blue-100 text-blue-900' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
              {item.title}
            </button>
          ))}
        </nav>

        {loading ? <p role="status" className="mt-6 text-slate-600">Загружаем данные…</p> : loaded ? (
          <div className="mt-6 space-y-5">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{current.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{current.lead}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {section === 'business' ? <>
                {field('Название компании', data.business?.name ?? '', (v) => setField('business', 'name', v))}
                {field('Юридическое название (если есть)', data.business?.legalName ?? '', (v) => setField('business', 'legalName', v))}
              </> : null}
              {section === 'owner' ? <>
                {field('Имя ответственного', data.owner?.name ?? '', (v) => setField('owner', 'name', v))}
                {field('Телефон', data.owner?.phone ?? '', (v) => setField('owner', 'phone', v), 'tel')}
                {field('Email', data.owner?.email ?? '', (v) => setField('owner', 'email', v), 'email')}
              </> : null}
              {section === 'operations' ? <>
                {field('Время заезда', data.operations?.checkInTime ?? '', (v) => setField('operations', 'checkInTime', v), 'time')}
                {field('Время выезда', data.operations?.checkOutTime ?? '', (v) => setField('operations', 'checkOutTime', v), 'time')}
                <label className={`${labelClass} sm:col-span-2`}>Правила уборки
                  <textarea className={inputClass} rows={3} value={data.operations?.cleaningRule ?? ''}
                    onChange={(e) => setField('operations', 'cleaningRule', e.target.value)} maxLength={2000}/>
                </label>
              </> : null}
            </div>
            {section === 'properties' ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-5">
                <h4 className="font-semibold text-slate-900">Объекты подключаются через проверенную форму</h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  Чтобы ASI использовал адреса и инструкции в реальной работе, объект должен быть создан
                  в принадлежащем вам аккаунте и пройти проверку. Просто добавить название в черновик недостаточно.
                </p>
                <Link href="/dashboard/channel-connections?setup=1"
                  className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
                  Открыть паспорт объекта
                </Link>
                <p className="mt-4 text-xs text-slate-600">
                  Для изменения уже работающего объекта пока требуется подтверждение ASI.
                  Сохранение другой анкеты не обновляет параметры заселения или каналов автоматически.
                </p>
              </div>
            ) : null}
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            {feedback ? <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{feedback}</p> : null}
            <div className="flex flex-wrap items-center gap-4">
              {section !== 'properties' ? (
                <button type="button" disabled={saving || loading} onClick={() => void save()} className={saveClass}>
                  {saving ? 'Сохраняем…' : 'Сохранить раздел'}
                </button>
              ) : null}
              <p className="text-xs text-slate-500">Доступно повторное редактирование в любой момент.</p>
            </div>
          </div>
        ) : (
          <p role="alert" className="mt-6 text-sm text-red-700">{error || 'Данные недоступны.'}</p>
        )}
      </section>
    </main>
  );
}
