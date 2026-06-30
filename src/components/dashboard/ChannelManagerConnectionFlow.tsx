'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CHANNEL_MANAGER_ACCESS_SITUATION_LABELS,
  CHANNEL_MANAGER_CONNECTION_METHOD_LABELS,
  CHANNEL_MANAGER_CONNECTION_STATUS_LABELS,
  type ChannelManagerAccessSituation,
  type ChannelManagerConnectionMethod,
  type ChannelManagerConnectionState,
} from '@/lib/channel-manager-connection';

type FlowProps = {
  contactId: string;
  objectId: string;
  source: string;
};

type FlowContext = {
  flowReady: boolean;
  objectTitle: string;
  connection: ChannelManagerConnectionState;
};

const METHOD_OPTIONS: ChannelManagerConnectionMethod[] = [
  'realtycalendar',
  'bnovo',
  'manual_import',
  'other',
  'none_yet',
];

const ACCESS_OPTIONS: ChannelManagerAccessSituation[] = ['has_access', 'from_scratch', 'needs_help'];

async function postAction(
  payload: Record<string, string>,
): Promise<{ ok: boolean; connection?: ChannelManagerConnectionState; message?: string }> {
  const response = await fetch('/api/dashboard/channel-manager-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as {
    ok: boolean;
    connection?: ChannelManagerConnectionState;
    message?: string;
  };
  if (!response.ok || !data.ok) {
    return { ok: false, message: data.message ?? 'Не удалось сохранить.' };
  }
  return { ok: true, connection: data.connection };
}

function StepCard({
  title,
  children,
  details,
}: {
  title: string;
  children: React.ReactNode;
  details?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
      {details ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            {open ? 'Скрыть подробнее' : 'Подробнее'}
          </button>
          {open ? <p className="mt-2 text-sm text-slate-500 leading-relaxed">{details}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function ChannelManagerConnectionFlow({ contactId, objectId, source }: FlowProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<FlowContext | null>(null);
  const [customName, setCustomName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ contactId, objectId, source });
      const response = await fetch(`/api/dashboard/channel-manager-connection?${params.toString()}`);
      const data = (await response.json()) as FlowContext & { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setError(data.message ?? 'Не удалось загрузить процесс подключения.');
        setContext(null);
        return;
      }
      setContext({
        flowReady: data.flowReady,
        objectTitle: data.objectTitle,
        connection: data.connection,
      });
      if (data.flowReady && !data.connection.method && !data.connection.updatedAt) {
        const opened = await postAction({ contactId, objectId, action: 'open_flow' });
        if (opened.ok && opened.connection) {
          setContext({
            flowReady: data.flowReady,
            objectTitle: data.objectTitle,
            connection: opened.connection,
          });
          return;
        }
      }
    } catch {
      setError('Не удалось загрузить процесс подключения.');
    } finally {
      setLoading(false);
    }
  }, [contactId, objectId, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const connection = context?.connection;
  const statusLabel = connection
    ? CHANNEL_MANAGER_CONNECTION_STATUS_LABELS[connection.status]
    : null;

  const ownerStep = useMemo(() => {
    if (!connection?.method) return 'Выберите способ подключения.';
    if (connection.method === 'realtycalendar' || connection.method === 'bnovo') {
      if (!connection.accessSituation) return 'Сообщите, есть ли доступ к кабинету Менеджера Каналов.';
      if (connection.accessSituation === 'from_scratch') return 'Откройте доступы по инструкции ASI или напишите в Telegram.';
      if (connection.accessSituation === 'has_access') return 'Передайте доступы оператору ASI в удобном формате.';
      return 'Ожидайте ответа оператора в Telegram.';
    }
    if (connection.method === 'other' && !connection.customManagerName) {
      return 'Укажите название вашего менеджера каналов.';
    }
    if (connection.method === 'none_yet') {
      return 'Начните с базового контура ASI — оператор свяжется для первичной настройки.';
    }
    return 'Подтвердите данные объекта, если ASI запросит уточнение.';
  }, [connection]);

  const asiStep = useMemo(() => {
    if (!connection?.method) return 'ASI подготовит объектный процесс подключения.';
    return connection.nextStepRu;
  }, [connection]);

  async function runAction(payload: Record<string, string>) {
    setSaving(true);
    setError(null);
    const result = await postAction(payload);
    if (!result.ok) {
      setError(result.message ?? 'Не удалось сохранить.');
      setSaving(false);
      return;
    }
    if (result.ok && result.connection) {
      setContext((prev) =>
        prev
          ? {
              ...prev,
              connection: result.connection!,
            }
          : prev,
      );
    }
    setSaving(false);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Загружаем процесс подключения…</p>;
  }

  if (error && !context) {
    return <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  }

  if (!context?.flowReady) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-2">
        <h2 className="text-lg font-semibold text-amber-900">Объект ещё не готов</h2>
        <p className="text-sm text-amber-800 leading-relaxed">
          Сначала завершите сбор данных в Telegram Wizard. Полный процесс подключения Менеджера каналов откроется,
          когда готовность объекта достигнет 100%.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-2">
        <p className="text-sm font-medium text-emerald-700">Рабочий процесс подключения</p>
        <h1 className="text-2xl font-bold text-slate-900">Менеджер Каналов</h1>
        <p className="text-sm text-slate-600">
          Объект: <span className="font-medium text-slate-800">{context.objectTitle}</span> ({objectId})
        </p>
        {statusLabel ? (
          <p className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700">
            {statusLabel}
          </p>
        ) : null}
        <p className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          На пилоте ASI готовит данные и контролирует этап подключения. Публикация на площадках и импорт могут выполняться вручную или полуавтоматически — прямой отправки во все площадки сейчас нет.
        </p>
      </header>

      <StepCard
        title="1. Что подключаем"
        details="ASI подключается к вашему Менеджеру Каналов или начинает с ручного контура, чтобы собрать календарь, цены и брони в одном месте."
      >
        <p className="text-sm text-slate-600 leading-relaxed">
          Объект прошёл онбординг и готов к следующему шагу — подключению каналов бронирования через Менеджер Каналов
          или альтернативный контур ASI.
        </p>
      </StepCard>

      <StepCard title="2. Как подключаем">
        {!connection?.method ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {METHOD_OPTIONS.map((method) => (
              <button
                key={method}
                type="button"
                disabled={saving}
                onClick={() => void runAction({ contactId, objectId, action: 'select_method', method })}
                className="group flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block text-sm font-semibold text-slate-900">
                  {CHANNEL_MANAGER_CONNECTION_METHOD_LABELS[method]}
                </span>
                <span className="shrink-0 rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white group-hover:bg-emerald-700">
                  Выбрать
                </span>
              </button>
            ))}
          </div>
        ) : connection.method === 'realtycalendar' || connection.method === 'bnovo' ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Выбрано: <span className="font-medium">{CHANNEL_MANAGER_CONNECTION_METHOD_LABELS[connection.method]}</span>
            </p>
            {!connection.accessSituation ? (
              <div className="grid gap-2">
                {ACCESS_OPTIONS.map((access) => (
                  <button
                    key={access}
                    type="button"
                    disabled={saving}
                    onClick={() => void runAction({ contactId, objectId, action: 'select_access', access })}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>{CHANNEL_MANAGER_ACCESS_SITUATION_LABELS[access]}</span>
                    <span className="shrink-0 text-xs font-semibold text-emerald-700">Выбрать</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Доступ: {CHANNEL_MANAGER_ACCESS_SITUATION_LABELS[connection.accessSituation]}
              </p>
            )}
          </div>
        ) : connection.method === 'manual_import' ? (
          <p className="text-sm text-slate-600 leading-relaxed">
            ASI начнёт с ручной или полуавтоматической загрузки данных объекта, пока готовится прямое подключение.
          </p>
        ) : connection.method === 'other' ? (
          <div className="space-y-3">
            {!connection.customManagerName ? (
              <>
                <label className="block text-sm font-medium text-slate-700" htmlFor="custom-cm-name">
                  Название Менеджера Каналов
                </label>
                <input
                  id="custom-cm-name"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder="Например, TravelLine"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={saving || !customName.trim()}
                  onClick={() =>
                    void runAction({
                      contactId,
                      objectId,
                      action: 'set_custom_name',
                      customName: customName.trim(),
                    })
                  }
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Сохранить
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                Другой Менеджер Каналов: <span className="font-medium">{connection.customManagerName}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600 leading-relaxed">
            Пока нет Менеджера Каналов — ASI предложит начать с базового контура и первичной настройки.
          </p>
        )}
      </StepCard>

      <StepCard title="3. Что нужно от владельца">
        <p className="text-sm text-slate-700 leading-relaxed">{ownerStep}</p>
      </StepCard>

      <StepCard title="4. Что ASI сделает дальше">
        <p className="text-sm text-slate-700 leading-relaxed">{asiStep}</p>
      </StepCard>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
